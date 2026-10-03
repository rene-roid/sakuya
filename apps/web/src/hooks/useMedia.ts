import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, type DiscoverFilters, type MediaFilters } from '../lib/api';
import type { Media, MediaListResponse } from '@sakuya/shared';

/** A cursor-paged media feed, flattened into one list. */
function useInfiniteMedia<F>(
  key: string,
  filters: F,
  fetchPage: (filters: F, cursor?: string) => Promise<MediaListResponse>,
) {
  const query = useInfiniteQuery({
    queryKey: [key, filters],
    queryFn: ({ pageParam }) => fetchPage(filters, pageParam || undefined),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
  });

  const items = useMemo<Media[]>(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;

  return { ...query, items, total };
}

export const useMediaInfinite = (filters: MediaFilters) => useInfiniteMedia('media', filters, api.mediaList);
export const useDiscoverInfinite = (filters: DiscoverFilters) => useInfiniteMedia('discover', filters, api.discover);
