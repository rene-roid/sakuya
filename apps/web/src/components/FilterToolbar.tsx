import { Shuffle, ArrowUp, ArrowDown, Heart, X } from 'lucide-react';
import { TagSearchInput } from './TagSearchInput';
import type { FilterState, FilterActions } from '../hooks/useFilters';

function segStyle(active: boolean): string {
  return `cursor-pointer rounded-md px-[13px] py-1.5 text-[12.5px] font-semibold ${
    active ? 'bg-accent text-white' : 'text-zinc-400 hover:text-zinc-200'
  }`;
}

export function FilterToolbar({ filters, actions }: { filters: FilterState; actions: FilterActions }) {
  const DirIcon = filters.dir === 'asc' ? ArrowUp : ArrowDown;

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
          <Heart size={13} fill={filters.liked ? 'currentColor' : 'none'} />
        </div>
      </div>
      <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
        <div className={segStyle(filters.sort === 'recent')} onClick={() => actions.setSort('recent')}>
          <span className="flex items-center gap-1">
            Recent
            {filters.sort === 'recent' && <DirIcon size={13} />}
          </span>
        </div>
        <div className={segStyle(filters.sort === 'name')} onClick={() => actions.setSort('name')}>
          <span className="flex items-center gap-1">
            Name
            {filters.sort === 'name' && <DirIcon size={13} />}
          </span>
        </div>
      </div>
      <div
        className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-[7px] text-[13px] font-semibold ${
          filters.sort === 'random' ? 'border-accent/40 text-accent' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
        }`}
        onClick={actions.randomize}
      >
        <Shuffle size={16} />
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
            <X size={11} />
          </span>
        </div>
      )}
    </div>
  );
}
