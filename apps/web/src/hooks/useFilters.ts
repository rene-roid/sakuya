import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { MediaFilters } from '../lib/api';

export type SortMode = MediaFilters['sort'];

/** Newest/biggest first reads better; only name wants A→Z. Server mirrors this. */
export function defaultDir(sort: SortMode): 'asc' | 'desc' {
  return sort === 'name' ? 'asc' : 'desc';
}

export interface FilterState extends MediaFilters {
  typeParam: 'all' | 'image' | 'video';
}

export interface FilterActions {
  setType(type: 'all' | 'image' | 'video'): void;
  setSort(sort: SortMode): void;
  randomize(): void;
  addTag(tag: string): void;
  removeTag(tag: string): void;
  setLibrary(id: number | undefined): void;
  addQ(term: string): void;
  removeQ(term: string): void;
  toggleLiked(): void;
  clearFilters(): void;
}

export function parseFilters(params: URLSearchParams, fixedLibraryId?: number): FilterState {
  const typeParam = (params.get('type') as 'image' | 'video' | null) ?? 'all';
  const sort = (params.get('sort') as SortMode | null) ?? 'recent';
  const dir = (params.get('dir') as 'asc' | 'desc' | null) ?? defaultDir(sort);
  const libParam = params.get('library');
  return {
    typeParam: typeParam === 'image' || typeParam === 'video' ? typeParam : 'all',
    type: typeParam === 'image' || typeParam === 'video' ? typeParam : undefined,
    sort,
    dir,
    seed: Number(params.get('seed') ?? 1) || 1,
    tags: (params.get('tags') ?? '').split(',').filter(Boolean),
    liked: params.get('liked') === '1',
    q: params.getAll('q').filter(Boolean),
    libraryId: fixedLibraryId ?? (libParam ? Number(libParam) : undefined),
  };
}

/**
 * Inverse of parseFilters: the canonical /board query string for a filter state.
 * Omits values equal to the parser's defaults so saved searches stay short and comparable.
 */
export function boardQueryString(f: FilterState): string {
  const p = new URLSearchParams();
  if (f.libraryId) p.set('library', String(f.libraryId));
  if (f.typeParam !== 'all') p.set('type', f.typeParam);
  if (f.tags.length) p.set('tags', f.tags.join(','));
  if (f.liked) p.set('liked', '1');
  for (const term of f.q) p.append('q', term);
  if (f.sort !== 'recent') p.set('sort', f.sort);
  if (f.dir !== defaultDir(f.sort)) p.set('dir', f.dir);
  if (f.sort === 'random') p.set('seed', String(f.seed));
  return p.toString();
}

export function useFilters(fixedLibraryId?: number): [FilterState, FilterActions] {
  const [params, setParams] = useSearchParams();

  const state = useMemo<FilterState>(() => parseFilters(params, fixedLibraryId), [params, fixedLibraryId]);

  const update = useCallback(
    (fn: (next: URLSearchParams) => void) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          fn(next);
          return next;
        },
        { replace: false },
      );
    },
    [setParams],
  );

  const actions = useMemo<FilterActions>(
    () => ({
      setType: (type) => update((p) => (type === 'all' ? p.delete('type') : p.set('type', type))),
      // Three states per sort: default direction, flipped direction, then off (back to recent).
      setSort: (sort) =>
        update((p) => {
          const current = (p.get('sort') as SortMode | null) ?? 'recent';
          if (current !== sort) {
            p.set('sort', sort);
            p.set('dir', defaultDir(sort));
          } else if ((p.get('dir') ?? defaultDir(sort)) === defaultDir(sort)) {
            p.set('dir', defaultDir(sort) === 'asc' ? 'desc' : 'asc');
          } else {
            p.delete('sort');
            p.delete('dir');
          }
        }),
      randomize: () =>
        update((p) => {
          p.set('sort', 'random');
          p.set('dir', defaultDir('random'));
          p.set('seed', String(Math.floor(Math.random() * 2 ** 30) + 1));
        }),
      addTag: (tag) =>
        update((p) => {
          const tags = (p.get('tags') ?? '').split(',').filter(Boolean);
          const clean = tag.trim().toLowerCase().replace(/\s+/g, '_');
          if (clean && !tags.includes(clean)) p.set('tags', [...tags, clean].join(','));
        }),
      removeTag: (tag) =>
        update((p) => {
          const tags = (p.get('tags') ?? '').split(',').filter(Boolean).filter((t) => t !== tag);
          if (tags.length) p.set('tags', tags.join(','));
          else p.delete('tags');
        }),
      setLibrary: (id) => update((p) => (id ? p.set('library', String(id)) : p.delete('library'))),
      addQ: (term) =>
        update((p) => {
          const clean = term.trim();
          if (clean && !p.getAll('q').includes(clean)) p.append('q', clean);
        }),
      removeQ: (term) =>
        update((p) => {
          const rest = p.getAll('q').filter((t) => t !== term);
          p.delete('q');
          for (const t of rest) p.append('q', t);
        }),
      toggleLiked: () => update((p) => (p.get('liked') === '1' ? p.delete('liked') : p.set('liked', '1'))),
      // Clears what narrows the results; sort/seed and the current library are how you're
      // viewing them, not filters, so they survive.
      clearFilters: () =>
        update((p) => {
          for (const key of ['tags', 'q', 'liked', 'type']) p.delete(key);
        }),
    }),
    [update],
  );

  return [state, actions];
}
