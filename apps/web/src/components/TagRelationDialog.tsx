import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { normalizeTagName, tagLabelText, type TagCategory, type TagRelationResult } from '@sakuya/shared';
import { api } from '../lib/api';
import { categoryLabel } from '../lib/format';
import { useDebounce } from '../hooks/useDebounce';
import { Modal } from './Modal';
import { TagName } from './TagName';
import { toast, toastError } from './Toast';

export type TagRelationKind = 'merge' | 'imply';

interface TagLike {
  name: string;
  category: TagCategory;
  displayName?: string | null;
}

const NEW_TAG_CATEGORIES: TagCategory[] = ['general', 'character', 'artist', 'copyright'];

/** Everything a relation change can move: tag lists, counts, item tags and the grid behind them. */
export function invalidateAfterRelationChange(qc: QueryClient) {
  for (const key of ['tags', 'tags-summary', 'media-detail', 'media', 'tag-relations']) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

export function relationToast(result: TagRelationResult, done: string) {
  toast(result.job ? `${done}. Updating ${result.job.total || 'existing'} items in the background…` : done);
}

/** Pick the tag `tag` merges into, or the tag it implies. */
export function TagRelationDialog({
  tag,
  kind,
  onClose,
}: {
  tag: TagLike;
  kind: TagRelationKind;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const target = normalizeTagName(text);
  const debounced = useDebounce(target);
  const { data: suggestions } = useQuery({
    queryKey: ['tags', 'relation-suggest', debounced],
    queryFn: () => api.tags({ q: debounced, limit: 8 }),
    enabled: debounced.length > 0,
  });
  const options = (suggestions ?? []).filter((s) => s.name !== tag.name);
  const exists = options.some((s) => s.name === target);
  const [category, setCategory] = useState<TagCategory>(
    kind === 'imply' && tag.category === 'character' ? 'copyright' : kind === 'merge' ? tag.category : 'general',
  );
  const label = tagLabelText(tag);

  const save = useMutation({
    mutationFn: (to: string) =>
      kind === 'merge'
        ? api.addTagSibling({ from: tag.name, to, category })
        : api.addTagImplication({ tag: tag.name, implies: to, category }),
    onSuccess: (result, to) => {
      invalidateAfterRelationChange(qc);
      relationToast(result, kind === 'merge' ? `Merged “${label}” into ${to}` : `“${label}” now implies ${to}`);
      onClose();
    },
    onError: toastError,
  });

  const submit = (to: string) => {
    if (to && to !== tag.name && !save.isPending) save.mutate(to);
  };

  return (
    <Modal
      onClose={save.isPending ? undefined : onClose}
      className="w-full max-w-[420px] rounded-xl border border-line bg-surface p-5"
    >
      <div className="mb-1 text-[15px] font-bold">
        {kind === 'merge' ? <>Merge “{label}” into…</> : <>“{label}” implies…</>}
      </div>
      <div className="mb-3.5 text-[12.5px] text-zinc-500">
        {kind === 'merge'
          ? 'Every item tagged with it gets the tag you pick instead, and so will anything tagged with it later. Searching for the old name keeps working.'
          : 'Every item tagged with it also gets the tag you pick, and loses it again when this tag is removed.'}
      </div>
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // The viewer closes on a window-level Escape; Enter here must not reach other shortcuts.
          e.stopPropagation();
          if (e.key === 'Enter') submit(target);
        }}
        placeholder="Tag name…"
        aria-label={kind === 'merge' ? 'Tag to merge into' : 'Tag it implies'}
        className="w-full rounded-lg border border-line bg-zinc-900 px-2.5 py-2 text-[12.5px] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-line-hover"
      />
      {options.length > 0 && (
        <div className="mt-1.5 flex max-h-[220px] flex-col overflow-y-auto rounded-lg border border-line">
          {options.map((option) => (
            <button
              key={option.name}
              type="button"
              onClick={() => submit(option.name)}
              className="flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
            >
              <TagName tag={option} />
              <span className="flex-none text-[11px] font-normal text-zinc-500">
                {categoryLabel(option.category)} · {option.count}
              </span>
            </button>
          ))}
        </div>
      )}
      {target && !exists && (
        <div className="mt-3 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[11.5px] text-zinc-500">New tag as</span>
          {NEW_TAG_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`cursor-pointer rounded-md px-2 py-1 text-[11px] font-semibold capitalize ${
                category === c ? 'bg-accent text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {categoryLabel(c)}
            </button>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={save.isPending}
          className="cursor-pointer rounded-btn border border-line px-3.5 py-1.5 text-[12.5px] font-semibold text-zinc-300 hover:text-zinc-100"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => submit(target)}
          disabled={!target || target === tag.name || save.isPending}
          className="cursor-pointer rounded-btn bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:cursor-default disabled:opacity-40"
        >
          {kind === 'merge' ? 'Merge' : 'Add implication'}
        </button>
      </div>
    </Modal>
  );
}
