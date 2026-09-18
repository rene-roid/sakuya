import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import type { Media, TagCategory } from '@sakuya/shared';
import { api } from '../lib/api';
import { TagSearchInput } from './TagSearchInput';
import { BulkConfirmDialog, type BulkChangeRow } from './BulkConfirmDialog';

const ADD_CATEGORIES: { key: TagCategory; label: string }[] = [
  { key: 'user', label: 'User' },
  { key: 'general', label: 'General' },
  { key: 'character', label: 'Character' },
  { key: 'rating', label: 'Rating' },
];

/**
 * Compose step for bulk tagging: stage tags to add and to remove, then hand the whole change
 * to the shared confirmation. The remove side is driven by a histogram of tags actually
 * present in the selection, so you can only remove something that's really there.
 */
export function BulkTagDialog({
  ids,
  selected,
  libraryId,
  busy,
  onApply,
  onCancel,
}: {
  ids: number[];
  selected: Media[];
  libraryId?: number;
  busy?: boolean;
  onApply: (body: { add: string[]; remove: string[]; category: TagCategory }) => void;
  onCancel: () => void;
}) {
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [category, setCategory] = useState<TagCategory>('user');
  const [confirming, setConfirming] = useState(false);

  const { data: present } = useQuery({
    queryKey: ['tags-summary', ids.join(',')],
    queryFn: () => api.tagsSummary(ids),
    enabled: ids.length > 0,
    staleTime: 15_000,
  });

  const countFor = (name: string) => present?.find((t) => t.name === name)?.count ?? 0;
  const hasChanges = add.length > 0 || remove.length > 0;

  if (confirming) {
    const detail = (
      <span>
        {add.length > 0 && <span className="text-emerald-400">+{add.join(', ')}</span>}
        {add.length > 0 && remove.length > 0 && ' · '}
        {remove.length > 0 && <span className="text-rose-400">−{remove.join(', ')}</span>}
      </span>
    );
    const rows: BulkChangeRow[] = selected.map((item) => ({ id: item.id, label: item.filename, detail }));
    return (
      <BulkConfirmDialog
        title={`Apply tag changes to ${ids.length} file${ids.length === 1 ? '' : 's'}?`}
        summary={
          <span>
            {add.length > 0 && (
              <>
                Adding <strong className="text-zinc-200">{add.join(', ')}</strong> as {category} tag
                {add.length === 1 ? '' : 's'} to all {ids.length}.{' '}
              </>
            )}
            {remove.map((name) => (
              <span key={name}>
                Removing <strong className="text-zinc-200">{name}</strong> from {countFor(name)} of {ids.length}.{' '}
              </span>
            ))}
          </span>
        }
        rows={rows}
        confirmLabel="Apply tags"
        busy={busy}
        onConfirm={() => onApply({ add, remove, category })}
        onCancel={() => setConfirming(false)}
      />
    );
  }

  return (
    <div
      className="fade-in fixed inset-0 z-[95] flex items-center justify-center bg-zinc-950/80 p-6 backdrop-blur"
      onClick={onCancel}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-[520px] flex-col rounded-xl border border-zinc-800 bg-[#111113] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 text-[15px] font-bold">Edit tags on {ids.length} files</div>
        <div className="mb-4 text-[12.5px] text-zinc-500">
          Added tags apply to every selected file. Removals only affect files that have the tag.
        </div>

        <div className="mb-1.5 text-xs font-bold tracking-[0.4px] text-zinc-500">ADD</div>
        <div className="mb-1.5 flex gap-1">
          {ADD_CATEGORIES.map((c) => (
            <div
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={`cursor-pointer rounded-md px-2 py-1 text-[11px] font-semibold ${
                category === c.key ? 'bg-accent text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {c.label}
            </div>
          ))}
        </div>
        <TagSearchInput
          tags={add}
          onAddTag={(tag) => setAdd((prev) => (prev.includes(tag) ? prev : [...prev, tag]))}
          onRemoveTag={(tag) => setAdd((prev) => prev.filter((t) => t !== tag))}
          onFreeText={(text) => {
            const tag = text.trim().toLowerCase().replace(/\s+/g, '_');
            if (tag) setAdd((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
          }}
          libraryId={libraryId}
          placeholder="Tag to add — Tab to complete, Enter for a new tag…"
        />

        <div className="mb-1.5 mt-5 text-xs font-bold tracking-[0.4px] text-zinc-500">REMOVE</div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
          {(present ?? []).length === 0 && (
            <div className="px-1 py-2 text-[11.5px] text-zinc-600">No tags on the selected files.</div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {(present ?? []).map((tag) => {
              const staged = remove.includes(tag.name);
              return (
                <div
                  key={tag.name}
                  onClick={() =>
                    setRemove((prev) => (staged ? prev.filter((t) => t !== tag.name) : [...prev, tag.name]))
                  }
                  className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${
                    staged
                      ? 'border-rose-500/50 bg-rose-500/15 text-rose-300 line-through'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600'
                  }`}
                >
                  <span>{tag.name}</span>
                  <span className={staged ? 'text-rose-400/70' : 'text-zinc-500'}>{tag.count}</span>
                  {staged && <X size={11} />}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="cursor-pointer rounded-[7px] border border-zinc-800 px-3.5 py-1.5 text-[12.5px] font-semibold text-zinc-300 hover:text-zinc-100"
          >
            Cancel
          </button>
          <button
            disabled={!hasChanges}
            onClick={() => setConfirming(true)}
            className="cursor-pointer rounded-[7px] bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            Review changes
          </button>
        </div>
      </div>
    </div>
  );
}
