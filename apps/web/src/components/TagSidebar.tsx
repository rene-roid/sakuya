import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Merge, MoreHorizontal, Pencil, X } from 'lucide-react';
import type { TagCount } from '@sakuya/shared';
import { api } from '../lib/api';
import { TagName, TagRenameInput } from './TagName';
import { MenuItem, MenuPanel } from './Menu';
import { TagRelationDialog, type TagRelationKind } from './TagRelationDialog';
import { exploreQueryString } from '../hooks/useFilters';
import type { FilterState, FilterActions } from '../hooks/useFilters';

function rowStyle(active: boolean): string {
  return `flex cursor-pointer items-center justify-between rounded-field px-2.5 py-[7px] text-[12.5px] font-semibold glass:rounded-full glass:px-3 ${
    active
      ? 'bg-zinc-800 text-zinc-100 glass:bg-white/10 glass:text-white'
      : 'text-zinc-400 hover:text-zinc-200 glass:hover:bg-white/5'
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
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [relation, setRelation] = useState<{ tag: TagCount; kind: TagRelationKind } | null>(null);
  const { data: libraries } = useQuery({ queryKey: ['libraries'], queryFn: api.libraries, staleTime: 30_000 });
  const { data: savedSearches } = useQuery({
    queryKey: ['saved-searches'],
    queryFn: api.savedSearches,
    staleTime: 30_000,
  });
  const deleteSearch = useMutation({
    mutationFn: api.deleteSavedSearch,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-searches'] }),
  });
  const currentQuery = exploreQueryString(filters);
  const { data: ratingTags } = useQuery({
    queryKey: ['tags', 'sidebar', 'rating', filters.libraryId],
    queryFn: () => api.tags({ libraryId: filters.libraryId, category: 'rating' }),
    staleTime: 30_000,
  });
  const { data: artistTags } = useQuery({
    queryKey: ['tags', 'sidebar', 'artist', filters.libraryId],
    queryFn: () => api.tags({ libraryId: filters.libraryId, category: 'artist', limit: 7 }),
    staleTime: 30_000,
  });
  const { data: seriesTags } = useQuery({
    queryKey: ['tags', 'sidebar', 'copyright', filters.libraryId],
    queryFn: () => api.tags({ libraryId: filters.libraryId, category: 'copyright', limit: 7 }),
    staleTime: 30_000,
  });
  const { data: characterTags } = useQuery({
    queryKey: ['tags', 'sidebar', 'character', filters.libraryId],
    queryFn: () => api.tags({ libraryId: filters.libraryId, category: 'character', limit: 7 }),
    staleTime: 30_000,
  });
  const { data: generalTags } = useQuery({
    queryKey: ['tags', 'sidebar', 'general', filters.libraryId],
    queryFn: () => api.tags({ libraryId: filters.libraryId, category: ['general', 'user'], limit: 100 }),
    staleTime: 30_000,
  });

  const sections = [
    { title: 'ARTISTS', tags: artistTags ?? [] },
    { title: 'SERIES', tags: seriesTags ?? [] },
    { title: 'RATING', tags: ratingTags ?? [] },
    { title: 'CHARACTERS', tags: characterTags ?? [] },
    { title: 'TAGS', tags: generalTags ?? [] },
  ];

  if (collapsed) {
    return (
      <button
        className="sticky top-(--nav-h) hidden h-[calc(100dvh-var(--nav-h)-var(--dock-h))] w-7 flex-none cursor-pointer items-start justify-center sm:flex border-r border-line pt-[18px] text-zinc-500 hover:text-zinc-300"
        onClick={onToggle}
      >
        <ChevronRight size={18} />
      </button>
    );
  }

  return (
    <>
      <div className="fade-in fixed inset-0 z-40 bg-black/60 sm:hidden glass:backdrop-blur-sm" onClick={onToggle} />
      <div className="fixed inset-y-0 left-0 z-50 h-full w-[230px] overflow-y-auto border-r border-line bg-zinc-950 px-3.5 py-[18px] max-sm:w-[min(290px,85vw)] max-sm:pb-[calc(18px+env(safe-area-inset-bottom))] max-sm:glass:rounded-r-3xl max-sm:glass:bg-[#0f0f13]/90 max-sm:glass:backdrop-blur-2xl sm:sticky sm:top-(--nav-h) sm:z-auto sm:h-[calc(100dvh-var(--nav-h)-var(--dock-h))] sm:flex-none sm:bg-transparent">
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
      {(savedSearches ?? []).length > 0 && (
        <>
          <div className="mb-2.5 text-[11px] font-bold tracking-[0.6px] text-zinc-500">SAVED</div>
          <div className="mb-5 flex flex-col gap-px">
            {(savedSearches ?? []).map((search) => (
              <div
                key={search.id}
                className={rowStyle(search.query === currentQuery)}
                onClick={() => navigate(`/explore?${search.query}`)}
              >
                <span className="truncate">{search.name}</span>
                <span
                  title="Delete saved search"
                  className="ml-1 flex-none cursor-pointer text-zinc-600 hover:text-rose-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSearch.mutate(search.id);
                  }}
                >
                  <X size={12} />
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {sections.map(
        (section, i) =>
          section.tags.length > 0 && (
            <Fragment key={section.title}>
              <div className="mb-2.5 text-[11px] font-bold tracking-[0.6px] text-zinc-500">{section.title}</div>
              {/* The last section is the end of the panel; the rest keep a gap below. */}
              <div className={`${i < sections.length - 1 ? 'mb-5 ' : ''}flex flex-col gap-px`}>
                {section.tags.map((tag) => {
                  const active = filters.tags.includes(tag.name);
                  if (renaming === tag.name) {
                    return (
                      <div key={tag.name} className={rowStyle(active)}>
                        <TagRenameInput tag={tag} onDone={() => setRenaming(null)} className="-my-0.5 w-full" />
                      </div>
                    );
                  }
                  return (
                    <div
                      key={tag.name}
                      title={tag.name}
                      className={`group ${rowStyle(active)}`}
                      onClick={() => (active ? actions.removeTag(tag.name) : actions.addTag(tag.name))}
                    >
                      <TagName tag={tag} />
                      <span className="relative ml-1.5 flex flex-none items-center gap-1.5">
                        <button
                          title="Tag options"
                          aria-label={`Options for ${tag.name}`}
                          className={`${menuFor === tag.name ? 'block' : 'hidden'} cursor-pointer text-zinc-500 hover:text-zinc-200 group-hover:block group-focus-within:block focus:block`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuFor(menuFor === tag.name ? null : tag.name);
                          }}
                        >
                          <MoreHorizontal size={13} />
                        </button>
                        <span className="text-[11px] text-zinc-500">{tag.count}</span>
                        {menuFor === tag.name && (
                          // The panel's own clicks must not reach the row, which toggles the filter.
                          <div onClick={(e) => e.stopPropagation()}>
                            <MenuPanel width={170} onClose={() => setMenuFor(null)}>
                              {[
                                { icon: <Pencil size={13} />, label: 'Rename…', run: () => setRenaming(tag.name) },
                                {
                                  icon: <Merge size={13} />,
                                  label: 'Merge into…',
                                  run: () => setRelation({ tag, kind: 'merge' }),
                                },
                                {
                                  icon: <ArrowRight size={13} />,
                                  label: 'Implies…',
                                  run: () => setRelation({ tag, kind: 'imply' }),
                                },
                              ].map((item) => (
                                <MenuItem
                                  key={item.label}
                                  icon={item.icon}
                                  label={item.label}
                                  onClick={() => {
                                    setMenuFor(null);
                                    item.run();
                                  }}
                                />
                              ))}
                            </MenuPanel>
                          </div>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Fragment>
          ),
      )}
      {sections.every((section) => section.tags.length === 0) && (
        <div className="px-2.5 py-1 text-[11.5px] text-zinc-600">No tags yet</div>
      )}
      </div>
      {relation && <TagRelationDialog tag={relation.tag} kind={relation.kind} onClose={() => setRelation(null)} />}
    </>
  );
}
