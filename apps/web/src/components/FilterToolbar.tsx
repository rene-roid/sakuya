import { Fragment, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Shuffle, ArrowUp, ArrowDown, Heart, X, BookmarkPlus, ListChecks, MoreVertical } from 'lucide-react';
import { TagSearchInput } from './TagSearchInput';
import { MenuItem, MenuLabel, MenuPanel } from './Menu';
import { api } from '../lib/api';
import { exploreQueryString } from '../hooks/useFilters';
import { useOverflowCount } from '../hooks/useOverflowCount';
import type { FilterState, FilterActions } from '../hooks/useFilters';
import type { SelectionApi } from '../hooks/useSelection';

function segStyle(active: boolean): string {
  return `cursor-pointer rounded-md px-[13px] py-1.5 text-[12.5px] font-semibold ${
    active ? 'bg-accent text-white' : 'text-zinc-400 hover:text-zinc-200'
  }`;
}

function buttonStyle(accent?: boolean): string {
  return `flex flex-none cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-[7px] text-[13px] font-semibold ${
    accent ? 'border-accent/40 text-accent' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
  }`;
}

const SORTS = [
  { key: 'recent', label: 'Recent' },
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size' },
] as const;

/** One control in the row: its inline form, and how it reads once it moves into the menu. */
interface ToolbarItem {
  id: string;
  inline: ReactNode;
  /** Pinned items never collapse — the row is useless without them. */
  pinned?: boolean;
  menu?: ReactNode;
}

/**
 * Filter row for the media grids. It always occupies exactly one line: when the window (or a
 * pile of active query chips) leaves too little room, controls move into a three-dot menu from
 * the right edge inward — Save, Select, Clear all, Randomize, Sort, Type — until the rest fits.
 * The search box and the active chips stay put at every width.
 */
export function FilterToolbar({
  filters,
  actions,
  selection,
}: {
  filters: FilterState;
  actions: FilterActions;
  selection?: SelectionApi;
}) {
  const DirIcon = filters.dir === 'asc' ? ArrowUp : ArrowDown;
  const qc = useQueryClient();
  const boxRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const query = exploreQueryString(filters);
  const hasFilters =
    filters.tags.length > 0 || filters.q.length > 0 || filters.liked || filters.typeParam !== 'all';
  const saveSearch = useMutation({
    mutationFn: (name: string) => api.createSavedSearch({ name, query }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-searches'] }),
  });

  const canSelect = !!selection && !selection.active;
  const promptSaveSearch = () => {
    const name = window.prompt('Name this search')?.trim();
    if (name) saveSearch.mutate(name);
  };
  const fromMenu = (run: () => void) => () => {
    setMenuOpen(false);
    run();
  };

  const items: ToolbarItem[] = [
    {
      id: 'type',
      inline: (
        <div className="flex flex-none rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
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
      ),
      menu: (
        <div key="type">
          <MenuLabel>Type</MenuLabel>
          {(['all', 'image', 'video'] as const).map((t) => (
            <MenuItem
              key={t}
              label={t === 'all' ? 'All' : t === 'image' ? 'Images' : 'Videos'}
              active={filters.typeParam === t}
              onClick={fromMenu(() => actions.setType(t))}
            />
          ))}
          <MenuItem
            icon={<Heart size={13} fill={filters.liked ? 'currentColor' : 'none'} />}
            label="Liked only"
            active={filters.liked}
            onClick={fromMenu(actions.toggleLiked)}
          />
        </div>
      ),
    },
    {
      id: 'sort',
      inline: (
        <div className="flex flex-none rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
          {SORTS.map((srt) => (
            <div key={srt.key} className={segStyle(filters.sort === srt.key)} onClick={() => actions.setSort(srt.key)}>
              <span className="flex items-center gap-1">
                {srt.label}
                {filters.sort === srt.key && <DirIcon size={13} />}
              </span>
            </div>
          ))}
        </div>
      ),
      menu: (
        <div key="sort">
          <MenuLabel>Sort</MenuLabel>
          {SORTS.map((srt) => (
            <MenuItem
              key={srt.key}
              icon={filters.sort === srt.key ? <DirIcon size={13} /> : undefined}
              label={srt.label}
              active={filters.sort === srt.key}
              // Kept open: re-picking the active sort flips its direction, which you want to see.
              onClick={() => actions.setSort(srt.key)}
            />
          ))}
        </div>
      ),
    },
    {
      id: 'randomize',
      inline: (
        <div className={buttonStyle(filters.sort === 'random')} onClick={actions.randomize}>
          <Shuffle size={16} />
          <span>Randomize</span>
        </div>
      ),
      menu: (
        <MenuItem key="randomize" icon={<Shuffle size={13} />} label="Randomize" onClick={fromMenu(actions.randomize)} />
      ),
    },
    {
      id: 'search',
      pinned: true,
      inline: (
        <div className="relative min-w-[220px] flex-1">
          <TagSearchInput
            tags={filters.tags}
            onAddTag={actions.addTag}
            onRemoveTag={actions.removeTag}
            onFreeText={actions.addQ}
            libraryId={filters.libraryId}
            placeholder="Add tag filter, press Enter…"
          />
        </div>
      ),
    },
    ...filters.q.map((term) => ({
      id: `q:${term}`,
      pinned: true,
      inline: (
        <div className="flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-700 bg-zinc-800 py-1 pl-2.5 pr-1.5 text-xs font-semibold text-zinc-300">
          <span>“{term}”</span>
          <span
            className="flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-zinc-700"
            onClick={() => actions.removeQ(term)}
          >
            <X size={11} />
          </span>
        </div>
      ),
    })),
  ];

  if (hasFilters) {
    items.push({
      id: 'clear',
      inline: (
        <div title="Clear every active filter" className={buttonStyle()} onClick={actions.clearFilters}>
          <X size={16} />
          <span>Clear all</span>
        </div>
      ),
      menu: <MenuItem key="clear" icon={<X size={13} />} label="Clear all filters" onClick={fromMenu(actions.clearFilters)} />,
    });
  }
  if (canSelect) {
    items.push({
      id: 'select',
      inline: (
        <div title="Select multiple files for bulk actions" className={buttonStyle()} onClick={selection.enter}>
          <ListChecks size={16} />
          <span>Select</span>
        </div>
      ),
      menu: <MenuItem key="select" icon={<ListChecks size={13} />} label="Select" onClick={fromMenu(selection.enter)} />,
    });
  }
  if (query) {
    items.push({
      id: 'save',
      inline: (
        <div title="Save these filters as a search" className={buttonStyle()} onClick={promptSaveSearch}>
          <BookmarkPlus size={16} />
          <span>Save</span>
        </div>
      ),
      menu: (
        <MenuItem key="save" icon={<BookmarkPlus size={13} />} label="Save search" onClick={fromMenu(promptSaveSearch)} />
      ),
    });
  }

  const collapsible = items.filter((item) => !item.pinned);
  const signature = `${items.map((i) => i.id).join('|')}|${filters.sort}|${filters.dir}|${filters.liked}|${
    filters.tags.length
  }`;
  const hiddenCount = useOverflowCount(rowRef, boxRef, collapsible.length, signature);
  // Collapse right to left: the last `hiddenCount` collapsible controls move into the menu.
  const hiddenIds = new Set(collapsible.slice(collapsible.length - hiddenCount).map((item) => item.id));
  // An active filter must never disappear without a trace, so the button carries a dot when
  // what it swallowed isn't in its default state.
  const hiddenActive =
    (hiddenIds.has('type') && (filters.typeParam !== 'all' || filters.liked)) ||
    (hiddenIds.has('sort') && filters.sort !== 'recent');

  return (
    // The overflow button sits outside the clipped row: a dropdown inside it would be cut off,
    // and a row whose own width the button changes would restart the measuring cycle forever.
    <div ref={boxRef} className="flex items-center gap-4">
      <div ref={rowRef} className="flex min-w-0 flex-1 flex-nowrap items-center gap-4 overflow-hidden">
        {items.filter((item) => !hiddenIds.has(item.id)).map((item) => (
          <Fragment key={item.id}>{item.inline}</Fragment>
        ))}
      </div>
      {hiddenIds.size > 0 && (
        <div className="relative flex-none">
          <div
            title="More filters"
            aria-label="More filters"
            className="relative flex cursor-pointer items-center rounded-lg border border-zinc-800 px-2 py-[7px] text-zinc-400 hover:text-zinc-200"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreVertical size={16} />
            {hiddenActive && (
              <span className="absolute right-[3px] top-[3px] h-[6px] w-[6px] rounded-full bg-accent" />
            )}
          </div>
          {menuOpen && (
            <MenuPanel width={210} onClose={() => setMenuOpen(false)}>
              {collapsible.filter((item) => hiddenIds.has(item.id)).map((item) => item.menu)}
            </MenuPanel>
          )}
        </div>
      )}
    </div>
  );
}
