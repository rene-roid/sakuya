import { Router } from 'express';
import { z } from 'zod';
import { sqlite } from '../db';
import { wrap, encodeCursor, decodeCursor, intParam } from '../lib/http';
import type { SQLQueryBindings } from 'bun:sqlite';
import { rowToMedia, type MediaSqlRow } from '../lib/rowToMedia';
import { bumpTasteVersion, tasteVersion } from '../lib/tasteVersion';
import { Diversifier, diversify, folderOf } from '../lib/diversify';
import { semanticSearchEnabled } from '../lib/settings';
import { mediaEmbedding, rankByVector } from '../services/semantic';
import { shelfById, shelfDefs, recordVisit, type ShelfDef } from '../lib/discoverShelves';
import {
  DISCOVER_TAG_MODES,
  MEDIA_TYPES,
  type DiscoverLikeResponse,
  type DiscoverProfileResponse,
  type DiscoverShelvesResponse,
  type DiscoverTagMode,
  type Media,
  type MediaListResponse,
  type TagCategory,
} from '@sakuya/shared';

export const discoverRouter = Router();

const discoverQuerySchema = z.object({
  type: z.enum(MEDIA_TYPES).optional(),
  // 0 = pure taste match, 1 = pure random. The page offers 0.1 / 0.3 / 0.6 as presets; any value
  // still works so old links keep their order.
  surprise: z.coerce.number().min(0).max(1).default(0.3),
  /** Narrows the feed to one shelf (lib/discoverShelves.ts): a shelf's "See all". */
  shelf: z.string().optional(),
  seed: z.coerce.number().int().default(1),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

/** How many of the strongest profile tags get expanded into their co-occurring neighbours. */
const SEED_TAGS = 10;
/** Neighbour tags enter the profile at this fraction of the weakest seed tag's weight. */
const ADJACENT_SHARE = 0.35;
/** A neighbour needs at least this many co-occurrences before it counts as related, not noise. */
const MIN_CO_OCCURRENCE = 2;
const MAX_PROFILE_TAGS = 120;
/**
 * Damping added to a tag's occurrence count before dividing engagement by it. Weighting by
 * engagement per occurrence is what stops a tag that's on half the library ("solo", "1girl")
 * from riding along on every item and turning the feed into a wall of one tag; the constant
 * keeps a tag seen exactly once from outranking everything on the strength of a single like.
 */
const TAG_SMOOTHING = 8;
/** Already-seen media keeps its score but at this fraction, so it sinks without disappearing. */
const SEEN_FACTOR = 0.4;
/**
 * Engagement a "Not interested" takes away from each of the item's tags, against 5 for a like.
 * Small on purpose: hiding one picture says little about every tag on it, and a tag the user
 * also likes elsewhere should barely move.
 */
const HIDE_PENALTY = 1.5;

/**
 * Knobs measured by apps/server/scripts/discover-eval.ts, which reports the numbers each value
 * was picked from. Mutable only so that script can sweep them; nothing else writes here.
 */
export const discoverTuning = {
  /**
   * An item scores the sum of its `topK` best profile weights (0 = every matching tag). Summing
   * every match let an item tagged forty times outrank one with five tags you clearly like,
   * because tag count grew the score as much as taste did.
   */
  topK: 5,
  /** Engagement loses half its weight every this many days (0 = never), so taste can move on. */
  halfLifeDays: 60,
  /** Variety rules, in any `window` consecutive feed items; see lib/diversify.ts. */
  window: 20,
  folderCap: 4,
  reasonCap: 5,
  /** dHash distance at or under which two images count as the same shot (-1 = off). */
  dupDistance: 6,
  /** Near-duplicates are kept at least this many items apart: one per page of 60. */
  dupWindow: 60,
  lookahead: 200,
  /**
   * Weight multipliers for "boost" and "Less of X"; a muted tag leaves the profile entirely. Half
   * was too gentle for "less": a tag that was already at the reason cap stopped being the credited
   * reason, escaped the cap, and showed up more often than before.
   */
  boostFactor: 2,
  lessFactor: 0.25,
  /**
   * Reason cap for items credited to a boosted tag. Boosting makes the tag the credited reason on
   * more cards, and at the plain cap that held its share flat or even lowered it.
   */
  boostedReasonCap: 10,
  /** More like this ranks on distinctive tags first (see rankSharedTags); false = the full sum. */
  likeShortcut: true,
  /** A tag on at most 1 in this many items counts as distinctive. */
  likeDistinctive: 10,
  /** Distinctive-tag leaders re-ranked with every shared tag, per result kept. */
  likeRerank: 10,
  /**
   * More like this blends the image-embedding neighbours with the shared-tag ranking by weighted
   * reciprocal rank, 1 / (likeFuseK + rank) per list. 0 = tags only.
   */
  likeVisualWeight: 1,
  likeFuseK: 20,
};

const modeFactor = (mode: DiscoverTagMode | null) =>
  mode === 'boost' ? discoverTuning.boostFactor : mode === 'less' ? discoverTuning.lessFactor : mode === 'mute' ? 0 : 1;

interface ProfileTag {
  tagId: number;
  name: string;
  /** Weight after the user's tag preferences; 0 for a muted tag. */
  weight: number;
  /** Weight from engagement alone, what the taste panel's bars show. */
  base: number;
  /** True for tags reached through co-occurrence rather than direct engagement. */
  related: boolean;
  mode: DiscoverTagMode | null;
}

function tagModes(): Map<string, DiscoverTagMode> {
  const rows = sqlite.query(`SELECT tag, mode FROM tag_preferences`).all() as { tag: string; mode: DiscoverTagMode }[];
  return new Map(rows.map((r) => [r.tag, r.mode]));
}

/**
 * Tag taste profile: every tag on media the user liked or engaged with, scored by engagement per
 * occurrence — "when this tag shows up, how much do you actually engage?" — so what's distinctive
 * outranks what's merely common. Co-occurring tags are folded in at a discount so adjacent
 * content can surface.
 *
 * Hidden items ("Not interested") count against their tags instead of for them, and the user's
 * tag preferences scale the result: boost doubles a tag, "less" halves it, mute zeroes it.
 *
 * Expensive: two aggregates over the whole media_tags table. Go through currentSnapshot() rather
 * than calling this directly, so the result is cached between requests.
 */
function buildProfile(): ProfileTag[] {
  const modes = tagModes();
  const withMode = (t: Omit<ProfileTag, 'weight' | 'mode'>): ProfileTag => {
    const mode = modes.get(t.name) ?? null;
    return { ...t, mode, weight: t.base * modeFactor(mode) };
  };
  const now = Date.now();
  const halfLife = discoverTuning.halfLifeDays * 86_400_000;
  // Each signal ages from its own timestamp: the like from when it was given, views, watch time
  // and dwell from the last time the item was opened. A like without a date predates liked_at
  // and counts as fresh rather than guessing its age.
  const decay = (col: string) => (halfLife > 0 ? `pow(0.5, MAX(${now} - COALESCE(${col}, ${now}), 0) / ${halfLife}.0)` : '1.0');
  // CROSS JOIN pins the plan to start from the few engaged media rows and reach their tags by
  // primary key. Left to itself SQLite walked every media_tags row in tag order and looked each
  // one's media up: 11s against 0.2s on a synthetic 30k-item library with 640k tag rows.
  const rows = sqlite
    .query(
      `SELECT mt.tag_id AS tagId, t.name AS name,
              (SELECT COUNT(*) FROM media_tags x WHERE x.tag_id = mt.tag_id) AS usage,
              SUM(CASE WHEN f.media_id IS NOT NULL THEN -${HIDE_PENALTY} * ${decay('f.at')}
                  ELSE m.liked * 5.0 * ${decay('m.liked_at')}
                     + (MIN(m.view_count, 8) * 0.6
                        + MIN(m.watched_seconds / 60.0, 10) * 0.5
                        + MIN(m.dwell_seconds / 20.0, 10) * 0.5) * ${decay('m.last_viewed_at')} END) AS engagement
       FROM media m
       CROSS JOIN media_tags mt ON mt.media_id = m.id
       JOIN tags t ON t.id = mt.tag_id
       LEFT JOIN media_feedback f ON f.media_id = m.id AND f.kind = 'hidden'
       -- On media columns only: a condition on f would hold back the filter until every tag row
       -- had been joined, which made the rebuild walk all of media_tags again.
       WHERE m.liked = 1 OR m.view_count > 0 OR m.watched_seconds > 0 OR m.dwell_seconds > 0
          OR m.id IN (SELECT media_id FROM media_feedback WHERE kind = 'hidden')
       GROUP BY mt.tag_id`,
    )
    .all() as { tagId: number; name: string; usage: number; engagement: number }[];

  const profile = rows
    .map((r) => withMode({ tagId: r.tagId, name: r.name, base: r.engagement / (r.usage + TAG_SMOOTHING), related: false }))
    .filter((t) => t.base > 0)
    .sort((a, b) => b.weight - a.weight || b.base - a.base)
    .slice(0, MAX_PROFILE_TAGS);
  // Muted tags stay in the list so the taste panel can show them, but seed nothing.
  const seeds = profile.filter((t) => t.weight > 0).slice(0, SEED_TAGS);
  if (!seeds.length) return profile;

  // Adjacent tags: what else shows up on media carrying the top tags. Keeps the feed from
  // collapsing into one tag repeated 60 times.
  const known = new Set(profile.map((t) => t.tagId));
  const coRows = sqlite
    .query(
      `SELECT b.tag_id AS tagId, t.name AS name, COUNT(*) AS co,
              (SELECT COUNT(*) FROM media_tags x WHERE x.tag_id = b.tag_id) AS usage
       FROM media_tags a
       JOIN media_tags b ON b.media_id = a.media_id AND b.tag_id <> a.tag_id
       JOIN tags t ON t.id = b.tag_id
       WHERE a.tag_id IN (${seeds.map(() => '?').join(',')})
       GROUP BY b.tag_id
       HAVING co >= ${MIN_CO_OCCURRENCE}`,
    )
    .all(...seeds.map((s) => s.tagId)) as { tagId: number; name: string; co: number; usage: number }[];

  // Affinity, not raw co-count: what fraction of this tag's uses sit next to a tag you like.
  // Counting raw co-occurrence instead just resurfaces whatever is most common library-wide,
  // which is never what makes a neighbour worth following.
  //
  // Anchored to the weakest seed rather than the strongest, so a tag that always travels with
  // your taste competes with your mid-tier matches instead of outranking your favourites.
  const anchorWeight = seeds[seeds.length - 1].weight;
  const neighbours = coRows
    .filter((row) => !known.has(row.tagId))
    .map((row) =>
      withMode({
        tagId: row.tagId,
        name: row.name,
        base: (row.co / Math.max(row.usage, 1)) * anchorWeight * ADJACENT_SHARE,
        related: true,
      }),
    )
    .sort((a, b) => b.weight - a.weight || b.base - a.base)
    .slice(0, MAX_PROFILE_TAGS);
  profile.push(...neighbours);
  return profile;
}

/**
 * The profile is identical for every request until engagement or tags change, but infinite
 * scroll asked for it once per 60 items and rebuilt it from the full media_tags table each time.
 *
 * Two guards, because they fail in different directions: the version counter catches writes that
 * went through the API and makes them visible immediately, and the TTL catches everything else —
 * a scan, a tag job, a direct database edit — so a stale profile can never outlive a minute.
 *
 * Each build gets a snapshot id, and a page cursor carries the id of the snapshot that ordered
 * it. Without that, the next page was ranked by whatever profile was current: a like, or a video
 * playing in the viewer (progress writes bump the version every few seconds), or the TTL expiring
 * mid-scroll re-scored the feed, and the cursor pointed into a different ordering — items
 * repeated or were skipped. Recent snapshots are kept so an in-flight scroll finishes on the
 * ordering it started with; a fresh first page always gets the current one.
 */
const PROFILE_TTL_MS = 60_000;
const KEPT_SNAPSHOTS = 8;

interface ProfileSnapshot {
  id: number;
  profile: ProfileTag[];
  /** Best raw score any item reaches under this profile; normalises taste into 0..1. */
  maxScore: number;
  /** Rows in discover_blocked; with none, pages skip that join. */
  blocked: number;
  builtAt: number;
  version: number;
}

const snapshots = new Map<number, ProfileSnapshot>();
let latest: ProfileSnapshot | null = null;
let nextSnapshotId = 1;

/**
 * Per-item taste scores, one set of rows per live snapshot. Scoring is an aggregate over every
 * media_tags row carrying a profile tag — ~100ms on a 34k-item library — and it used to run on
 * every page. It depends only on the snapshot, so it's computed once when the snapshot is built
 * and pages join against it.
 *
 * TEMP: connection-local and gone on restart, which is what a cache wants; the snapshot ids it's
 * keyed by don't survive a restart either.
 */
sqlite.exec(`CREATE TEMP TABLE IF NOT EXISTS discover_scores (
  snapshot INTEGER NOT NULL,
  media_id INTEGER NOT NULL,
  raw REAL NOT NULL,
  best REAL NOT NULL,
  reason TEXT,
  related INTEGER,
  PRIMARY KEY (snapshot, media_id)
)`);
/** Media no Discover list may show under a snapshot: hidden items and everything carrying a muted tag. */
sqlite.exec(`CREATE TEMP TABLE IF NOT EXISTS discover_blocked (
  snapshot INTEGER NOT NULL,
  media_id INTEGER NOT NULL,
  PRIMARY KEY (snapshot, media_id)
)`);

function buildSnapshot(): ProfileSnapshot {
  const profile = buildProfile();
  const id = nextSnapshotId++;
  const scoring = profile.filter((t) => t.weight > 0);
  // The placeholder keeps one SQL path when nothing has been liked or viewed yet: no item scores,
  // so the feed is pure random, which is the right cold start anyway.
  const rows = scoring.length ? scoring : [{ tagId: -1, name: '', weight: 0, related: false }];
  // Ranked per item so only its topK strongest tags count; the strongest one is the tag the card
  // credits, ties going to the lower tag id so the credit can't flip between rebuilds.
  const topK = discoverTuning.topK > 0 ? discoverTuning.topK : 1_000_000;
  sqlite
    .query(
      `WITH profile(tag_id, weight, name, related) AS (VALUES ${rows.map(() => '(?, ?, ?, ?)').join(', ')}),
       ranked AS (
         SELECT mt.media_id, p.weight,
                ROW_NUMBER() OVER w AS rn,
                FIRST_VALUE(p.name) OVER w AS reason,
                FIRST_VALUE(p.related) OVER w AS related
         FROM media_tags mt JOIN profile p ON p.tag_id = mt.tag_id
         WINDOW w AS (PARTITION BY mt.media_id ORDER BY p.weight DESC, p.tag_id)
       )
       INSERT INTO discover_scores (snapshot, media_id, raw, best, reason, related)
       SELECT ?, media_id, SUM(weight), MAX(weight), reason, related
       FROM ranked WHERE rn <= ?
       GROUP BY media_id`,
    )
    .run(...rows.flatMap((t) => [t.tagId, t.weight, t.name, t.related ? 1 : 0]), id, topK);
  // Scale scores by the best-matching item so the taste half of the mix is comparable to the
  // random half (which is already 0..1).
  const best = (
    sqlite.query(`SELECT MAX(raw) AS best FROM discover_scores WHERE snapshot = ?`).get(id) as { best: number | null }
  ).best;
  const { changes: blocked } = sqlite
    .query(
      `INSERT OR IGNORE INTO discover_blocked (snapshot, media_id)
       SELECT ?, media_id FROM media_feedback WHERE kind = 'hidden'
       UNION
       SELECT ?, mt.media_id FROM tag_preferences p
       JOIN tags t ON t.name = p.tag
       JOIN media_tags mt ON mt.tag_id = t.id
       WHERE p.mode = 'mute'`,
    )
    .run(id, id);
  return { id, profile, maxScore: best || 1, blocked, builtAt: Date.now(), version: tasteVersion() };
}

function currentSnapshot(): ProfileSnapshot {
  if (latest && latest.version === tasteVersion() && Date.now() - latest.builtAt < PROFILE_TTL_MS) return latest;
  latest = buildSnapshot();
  snapshots.set(latest.id, latest);
  // Map iteration is insertion order, so the first key is always the oldest snapshot.
  while (snapshots.size > KEPT_SNAPSHOTS) {
    const oldest = snapshots.keys().next().value!;
    snapshots.delete(oldest);
    sqlite.query(`DELETE FROM discover_scores WHERE snapshot = ?`).run(oldest);
    sqlite.query(`DELETE FROM discover_blocked WHERE snapshot = ?`).run(oldest);
  }
  return latest;
}

/**
 * The feed a scroll walks is the ranked order passed through the variety re-rank
 * (lib/diversify.ts), which defers items to later slots. A keyset cursor can't describe "past
 * this key, except these deferred items", so the diversified order is built as one stream per
 * snapshot and query, served in slices, and the cursor is just an offset into it. The stream is
 * a pure function of the snapshot and the query, so it's memoised here and rebuilt on a miss.
 *
 * It's built lazily: ranking a chunk past the stream's tail costs one ranked query, the same as a
 * page cost before, and most pages are served from candidates an earlier page already fetched.
 */
interface FeedStream {
  snapshot: number;
  diversifier: Diversifier;
  /** Sort key and id of the last ranked row fetched; the next chunk starts below it. */
  after: { key: number; id: number } | null;
  exhausted: boolean;
  served: number[];
  reasons: Map<number, { tag: string | null; related: number | null }>;
}

const KEPT_STREAMS = 16;
const streams = new Map<string, FeedStream>();

/** Drops every cached snapshot and stream, so the next request rebuilds under the current tuning. */
export function resetDiscoverCache(): void {
  snapshots.clear();
  streams.clear();
  latest = null;
  sqlite.exec(`DELETE FROM discover_scores; DELETE FROM discover_blocked;`);
}

function newStream(snapshot: number): FeedStream {
  const { window, folderCap, reasonCap, dupDistance, dupWindow, lookahead } = discoverTuning;
  return {
    snapshot,
    diversifier: new Diversifier({ window, folderCap, reasonCap, dupDistance, dupWindow, lookahead }),
    after: null,
    exhausted: false,
    served: [],
    reasons: new Map(),
  };
}

const invalidCursor = () => Object.assign(new Error('Invalid cursor'), { status: 400 });
const notFound = (what: string) => Object.assign(new Error(`${what} not found`), { status: 404 });

/**
 * The feed's sort key and the joins it needs, under one snapshot. One deterministic key blends
 * taste score with a seeded per-item random value, so the surprise setting is just a mix ratio
 * and the ranked order is reproducible chunk after chunk. Shelves rank with the same key, so a
 * shelf row and its "See all" page agree.
 */
function ranking(snap: ProfileSnapshot, surprise: number, seed: number) {
  // "Seen" is judged as of the snapshot too. Read live, opening a feed item in the viewer sank
  // it below the stream's tail and the same scroll served it a second time. Items viewed since
  // only ever score higher under this rule, and those were opened from pages already served.
  const seen = `(m.last_viewed_at <= ${snap.builtAt} OR (m.last_viewed_at IS NULL AND m.view_count > 0))`;
  const taste = `MIN(COALESCE(s.raw, 0) / ${snap.maxScore}, 1.0) * (CASE WHEN ${seen} THEN ${SEEN_FACTOR} ELSE 1.0 END)`;
  const random = `((((m.id + ${seed % 2147483647}) * 2654435761) % 2147483647) / 2147483647.0)`;
  return {
    key: `(${1 - surprise} * ${taste} + ${surprise} * ${random})`,
    joins: `LEFT JOIN discover_scores s ON s.snapshot = ${snap.id} AND s.media_id = m.id
            ${snap.blocked ? `LEFT JOIN discover_blocked b ON b.snapshot = ${snap.id} AND b.media_id = m.id` : ''}`,
    unblocked: snap.blocked ? 'b.media_id IS NULL' : '1',
  };
}

/** Full media rows for `ids`, in that order, with the credited reason tag on each. */
function mediaInOrder(ids: number[], reasons: Map<number, { tag: string | null; related: number | null }>): Media[] {
  const rows = ids.length
    ? (sqlite
        .query(
          `SELECT m.*, l.name AS library_name,
                  (SELECT COUNT(*) FROM media_tags mt WHERE mt.media_id = m.id) AS tag_count
           FROM media m
           LEFT JOIN libraries l ON l.id = m.library_id
           WHERE m.id IN (${ids.map(() => '?').join(',')})`,
        )
        .all(...ids) as MediaSqlRow[])
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const reason = reasons.get(id);
    return [rowToMedia({ ...row, reason_tag: reason?.tag ?? null, reason_related: reason?.related ?? null })];
  });
}

interface RankedRow {
  id: number;
  sort_key: number;
  path: string;
  hash: string | null;
  reason: string | null;
  related: number | null;
}

export function discoverFeed(input: z.input<typeof discoverQuerySchema>): MediaListResponse {
  const query = discoverQuerySchema.parse(input);

  let cursor: { offset: number; snapshot: number } | null = null;
  if (query.cursor) {
    const [offset, snapshot] = decodeCursor(query.cursor);
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || typeof snapshot !== 'number') {
      throw invalidCursor();
    }
    cursor = { offset, snapshot };
  }
  let shelf: ShelfDef | null = null;
  if (query.shelf) {
    shelf = shelfById(query.shelf);
    if (!shelf) throw notFound('Shelf');
  }
  // A cursor whose snapshot has aged out falls back to the current one: the rest of that scroll
  // may repeat or miss a few items, which is the old behaviour, but only after 8 rebuilds.
  const snap = (cursor && snapshots.get(cursor.snapshot)) || currentSnapshot();
  const rank = ranking(snap, query.surprise, query.seed);

  const conds: string[] = [rank.unblocked];
  const params: SQLQueryBindings[] = [];
  if (query.type) {
    conds.push('m.type = ?');
    params.push(query.type);
  }
  if (shelf) {
    conds.push(`(${shelf.where})`);
    params.push(...shelf.params);
  }

  const streamKey = `${snap.id}|${query.type ?? ''}|${query.surprise}|${query.seed % 2147483647}|${query.shelf ?? ''}`;
  // A first page always starts a new stream, so media added since (a scan, an upload) shows up
  // the way it did when every page re-ranked live; only a scroll in progress reuses one.
  const stream = (cursor && streams.get(streamKey)) || newStream(snap.id);
  streams.delete(streamKey);
  // Re-inserted on every use, so the first key is always the least recently used.
  streams.set(streamKey, stream);
  while (streams.size > KEPT_STREAMS) streams.delete(streams.keys().next().value!);
  for (const [key, s] of streams) if (!snapshots.has(s.snapshot)) streams.delete(key);

  const boosted = new Set(snap.profile.filter((t) => t.mode === 'boost').map((t) => t.name));
  // Enough to fill a page and leave a full lookahead behind it, so the next page usually needs
  // no ranked query of its own.
  const chunk = discoverTuning.lookahead + query.limit + 1;
  const fetchChunk = (st: FeedStream) => {
    const chunkConds = [...conds];
    const chunkParams = [...params];
    if (st.after) {
      chunkConds.push(`(${rank.key}, m.id) < (?, ?)`);
      chunkParams.push(st.after.key, st.after.id);
    }
    // Ranked on narrow rows; full rows are fetched for the served page only. Every row is ranked,
    // so a plain table scan is the right plan. Left to itself, SQLite walked a phash band index
    // instead and fetched each row out of rowid order: 63ms against 22ms on a 34k-item library.
    const rows = sqlite
      .query(
        `SELECT m.id AS id, ${rank.key} AS sort_key, m.path AS path, m.perceptual_hash AS hash,
                CASE WHEN COALESCE(s.raw, 0) > 0 THEN s.reason END AS reason,
                CASE WHEN COALESCE(s.raw, 0) > 0 THEN s.related END AS related
         FROM media m NOT INDEXED
         ${rank.joins}
         WHERE ${chunkConds.join(' AND ')}
         ORDER BY sort_key DESC, m.id DESC
         LIMIT ?`,
      )
      .all(...chunkParams, chunk) as RankedRow[];
    if (rows.length < chunk) st.exhausted = true;
    if (rows.length) st.after = { key: rows[rows.length - 1].sort_key, id: rows[rows.length - 1].id };
    const fresh = rows.filter((r) => !st.reasons.has(r.id));
    for (const r of fresh) st.reasons.set(r.id, { tag: r.reason, related: r.related });
    st.diversifier.push(
      fresh.map((r) => ({
        id: r.id,
        folder: folderOf(r.path),
        reason: r.reason,
        hash: r.hash,
        ...(r.reason !== null && boosted.has(r.reason) ? { reasonCap: discoverTuning.boostedReasonCap } : {}),
      })),
    );
  };

  const offset = cursor?.offset ?? 0;
  // One past the page, so the last page knows it's the last and doesn't hand out a cursor to an
  // empty one.
  const want = offset + query.limit + 1;
  while (stream.served.length < want) {
    if (!stream.exhausted && stream.diversifier.pending < discoverTuning.lookahead) fetchChunk(stream);
    const next = stream.diversifier.next();
    if (!next) break;
    stream.served.push(next.id);
  }

  const items = mediaInOrder(stream.served.slice(offset, offset + query.limit), stream.reasons);
  // Only the first page pays for the count; the client keeps the total from page one, the same
  // as /api/media.
  // Joins only when a condition needs them: the plain count is an index-only scan.
  const total = cursor
    ? null
    : (
        sqlite
          .query(
            `SELECT COUNT(*) AS c FROM media m ${shelf || snap.blocked ? rank.joins : ''} WHERE ${conds.join(' AND ')}`,
          )
          .get(...params) as { c: number }
      ).c;
  const nextCursor = stream.served.length > offset + query.limit ? encodeCursor([offset + query.limit, snap.id]) : null;
  return { items, nextCursor, total };
}

discoverRouter.get(
  '/api/discover',
  wrap(async (req, res) => {
    res.json(discoverFeed(req.query as z.input<typeof discoverQuerySchema>));
  }),
);

/** Taste tags strong enough to name a "because you like" shelf: your own, unmuted, not ratings. */
function topTasteTags(snap: ProfileSnapshot): string[] {
  const ratings = new Set(
    (sqlite.query(`SELECT name FROM tags WHERE category = 'rating'`).all() as { name: string }[]).map((r) => r.name),
  );
  return snap.profile
    .filter((t) => !t.related && t.weight > 0 && !ratings.has(t.name))
    .sort((a, b) => b.weight - a.weight)
    .map((t) => t.name);
}

const SHELF_SIZE = 12;
/** A shelf with fewer than this many items is left off rather than shown half empty. */
const MIN_SHELF = 3;
/** Ranked candidates per shelf; the variety pass picks its row from these. */
const SHELF_CANDIDATES = 60;

const shelvesQuerySchema = z.object({
  type: z.enum(MEDIA_TYPES).optional(),
  surprise: z.coerce.number().min(0).max(1).default(0.3),
  seed: z.coerce.number().int().default(1),
  /** Set by the page on open, so "new since your last visit" knows when that was. */
  visit: z.enum(['0', '1']).optional(),
});

export function discoverShelves(input: z.input<typeof shelvesQuerySchema>): DiscoverShelvesResponse {
  const query = shelvesQuerySchema.parse(input);
  const snap = currentSnapshot();
  const rank = ranking(snap, query.surprise, query.seed);
  // Each item fills one slot on the page: a picture under "because you like rain" isn't repeated
  // under "new since your last visit".
  const used = new Set<number>();
  const shelves = [];
  for (const def of shelfDefs(topTasteTags(snap))) {
    const conds = [rank.unblocked, `(${def.where})`];
    const params = [...def.params];
    if (query.type) {
      conds.push('m.type = ?');
      params.push(query.type);
    }
    const rows = sqlite
      .query(
        `SELECT m.id AS id, ${rank.key} AS sort_key, m.path AS path, m.perceptual_hash AS hash,
                CASE WHEN COALESCE(s.raw, 0) > 0 THEN s.reason END AS reason,
                CASE WHEN COALESCE(s.raw, 0) > 0 THEN s.related END AS related
         FROM media m
         ${rank.joins}
         WHERE ${conds.join(' AND ')}
         ORDER BY sort_key DESC, m.id DESC
         LIMIT ?`,
      )
      .all(...params, SHELF_CANDIDATES + used.size) as RankedRow[];
    const fresh = rows.filter((r) => !used.has(r.id));
    const order = diversify(
      fresh.map((r) => ({ id: r.id, folder: folderOf(r.path), reason: r.reason, hash: r.hash })),
      {
        window: SHELF_SIZE,
        folderCap: 3,
        reasonCap: 0,
        dupDistance: discoverTuning.dupDistance,
        dupWindow: SHELF_SIZE,
        lookahead: SHELF_CANDIDATES,
      },
    ).slice(0, SHELF_SIZE);
    if (order.length < MIN_SHELF) continue;
    for (const id of order) used.add(id);
    const reasons = new Map(fresh.map((r) => [r.id, { tag: r.reason, related: r.related }]));
    shelves.push({
      id: def.id,
      title: def.title,
      subtitle: def.subtitle,
      ...(def.tag ? { tag: def.tag } : {}),
      items: mediaInOrder(order, reasons),
    });
  }
  // After building, so the first open of a new visit still compares against the previous one.
  if (query.visit === '1') recordVisit();
  return { shelves };
}

discoverRouter.get(
  '/api/discover/shelves',
  wrap(async (req, res) => {
    res.json(discoverShelves(req.query as z.input<typeof shelvesQuerySchema>));
  }),
);

/** How many taste tags the panel lists, of your own and of their neighbours. */
const PANEL_TAGS = 14;
const PANEL_RELATED = 6;

discoverRouter.get(
  '/api/discover/profile',
  wrap(async (_req, res) => {
    const snap = currentSnapshot();
    // By engagement alone, so a chip stays where it is while it's clicked through boost and mute.
    const byBase = (a: ProfileTag, b: ProfileTag) => b.base - a.base || a.tagId - b.tagId;
    const direct = snap.profile.filter((t) => !t.related).sort(byBase);
    const related = snap.profile.filter((t) => t.related).sort(byBase);
    const top = Math.max(...direct.map((t) => t.base), 0) || 1;
    const shown = [...direct.slice(0, PANEL_TAGS), ...related.slice(0, PANEL_RELATED)];
    // A tag the user set a preference on stays listed even once it falls out of the top, so the
    // preference can always be taken back.
    const listed = new Set(shown.map((t) => t.name));
    const byName = new Map(snap.profile.map((t) => [t.name, t]));
    const extra = [...tagModes().keys()].filter((name) => !listed.has(name));
    const names = [...shown.map((t) => t.name), ...extra];
    const info = new Map(
      names.length
        ? (
            sqlite
              .query(
                `SELECT name, category, display_name AS displayName FROM tags WHERE name IN (${names.map(() => '?').join(',')})`,
              )
              .all(...names) as { name: string; category: TagCategory; displayName: string | null }[]
          ).map((r) => [r.name, r])
        : [],
    );
    const modes = tagModes();
    const body: DiscoverProfileResponse = {
      tags: names.map((name) => {
        const t = byName.get(name);
        return {
          name,
          category: info.get(name)?.category ?? 'general',
          displayName: info.get(name)?.displayName ?? null,
          weight: t ? Math.min(t.base / top, 1) : 0,
          related: t?.related ?? false,
          mode: modes.get(name) ?? null,
        };
      }),
      activeTags: direct.filter((t) => t.weight > 0).length,
      hiddenCount: (sqlite.query(`SELECT COUNT(*) AS c FROM media_feedback WHERE kind = 'hidden'`).get() as { c: number })
        .c,
    };
    res.json(body);
  }),
);

discoverRouter.put(
  '/api/discover/tags/:name',
  wrap(async (req, res) => {
    const { mode } = z.object({ mode: z.enum(DISCOVER_TAG_MODES).nullable() }).parse(req.body);
    const name = String(req.params.name);
    if (mode) {
      sqlite
        .query(
          `INSERT INTO tag_preferences (tag, mode, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(tag) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`,
        )
        .run(name, mode, Date.now());
    } else {
      sqlite.query(`DELETE FROM tag_preferences WHERE tag = ?`).run(name);
    }
    bumpTasteVersion();
    res.json({ name, mode });
  }),
);

const feedbackBody = z.object({
  mediaId: z.number().int().positive(),
  hidden: z.boolean(),
});

discoverRouter.post(
  '/api/discover/feedback',
  wrap(async (req, res) => {
    const { mediaId, hidden } = feedbackBody.parse(req.body);
    if (!sqlite.query(`SELECT 1 FROM media WHERE id = ?`).get(mediaId)) throw notFound('Media');
    if (hidden) {
      sqlite
        .query(`INSERT OR REPLACE INTO media_feedback (media_id, kind, at) VALUES (?, 'hidden', ?)`)
        .run(mediaId, Date.now());
    } else {
      sqlite.query(`DELETE FROM media_feedback WHERE media_id = ? AND kind = 'hidden'`).run(mediaId);
    }
    bumpTasteVersion();
    res.json({ mediaId, hidden });
  }),
);

/** "Show hidden items again": forgets every Not interested at once. */
discoverRouter.delete(
  '/api/discover/feedback',
  wrap(async (_req, res) => {
    const { changes } = sqlite.query(`DELETE FROM media_feedback WHERE kind = 'hidden'`).run();
    bumpTasteVersion();
    res.json({ cleared: changes });
  }),
);

const MORE_LIKE_LIMIT = 60;

/**
 * Items sharing tags with `id`, each shared tag worth log(N / usage): a tag on three items says far
 * more about a picture than one on half the library. Rating tags are left out, since sharing
 * "general" says nothing about content. Hidden items and anything carrying a muted tag are left
 * out the same as in the feed.
 */
/**
 * Media sharing tags with `sourceId`, best `limit` by summed idf, hidden and muted items left out.
 *
 * Summing every shared tag's postings is the definition, but on a booru-tagged library a few
 * dozen tags ("solo", "simple background") sit on a large share of items, and an item carrying
 * many of them turned each call into a walk over 100k+ rows: 1-2 s on 30k items. So candidates
 * are ranked on the distinctive tags (on at most 1 in 10 items) and the leaders re-ranked with
 * every shared tag; discover-eval.ts measures how close that stays to the full sum. The full walk
 * still runs when too few items share a distinctive tag, e.g. a source tagged only "1girl".
 */
export function rankSharedTags(sourceId: number, tags: { tagId: number; idf: number }[], limit: number): number[] {
  const distinctive = discoverTuning.likeShortcut ? tags.filter((t) => t.idf >= Math.log(discoverTuning.likeDistinctive)) : [];
  const common = tags.filter((t) => !distinctive.includes(t));
  const list = (n: number) => Array.from({ length: n }, () => '?').join(',');
  const walk = (walked: typeof tags, take: number) =>
    sqlite
      .query(
        `WITH shared(tag_id, idf) AS (VALUES ${walked.map(() => '(?, ?)').join(', ')})
         SELECT o.media_id AS id, SUM(sh.idf) AS score
         FROM shared sh JOIN media_tags o ON o.tag_id = sh.tag_id
         WHERE o.media_id <> ?
           AND NOT EXISTS (SELECT 1 FROM media_feedback f WHERE f.media_id = o.media_id AND f.kind = 'hidden')
         GROUP BY o.media_id
         HAVING NOT EXISTS (
           SELECT 1 FROM tag_preferences p JOIN tags t ON t.name = p.tag JOIN media_tags x ON x.tag_id = t.id
           WHERE p.mode = 'mute' AND x.media_id = o.media_id
         )
         ORDER BY score DESC, o.media_id DESC
         LIMIT ?`,
      )
      .all(...walked.flatMap((t) => [t.tagId, t.idf]), sourceId, take) as { id: number; score: number }[];

  if (distinctive.length) {
    const leaders = walk(distinctive, limit * discoverTuning.likeRerank);
    if (leaders.length >= limit) {
      const extra = new Map<number, number>();
      if (common.length) {
        const idf = new Map(common.map((t) => [t.tagId, t.idf]));
        const rows = sqlite
          .query(
            `SELECT media_id AS id, tag_id AS tagId FROM media_tags
             WHERE media_id IN (${list(leaders.length)}) AND tag_id IN (${list(common.length)})`,
          )
          .all(...leaders.map((l) => l.id), ...common.map((t) => t.tagId)) as { id: number; tagId: number }[];
        for (const r of rows) extra.set(r.id, (extra.get(r.id) ?? 0) + idf.get(r.tagId)!);
      }
      return leaders
        .map((l) => ({ id: l.id, score: l.score + (extra.get(l.id) ?? 0) }))
        .sort((a, b) => b.score - a.score || b.id - a.id)
        .slice(0, limit)
        .map((l) => l.id);
    }
  }
  return walk(tags, limit).map((r) => r.id);
}

/**
 * The media whose image embeddings sit closest to `sourceId`'s, best `limit` first, hidden and
 * muted items left out; null when the source has no embedding or the feature is off.
 */
export function visualNeighbours(sourceId: number, limit: number): number[] | null {
  if (!semanticSearchEnabled() || discoverTuning.likeVisualWeight <= 0) return null;
  const vec = mediaEmbedding(sourceId);
  if (!vec) return null;
  const excluded = new Set(
    (
      sqlite
        .query(
          `SELECT media_id AS id FROM media_feedback WHERE kind = 'hidden'
           UNION SELECT x.media_id FROM tag_preferences p JOIN tags t ON t.name = p.tag
             JOIN media_tags x ON x.tag_id = t.id WHERE p.mode = 'mute'`,
        )
        .all() as { id: number }[]
    ).map((r) => r.id),
  );
  excluded.add(sourceId);
  const out: number[] = [];
  for (const r of rankByVector(vec)) {
    if (excluded.has(r.id)) continue;
    out.push(r.id);
    if (out.length >= limit) break;
  }
  return out;
}

/** Weighted reciprocal-rank fusion: no score scales to reconcile, only each list's order. */
export function fuseRankings(lists: { ids: number[]; weight: number }[], limit: number, k = discoverTuning.likeFuseK): number[] {
  const score = new Map<number, number>();
  for (const { ids, weight } of lists) {
    ids.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + weight / (k + rank + 1)));
  }
  return [...score]
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])
    .slice(0, limit)
    .map(([id]) => id);
}

export function moreLikeThis(id: number, limit = MORE_LIKE_LIMIT): DiscoverLikeResponse {
  const [source] = mediaInOrder([id], new Map());
  if (!source) throw notFound('Media');
  const total = (sqlite.query(`SELECT COUNT(*) AS c FROM media`).get() as { c: number }).c;
  const shared = sqlite
    .query(
      `SELECT mt.tag_id AS tagId, t.name AS name,
              ln(${total}.0 / MAX((SELECT COUNT(*) FROM media_tags x WHERE x.tag_id = mt.tag_id), 1)) AS idf
       FROM media_tags mt JOIN tags t ON t.id = mt.tag_id
       WHERE mt.media_id = ? AND t.category <> 'rating'`,
    )
    .all(id) as { tagId: number; name: string; idf: number }[];
  const weighted = shared.filter((t) => t.idf > 0);
  const visual = visualNeighbours(id, limit);
  if (!weighted.length && !visual?.length) return { source, items: [], ranking: 'tags' };

  const byTags = weighted.length ? rankSharedTags(id, weighted, limit) : [];
  const ids = visual?.length
    ? fuseRankings(
        [
          { ids: byTags, weight: 1 },
          { ids: visual, weight: discoverTuning.likeVisualWeight },
        ],
        limit,
      )
    : byTags;
  const rarest = [...weighted].sort((a, b) => b.idf - a.idf || a.tagId - b.tagId);
  const tagsOf = new Map<number, Set<number>>();
  if (ids.length && weighted.length) {
    const links = sqlite
      .query(
        `SELECT media_id AS mediaId, tag_id AS tagId FROM media_tags
         WHERE media_id IN (${ids.map(() => '?').join(',')}) AND tag_id IN (${weighted.map(() => '?').join(',')})`,
      )
      .all(...ids, ...weighted.map((t) => t.tagId)) as { mediaId: number; tagId: number }[];
    for (const l of links) tagsOf.set(l.mediaId, (tagsOf.get(l.mediaId) ?? new Set()).add(l.tagId));
  }
  const reasons = new Map(
    ids.map((mid) => [mid, { tag: rarest.find((t) => tagsOf.get(mid)?.has(t.tagId))?.name ?? null, related: null }]),
  );
  return { source, items: mediaInOrder(ids, reasons), ranking: visual?.length ? 'visual' : 'tags' };
}

discoverRouter.get(
  '/api/discover/like/:id',
  wrap(async (req, res) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(MORE_LIKE_LIMIT) }).parse(req.query);
    res.json(moreLikeThis(intParam(String(req.params.id)), limit));
  }),
);
