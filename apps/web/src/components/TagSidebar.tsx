import { useQuery } from '@tanstack/react-query';
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
    queryFn: () => api.tags({ libraryId: filters.libraryId, limit: 40 }),
    staleTime: 30_000,
  });

  if (collapsed) {
    return (
      <div
        className="sticky top-[60px] flex h-[calc(100vh-60px)] w-7 flex-none cursor-pointer items-start justify-center border-r border-zinc-800 pt-[18px] text-zinc-500 hover:text-zinc-300"
        onClick={onToggle}
      >
        ›
      </div>
    );
  }

  return (
    <div className="sticky top-[60px] h-[calc(100vh-60px)] w-[230px] flex-none overflow-y-auto border-r border-zinc-800 px-3.5 py-[18px]">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-[11px] font-bold tracking-[0.6px] text-zinc-500">LIBRARIES</div>
        <div className="cursor-pointer text-[13px] text-zinc-500 hover:text-zinc-300" onClick={onToggle}>
          ‹
        </div>
      </div>
      <div className="mb-5 flex flex-col gap-0.5">
        <div className={rowStyle(!filters.libraryId && !filters.liked)} onClick={() => actions.setLibrary(undefined)}>
          <span>All libraries</span>
          <span className="text-[11px] text-zinc-500">
            {(libraries ?? []).reduce((sum, l) => sum + l.itemCount, 0)}
          </span>
        </div>
        {/*<div*/}
        {/*  className={rowStyle(!!filters.liked)}*/}
        {/*  onClick={() => {*/}
        {/*    if (!filters.liked) actions.toggleLiked();*/}
        {/*  }}*/}
        {/*>*/}
        {/*  <span className={filters.liked ? 'text-rose-400 flex items-center' : 'flex items-center'}>*/}
        {/*    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">*/}
        {/*      <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" />*/}
        {/*    </svg>*/}
        {/*    &nbsp;*/}
        {/*    Likes*/}
        {/*  </span>*/}
        {/*</div>*/}
        {(libraries ?? []).map((lib) => (
          <div key={lib.id} className={rowStyle(filters.libraryId === lib.id)} onClick={() => actions.setLibrary(lib.id)}>
            <span className="truncate">{lib.name}</span>
            <span className="text-[11px] text-zinc-500">{lib.itemCount}</span>
          </div>
        ))}
      </div>
      <div className="mb-2.5 text-[11px] font-bold tracking-[0.6px] text-zinc-500">TAGS</div>
      <div className="flex flex-col gap-px">
        {(sidebarTags ?? []).map((tag) => {
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
        {(sidebarTags ?? []).length === 0 && (
          <div className="px-2.5 py-1 text-[11.5px] text-zinc-600">No tags yet</div>
        )}
      </div>
    </div>
  );
}
