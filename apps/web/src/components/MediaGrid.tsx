import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { Media } from '@sakuya/shared';
import { MediaCard } from './MediaCard';

const GAP = 14;
const MIN_COL = 190;

interface MediaGridProps {
  items: Media[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  isLoading: boolean;
  onOpen: (index: number) => void;
}

export function MediaGrid({ items, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading, onOpen }: MediaGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setWidth(el.clientWidth);
      setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cols = Math.max(2, Math.floor((width + GAP) / (MIN_COL + GAP)));
  const colWidth = width > 0 ? (width - GAP * (cols - 1)) / cols : MIN_COL;
  const rowHeight = colWidth + GAP;
  const rowCount = Math.ceil(items.length / cols);

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowHeight,
    overscan: 4,
    scrollMargin,
  });
  const virtualRows = virtualizer.getVirtualItems();

  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  useEffect(() => {
    const lastRow = virtualRows[virtualRows.length - 1];
    if (!lastRow) return;
    if (lastRow.index >= rowCount - 3 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [virtualRows, rowCount, hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (!isLoading && items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
        <div className="mb-2.5 text-[34px]">◌</div>
        <div className="text-sm font-semibold text-zinc-400">No media matches these filters</div>
        <div className="mt-1 text-[12.5px]">Try removing a tag or switching the type filter.</div>
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualRows.map((row) => {
          const start = row.index * cols;
          const rowItems = items.slice(start, start + cols);
          return (
            <div
              key={row.key}
              className="absolute left-0 top-0 flex w-full"
              style={{ transform: `translateY(${row.start - scrollMargin}px)`, gap: GAP }}
            >
              {rowItems.map((item, i) => (
                <div key={item.id} style={{ width: colWidth }}>
                  <MediaCard item={item} onClick={() => onOpen(start + i)} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {(isFetchingNextPage || isLoading) && (
        <div className="py-6 text-center text-[12.5px] text-zinc-500">Loading…</div>
      )}
    </div>
  );
}
