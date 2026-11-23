import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { DiscoverShelf } from '@sakuya/shared';
import { MediaCard } from './MediaCard';

/**
 * One Discover shelf: a title line and a single row of tiles. Wider screens show as many tiles as
 * fit and clip the rest (the row never wraps); phones scroll the row sideways instead.
 */
export function Shelf({
  shelf,
  seeAll,
  onOpen,
}: {
  shelf: DiscoverShelf;
  seeAll: string;
  onOpen: (shelf: DiscoverShelf, index: number) => void;
}) {
  const open = useCallback((index: number) => onOpen(shelf, index), [onOpen, shelf]);
  return (
    <section>
      <div className="mb-1.5 flex items-baseline gap-2">
        <h2 className="m-0 min-w-0 truncate text-[13.5px] font-bold text-zinc-100 glass:font-semibold">
          {shelf.title}
        </h2>
        <span className="hidden truncate text-[12px] text-zinc-500 sm:inline">{shelf.subtitle}</span>
        <Link
          to={seeAll}
          className="ml-auto flex flex-none items-center text-[12px] font-semibold text-zinc-400 hover:text-zinc-100"
        >
          See all
          <ChevronRight size={14} />
        </Link>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(138px,1fr))] sm:grid-rows-[auto] sm:auto-rows-[0] sm:gap-y-0 sm:overflow-hidden sm:pb-0">
        {shelf.items.map((item, i) => (
          <div key={item.id} className="w-[118px] flex-none sm:w-auto">
            <MediaCard item={item} index={i} onActivate={open} discoverMenu />
          </div>
        ))}
      </div>
    </section>
  );
}
