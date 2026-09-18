import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Media } from '@sakuya/shared';

export interface SelectionApi {
  /** True while the grid is in multi-select mode (cards toggle instead of opening). */
  active: boolean;
  ids: Set<number>;
  count: number;
  enter: () => void;
  exit: () => void;
  /** Card click while in select mode. `shift` extends from the last-clicked card. */
  click: (index: number, shift: boolean) => void;
  toggle: (id: number) => void;
  selectAllLoaded: () => void;
  /** Used by "select all N matching", which resolves ids on the server. */
  replace: (ids: number[]) => void;
  clear: () => void;
}

/**
 * Multi-select state for a media grid.
 *
 * `items` is the loaded (paginated) window, which is what index-based range selection walks.
 * Selected ids may legitimately point outside it — "select all matching" pulls ids straight
 * from the server — so consumers must resolve metadata by id rather than assuming membership.
 *
 * `resetKey` should change whenever the underlying query changes (filters, board, library):
 * ids from a previous result set would otherwise linger and get bulk-edited by accident.
 */
export function useSelection(items: Media[], resetKey: string): SelectionApi {
  const [active, setActive] = useState(false);
  const [ids, setIds] = useState<Set<number>>(new Set());
  const anchorRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    setIds(new Set());
    anchorRef.current = null;
  }, []);

  const exit = useCallback(() => {
    setActive(false);
    clear();
  }, [clear]);

  // A new query means a different result set; carrying a selection across it is never right.
  useEffect(() => {
    clear();
  }, [resetKey, clear]);

  const toggle = useCallback((id: number) => {
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const click = useCallback(
    (index: number, shift: boolean) => {
      const item = items[index];
      if (!item) return;
      const anchor = anchorRef.current;
      if (shift && anchor !== null && anchor !== index) {
        // Range extension adds rather than toggles, matching file-manager behaviour.
        const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
        setIds((prev) => {
          const next = new Set(prev);
          for (let i = from; i <= to; i++) {
            const row = items[i];
            if (row) next.add(row.id);
          }
          return next;
        });
        return;
      }
      anchorRef.current = index;
      toggle(item.id);
    },
    [items, toggle],
  );

  const selectAllLoaded = useCallback(() => {
    setIds(new Set(items.map((item) => item.id)));
  }, [items]);

  const replace = useCallback((next: number[]) => {
    setIds(new Set(next));
    anchorRef.current = null;
  }, []);

  const enter = useCallback(() => setActive(true), []);

  useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      // Don't hijack keys while the user is typing in a filter or dialog field.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        exit();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAllLoaded();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, exit, selectAllLoaded]);

  return useMemo(
    () => ({ active, ids, count: ids.size, enter, exit, click, toggle, selectAllLoaded, replace, clear }),
    [active, ids, enter, exit, click, toggle, selectAllLoaded, replace, clear],
  );
}
