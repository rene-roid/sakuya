import type { SQLQueryBindings } from 'bun:sqlite';
import { tagLabelText, type TagCategory } from '@sakuya/shared';
import { sqlite } from '../db';
import { getSetting, setSetting } from './settings';

const DAY = 86_400_000;

/**
 * Knobs measured by apps/server/scripts/discover-eval.ts (the `shelves` section of its metrics
 * mode). Mutable only so that script can sweep them.
 */
export const shelfTuning = {
  /** Rediscover: liked at least this long ago... */
  rediscoverLikedDays: 60,
  /** ...and not opened for at least this long. */
  rediscoverUnopenedDays: 30,
  /** "Because you like" shelves, one per strongest taste tag. */
  tagShelves: 3,
};

/** A Discover visit within this long of the previous one continues the same visit. */
const VISIT_GAP_MS = 30 * 60_000;

/**
 * A shelf is a filter over the Discover feed: `where` is a condition on the feed query's `m`
 * (media) and `s` (snapshot scores) rows. The shelf row and its "See all" page are the same feed
 * with this condition added, so they rank and exclude identically.
 */
export interface ShelfDef {
  id: string;
  title: string;
  subtitle: string;
  tag?: string;
  where: string;
  params: SQLQueryBindings[];
}

const UNSEEN = 'm.view_count = 0 AND m.liked = 0';

function tagShelf(name: string): ShelfDef | null {
  const tag = sqlite.query(`SELECT id, category, display_name AS displayName FROM tags WHERE name = ?`).get(name) as {
    id: number;
    category: TagCategory;
    displayName: string | null;
  } | null;
  if (!tag) return null;
  return {
    id: `like:${name}`,
    title: `Because you like ${tagLabelText({ name, ...tag })}`,
    subtitle: 'not opened yet',
    tag: name,
    where: `m.id IN (SELECT media_id FROM media_tags WHERE tag_id = ?) AND ${UNSEEN}`,
    params: [tag.id],
  };
}

function newShelf(): ShelfDef | null {
  const since = lastVisit();
  if (since === null) return null;
  return {
    id: 'new',
    title: 'New since your last visit',
    subtitle: 'added since you last opened Discover',
    where: 'm.created_at > ?',
    params: [since],
  };
}

function rediscoverShelf(now: number): ShelfDef {
  return {
    id: 'rediscover',
    title: 'Rediscover',
    subtitle: 'liked a while ago, not opened since',
    // A like from before liked_at existed is old by definition.
    where: 'm.liked = 1 AND COALESCE(m.liked_at, 0) < ? AND COALESCE(m.last_viewed_at, 0) < ?',
    params: [now - shelfTuning.rediscoverLikedDays * DAY, now - shelfTuning.rediscoverUnopenedDays * DAY],
  };
}

const offBeatShelf: ShelfDef = {
  id: 'offbeat',
  title: 'Off the beaten path',
  subtitle: 'close to your taste, not in it',
  where: `s.raw > 0 AND s.related = 1 AND ${UNSEEN}`,
  params: [],
};

/** Every shelf, in page order. `tagNames` are the strongest taste tags, strongest first. */
export function shelfDefs(tagNames: string[], now = Date.now()): ShelfDef[] {
  const tags = tagNames.slice(0, shelfTuning.tagShelves).map(tagShelf);
  return [...tags, newShelf(), rediscoverShelf(now), offBeatShelf].filter((s): s is ShelfDef => s !== null);
}

/** The shelf behind a "See all" link, or null for an id that names nothing. */
export function shelfById(id: string, now = Date.now()): ShelfDef | null {
  if (id.startsWith('like:')) return tagShelf(id.slice(5));
  if (id === 'new') return newShelf();
  if (id === 'rediscover') return rediscoverShelf(now);
  if (id === 'offbeat') return offBeatShelf;
  return null;
}

/**
 * Notes a Discover page open. "Last visit" is when the previous visit ended, so a reload or a
 * quick trip to another page doesn't empty the "new" shelf; only a return after a break moves it.
 */
export function recordVisit(now = Date.now()): void {
  const at = Number(getSetting('discover_visit_at')) || 0;
  if (at && now - at > VISIT_GAP_MS) setSetting('discover_last_visit', String(at));
  setSetting('discover_visit_at', String(now));
}

export function lastVisit(): number | null {
  const at = Number(getSetting('discover_last_visit'));
  return at > 0 ? at : null;
}
