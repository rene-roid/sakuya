import { useCallback } from 'react';
import { useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import type {
  DiscoverLikeResponse,
  DiscoverShelvesResponse,
  DiscoverTagMode,
  Media,
  MediaListResponse,
} from '@sakuya/shared';
import { api } from '../lib/api';
import { toast, toastError } from '../components/Toast';

/** Every Discover list: the feed, the shelves, more-like-this, and the taste panel that explains them. */
export function refreshDiscover(qc: QueryClient): void {
  for (const key of ['discover', 'discover-shelves', 'discover-like', 'discover-profile']) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

type Lists = InfiniteData<MediaListResponse> | DiscoverShelvesResponse | DiscoverLikeResponse;

/** Drops `id` from a cached list; `restore` puts it back where it was in whatever the list is by then. */
function withoutItem(data: Lists | undefined, id: number): { next: Lists | undefined; restore: (cur: Lists) => Lists } {
  const remove = (items: Media[]) => {
    const at = items.findIndex((m) => m.id === id);
    return { items: at < 0 ? items : items.filter((m) => m.id !== id), item: items[at], at };
  };
  const put = (items: Media[], item: Media | undefined, at: number) =>
    !item || at < 0 || items.some((m) => m.id === id) ? items : [...items.slice(0, at), item, ...items.slice(at)];
  const keep = (cur: Lists) => cur;
  if (!data) return { next: data, restore: keep };
  if ('pages' in data) {
    const removed = data.pages.map((p) => remove(p.items));
    return {
      next: { ...data, pages: data.pages.map((p, i) => ({ ...p, items: removed[i].items })) },
      restore: (cur) =>
        'pages' in cur
          ? {
              ...cur,
              pages: cur.pages.map((p, i) => ({ ...p, items: put(p.items, removed[i]?.item, removed[i]?.at ?? -1) })),
            }
          : cur,
    };
  }
  if ('shelves' in data) {
    const removed = data.shelves.map((s) => remove(s.items));
    return {
      next: { shelves: data.shelves.map((s, i) => ({ ...s, items: removed[i].items })) },
      restore: (cur) =>
        'shelves' in cur
          ? {
              shelves: cur.shelves.map((s, i) => ({
                ...s,
                items: put(s.items, removed[i]?.item, removed[i]?.at ?? -1),
              })),
            }
          : cur,
    };
  }
  const removed = remove(data.items);
  return {
    next: { ...data, items: removed.items },
    restore: (cur) =>
      'items' in cur && 'source' in cur ? { ...cur, items: put(cur.items, removed.item, removed.at) } : cur,
  };
}

/**
 * Card and taste-panel actions. A hide takes the card out of every cached Discover list at once
 * rather than refetching, so the grid doesn't jump, and Undo puts it back in the same slot.
 */
export function useDiscoverFeedback() {
  const qc = useQueryClient();

  const hide = useCallback(
    async (item: Media) => {
      const restores: (() => void)[] = [];
      for (const key of ['discover', 'discover-shelves', 'discover-like']) {
        for (const [queryKey, data] of qc.getQueriesData<Lists>({ queryKey: [key] })) {
          const { next, restore } = withoutItem(data, item.id);
          qc.setQueryData(queryKey, next);
          restores.push(() => qc.setQueryData<Lists>(queryKey, (cur) => (cur ? restore(cur) : cur)));
        }
      }
      const putBack = () => restores.forEach((r) => r());
      try {
        await api.setDiscoverHidden(item.id, true);
      } catch (err) {
        putBack();
        toastError(err as Error);
        return;
      }
      qc.invalidateQueries({ queryKey: ['discover-profile'] });
      toast('Hidden. Discover will show a little less like it.', {
        label: 'Undo',
        onClick: () => {
          putBack();
          api
            .setDiscoverHidden(item.id, false)
            .then(() => qc.invalidateQueries({ queryKey: ['discover-profile'] }), toastError);
        },
      });
    },
    [qc],
  );

  const setMode = useCallback(
    async (tag: string, label: string, mode: DiscoverTagMode | null, previous: DiscoverTagMode | null) => {
      try {
        await api.setDiscoverTagMode(tag, mode);
      } catch (err) {
        toastError(err as Error);
        return;
      }
      refreshDiscover(qc);
      const undo = {
        label: 'Undo',
        onClick: () => api.setDiscoverTagMode(tag, previous).then(() => refreshDiscover(qc), toastError),
      };
      if (mode === 'mute') toast(`Muted “${label}”. Nothing with it will show.`, undo);
      else if (mode === 'less') toast(`Showing less of “${label}”`, undo);
      else if (mode === 'boost') toast(`Boosted “${label}”`);
    },
    [qc],
  );

  return { hide, setMode };
}
