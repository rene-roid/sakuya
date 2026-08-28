import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useFilters } from '../hooks/useFilters';
import { useMediaInfinite } from '../hooks/useMedia';
import { FilterToolbar } from '../components/FilterToolbar';
import { TagSidebar } from '../components/TagSidebar';
import { MediaGrid } from '../components/MediaGrid';
import { MediaViewer } from '../components/MediaViewer';

const BOARD_FILTERS_KEY = 'sakuya:boardFilters';

export function Board() {
  const [filters, actions] = useFilters();
  const media = useMediaInfinite(filters);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  const rememberFilters = settings?.board_remember_filters !== '0';
  const restored = useRef(false);

  // Restore last-used filters (once) when landing on a bare /board, if remembering is on.
  useEffect(() => {
    if (restored.current || settings === undefined) return;
    restored.current = true;
    if (!rememberFilters) {
      localStorage.removeItem(BOARD_FILTERS_KEY);
      return;
    }
    if (!location.search) {
      const stored = localStorage.getItem(BOARD_FILTERS_KEY);
      if (stored) navigate(`/board?${stored}`, { replace: true });
    }
  }, [settings, rememberFilters, location.search, navigate]);

  // Persist current filters as they change.
  useEffect(() => {
    if (!rememberFilters) return;
    const qs = location.search.replace(/^\?/, '');
    if (qs) localStorage.setItem(BOARD_FILTERS_KEY, qs);
    else localStorage.removeItem(BOARD_FILTERS_KEY);
  }, [location.search, rememberFilters]);

  return (
    <div className="fade-in flex">
      <TagSidebar
        filters={filters}
        actions={actions}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
      />
      <div className="min-w-0 flex-1">
        <div className="max-w-[1400px] px-4 sm:px-8 pt-6">
          <div className="mb-1 flex items-baseline gap-3">
            <h1 className="m-0 text-[22px] font-extrabold">Board</h1>
            <span className="text-[13px] text-zinc-500">
              {media.total} item{media.total === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <div className="sticky top-[60px] z-20 mt-3.5 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
          <div className="px-4 sm:px-8 py-3">
            <FilterToolbar filters={filters} actions={actions} />
          </div>
        </div>
        <div className="px-4 sm:px-8 pb-16 pt-5">
          <MediaGrid
            items={media.items}
            hasNextPage={!!media.hasNextPage}
            isFetchingNextPage={media.isFetchingNextPage}
            fetchNextPage={media.fetchNextPage}
            isLoading={media.isLoading}
            onOpen={setViewerIndex}
          />
        </div>
      </div>
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
