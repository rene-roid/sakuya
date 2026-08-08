import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download, Pause, Play, SkipForward, Trash2, Upload as UploadIcon } from 'lucide-react';
import type { DownloadBatchWithItems, DownloadItem, DownloadItemStatus } from '@sakuya/shared';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { useJobs } from '../../hooks/useJobs';
import { useDownloader } from '../../hooks/useDownloader';

const STATUS_COLOR: Record<DownloadItemStatus, string> = {
  queued: 'text-zinc-500',
  running: 'text-amber-500',
  paused: 'text-sky-400',
  done: 'text-green-500',
  error: 'text-red-500',
  skipped: 'text-zinc-600',
};

export function DownloaderPage() {
  const { data: status } = useQuery({ queryKey: ['downloader-status'], queryFn: api.downloaderStatus });
  const { data: libraries } = useQuery({ queryKey: ['libraries'], queryFn: api.libraries });
  const { data: cookies } = useQuery({ queryKey: ['downloader-cookies'], queryFn: api.listCookies });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const jobs = useJobs();
  const { batches } = useDownloader();
  const queryClient = useQueryClient();
  const showToast = useToast();

  const installJob = jobs.find(
    (j) => j.type === 'downloader-install' && (j.status === 'running' || j.status === 'queued'),
  );

  const installMutation = useMutation({
    mutationFn: () => api.installDownloader(),
    onSuccess: () => showToast('Installing gallery-dl…'),
    onError: (err: Error) => showToast(err.message),
  });

  const [urlsText, setUrlsText] = useState('');
  const [libraryId, setLibraryId] = useState<number | ''>('');
  const [folderPath, setFolderPath] = useState('');
  const [cookieFileId, setCookieFileId] = useState<number | ''>('');
  const [extraArgs, setExtraArgs] = useState('');
  const [lockedLibraryName, setLockedLibraryName] = useState<string | null>(null);
  const cookieInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!folderPath.trim()) {
      setLockedLibraryName(null);
      return;
    }
    const handle = setTimeout(() => {
      api
        .resolveDownloaderPath(folderPath.trim())
        .then((res) => {
          if (res.library) {
            setLockedLibraryName(res.library.name);
            setLibraryId(res.library.id);
          } else {
            setLockedLibraryName(null);
          }
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(handle);
  }, [folderPath]);

  const uploadCookiesMutation = useMutation({
    mutationFn: (files: File[]) => api.uploadCookies(files),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['downloader-cookies'] });
      showToast('Cookie file(s) uploaded');
    },
    onError: (err: Error) => showToast(err.message),
  });

  const createBatchMutation = useMutation({
    mutationFn: () => {
      const urls = urlsText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      return api.createDownloadBatch({
        libraryId: Number(libraryId),
        folderPath: folderPath.trim(),
        urls,
        extraArgs: extraArgs.trim() || undefined,
        cookieFileId: cookieFileId === '' ? null : Number(cookieFileId),
      });
    },
    onSuccess: () => {
      setUrlsText('');
      showToast('Download batch queued');
    },
    onError: (err: Error) => showToast(err.message),
  });

  const concurrencyMutation = useMutation({
    mutationFn: (value: number) => api.patchSettings({ downloader_concurrency: String(value) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
    onError: (err: Error) => showToast(err.message),
  });

  const urlCount = urlsText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean).length;
  const canSubmit = urlCount > 0 && !!folderPath.trim() && libraryId !== '';

  return (
    <div className="fade-in mx-auto max-w-[1000px] px-8 pb-16 pt-7">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-[22px] font-bold">Downloader</div>
          <div className="mt-0.5 text-[13px] text-zinc-500">Batch-download media from URLs with gallery-dl.</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-zinc-500">Concurrency</span>
          <input
            type="number"
            min={1}
            max={8}
            defaultValue={Number(settings?.downloader_concurrency ?? 2)}
            onBlur={(e) => {
              const v = Math.min(8, Math.max(1, Number(e.target.value) || 2));
              concurrencyMutation.mutate(v);
            }}
            className="w-16 rounded-[7px] border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[13px] text-zinc-100 outline-none"
          />
        </div>
      </div>

      {status && !status.installed && (
        <div className="mb-5 flex items-center justify-between rounded-xl border border-amber-900/50 bg-amber-950/20 px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold text-amber-400">gallery-dl isn't installed</div>
            <div className="text-[12px] text-amber-600/80">
              {installJob ? installJob.log || 'Installing…' : 'Install the bundled gallery-dl binary to start downloading.'}
            </div>
          </div>
          <button
            disabled={!!installJob || installMutation.isPending}
            onClick={() => installMutation.mutate()}
            className="cursor-pointer rounded-[7px] bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-40"
          >
            {installJob ? 'Installing…' : 'Install'}
          </button>
        </div>
      )}

      <div className="mb-6 rounded-xl border border-zinc-800 bg-[#111113] p-4">
        <div className="mb-3 text-[13.5px] font-bold">New download</div>
        <textarea
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
          placeholder="One URL per line…"
          rows={4}
          className="mb-3 w-full resize-y rounded-[7px] border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-[12.5px] text-zinc-100 outline-none placeholder:text-zinc-600"
        />
        <div className="mb-3 grid grid-cols-2 gap-2.5">
          <div>
            <div className="mb-1 text-[11px] font-semibold text-zinc-500">Library</div>
            <select
              value={libraryId}
              disabled={lockedLibraryName !== null}
              onChange={(e) => setLibraryId(e.target.value ? Number(e.target.value) : '')}
              className="w-full rounded-[7px] border border-zinc-800 bg-zinc-900 px-2.5 py-[7px] text-[13px] text-zinc-100 outline-none disabled:opacity-60"
            >
              <option value="">Select a library…</option>
              {(libraries ?? []).map((lib) => (
                <option key={lib.id} value={lib.id}>
                  {lib.name}
                </option>
              ))}
            </select>
            {lockedLibraryName && (
              <div className="mt-1 text-[11px] text-zinc-500">
                Already part of <span className="font-semibold text-zinc-300">{lockedLibraryName}</span> — use a
                different folder to pick another library.
              </div>
            )}
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold text-zinc-500">Destination folder</div>
            <input
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder="/absolute/path/to/folder"
              className="w-full rounded-[7px] border border-zinc-800 bg-zinc-900 px-2.5 py-[7px] font-mono text-[12.5px] text-zinc-100 outline-none placeholder:text-zinc-600"
            />
          </div>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2.5">
          <div>
            <div className="mb-1 text-[11px] font-semibold text-zinc-500">Cookie file (optional)</div>
            <div className="flex gap-2">
              <select
                value={cookieFileId}
                onChange={(e) => setCookieFileId(e.target.value ? Number(e.target.value) : '')}
                className="flex-1 rounded-[7px] border border-zinc-800 bg-zinc-900 px-2.5 py-[7px] text-[13px] text-zinc-100 outline-none"
              >
                <option value="">None</option>
                {(cookies ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.filename}
                  </option>
                ))}
              </select>
              <input
                ref={cookieInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) uploadCookiesMutation.mutate(files);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => cookieInputRef.current?.click()}
                title="Upload cookie file"
                className="cursor-pointer rounded-[7px] border border-zinc-800 px-2.5 py-[7px] text-zinc-400 hover:text-zinc-200"
              >
                <UploadIcon size={14} />
              </button>
            </div>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold text-zinc-500">Custom gallery-dl args (optional)</div>
            <input
              value={extraArgs}
              onChange={(e) => setExtraArgs(e.target.value)}
              placeholder="e.g. --range 1-20 --write-metadata"
              className="w-full rounded-[7px] border border-zinc-800 bg-zinc-900 px-2.5 py-[7px] font-mono text-[12.5px] text-zinc-100 outline-none placeholder:text-zinc-600"
            />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-[11.5px] text-zinc-600">
            {urlCount} URL{urlCount === 1 ? '' : 's'}
          </div>
          <button
            disabled={!canSubmit || createBatchMutation.isPending || !status?.installed}
            onClick={() => createBatchMutation.mutate()}
            className="flex cursor-pointer items-center gap-1.5 rounded-[7px] bg-accent px-4 py-[7px] text-[12.5px] font-semibold text-white disabled:opacity-40"
          >
            <Download size={14} /> Start download
          </button>
        </div>
      </div>

      <div className="mb-3 text-[13.5px] font-bold">Queue</div>
      {batches.length === 0 && <div className="text-[12.5px] text-zinc-600">No downloads yet.</div>}
      <div className="flex flex-col gap-4">
        {batches.map((batch) => (
          <BatchCard key={batch.id} batch={batch} />
        ))}
      </div>
    </div>
  );
}

function BatchCard({ batch }: { batch: DownloadBatchWithItems }) {
  if (batch.items.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 truncate font-mono text-[11.5px] text-zinc-500">{batch.folderPath}</div>
      <div className="flex flex-col gap-1.5">
        {batch.items.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function ItemRow({ item }: { item: DownloadItem }) {
  const [expanded, setExpanded] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { logs } = useDownloader();
  const showToast = useToast();
  const queryClient = useQueryClient();

  const { data: historyLogs } = useQuery({
    queryKey: ['download-logs', item.id],
    queryFn: () => api.downloadItemLogs(item.id),
    enabled: expanded,
    staleTime: Infinity,
  });

  const liveLogs = logs[item.id] ?? [];
  const merged = useMemo(() => {
    const map = new Map<number, string>();
    for (const l of historyLogs ?? []) map.set(l.id, l.line);
    for (const l of liveLogs) map.set(l.id, l.line);
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, line]) => line);
  }, [historyLogs, liveLogs]);

  const pauseMutation = useMutation({
    mutationFn: () => api.pauseDownloadItem(item.id),
    onError: (err: Error) => showToast(err.message),
  });
  const resumeMutation = useMutation({
    mutationFn: () => api.resumeDownloadItem(item.id),
    onError: (err: Error) => showToast(err.message),
  });
  const skipMutation = useMutation({
    mutationFn: () => api.skipDownloadItem(item.id),
    onError: (err: Error) => showToast(err.message),
  });
  const removeMutation = useMutation({
    mutationFn: (deleteFiles: boolean) => api.removeDownloadItem(item.id, deleteFiles),
    onSuccess: () => {
      setRemoving(false);
      queryClient.invalidateQueries({ queryKey: ['libraries'] });
    },
    onError: (err: Error) => showToast(err.message),
  });

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <button onClick={() => setExpanded((v) => !v)} className="cursor-pointer text-zinc-500 hover:text-zinc-300">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] text-zinc-200">{item.url}</div>
          {item.errorMessage && <div className="truncate text-[11px] text-red-500">{item.errorMessage}</div>}
        </div>
        <div className="shrink-0 text-[11.5px] text-zinc-500">
          {item.filesDownloaded} file{item.filesDownloaded === 1 ? '' : 's'}
        </div>
        <span
          className={`w-[62px] shrink-0 text-right text-[10.5px] font-bold uppercase tracking-[0.3px] ${STATUS_COLOR[item.status]}`}
        >
          {item.status}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {item.status === 'running' && (
            <IconButton title="Pause" onClick={() => pauseMutation.mutate()}>
              <Pause size={13} />
            </IconButton>
          )}
          {(item.status === 'paused' || item.status === 'error' || item.status === 'skipped') && (
            <IconButton title="Resume" onClick={() => resumeMutation.mutate()}>
              <Play size={13} />
            </IconButton>
          )}
          {(item.status === 'queued' || item.status === 'running') && (
            <IconButton title="Skip" onClick={() => skipMutation.mutate()}>
              <SkipForward size={13} />
            </IconButton>
          )}
          <IconButton title="Remove" onClick={() => setRemoving(true)}>
            <Trash2 size={13} />
          </IconButton>
        </div>
      </div>
      {expanded && (
        <div className="max-h-[200px] overflow-y-auto border-t border-zinc-800 bg-black/30 px-3 py-2 font-mono text-[11px] text-zinc-500">
          {merged.length === 0 ? (
            <div className="text-zinc-700">No log output yet.</div>
          ) : (
            merged.map((line, i) => <div key={i}>{line}</div>)
          )}
        </div>
      )}
      {removing && (
        <RemoveItemModal
          onKeep={() => removeMutation.mutate(false)}
          onDelete={() => removeMutation.mutate(true)}
          onCancel={() => setRemoving(false)}
        />
      )}
    </div>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="cursor-pointer rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
    >
      {children}
    </button>
  );
}

function RemoveItemModal({
  onKeep,
  onDelete,
  onCancel,
}: {
  onKeep: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fade-in fixed inset-0 z-[95] flex items-center justify-center bg-zinc-950/80 p-6 backdrop-blur"
      onClick={onCancel}
    >
      <div
        className="w-[380px] rounded-xl border border-zinc-800 bg-[#111113] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 text-[15px] font-bold">Remove download</div>
        <div className="mb-4 text-[12.5px] leading-relaxed text-zinc-400">
          Remove this item from the queue. You can keep the files already downloaded, or delete them from disk.
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="cursor-pointer rounded-[7px] border border-zinc-800 px-3.5 py-1.5 text-[12.5px] font-semibold text-zinc-300 hover:text-zinc-100"
          >
            Cancel
          </button>
          <button
            onClick={onKeep}
            className="cursor-pointer rounded-[7px] bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90"
          >
            Keep files
          </button>
          <button
            onClick={onDelete}
            className="cursor-pointer rounded-[7px] bg-rose-600 px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-rose-500"
          >
            Delete files
          </button>
        </div>
      </div>
    </div>
  );
}
