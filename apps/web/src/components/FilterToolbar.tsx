import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useDebounce } from '../hooks/useDebounce';
import type { FilterState, FilterActions } from '../hooks/useFilters';

function segStyle(active: boolean): string {
  return `cursor-pointer rounded-md px-[13px] py-1.5 text-[12.5px] font-semibold ${
    active ? 'bg-accent text-white' : 'text-zinc-400 hover:text-zinc-200'
  }`;
}

export function FilterToolbar({ filters, actions }: { filters: FilterState; actions: FilterActions }) {
  const [tagInput, setTagInput] = useState('');
  const debouncedInput = useDebounce(tagInput.trim());

  const { data: suggestions } = useQuery({
    queryKey: ['tags', 'suggest', debouncedInput, filters.libraryId],
    queryFn: () => api.tags({ q: debouncedInput, libraryId: filters.libraryId, limit: 8 }),
    enabled: debouncedInput.length > 0,
    staleTime: 30_000,
  });
  const visibleSuggestions = (suggestions ?? []).filter((s) => !filters.tags.includes(s.name));

  const dirArrow = filters.dir === 'asc' ? '↑' : '↓';

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
        {(['all', 'image', 'video'] as const).map((t) => (
          <div key={t} className={segStyle(filters.typeParam === t)} onClick={() => actions.setType(t)}>
            {t === 'all' ? 'All' : t === 'image' ? 'Images' : 'Videos'}
          </div>
        ))}
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
        <span>🔀</span>
        <span>Randomize</span>
      </div>
      <div className="relative min-w-[180px] flex-1">
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && tagInput.trim()) {
              actions.addTag(visibleSuggestions.length === 1 ? visibleSuggestions[0].name : tagInput);
              setTagInput('');
            }
          }}
          placeholder="Add tag filter, press Enter…"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-[7px] text-[13px] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-600"
        />
        {tagInput.trim().length > 0 && visibleSuggestions.length > 0 && (
          <div className="absolute inset-x-0 top-[38px] z-30 overflow-hidden rounded-lg border border-zinc-600 bg-zinc-900 shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
            {visibleSuggestions.map((s) => (
              <div
                key={s.name}
                className="flex cursor-pointer items-center justify-between px-3 py-2 text-[12.5px] text-zinc-200 hover:bg-zinc-800"
                onClick={() => {
                  actions.addTag(s.name);
                  setTagInput('');
                }}
              >
                <span>{s.name}</span>
                <span className="text-[11px] text-zinc-500">{s.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {filters.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {filters.tags.map((tag) => (
            <div
              key={tag}
              className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/15 py-1 pl-2.5 pr-1.5 text-xs font-semibold text-violet-300"
            >
              <span>{tag}</span>
              <span
                className="flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-accent/25"
                onClick={() => actions.removeTag(tag)}
              >
                ×
              </span>
            </div>
          ))}
        </div>
      )}
      {filters.q && (
        <div className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800 py-1 pl-2.5 pr-1.5 text-xs font-semibold text-zinc-300">
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
