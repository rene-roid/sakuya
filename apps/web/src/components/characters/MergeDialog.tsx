import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Merge, Search } from 'lucide-react';
import type { CharacterSummary } from '@sakuya/shared';
import { api } from '../../lib/api';
import { characterLabelText } from '../../lib/characters';
import { Modal } from '../Modal';
import { toast, toastError } from '../Toast';
import { Crop, invalidateCharacters, useCharacterList } from './NamePicker';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Pick the character this one is really the same as; its faces move there and this one goes away. */
export function MergeDialog({
  character,
  onClose,
  onMerged,
}: {
  character: CharacterSummary;
  onClose: () => void;
  onMerged: (into: CharacterSummary) => void;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<CharacterSummary | null>(null);
  const { data } = useCharacterList(true);
  const label = characterLabelText(character);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [...(data?.named ?? []), ...(data?.suggested ?? []), ...(data?.unnamed ?? [])].filter(
      (c) => c.id !== character.id,
    );
    const matching = q
      ? all.filter((c) => c.name && (characterLabelText(c).toLowerCase().includes(q) || c.name.includes(q.replace(/\s+/g, '_'))))
      : all;
    // Named first, so the usual case (an unnamed cluster that is someone already named) is on top.
    return matching.sort((a, b) => Number(!a.name) - Number(!b.name) || b.mediaCount - a.mediaCount);
  }, [data, query, character.id]);

  const merge = useMutation({
    mutationFn: (into: CharacterSummary) => api.mergeCharacter(character.id, into.id),
    onSuccess: (into) => {
      toast(`Merged into ${characterLabelText(into)} · ${plural(into.mediaCount, 'item')}`);
      invalidateCharacters(qc);
      onMerged(into);
    },
    onError: toastError,
  });

  return (
    <Modal
      onClose={merge.isPending ? undefined : onClose}
      className="flex max-h-[min(640px,90dvh)] w-full max-w-[440px] flex-col rounded-panel border border-line bg-surface p-4 shadow-2xl glass:bg-surface/95 glass:backdrop-blur-xl"
    >
      <div className="text-[15px] font-bold">Merge {label} into…</div>
      <div className="mt-0.5 text-[12.5px] text-zinc-500">
        Its {plural(character.detectionCount, 'face')} move to the character you pick, and {label} goes away.
      </div>
      <div className="relative mt-3">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search characters"
          aria-label="Search characters"
          className="w-full rounded-field border border-line bg-zinc-900 py-1.5 pl-8 pr-2 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-accent"
        />
      </div>
      <div className="-mx-1 mt-2 min-h-[120px] flex-1 overflow-y-auto">
        {candidates.length === 0 && (
          <div className="px-1 py-3 text-[12.5px] text-zinc-500">{data ? 'No other character matches.' : 'Loading…'}</div>
        )}
        {candidates.map((c) => (
          <button
            type="button"
            key={c.id}
            onClick={() => setTarget(c)}
            aria-pressed={target?.id === c.id}
            className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left ${
              target?.id === c.id ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
            }`}
          >
            <Crop url={c.coverUrl} alt="" className="h-10 w-8 flex-none !rounded-[6px]" />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[13px] font-semibold ${c.name ? 'text-zinc-200' : 'text-zinc-500'}`}>
                {characterLabelText(c)}
                {c.hidden && <span className="ml-1.5 text-[11px] font-normal text-zinc-600">hidden</span>}
              </span>
              <span className="block text-[11.5px] text-zinc-500">{plural(c.mediaCount, 'item')}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 border-t border-line pt-3">
        <button
          type="button"
          onClick={onClose}
          disabled={merge.isPending}
          className="cursor-pointer rounded-btn px-3 py-1.5 text-[12.5px] font-semibold text-zinc-400 hover:text-zinc-200"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!target || merge.isPending}
          onClick={() => target && merge.mutate(target)}
          className="flex cursor-pointer items-center gap-1.5 rounded-btn bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:cursor-default disabled:opacity-40"
        >
          <Merge size={13} />
          {target ? `Merge into ${characterLabelText(target)}` : 'Merge'}
        </button>
      </div>
    </Modal>
  );
}
