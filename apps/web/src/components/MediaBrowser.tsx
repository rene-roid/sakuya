import { useState, type ReactNode } from 'react';
import type { FilterActions, FilterState } from '../hooks/useFilters';
import { useMediaInfinite } from '../hooks/useMedia';
import { useSelection } from '../hooks/useSelection';
import { FilterToolbar } from './FilterToolbar';
import { MediaGrid } from './MediaGrid';
import { SelectionBar } from './SelectionBar';
import { MediaViewer } from './MediaViewer';

/**
 * A filterable media page: title with the item count, the sticky filter toolbar, the grid, and
 * the selection bar and viewer on top. Explore, a library and a board are all this page.
 */
export function MediaBrowser({
  title,
  filters,
  actions,
  boardId,
  sidebar,
  headerExtra,
}: {
  title: ReactNode;
  filters: FilterState;
  actions: FilterActions;
  /** Restricts the grid to one board and unlocks "remove from board". */
  boardId?: number;
  /** Explore's tag sidebar. With one, the page runs full width beside it instead of centered. */
  sidebar?: ReactNode;
  headerExtra?: ReactNode;
}) {
  const query = { ...filters, boardId };
  const media = useMediaInfinite(query);
  const selection = useSelection(media.items, JSON.stringify(query));
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const centered = sidebar ? '' : 'mx-auto max-w-[1400px] ';

  const page = (
    <>
      <div className={`${sidebar ? 'max-w-[1400px] ' : centered}px-4 sm:px-8 pt-6`}>
        <div className="mb-1 flex items-baseline gap-3">
          <h1 className="m-0 text-[22px] font-extrabold glass:text-[24px] glass:font-semibold">{title}</h1>
          <span className="text-[13px] text-zinc-500">
            {media.total} item{media.total === 1 ? '' : 's'}
          </span>
          {headerExtra}
        </div>
      </div>
      <div className="sticky top-(--nav-h) z-20 mt-3.5 border-b border-line bg-bar backdrop-blur transition-transform duration-300 max-md:nav-hidden:-translate-y-[calc(100%+var(--nav-h))] glass:backdrop-blur-2xl">
        <div className={`${centered}px-4 sm:px-8 py-3`}>
          <FilterToolbar filters={filters} actions={actions} selection={selection} />
        </div>
      </div>
      <div className={`${centered}px-4 sm:px-8 pb-16 pt-5`}>
        <MediaGrid
          items={media.items}
          hasNextPage={!!media.hasNextPage}
          isFetchingNextPage={media.isFetchingNextPage}
          fetchNextPage={media.fetchNextPage}
          isLoading={media.isLoading}
          onOpen={setViewerIndex}
          selection={selection}
        />
      </div>
    </>
  );

  return (
    <div className={sidebar ? 'fade-in flex' : 'fade-in'}>
      {sidebar}
      {sidebar ? <div className="min-w-0 flex-1">{page}</div> : page}
      {selection.active && <SelectionBar selection={selection} filters={query} total={media.total} boardId={boardId} />}
      {viewerIndex !== null && (
        <MediaViewer
          items={media.items}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          onNearEnd={() => media.hasNextPage && !media.isFetchingNextPage && media.fetchNextPage()}
        />
      )}
    </div>
  );
}
