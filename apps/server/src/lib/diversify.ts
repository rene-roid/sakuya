/**
 * Variety re-rank for a ranked feed. Ranking scores each item on its own, so a batch of
 * near-identical shots from one folder all score alike and land as one block. This walks the
 * ranked stream and, for each slot, takes the best-ranked candidate that keeps the feed varied:
 *
 * - at most `folderCap` items from one folder in any `window` consecutive items,
 * - at most `reasonCap` items credited to the same reason tag in any `window` consecutive items,
 * - at most one of a group within dHash distance `dupDistance` in any `dupWindow` consecutive items.
 *
 * A candidate that breaks a rule is deferred, not dropped: it stays at the head of the queue and
 * takes the first slot where it fits. Only `lookahead` candidates are considered per slot. When
 * none of them fits, the rules are let go one at a time, least visible first: the reason cap,
 * then the folder cap, then near-duplicate spacing, since a fifth shot from one folder reads as
 * variety gone thin while the same picture twice reads as a bug. A library that is one folder
 * still fills the feed, in rank order.
 *
 * The output order depends only on the input order, never on page size, which is what lets the
 * route serve pages as slices of one deterministic stream.
 */
export interface DiversifyOptions {
  window: number;
  /** 0 disables the folder rule. */
  folderCap: number;
  /** 0 disables the reason rule. */
  reasonCap: number;
  /** Negative disables near-duplicate spacing. */
  dupDistance: number;
  dupWindow: number;
  lookahead: number;
}

export interface Candidate {
  id: number;
  folder: string;
  reason: string | null;
  /** 16-char hex dHash, or null. */
  hash: string | null;
}

interface Entry extends Candidate {
  hi: number;
  lo: number;
}

function popcount(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

const usableHash = (h: string | null): h is string => !!h && /^[0-9a-f]{16}$/i.test(h);

/** Directory part of a media path, for either separator. */
export function folderOf(p: string): string {
  return p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'), 0));
}

const RELAX_LEVELS = 3;

export class Diversifier {
  private queue: Entry[] = [];
  private recent: Entry[] = [];
  private readonly keep: number;

  constructor(private readonly opts: DiversifyOptions) {
    this.keep = Math.max(opts.window, opts.dupWindow, 1) - 1;
  }

  /** Candidates waiting for a slot, including deferred ones. */
  get pending(): number {
    return this.queue.length;
  }

  push(items: Candidate[]): void {
    for (const c of items) {
      const hash = usableHash(c.hash) ? c.hash : null;
      this.queue.push({
        ...c,
        hash,
        hi: hash ? parseInt(hash.slice(0, 8), 16) : 0,
        lo: hash ? parseInt(hash.slice(8, 16), 16) : 0,
      });
    }
  }

  /** Next item of the varied feed, or null when the queue is empty. */
  next(): Candidate | null {
    if (!this.queue.length) return null;
    const limit = Math.min(this.queue.length, this.opts.lookahead);
    let chosen = 0;
    search: for (let relax = 0; relax < RELAX_LEVELS; relax++) {
      for (let i = 0; i < limit; i++) {
        if (this.fits(this.queue[i], relax)) {
          chosen = i;
          break search;
        }
      }
    }
    const [entry] = this.queue.splice(chosen, 1);
    this.recent.push(entry);
    if (this.recent.length > this.keep) this.recent.shift();
    return { id: entry.id, folder: entry.folder, reason: entry.reason, hash: entry.hash };
  }

  /** relax 0 checks every rule; 1 drops the reason cap, 2 also the folder cap. */
  private fits(c: Entry, relax: number): boolean {
    const { window, reasonCap: cap, dupDistance, dupWindow } = this.opts;
    const reasonCap = relax >= 1 ? 0 : cap;
    const folderCap = relax >= 2 ? 0 : this.opts.folderCap;
    const n = this.recent.length;
    if (folderCap > 0 || reasonCap > 0) {
      let folders = 0;
      let reasons = 0;
      for (let i = Math.max(0, n - (window - 1)); i < n; i++) {
        const r = this.recent[i];
        if (r.folder === c.folder) folders++;
        if (c.reason !== null && r.reason === c.reason) reasons++;
      }
      if (folderCap > 0 && folders >= folderCap) return false;
      if (reasonCap > 0 && reasons >= reasonCap) return false;
    }
    if (dupDistance >= 0 && c.hash) {
      for (let i = Math.max(0, n - (dupWindow - 1)); i < n; i++) {
        const r = this.recent[i];
        if (r.hash && popcount((r.hi ^ c.hi) >>> 0) + popcount((r.lo ^ c.lo) >>> 0) <= dupDistance) return false;
      }
    }
    return true;
  }
}

/** The whole varied order of `items` at once. */
export function diversify(items: Candidate[], opts: DiversifyOptions): number[] {
  const d = new Diversifier(opts);
  d.push(items);
  const out: number[] = [];
  for (let c = d.next(); c; c = d.next()) out.push(c.id);
  return out;
}
