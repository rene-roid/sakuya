import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { tagLabelText, type DiscoverTagMode, type DiscoverTasteTag } from '@sakuya/shared';
import { api } from '../lib/api';
import { refreshDiscover, useDiscoverFeedback } from '../hooks/useDiscoverFeedback';
import { TagName } from './TagName';
import { toast, toastError } from './Toast';

/** Click order on a chip: boost, then mute, then back to normal. "Less" counts as normal here. */
function nextMode(mode: DiscoverTagMode | null): DiscoverTagMode | null {
  if (mode === 'boost') return 'mute';
  if (mode === 'mute') return null;
  return 'boost';
}

const NEXT_HINT: Record<string, string> = {
  boost: 'Click to boost: twice the weight',
  mute: 'Click to mute: hide everything with this tag',
  normal: 'Click to reset',
};

function Chip({ tag, onCycle }: { tag: DiscoverTasteTag; onCycle: () => void }) {
  const next = nextMode(tag.mode) ?? 'normal';
  const muted = tag.mode === 'mute';
  return (
    <button
      type="button"
      onClick={onCycle}
      title={`${tag.related ? 'Neighbour of tags you like. ' : ''}${NEXT_HINT[next]}`}
      aria-pressed={tag.mode === 'boost' || muted}
      className={`relative flex max-w-[220px] cursor-pointer items-center gap-1 overflow-hidden rounded-btn border px-2 py-[3px] text-[12px] font-semibold transition-colors ${
        tag.related ? 'border-dashed' : ''
      } ${
        tag.mode === 'boost'
          ? 'border-accent/70 text-zinc-100'
          : muted
            ? 'border-line text-zinc-500 line-through'
            : tag.related
              ? 'border-line-strong text-zinc-400 hover:text-zinc-200'
              : 'border-line-strong text-zinc-300 hover:text-zinc-100'
      }`}
    >
      {tag.mode === 'boost' && <ArrowUp size={12} className="flex-none text-accent" />}
      {tag.mode === 'less' && <ArrowDown size={12} className="flex-none text-zinc-500" />}
      <TagName tag={tag} />
      {!muted && (
        <i
          className="absolute bottom-0 left-0 h-[2px] bg-accent/80"
          style={{ width: `${Math.max(tag.weight * 100, 4)}%` }}
        />
      )}
    </button>
  );
}

/**
 * "Your taste": the profile's strongest tags with a bar for how much each one counts. Clicking a
 * chip boosts it, a second click mutes it, a third puts it back.
 */
export function TastePanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['discover-profile'], queryFn: api.discoverProfile, staleTime: 15_000 });
  const { setMode } = useDiscoverFeedback();
  if (!data || (!data.tags.length && !data.hiddenCount)) return null;

  const allMuted = data.activeTags === 0 && data.tags.some((t) => t.mode === 'mute');
  return (
    <section className="rounded-panel border border-line bg-surface px-3.5 py-2.5 glass:bg-white/[0.03]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.5px] text-zinc-500">Your taste</span>
        {data.tags.map((tag) => (
          <Chip
            key={tag.name}
            tag={tag}
            onCycle={() => setMode(tag.name, tagLabelText(tag), nextMode(tag.mode), tag.mode)}
          />
        ))}
      </div>
      {/* The how-to line is left off on phones, where it took two more rows above the shelves. */}
      <div
        className={`mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500 ${
          allMuted || data.hiddenCount > 0 ? '' : 'max-sm:hidden'
        }`}
      >
        {allMuted ? (
          <span className="text-zinc-400">
            Every taste tag is muted, so picks below are random until you unmute one.
          </span>
        ) : (
          <span className="max-sm:hidden">
            Click a tag to boost it, again to mute it, a third time to reset. Dashed tags are neighbours of what you
            like.
          </span>
        )}
        {data.hiddenCount > 0 && (
          <button
            type="button"
            className="cursor-pointer font-semibold text-zinc-400 hover:text-zinc-200"
            onClick={() =>
              api.clearDiscoverHidden().then(({ cleared }) => {
                refreshDiscover(qc);
                toast(`${cleared} hidden item${cleared === 1 ? '' : 's'} can show again`);
              }, toastError)
            }
          >
            {data.hiddenCount} hidden · show again
          </button>
        )}
      </div>
    </section>
  );
}
