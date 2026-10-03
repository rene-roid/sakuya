import { useEffect, useRef, useState } from 'react';
import { PanelLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useFilters } from '../hooks/useFilters';
import { useSettings } from '../hooks/useSettings';
import { TagSidebar } from '../components/TagSidebar';
import { MediaBrowser } from '../components/MediaBrowser';

const EXPLORE_FILTERS_KEY = 'sakuya:exploreFilters';

export function Explore() {
  const [filters, actions] = useFilters();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);

  const navigate = useNavigate();
  const location = useLocation();
  const settings = useSettings();
  const rememberFilters = settings?.board_remember_filters !== '0';
  const restored = useRef(false);

  // Restore last-used filters (once) when landing on a bare /explore, if remembering is on.
  useEffect(() => {
    if (restored.current || settings === undefined) return;
    restored.current = true;
    if (!rememberFilters) {
      localStorage.removeItem(EXPLORE_FILTERS_KEY);
      return;
    }
    if (!location.search) {
      const stored = localStorage.getItem(EXPLORE_FILTERS_KEY);
      if (stored) navigate(`/explore?${stored}`, { replace: true });
    }
  }, [settings, rememberFilters, location.search, navigate]);

  // Persist current filters as they change.
  useEffect(() => {
    if (!rememberFilters) return;
    const qs = location.search.replace(/^\?/, '');
    if (qs) localStorage.setItem(EXPLORE_FILTERS_KEY, qs);
    else localStorage.removeItem(EXPLORE_FILTERS_KEY);
  }, [location.search, rememberFilters]);

  return (
    <MediaBrowser
      title="Explore"
      filters={filters}
      actions={actions}
      sidebar={
        <TagSidebar
          filters={filters}
          actions={actions}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((c) => !c)}
        />
      }
      headerExtra={
        // Phones get this instead of the collapsed sidebar strip, which ate a column of the grid.
        <button
          onClick={() => setSidebarCollapsed(false)}
          className="ml-auto flex cursor-pointer items-center gap-1.5 self-center rounded-btn border border-line px-3 py-1.5 text-[12.5px] font-semibold text-zinc-300 hover:text-zinc-100 sm:hidden glass:bg-white/[0.04] glass:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
        >
          <PanelLeft size={14} />
          Libraries &amp; tags
        </button>
      }
    />
  );
}
