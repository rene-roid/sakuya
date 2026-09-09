import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { MediaFilters } from '../lib/api';

export interface FilterState extends MediaFilters {
  typeParam: 'all' | 'image' | 'video';
}

export interface FilterActions {
  setType(type: 'all' | 'image' | 'video'): void;
  setSort(sort: 'recent' | 'name'): void;
  randomize(): void;
  addTag(tag: string): void;
  removeTag(tag: string): void;
  setLibrary(id: number | undefined): void;
  setQ(q: string): void;
  toggleLiked(): void;
}

export function parseFilters(params: URLSearchParams, fixedLibraryId?: number): FilterState {
  const typeParam = (params.get('type') as 'image' | 'video' | null) ?? 'all';
  const sort = (params.get('sort') as 'recent' | 'name' | 'random' | null) ?? 'recent';
  const dir = (params.get('dir') as 'asc' | 'desc' | null) ?? (sort === 'recent' ? 'desc' : 'asc');
  const libParam = params.get('library');
  return {
    typeParam: typeParam === 'image' || typeParam === 'video' ? typeParam : 'all',
    type: typeParam === 'image' || typeParam === 'video' ? typeParam : undefined,
    sort,
    dir,
    seed: Number(params.get('seed') ?? 1) || 1,
    tags: (params.get('tags') ?? '').split(',').filter(Boolean),
    liked: params.get('liked') === '1',
    q: params.get('q') ?? undefined,
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
  if (f.q) p.set('q', f.q);
  if (f.sort !== 'recent') p.set('sort', f.sort);
  if (f.dir !== (f.sort === 'recent' ? 'desc' : 'asc')) p.set('dir', f.dir);
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
      setSort: (sort) =>
        update((p) => {
          const current = p.get('sort') ?? 'recent';
          if (current === sort) {
            const dir = p.get('dir') ?? (sort === 'recent' ? 'desc' : 'asc');
            p.set('dir', dir === 'asc' ? 'desc' : 'asc');
          } else {
            p.set('sort', sort);
            p.set('dir', sort === 'recent' ? 'desc' : 'asc');
          }
        }),
      randomize: () =>
        update((p) => {
          p.set('sort', 'random');
          p.set('dir', 'asc');
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
      setQ: (q) => update((p) => (q ? p.set('q', q) : p.delete('q'))),
      toggleLiked: () => update((p) => (p.get('liked') === '1' ? p.delete('liked') : p.set('liked', '1'))),
    }),
    [update],
  );

  return [state, actions];
}
