import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  Heart,
  HeartOff,
  Images,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  RotateCw,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type { BulkResult, BulkRenameItem, Media, TagCategory } from '@sakuya/shared';
import { api, type MediaFilters } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useToast } from './Toast';
import { BulkConfirmDialog, type BulkChangeRow } from './BulkConfirmDialog';
import { BulkTagDialog } from './BulkTagDialog';
import { BulkRenameDialog } from './BulkRenameDialog';
import type { SelectionApi } from '../hooks/useSelection';

type Action = 'tags' | 'rename' | 'boards' | 'like' | 'unlike' | 'delete' | 'retag' | 'thumbnails' | 'board-remove';

/** Actions that need the selected rows resolved before their dialog can render. */
const NEEDS_ROWS: Action[] = ['tags', 'rename', 'like', 'unlike', 'delete', 'retag', 'thumbnails', 'board-remove'];

function actionButton(danger?: boolean): string {
  return `flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-[7px] text-[12.5px] font-semibold ${
    danger
      ? 'border-zinc-800 text-zinc-400 hover:border-rose-500/40 hover:text-rose-400'
      : 'border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100'
  }`;
}

/**
 * Floating action bar for multi-select mode.
 *
 * Every mutating action routes through `BulkConfirmDialog` first, which lists the affected
 * files one by one — a selection can span pages the grid never rendered, so a bare count is
 * not enough to know what you're about to change.
 */
export function SelectionBar({
  selection,
  filters,
  total,
  boardId,
}: {
  selection: SelectionApi;
  /** Omitted on Discover, whose feed isn't a /api/media query — "select all" is hidden there. */
  filters?: MediaFilters;
  /** Total matching the current filters — the ceiling for "select all". */
  total: number;
  /** Set inside a board view, which unlocks "remove from board". */
  boardId?: number;
}) {
  const qc = useQueryClient();
  const showToast = useToast();
  const [action, setAction] = useState<Action | null>(null);
  const [boardTarget, setBoardTarget] = useState<{ id: number; name: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const ids = useMemo(() => [...selection.ids], [selection.ids]);
  const idKey = ids.join(',');

  const { data: rows } = useQuery({
    queryKey: ['media-by-ids', idKey],
    queryFn: () => api.mediaByIds(ids),
    enabled: action !== null && ids.length > 0,
    staleTime: 15_000,
  });
  const selected: Media[] = rows ?? [];

  const { data: boards } = useQuery({
    queryKey: ['boards'],
    queryFn: api.boards,
    enabled: action === 'boards',
  });

  function close() {
    setAction(null);
    setBoardTarget(null);
  }

  function finish(message: string) {
    showToast(message);
    qc.invalidateQueries({ queryKey: ['media'] });
    qc.invalidateQueries({ queryKey: ['media-by-ids'] });
    qc.invalidateQueries({ queryKey: ['media-detail'] });
    qc.invalidateQueries({ queryKey: ['tags'] });
    qc.invalidateQueries({ queryKey: ['tags-summary'] });
    qc.invalidateQueries({ queryKey: ['boards'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    close();
    selection.exit();
  }

  /** Bulk routes report per-item failures instead of failing the whole call. */
  function report(verb: string, result: BulkResult) {
    const failed = result.failed.length;
    finish(`${verb} ${result.updated} file${result.updated === 1 ? '' : 's'}${failed ? ` · ${failed} skipped` : ''}`);
  }

  const fail = (err: Error) => showToast(`Failed: ${err.message}`);

  const selectAll = useMutation({
    mutationFn: () => api.mediaIds(filters!),
    onSuccess: (res) => {
      selection.replace(res.ids);
      showToast(`Selected ${res.ids.length} file${res.ids.length === 1 ? '' : 's'}`);
    },
    onError: fail,
  });

  const tagsMutation = useMutation({
    mutationFn: (body: { add: string[]; remove: string[]; category: TagCategory }) =>
      api.tagsBatch({ ids, ...body }),
    onSuccess: (res) => report('Tagged', res),
    onError: fail,
  });

  const renameMutation = useMutation({
    mutationFn: (items: BulkRenameItem[]) => api.renameBatch(items),
    onSuccess: (res) => report('Renamed', res),
    onError: fail,
  });

  const likeMutation = useMutation({
    mutationFn: (liked: boolean) => api.likeBatch(ids, liked),
    onSuccess: (res) => report(action === 'unlike' ? 'Unliked' : 'Liked', res),
    onError: fail,
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteMediaBatch(ids),
    onSuccess: (res) => finish(`Deleted ${res.deleted} file${res.deleted === 1 ? '' : 's'}`),
    onError: fail,
  });

  const addToBoardMutation = useMutation({
    mutationFn: (target: number) => api.addToBoard(target, ids),
    onSuccess: (board) => finish(`Added ${ids.length} to ${board.name}`),
    onError: fail,
  });

  const removeFromBoardMutation = useMutation({
    mutationFn: () => api.removeFromBoardBatch(boardId!, ids),
    onSuccess: (board) => finish(`Removed ${ids.length} from ${board.name}`),
    onError: fail,
  });

  const retagMutation = useMutation({
    mutationFn: () => api.retagBatch(ids),
    onSuccess: () => finish(`Queued AI tagging for ${ids.length} file${ids.length === 1 ? '' : 's'}`),
    onError: fail,
  });

  const thumbnailsMutation = useMutation({
    mutationFn: () => api.thumbnailsBatch(ids),
    onSuccess: () => finish(`Queued thumbnail regeneration for ${ids.length} file${ids.length === 1 ? '' : 's'}`),
    onError: fail,
  });

  const copyPaths = useMutation({
    mutationFn: async () => {
      const items = await api.mediaByIds(ids);
      await navigator.clipboard.writeText(items.map((m) => m.path).join('\n'));
      return items.length;
    },
    onSuccess: (count) => showToast(`Copied ${count} path${count === 1 ? '' : 's'}`),
    onError: fail,
  });

  const busy =
    tagsMutation.isPending ||
    renameMutation.isPending ||
    likeMutation.isPending ||
    deleteMutation.isPending ||
    addToBoardMutation.isPending ||
    removeFromBoardMutation.isPending ||
    retagMutation.isPending ||
    thumbnailsMutation.isPending;

  // The board flow only needs rows once a target board is chosen and the confirm list renders.
  const needsRows =
    action !== null && (NEEDS_ROWS.includes(action) || (action === 'boards' && boardTarget !== null));
  const plainRows: BulkChangeRow[] = selected.map((item) => ({ id: item.id, label: item.filename }));
  const selectedBytes = selected.reduce((sum, m) => sum + m.sizeBytes, 0);
  const allSelected = ids.length >= total && total > 0;

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-5">
        <div className="fade-in flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/95 px-3 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.6)] backdrop-blur">
          <span className="px-1 text-[12.5px] font-bold text-zinc-100">
            {ids.length} selected
          </span>
          {filters && !allSelected && total > ids.length && (
            <button
              disabled={selectAll.isPending}
              onClick={() => selectAll.mutate()}
              className="cursor-pointer rounded-lg px-2 py-[7px] text-[12.5px] font-semibold text-accent hover:opacity-80 disabled:opacity-40"
            >
              Select all {total}
            </button>
          )}
          <div className="mx-1 h-5 w-px flex-none bg-zinc-700" />

          <button disabled={!ids.length} onClick={() => setAction('tags')} className={actionButton()}>
            <Tag size={14} />
            Tags
          </button>
          <button disabled={!ids.length} onClick={() => setAction('boards')} className={actionButton()}>
            <Images size={14} />
            Board
          </button>
          <button disabled={!ids.length} onClick={() => setAction('rename')} className={actionButton()}>
            <Pencil size={14} />
            Rename
          </button>
          <button disabled={!ids.length} onClick={() => setAction('like')} className={actionButton()}>
            <Heart size={14} />
            Like
          </button>
          <button disabled={!ids.length} onClick={() => setAction('delete')} className={actionButton(true)}>
            <Trash2 size={14} />
            Delete
          </button>

          <div className="relative">
            <button
              disabled={!ids.length}
              onClick={() => setMenuOpen((open) => !open)}
              title="More bulk actions"
              className={actionButton()}
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-[70]" onClick={() => setMenuOpen(false)} />
                <div className="absolute bottom-[calc(100%+6px)] right-0 z-[71] w-[230px] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
                  <MenuItem
                    icon={<HeartOff size={13} />}
                    label="Unlike"
                    onClick={() => {
                      setMenuOpen(false);
                      setAction('unlike');
                    }}
                  />
                  {boardId !== undefined && (
                    <MenuItem
                      icon={<Images size={13} />}
                      label="Remove from this board"
                      onClick={() => {
                        setMenuOpen(false);
                        setAction('board-remove');
                      }}
                    />
                  )}
                  <MenuItem
                    icon={<RotateCw size={13} />}
                    label="AI re-tag"
                    onClick={() => {
                      setMenuOpen(false);
                      setAction('retag');
                    }}
                  />
                  <MenuItem
                    icon={<RefreshCw size={13} />}
                    label="Regenerate thumbnails"
                    onClick={() => {
                      setMenuOpen(false);
                      setAction('thumbnails');
                    }}
                  />
                  <MenuItem
                    icon={<Copy size={13} />}
                    label="Copy file paths"
                    onClick={() => {
                      setMenuOpen(false);
                      copyPaths.mutate();
                    }}
                  />
                </div>
              </>
            )}
          </div>

          <div className="mx-1 h-5 w-px flex-none bg-zinc-700" />
          <button
            onClick={selection.exit}
            title="Exit select mode (Esc)"
            className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-[7px] text-[12.5px] font-semibold text-zinc-400 hover:text-zinc-200"
          >
            <X size={14} />
            Done
          </button>
        </div>
      </div>

      {/* Every dialog below waits for the real rows so the change list is never a guess. */}
      {needsRows && !rows && <LoadingDialog onCancel={close} />}

      {action === 'tags' && rows && (
        <BulkTagDialog
          ids={ids}
          selected={selected}
          libraryId={filters?.libraryId}
          busy={busy}
          onApply={(body) => tagsMutation.mutate(body)}
          onCancel={close}
        />
      )}

      {action === 'rename' && rows && (
        <BulkRenameDialog
          selected={selected}
          busy={busy}
          onApply={(items) => renameMutation.mutate(items)}
          onCancel={close}
        />
      )}

      {action === 'boards' &&
        (boardTarget && rows ? (
          <BulkConfirmDialog
            title={`Add ${ids.length} file${ids.length === 1 ? '' : 's'} to “${boardTarget.name}”?`}
            summary={`Files already on the board are left as they are. Nothing is moved or copied on disk.`}
            rows={plainRows}
            confirmLabel="Add to board"
            busy={busy}
            onConfirm={() => addToBoardMutation.mutate(boardTarget.id)}
            onCancel={() => setBoardTarget(null)}
          />
        ) : (
          <BoardPicker
            boards={boards ?? []}
            onPick={setBoardTarget}
            onCancel={close}
          />
        ))}

      {action === 'board-remove' && rows && (
        <BulkConfirmDialog
          title={`Remove ${ids.length} file${ids.length === 1 ? '' : 's'} from this board?`}
          summary="The files stay in their libraries — only the board membership is removed."
          rows={plainRows}
          confirmLabel="Remove from board"
          busy={busy}
          onConfirm={() => removeFromBoardMutation.mutate()}
          onCancel={close}
        />
      )}

      {(action === 'like' || action === 'unlike') && rows && (
        <BulkConfirmDialog
          title={`${action === 'like' ? 'Like' : 'Unlike'} ${ids.length} file${ids.length === 1 ? '' : 's'}?`}
          summary={
            action === 'like'
              ? 'Liked media shows up in the Likes library and under the liked filter.'
              : 'These files will be removed from the Likes library.'
          }
          rows={selected.map((item) => ({
            id: item.id,
            label: item.filename,
            detail: item.liked === (action === 'like') ? 'already ' + (item.liked ? 'liked' : 'unliked') : undefined,
          }))}
          confirmLabel={action === 'like' ? 'Like all' : 'Unlike all'}
          busy={busy}
          onConfirm={() => likeMutation.mutate(action === 'like')}
          onCancel={close}
        />
      )}

      {action === 'retag' && rows && (
        <BulkConfirmDialog
          title={`Re-tag ${ids.length} file${ids.length === 1 ? '' : 's'} with AI?`}
          summary="Queues a tagging job. Existing AI tags are replaced; tags you added by hand are kept."
          rows={plainRows}
          confirmLabel="Queue tagging"
          busy={busy}
          onConfirm={() => retagMutation.mutate()}
          onCancel={close}
        />
      )}

      {action === 'thumbnails' && rows && (
        <BulkConfirmDialog
          title={`Regenerate ${ids.length} thumbnail${ids.length === 1 ? '' : 's'}?`}
          summary="Queues a job that re-renders the preview image for each file. The files themselves aren't touched."
          rows={plainRows}
          confirmLabel="Queue regeneration"
          busy={busy}
          onConfirm={() => thumbnailsMutation.mutate()}
          onCancel={close}
        />
      )}

      {action === 'delete' && rows && (
        <BulkConfirmDialog
          title={`Delete ${ids.length} file${ids.length === 1 ? '' : 's'}?`}
          summary={
            <span>
              <strong className="text-rose-400">This cannot be undone.</strong> {formatBytes(selectedBytes)} will be
              permanently removed from disk, along with their tags and board memberships.
            </span>
          }
          rows={selected.map((item) => ({
            id: item.id,
            label: item.filename,
            detail: `${item.libraryName ?? ''} · ${formatBytes(item.sizeBytes)}`,
          }))}
          confirmLabel="Delete permanently"
          danger
          busy={busy}
          onConfirm={() => deleteMutation.mutate()}
          onCancel={close}
        />
      )}
    </>
  );
}

function MenuItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[12.5px] font-semibold text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
    >
      <span className="flex-none text-zinc-500">{icon}</span>
      {label}
    </div>
  );
}

function LoadingDialog({ onCancel }: { onCancel: () => void }) {
  return (
    <div
      className="fade-in fixed inset-0 z-[95] flex items-center justify-center bg-zinc-950/80 p-6 backdrop-blur"
      onClick={onCancel}
    >
      <div className="rounded-xl border border-zinc-800 bg-[#111113] px-6 py-5 text-[12.5px] text-zinc-400">
        Loading selection…
      </div>
    </div>
  );
}

function BoardPicker({
  boards,
  onPick,
  onCancel,
}: {
  boards: { id: number; name: string; itemCount: number }[];
  onPick: (board: { id: number; name: string }) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const showToast = useToast();
  const [newName, setNewName] = useState('');

  const createMutation = useMutation({
    mutationFn: (name: string) => api.createBoard(name),
    onSuccess: (board) => {
      qc.invalidateQueries({ queryKey: ['boards'] });
      onPick({ id: board.id, name: board.name });
    },
    onError: (err: Error) => showToast(`Failed: ${err.message}`),
  });

  return (
    <div
      className="fade-in fixed inset-0 z-[95] flex items-center justify-center bg-zinc-950/80 p-6 backdrop-blur"
      onClick={onCancel}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-[420px] flex-col rounded-xl border border-zinc-800 bg-[#111113] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-[15px] font-bold">Add to board</div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/40">
          {boards.length === 0 && (
            <div className="px-3 py-3 text-[11.5px] text-zinc-600">No boards yet — create one below.</div>
          )}
          {boards.map((board) => (
            <div
              key={board.id}
              onClick={() => onPick({ id: board.id, name: board.name })}
              className="flex cursor-pointer items-center justify-between border-b border-zinc-800/60 px-3 py-2 last:border-b-0 hover:bg-white/5"
            >
              <span className="truncate text-[12.5px] font-semibold text-zinc-200">{board.name}</span>
              <span className="flex-none text-[11px] text-zinc-500">{board.itemCount}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim()) createMutation.mutate(newName.trim());
            }}
            placeholder="New board name"
            className="flex-1 rounded-[7px] border border-zinc-800 bg-zinc-900 px-3 py-[7px] text-[13px] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-600"
          />
          <button
            disabled={!newName.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate(newName.trim())}
            className="cursor-pointer rounded-[7px] bg-accent px-4 py-[7px] text-[12.5px] font-semibold text-white disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
