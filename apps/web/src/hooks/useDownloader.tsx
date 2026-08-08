import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DownloadBatchWithItems, DownloadItem, DownloadLogLine } from '@sakuya/shared';
import { useToast } from '../components/Toast';

interface DownloaderState {
  batches: DownloadBatchWithItems[];
  logs: Record<number, DownloadLogLine[]>;
}

const DownloaderContext = createContext<DownloaderState>({ batches: [], logs: {} });

export function useDownloader() {
  return useContext(DownloaderContext);
}

const MAX_LOG_LINES = 500;

export function DownloaderProvider({ children }: { children: ReactNode }) {
  const [batches, setBatches] = useState<DownloadBatchWithItems[]>([]);
  const [logs, setLogs] = useState<Record<number, DownloadLogLine[]>>({});
  const queryClient = useQueryClient();
  const showToast = useToast();
  const knownStatus = useRef(new Map<number, string>());

  useEffect(() => {
    const source = new EventSource('/api/downloader/stream');
    source.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'snapshot') {
        setBatches(data.batches);
        for (const batch of data.batches as DownloadBatchWithItems[]) {
          for (const item of batch.items) knownStatus.current.set(item.id, item.status);
        }
        return;
      }

      if (data.type === 'item') {
        const item: DownloadItem = data.item;
        setBatches((prev) =>
          prev.map((batch) =>
            batch.id === item.batchId
              ? {
                  ...batch,
                  items: batch.items.some((i) => i.id === item.id)
                    ? batch.items.map((i) => (i.id === item.id ? item : i))
                    : [...batch.items, item],
                }
              : batch,
          ),
        );
        const prevStatus = knownStatus.current.get(item.id);
        knownStatus.current.set(item.id, item.status);
        if (prevStatus !== 'done' && item.status === 'done') {
          showToast(`Downloaded — ${item.url}`);
          queryClient.invalidateQueries({ queryKey: ['media'] });
          queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          queryClient.invalidateQueries({ queryKey: ['libraries'] });
        }
        if (prevStatus !== 'error' && item.status === 'error') {
          showToast(`Download failed — ${item.url}`);
        }
        return;
      }

      if (data.type === 'log') {
        const log: DownloadLogLine = data.log;
        setLogs((prev) => {
          const existing = prev[log.itemId] ?? [];
          return { ...prev, [log.itemId]: [...existing, log].slice(-MAX_LOG_LINES) };
        });
        return;
      }

      if (data.type === 'removed') {
        const { id, batchId } = data as { id: number; batchId: number };
        setBatches((prev) =>
          prev.map((batch) =>
            batch.id === batchId ? { ...batch, items: batch.items.filter((i) => i.id !== id) } : batch,
          ),
        );
        setLogs((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    };
    return () => source.close();
  }, [queryClient, showToast]);

  return <DownloaderContext.Provider value={{ batches, logs }}>{children}</DownloaderContext.Provider>;
}
