import type { Media } from '@sakuya/shared';
import { thumbUrl } from '../lib/api';
import { formatDuration } from '../lib/format';

export function TypeBadge({ type }: { type: 'image' | 'video' }) {
  return (
    <div
      className={`absolute left-1.5 top-1.5 rounded px-1.5 py-px text-[9px] font-bold tracking-wide text-white backdrop-blur ${
        type === 'video' ? 'bg-accent/85' : 'bg-black/60'
      }`}
    >
      {type === 'video' ? 'VIDEO' : 'IMAGE'}
    </div>
  );
}

export function DurationBadge({ seconds }: { seconds: number | null }) {
  const label = formatDuration(seconds);
  if (!label) return null;
  return (
    <div className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-px text-[10px] font-semibold text-zinc-100">
      {label}
    </div>
  );
}

/** Square virtualized-grid card with hover overlay. */
export function MediaCard({ item, onClick }: { item: Media; onClick: () => void }) {
  return (
    <div className="cursor-pointer" onClick={onClick}>
      <div className="group relative aspect-square w-full overflow-hidden rounded-[10px] border border-zinc-800 bg-zinc-900">
        <img
          src={thumbUrl(item.id)}
          alt={item.filename}
          loading="lazy"
          className="h-full w-full object-cover"
        />
        <TypeBadge type={item.type} />
        <DurationBadge seconds={item.durationSeconds} />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-2 pt-6 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="truncate text-xs font-bold text-white">{item.filename}</div>
          <div className="mt-0.5 text-[10.5px] text-zinc-300">
            {item.tagCount} tag{item.tagCount === 1 ? '' : 's'}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Wide 16:9 card for dashboard rows. */
export function WideCard({
  item,
  onClick,
  showProgress,
}: {
  item: Media;
  onClick: () => void;
  showProgress?: boolean;
}) {
  return (
    <div className="w-[200px] flex-none cursor-pointer" onClick={onClick}>
      <div className="relative h-[112px] w-[200px] overflow-hidden rounded-[10px] border border-zinc-800 bg-zinc-900">
        <img src={thumbUrl(item.id)} alt={item.filename} loading="lazy" className="h-full w-full object-cover" />
        {showProgress && (
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/15">
            <div className="h-full bg-accent" style={{ width: `${Math.round(item.viewProgress * 100)}%` }} />
          </div>
        )}
        <TypeBadge type={item.type} />
        <DurationBadge seconds={item.durationSeconds} />
      </div>
      <div className="mt-[7px] truncate text-[12.5px] font-semibold text-zinc-200">{item.filename}</div>
      <div className="mt-px text-[11px] text-zinc-500">{item.libraryName}</div>
    </div>
  );
}
