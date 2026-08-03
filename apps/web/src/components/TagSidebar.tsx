import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import type { FilterState, FilterActions } from '../hooks/useFilters';

function rowStyle(active: boolean): string {
  return `flex cursor-pointer items-center justify-between rounded-[7px] px-2.5 py-[7px] text-[12.5px] font-semibold ${
    active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
  }`;
}

export function TagSidebar({
  filters,
  actions,
  collapsed,
  onToggle,
}: {
  filters: FilterState;
  actions: FilterActions;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { data: libraries } = useQuery({ queryKey: ['libraries'], queryFn: api.libraries, staleTime: 30_000 });
  const { data: sidebarTags } = useQuery({
    queryKey: ['tags', 'sidebar', filters.libraryId],
    queryFn: () => api.tags({ libraryId: filters.libraryId, limit: 100 }),
    staleTime: 30_000,
  });

  if (collapsed) {
    return (
      <button
        className="sticky top-[60px] flex h-[calc(100vh-60px)] w-7 flex-none cursor-pointer items-start justify-center border-r border-zinc-800 pt-[18px] text-zinc-500 hover:text-zinc-300"
        onClick={onToggle}
      >
        <ChevronRight size={18} />
      </button>
    );
  }

  return (
    <div className="sticky top-[60px] h-[calc(100vh-60px)] w-[230px] flex-none overflow-y-auto border-r border-zinc-800 px-3.5 py-[18px]">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-[11px] font-bold tracking-[0.6px] text-zinc-500">LIBRARIES</div>
        <button className="cursor-pointer text-zinc-500 hover:text-zinc-300" onClick={onToggle}>
          <ChevronLeft size={16} />
        </button>
      </div>
      <div className="mb-5 flex flex-col gap-0.5">
        <div className={rowStyle(!filters.libraryId && !filters.liked)} onClick={() => actions.setLibrary(undefined)}>
          <span>All libraries</span>
          <span className="text-[11px] text-zinc-500">
            {(libraries ?? []).reduce((sum, l) => sum + l.itemCount, 0)}
          </span>
        </div>
        {(libraries ?? []).map((lib) => (
          <div key={lib.id} className={rowStyle(filters.libraryId === lib.id)} onClick={() => actions.setLibrary(lib.id)}>
            <span className="truncate">{lib.name}</span>
            <span className="text-[11px] text-zinc-500">{lib.itemCount}</span>
          </div>
        ))}
      </div>
      {(() => {
        const tags = sidebarTags ?? [];
        const ratings = tags.filter((t) => t.category === 'rating');
        const characters = tags.filter((t) => t.category === 'character');
        const general = tags.filter((t) => t.category === 'general' || t.category === 'user');

        return (
          <>
            {ratings.length > 0 && (
              <>
                <div className="mb-2.5 text-[11px] font-bold tracking-[0.6px] text-zinc-500">RATING</div>
                <div className="mb-5 flex flex-col gap-px">
                  {ratings.map((tag) => {
                    const active = filters.tags.includes(tag.name);
                    return (
                      <div
                        key={tag.name}
                        className={rowStyle(active)}
                        onClick={() => (active ? actions.removeTag(tag.name) : actions.addTag(tag.name))}
                      >
                        <span className="truncate">{tag.name}</span>
                        <span className="text-[11px] text-zinc-500">{tag.count}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {characters.length > 0 && (
              <>
                <div className="mb-2.5 text-[11px] font-bold tracking-[0.6px] text-zinc-500">CHARACTERS</div>
                <div className="mb-5 flex flex-col gap-px">
                  {characters.map((tag) => {
                    const active = filters.tags.includes(tag.name);
                    return (
                      <div
                        key={tag.name}
                        className={rowStyle(active)}
                        onClick={() => (active ? actions.removeTag(tag.name) : actions.addTag(tag.name))}
                      >
                        <span className="truncate">{tag.name}</span>
                        <span className="text-[11px] text-zinc-500">{tag.count}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {general.length > 0 && (
              <>
                <div className="mb-2.5 text-[11px] font-bold tracking-[0.6px] text-zinc-500">TAGS</div>
                <div className="flex flex-col gap-px">
                  {general.map((tag) => {
                    const active = filters.tags.includes(tag.name);
                    return (
                      <div
                        key={tag.name}
                        className={rowStyle(active)}
                        onClick={() => (active ? actions.removeTag(tag.name) : actions.addTag(tag.name))}
                      >
                        <span className="truncate">{tag.name}</span>
                        <span className="text-[11px] text-zinc-500">{tag.count}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {tags.length === 0 && (
              <div className="px-2.5 py-1 text-[11.5px] text-zinc-600">No tags yet</div>
            )}
          </>
        );
      })()}
    </div>
  );
}
