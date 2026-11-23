import { memo, useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, X } from 'lucide-react';
import type { DuplicateGroup } from '@sakuya/shared';
import { api, thumbUrl } from '../lib/api';
import { formatBytes } from '../lib/format';
import { toast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function Duplicates() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const libraryId = Number(searchParams.get('library')) || null;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);

  const { data, isFetching, refetch } = useQuery({ queryKey: ['duplicates'], queryFn: api.duplicates });
  const { data: library } = useQuery({
    queryKey: ['libraries', libraryId],
    queryFn: () => api.library(libraryId!),
    enabled: libraryId !== null,
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: number[]) => api.deleteMediaBatch(ids),
    onSuccess: async (res) => {
      toast(`Deleted ${res.deleted} file${res.deleted === 1 ? '' : 's'}`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['media'] });
      queryClient.invalidateQueries({ queryKey: ['system'] });
      await refetch();
    },
  });

  // From a library's menu, only the groups with a copy in that library.
  const groups = (data?.groups ?? []).filter((g) => !libraryId || g.items.some((m) => m.libraryId === libraryId));
  const scanned = data !== undefined;
  const wasted = groups.reduce((sum, g) => sum + g.wastedBytes, 0);
  const files = groups.reduce((sum, g) => sum + g.items.length, 0);

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function autoSelect() {
    setSelected(new Set(groups.flatMap((g) => g.items.slice(1).map((m) => m.id))));
  }

  const selectedBytes = groups
    .flatMap((g) => g.items)
    .filter((m) => selected.has(m.id))
    .reduce((sum, m) => sum + m.sizeBytes, 0);

  return (
    <div className="fade-in mx-auto max-w-[1400px] px-4 pb-16 pt-6 sm:px-8">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="m-0 text-[22px] font-extrabold glass:text-[24px] glass:font-semibold">Duplicates</h1>
        {libraryId && (
          <span className="flex items-center gap-1.5 rounded-full border border-line-strong bg-zinc-800 py-0.5 pl-2.5 pr-1.5 text-xs font-semibold text-zinc-300">
            In {library?.name ?? '…'}
            <button
              type="button"
              aria-label="Show every library"
              onClick={() => setSearchParams({}, { replace: true })}
              className="flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-zinc-700"
            >
              <X size={11} />
            </button>
          </span>
        )}
        <button
          disabled={isFetching}
          onClick={() => refetch()}
          className="ml-auto cursor-pointer rounded-btn border border-line px-3 py-1.5 text-[12.5px] font-semibold text-zinc-300 hover:border-line-strong hover:text-zinc-100 disabled:opacity-40"
        >
          {isFetching ? 'Scanning…' : 'Rescan'}
        </button>
      </div>
      <div className="mb-5 text-[13px] text-zinc-500">
        {!scanned
          ? 'Looking for files with identical content…'
          : groups.length > 0
            ? `${groups.length} group${groups.length === 1 ? '' : 's'} · ${files} files · ${formatBytes(wasted)} wasted`
            : 'No duplicate files found.'}
      </div>

      {scanned && groups.length > 0 && (
        <>
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-surface p-3 glass:bg-white/[0.03]">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={autoSelect}
                className="cursor-pointer rounded-btn border border-line px-3 py-1.5 text-[12px] font-semibold text-zinc-300 hover:border-line-strong hover:text-zinc-100"
              >
                Select all but oldest in each group
              </button>
              {selected.size > 0 && (
                <button
                  onClick={() => setSelected(new Set())}
                  className="cursor-pointer rounded-btn border border-line px-3 py-1.5 text-[12px] font-semibold text-zinc-400 hover:text-zinc-200"
                >
                  Clear selection
                </button>
              )}
            </div>
            <button
              disabled={selected.size === 0 || deleteMutation.isPending}
              onClick={() => setShowConfirm(true)}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-field bg-rose-600/90 px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-rose-600 disabled:opacity-40"
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
    <div className="rounded-panel border border-line bg-surface p-3.5 glass:bg-white/[0.03]">
      <div className="mb-2.5 text-[12px] font-semibold text-zinc-400">
        {group.items.length} copies · {formatBytes(group.wastedBytes)} wasted
      </div>
      <div className="flex flex-wrap gap-2.5">
        {group.items.map((m, i) => (
          <DuplicateTile key={m.id} item={m} oldest={i === 0} selected={selected.has(m.id)} onToggle={onToggle} />
        ))}
      </div>
    </div>
  );
}

const DuplicateTile = memo(function DuplicateTile({
  item: m,
  oldest,
  selected,
  onToggle,
}: {
  item: DuplicateGroup['items'][number];
  oldest: boolean;
  selected: boolean;
  onToggle: (id: number) => void;
}) {
  return (
    <label
      className={`flex w-[140px] cursor-pointer flex-col gap-1.5 rounded-lg border p-1.5 ${
        selected ? 'border-rose-700 bg-rose-950/20' : 'border-line hover:border-line-strong'
      }`}
    >
      <div className="relative aspect-square overflow-hidden rounded-media bg-zinc-900">
        <img src={thumbUrl(m.id)} alt={m.filename} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        {oldest && (
          <span className="absolute left-1 top-1 rounded bg-zinc-950/80 px-1.5 py-0.5 text-[9px] font-bold text-zinc-300">
            OLDEST
          </span>
        )}
        <input
          type="checkbox"
          checked={selected}
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
  );
});
