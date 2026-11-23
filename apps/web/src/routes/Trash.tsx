import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Film, ImageOff, RotateCcw, Trash2 } from 'lucide-react';
import type { TrashItem } from '@sakuya/shared';
import { api, trashThumbUrl } from '../lib/api';
import { formatBytes, timeAgo } from '../lib/format';
import { settingHref } from './settings/registry';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { toast, toastError } from '../components/Toast';

const DAY = 86_400_000;

/** Deleted media, restorable until the 30-day purge takes it. */
export function Trash() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['trash'], queryFn: api.trash });
  const [confirm, setConfirm] = useState<'empty' | TrashItem | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['trash'] });
    queryClient.invalidateQueries({ queryKey: ['system'] });
  };

  const restore = useMutation({
    mutationFn: (item: TrashItem) => api.restoreFromTrash(item.id),
    onSuccess: (res, item) => {
      toast(res.renamed ? `Restored as ${res.path.split(/[\\/]/).pop()}` : `Restored ${item.filename}`);
      refresh();
      for (const key of ['media', 'dashboard', 'tags', 'tags-summary', 'boards', 'libraries']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: toastError,
  });

  const remove = useMutation({
    mutationFn: (target: 'empty' | TrashItem) =>
      target === 'empty' ? api.emptyTrash() : api.deleteFromTrash(target.id),
    onSuccess: (res) => {
      toast(
        `Deleted ${res.removed} file${res.removed === 1 ? '' : 's'} for good · freed ${formatBytes(res.freedBytes)}`,
      );
      refresh();
    },
    onError: toastError,
  });

  const items = data?.items ?? [];

  return (
    <div className="fade-in mx-auto max-w-[1400px] px-4 pb-16 pt-6 sm:px-8">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="m-0 text-[22px] font-extrabold glass:text-[24px] glass:font-semibold">Trash</h1>
        <button
          disabled={!items.length || remove.isPending}
          onClick={() => setConfirm('empty')}
          className="ml-auto flex cursor-pointer items-center gap-1.5 rounded-field bg-rose-600/90 px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-rose-600 disabled:cursor-default disabled:opacity-40"
        >
          <Trash2 size={14} />
          Empty trash
        </button>
      </div>
      <div className="mb-5 text-[13px] text-zinc-500">
        {!data
          ? 'Loading…'
          : items.length
            ? `${data.count} item${data.count === 1 ? '' : 's'} · ${formatBytes(data.totalBytes)} · each is deleted for good ${data.retentionDays} days after it was trashed.`
            : `The trash is empty. Deleted media waits here for ${data.retentionDays} days.`}{' '}
        <Link
          to={settingHref('trash')}
          className="text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
        >
          Storage settings
        </Link>
      </div>

      {items.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
          {items.map((item) => (
            <TrashTile
              key={item.id}
              item={item}
              busy={restore.isPending && restore.variables?.id === item.id}
              onRestore={() => restore.mutate(item)}
              onDelete={() => setConfirm(item)}
            />
          ))}
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          danger
          title={confirm === 'empty' ? 'Empty the trash?' : `Delete "${confirm.filename}" for good?`}
          confirmLabel={confirm === 'empty' ? 'Empty trash' : 'Delete forever'}
          body={
            confirm === 'empty'
              ? `${data?.count ?? 0} file${data?.count === 1 ? '' : 's'} (${formatBytes(data?.totalBytes ?? 0)}) are deleted from disk. This cannot be undone.`
              : 'The file is deleted from disk. This cannot be undone.'
          }
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            remove.mutate(confirm);
          }}
        />
      )}
    </div>
  );
}

function TrashTile({
  item,
  busy,
  onRestore,
  onDelete,
}: {
  item: TrashItem;
  busy: boolean;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const [noPreview, setNoPreview] = useState(false);
  const daysLeft = Math.max(0, Math.ceil((item.expiresAt - Date.now()) / DAY));
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line p-1.5 glass:bg-white/[0.03]">
      <div className="relative aspect-square overflow-hidden rounded-media bg-zinc-900">
        {noPreview ? (
          <div className="flex h-full w-full items-center justify-center text-zinc-600">
            {item.type === 'video' ? <Film size={28} /> : <ImageOff size={28} />}
          </div>
        ) : (
          <img
            src={trashThumbUrl(item.id)}
            alt={item.filename}
            loading="lazy"
            decoding="async"
            onError={() => setNoPreview(true)}
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="truncate text-[11.5px] font-medium text-zinc-300" title={item.originalPath}>
        {item.filename}
      </div>
      <div className="truncate text-[10.5px] text-zinc-500">
        {formatBytes(item.sizeBytes)}
        {item.libraryName ? ` · ${item.libraryName}` : ' · library deleted'}
      </div>
      <div
        className="truncate text-[10.5px] text-zinc-500"
        title={`Deleted ${new Date(item.trashedAt).toLocaleString()}`}
      >
        {timeAgo(item.trashedAt)} · {daysLeft}d left
      </div>
      <div className="mt-0.5 flex gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={onRestore}
          className="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-btn border border-line py-1 text-[11.5px] font-semibold text-zinc-300 hover:border-line-strong hover:text-zinc-100 disabled:opacity-40"
        >
          <RotateCcw size={12} />
          {busy ? 'Restoring…' : 'Restore'}
        </button>
        <button
          type="button"
          aria-label={`Delete ${item.filename} forever`}
          title="Delete forever"
          onClick={onDelete}
          className="flex cursor-pointer items-center justify-center rounded-btn border border-line px-2 text-zinc-400 hover:border-rose-800 hover:text-rose-300"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
