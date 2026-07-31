import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, type MediaFilters } from '../lib/api';
import type { Media } from '@sakuya/shared';

export function useMediaInfinite(filters: MediaFilters) {
  const query = useInfiniteQuery({
    queryKey: ['media', filters],
    queryFn: ({ pageParam }) => api.mediaList(filters, pageParam || undefined),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
  });

  const items = useMemo<Media[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );
  const total = query.data?.pages[0]?.total ?? 0;

  return { ...query, items, total };
}
