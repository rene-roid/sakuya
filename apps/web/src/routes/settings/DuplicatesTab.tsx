import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import type { DuplicateGroup } from '@sakuya/shared';
import { api, thumbUrl } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TabHeader } from './index';

export function DuplicatesTab() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [scanned, setScanned] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['duplicates'],
    queryFn: api.duplicates,
    enabled: false,
  });

  const scanMutation = useMutation({
    mutationFn: () => refetch(),
    onSuccess: () => setScanned(true),
    onError: (err: Error) => showToast(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: number[]) => api.deleteMediaBatch(ids),
    onSuccess: async (res) => {
      showToast(`Deleted ${res.deleted} file${res.deleted === 1 ? '' : 's'}`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['media'] });
      queryClient.invalidateQueries({ queryKey: ['system'] });
      await refetch();
    },
    onError: (err: Error) => showToast(err.message),
  });

  const groups = data?.groups ?? [];

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function autoSelect() {
    setSelected(new Set(groups.flatMap((g) => g.items.slice(1).map((m) => m.id))));
  }

  const selectedBytes = groups
    .flatMap((g) => g.items)
    .filter((m) => selected.has(m.id))
    .reduce((sum, m) => sum + m.sizeBytes, 0);

  return (
    <div>
      <TabHeader title="Duplicates" subtitle="Find exact duplicate files and clean them up." />

      <div className="mb-3.5 rounded-xl border border-zinc-800 bg-[#111113] p-[18px]">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13.5px] font-bold">Detect duplicates</div>
            <div className="mt-0.5 text-xs text-zinc-500">
              {!scanned
                ? 'Scans your library for files with identical content.'
                : groups.length > 0
                  ? `${data?.groupCount} group${data?.groupCount === 1 ? '' : 's'} · ${data?.fileCount} files · ${formatBytes(data?.wastedBytes ?? 0)} wasted`
                  : 'No duplicate files found.'}
            </div>
          </div>
          <button
            disabled={scanMutation.isPending || isFetching}
            onClick={() => scanMutation.mutate()}
            className="shrink-0 cursor-pointer rounded-[7px] bg-accent px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40"
          >
            {scanMutation.isPending || isFetching ? 'Scanning…' : scanned ? 'Rescan' : 'Scan for duplicates'}
          </button>
        </div>
      </div>

      {scanned && groups.length > 0 && (
        <>
          <div className="mb-3.5 flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-[#111113] p-[14px]">
            <div className="flex items-center gap-2">
              <button
                onClick={autoSelect}
                className="cursor-pointer rounded-[7px] border border-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
              >
                Select all but oldest in each group
              </button>
              {selected.size > 0 && (
                <button
                  onClick={() => setSelected(new Set())}
                  className="cursor-pointer rounded-[7px] border border-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-400 hover:text-zinc-200"
                >
                  Clear selection
                </button>
              )}
            </div>
            <button
              disabled={selected.size === 0 || deleteMutation.isPending}
              onClick={() => setShowConfirm(true)}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] bg-rose-600/90 px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-rose-600 disabled:opacity-40"
            >
              <Trash2 size={14} />
              Delete selected {selected.size > 0 ? `(${selected.size} · ${formatBytes(selectedBytes)})` : ''}
            </button>
          </div>

          <div className="flex flex-col gap-2.5">
            {groups.map((group) => (
              <DuplicateGroupCard key={group.contentHash} group={group} selected={selected} onToggle={toggle} />
            ))}
          </div>
        </>
      )}

      {showConfirm && (
        <ConfirmDialog
          title={`Delete ${selected.size} file${selected.size === 1 ? '' : 's'}?`}
          danger
          confirmLabel="Delete"
          body="This permanently removes the selected files from disk. This cannot be undone."
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => {
            setShowConfirm(false);
            deleteMutation.mutate(Array.from(selected));
          }}
        />
      )}
    </div>
  );
}

function DuplicateGroupCard({
  group,
  selected,
  onToggle,
}: {
  group: DuplicateGroup;
  selected: Set<number>;
  onToggle: (id: number) => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-[#111113] p-[14px]">
      <div className="mb-2.5 text-[12px] font-semibold text-zinc-400">
        {group.items.length} copies · {formatBytes(group.wastedBytes)} wasted
      </div>
      <div className="flex flex-wrap gap-2.5">
        {group.items.map((m, i) => (
          <label
            key={m.id}
            className={`flex w-[140px] cursor-pointer flex-col gap-1.5 rounded-lg border p-1.5 ${
              selected.has(m.id) ? 'border-rose-700 bg-rose-950/20' : 'border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <div className="relative aspect-square overflow-hidden rounded-md bg-zinc-900">
              <img src={thumbUrl(m.id)} alt={m.filename} className="h-full w-full object-cover" />
              {i === 0 && (
                <span className="absolute left-1 top-1 rounded bg-zinc-950/80 px-1.5 py-0.5 text-[9px] font-bold text-zinc-300">
                  OLDEST
                </span>
              )}
              <input
                type="checkbox"
                checked={selected.has(m.id)}
                onChange={() => onToggle(m.id)}
                className="absolute right-1 top-1 h-4 w-4 cursor-pointer accent-rose-600"
              />
            </div>
            <div className="truncate text-[11px] font-medium text-zinc-300" title={m.filename}>
              {m.filename}
            </div>
            <div className="text-[10px] text-zinc-500">
              {formatBytes(m.sizeBytes)}
              {m.libraryName ? ` · ${m.libraryName}` : ''}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
