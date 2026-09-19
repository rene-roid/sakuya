import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

/**
 * How many trailing items of a single-line row have to be hidden for the rest to fit.
 *
 * The row is measured, not guessed: `rowRef` must be `flex-nowrap overflow-hidden`, so a row
 * that doesn't fit reports `scrollWidth > clientWidth`. Each pass hides one more item and
 * re-measures, all inside layout effects — React flushes those before paint, so the
 * overflowing intermediate states never reach the screen.
 *
 * A cycle only ever collapses. Expanding mid-cycle would oscillate: hiding an item frees the
 * width that made it not fit, which would bring it back, which would overflow again. Instead a
 * resize (or a change of `signature`) starts a fresh cycle from zero hidden, which is also how
 * items come back when the window widens.
 *
 * `boxRef` is the row's stable-width parent rather than the row itself: anything the collapse
 * reveals (an overflow button beside the row) narrows the row, and observing a box that the
 * collapse itself resizes would restart the cycle forever.
 */
export function useOverflowCount(
  rowRef: RefObject<HTMLElement | null>,
  boxRef: RefObject<HTMLElement | null>,
  max: number,
  /** Cheap string describing the row's contents; changing it restarts the measuring cycle. */
  signature: string,
): number {
  // `cycle` is what makes a resize re-measure: resetting `hidden` to a 0 it already holds is a
  // no-op React would bail out of, leaving an overflowing row uncollapsed.
  const [{ hidden, cycle }, setState] = useState({ hidden: 0, cycle: 0 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    // Only width decides the answer. Reacting to height as well would let a collapse that
    // changes the row's height start the next cycle, and that cycle the one after it.
    let lastWidth = -1;
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      setState((s) => ({ hidden: 0, cycle: s.cycle + 1 }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [boxRef]);

  useLayoutEffect(() => {
    setState((s) => (s.hidden === 0 ? s : { hidden: 0, cycle: s.cycle + 1 }));
  }, [signature, max]);

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    if (hidden < max && el.scrollWidth > el.clientWidth + 1) {
      setState((s) => ({ hidden: s.hidden + 1, cycle: s.cycle }));
    }
  }, [rowRef, hidden, cycle, max, signature]);

  return Math.min(hidden, max);
}
