import { expect, test } from 'bun:test';
import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import type { DashboardResponse, Media, MediaListResponse, SimilarResponse } from '@sakuya/shared';
import { isLikedMediaList, patchCachedMedia } from './mediaCache';

const media = (id: number, liked = false) => ({ id, liked }) as unknown as Media;
const pages = (...ids: number[][]): InfiniteData<MediaListResponse> => ({
  pages: ids.map((page) => ({ items: page.map((id) => media(id)), nextCursor: null, total: 0 }) as MediaListResponse),
  pageParams: ids.map(() => null),
});
const liked = (items: Media[]) => items.filter((m) => m.liked).map((m) => m.id);

test('a patch reaches the item in every cached list, and nothing else', () => {
  const client = new QueryClient();
  client.setQueryData(['media', { libraryId: 1 }], pages([1, 2], [3]));
  client.setQueryData(['media', { libraryId: 2 }], pages([4]));
  client.setQueryData(['discover', {}], pages([3, 5]));
  client.setQueryData<DashboardResponse>(['dashboard'], {
    continueWatching: [media(3)],
    recentlyViewed: [media(6)],
    recentlyAdded: [media(3), media(7)],
  } as unknown as DashboardResponse);
  client.setQueryData<SimilarResponse>(['similar', 9], { duplicates: [media(3)], similar: [media(8)] });
  const untouched = client.getQueryData(['media', { libraryId: 2 }]);

  patchCachedMedia(client, 3, { liked: true });

  const list = client.getQueryData<InfiniteData<MediaListResponse>>(['media', { libraryId: 1 }])!;
  expect(list.pages.map((page) => liked(page.items))).toEqual([[], [3]]);
  expect(liked(client.getQueryData<InfiniteData<MediaListResponse>>(['discover', {}])!.pages[0].items)).toEqual([3]);
  const dashboard = client.getQueryData<DashboardResponse>(['dashboard'])!;
  expect([dashboard.continueWatching, dashboard.recentlyViewed, dashboard.recentlyAdded].map(liked)).toEqual([
    [3],
    [],
    [3],
  ]);
  const similar = client.getQueryData<SimilarResponse>(['similar', 9])!;
  expect([liked(similar.duplicates), liked(similar.similar)]).toEqual([[3], []]);
  // A list that doesn't hold the item keeps its identity, so nothing subscribed to it re-renders.
  expect(client.getQueryData(['media', { libraryId: 2 }])).toBe(untouched);
});

test('a list that has not loaded yet is left alone', () => {
  const client = new QueryClient();
  client.setQueryData(['media', { libraryId: 1 }], undefined);
  expect(() => patchCachedMedia(client, 1, { liked: true })).not.toThrow();
});

test('only media lists filtered to liked items count as liked lists', () => {
  expect(isLikedMediaList(['media', { liked: true }])).toBe(true);
  expect(isLikedMediaList(['media', { liked: false }])).toBe(false);
  expect(isLikedMediaList(['media'])).toBe(false);
  expect(isLikedMediaList(['discover', { liked: true }])).toBe(false);
});
