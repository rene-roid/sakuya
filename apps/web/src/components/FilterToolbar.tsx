import { TagSearchInput } from './TagSearchInput';
import type { FilterState, FilterActions } from '../hooks/useFilters';

function segStyle(active: boolean): string {
  return `cursor-pointer rounded-md px-[13px] py-1.5 text-[12.5px] font-semibold ${
    active ? 'bg-accent text-white' : 'text-zinc-400 hover:text-zinc-200'
  }`;
}

export function FilterToolbar({ filters, actions }: { filters: FilterState; actions: FilterActions }) {
  const dirArrow = filters.dir === 'asc' ? '↑' : '↓';

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
        {(['all', 'image', 'video'] as const).map((t) => (
          <div key={t} className={segStyle(filters.typeParam === t)} onClick={() => actions.setType(t)}>
            {t === 'all' ? 'All' : t === 'image' ? 'Images' : 'Videos'}
          </div>
        ))}
        <div
          title="Show only liked media"
          className={`flex cursor-pointer items-center rounded-md px-[13px] py-1.5 text-[13px] font-semibold ${
            filters.liked ? 'bg-rose-500 text-white' : 'text-zinc-400 hover:text-rose-400'
          }`}
          onClick={actions.toggleLiked}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" />
          </svg>
        </div>
      </div>
      <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
        <div className={segStyle(filters.sort === 'recent')} onClick={() => actions.setSort('recent')}>
          Recent{filters.sort === 'recent' ? ` ${dirArrow}` : ''}
        </div>
        <div className={segStyle(filters.sort === 'name')} onClick={() => actions.setSort('name')}>
          Name{filters.sort === 'name' ? ` ${dirArrow}` : ''}
        </div>
      </div>
      <div
        className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-[7px] text-[13px] font-semibold ${
          filters.sort === 'random' ? 'border-accent/40 text-accent' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
        }`}
        onClick={actions.randomize}
      >
        <span>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                 className="lucide lucide-shuffle-icon lucide-shuffle"><path d="m18 14 4 4-4 4"/><path
                d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path
                d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/></svg>
        </span>
          <span>Randomize</span>
      </div>
        <div className="relative min-w-[220px] flex-1">
            <TagSearchInput
                tags={filters.tags}
                onAddTag={actions.addTag}
                onRemoveTag={actions.removeTag}
                onFreeText={actions.setQ}
                libraryId={filters.libraryId}
                placeholder="Add tag filter, press Enter…"
            />
        </div>
        {filters.q && (
            <div
                className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800 py-1 pl-2.5 pr-1.5 text-xs font-semibold text-zinc-300">
          <span>“{filters.q}”</span>
          <span
            className="flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-zinc-700"
            onClick={() => actions.setQ('')}
          >
            ×
          </span>
        </div>
      )}
    </div>
  );
}
