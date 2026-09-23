import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { DashboardResponse, Media, MediaListResponse, SimilarResponse } from '@sakuya/shared';
import type { MediaFilters } from './api';

function patchList<T extends Media>(items: T[], id: number, patch: Partial<Media>): T[] {
  return items.some((m) => m.id === id) ? items.map((m) => (m.id === id ? { ...m, ...patch } : m)) : items;
}

function patchPages(
  data: InfiniteData<MediaListResponse> | undefined,
  id: number,
  patch: Partial<Media>,
): InfiniteData<MediaListResponse> | undefined {
  if (!data?.pages) return data;
  return { ...data, pages: data.pages.map((page) => ({ ...page, items: patchList(page.items, id, patch) })) };
}

/**
 * Apply a change to one media item everywhere it's cached, in place.
 *
 * The alternative, invalidating ['media'], refetches every page of every media list the user has
 * scrolled through — dozens of requests for one heart click — and never reached the Discover
 * feed at all, whose cards kept showing the old state.
 */
export function patchCachedMedia(queryClient: QueryClient, id: number, patch: Partial<Media>): void {
  queryClient.setQueriesData<InfiniteData<MediaListResponse>>({ queryKey: ['media'] }, (data) =>
    patchPages(data, id, patch),
  );
  queryClient.setQueriesData<InfiniteData<MediaListResponse>>({ queryKey: ['discover'] }, (data) =>
    patchPages(data, id, patch),
  );
  queryClient.setQueriesData<DashboardResponse>({ queryKey: ['dashboard'] }, (data) =>
    data
      ? {
          ...data,
          continueWatching: patchList(data.continueWatching, id, patch),
          recentlyViewed: patchList(data.recentlyViewed, id, patch),
          recentlyAdded: patchList(data.recentlyAdded, id, patch),
        }
      : data,
  );
  queryClient.setQueriesData<SimilarResponse>({ queryKey: ['similar'] }, (data) =>
    data ? { duplicates: patchList(data.duplicates, id, patch), similar: patchList(data.similar, id, patch) } : data,
  );
}

/** Media lists filtered to liked items: a like change adds or removes rows, so these do refetch. */
export function isLikedMediaList(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'media' && (queryKey[1] as MediaFilters | undefined)?.liked === true;
}
