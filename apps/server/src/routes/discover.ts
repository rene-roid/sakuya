import { Router } from 'express';
import { z } from 'zod';
import { sqlite } from '../db';
import { wrap, encodeCursor, decodeCursor } from '../lib/http';
import type { SQLQueryBindings } from 'bun:sqlite';
import { rowToMedia, countMedia, type MediaSqlRow } from '../lib/rowToMedia';
import { tasteVersion } from '../lib/tasteVersion';
import { Diversifier, folderOf } from '../lib/diversify';
import { MEDIA_TYPES, type MediaListResponse } from '@sakuya/shared';

export const discoverRouter = Router();

const discoverQuerySchema = z.object({
  type: z.enum(MEDIA_TYPES).optional(),
  // 0 = pure taste match, 1 = pure random. "I'm feeling lucky" is 1 with limit=1.
  surprise: z.coerce.number().min(0).max(1).default(0.25),
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
};

interface ProfileTag {
  tagId: number;
  name: string;
  weight: number;
  /** True for tags reached through co-occurrence rather than direct engagement. */
  related: boolean;
}

/**
 * Tag taste profile: every tag on media the user liked or engaged with, scored by engagement per
 * occurrence — "when this tag shows up, how much do you actually engage?" — so what's distinctive
 * outranks what's merely common. Co-occurring tags are folded in at a discount so adjacent
 * content can surface.
 *
 * Expensive: two aggregates over the whole media_tags table. Go through currentSnapshot() rather
 * than calling this directly, so the result is cached between requests.
 */
function buildProfile(): ProfileTag[] {
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
              SUM(m.liked * 5.0 * ${decay('m.liked_at')}
                  + (MIN(m.view_count, 8) * 0.6
                     + MIN(m.watched_seconds / 60.0, 10) * 0.5
                     + MIN(m.dwell_seconds / 20.0, 10) * 0.5) * ${decay('m.last_viewed_at')}) AS engagement
       FROM media m
       CROSS JOIN media_tags mt ON mt.media_id = m.id
       JOIN tags t ON t.id = mt.tag_id
       WHERE m.liked = 1 OR m.view_count > 0 OR m.watched_seconds > 0 OR m.dwell_seconds > 0
       GROUP BY mt.tag_id`,
    )
    .all() as { tagId: number; name: string; usage: number; engagement: number }[];

  const profile = rows
    .map((r) => ({ tagId: r.tagId, name: r.name, weight: r.engagement / (r.usage + TAG_SMOOTHING), related: false }))
    .filter((t) => t.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_PROFILE_TAGS);
  if (!profile.length) return profile;

  // Adjacent tags: what else shows up on media carrying the top tags. Keeps the feed from
  // collapsing into one tag repeated 60 times.
  const seeds = profile.slice(0, SEED_TAGS);
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
    .map((row) => ({
      tagId: row.tagId,
      name: row.name,
      weight: (row.co / Math.max(row.usage, 1)) * anchorWeight * ADJACENT_SHARE,
      related: true,
    }))
    .sort((a, b) => b.weight - a.weight)
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
  /** Best raw score any item reaches under this profile; normalises taste into 0..1. */
  maxScore: number;
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

function buildSnapshot(): ProfileSnapshot {
  const profile = buildProfile();
  const id = nextSnapshotId++;
  // The placeholder keeps one SQL path when nothing has been liked or viewed yet: no item scores,
  // so the feed is pure random, which is the right cold start anyway.
  const rows = profile.length ? profile : [{ tagId: -1, name: '', weight: 0, related: false }];
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
  return { id, maxScore: best || 1, builtAt: Date.now(), version: tasteVersion() };
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

const KEPT_STREAMS = 32;
const streams = new Map<string, FeedStream>();

/** Drops every cached snapshot and stream, so the next request rebuilds under the current tuning. */
export function resetDiscoverCache(): void {
  snapshots.clear();
  streams.clear();
  latest = null;
  sqlite.exec(`DELETE FROM discover_scores`);
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
  // A cursor whose snapshot has aged out falls back to the current one: the rest of that scroll
  // may repeat or miss a few items, which is the old behaviour, but only after 8 rebuilds.
  const snap = (cursor && snapshots.get(cursor.snapshot)) || currentSnapshot();
  const { maxScore } = snap;

  const conds: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (query.type) {
    conds.push('m.type = ?');
    params.push(query.type);
  }

  // One deterministic sort key blends taste score with a seeded per-item random value, so the
  // surprise slider is just a mix ratio and the ranked order is reproducible chunk after chunk.
  const seed = query.seed % 2147483647;
  // "Seen" is judged as of the snapshot too. Read live, opening a feed item in the viewer sank
  // it below the stream's tail and the same scroll served it a second time. Items viewed since
  // only ever score higher under this rule, and those were opened from pages already served.
  const seen = `(m.last_viewed_at <= ${snap.builtAt} OR (m.last_viewed_at IS NULL AND m.view_count > 0))`;
  const taste = `MIN(COALESCE(s.raw, 0) / ${maxScore}, 1.0) * (CASE WHEN ${seen} THEN ${SEEN_FACTOR} ELSE 1.0 END)`;
  const random = `((((m.id + ${seed}) * 2654435761) % 2147483647) / 2147483647.0)`;
  const keyExpr = `(${1 - query.surprise} * ${taste} + ${query.surprise} * ${random})`;

  const streamKey = `${snap.id}|${query.type ?? ''}|${query.surprise}|${seed}`;
  // A first page always starts a new stream, so media added since (a scan, an upload) shows up
  // the way it did when every page re-ranked live; only a scroll in progress reuses one.
  const stream = (cursor && streams.get(streamKey)) || newStream(snap.id);
  streams.delete(streamKey);
  // Re-inserted on every use, so the first key is always the least recently used.
  streams.set(streamKey, stream);
  while (streams.size > KEPT_STREAMS) streams.delete(streams.keys().next().value!);
  for (const [key, s] of streams) if (!snapshots.has(s.snapshot)) streams.delete(key);

  // Enough to fill a page and leave a full lookahead behind it, so the next page usually needs
  // no ranked query of its own.
  const chunk = discoverTuning.lookahead + query.limit + 1;
  const fetchChunk = (st: FeedStream) => {
    const chunkConds = [...conds];
    const chunkParams = [...params];
    if (st.after) {
      chunkConds.push(`(${keyExpr}, m.id) < (?, ?)`);
      chunkParams.push(st.after.key, st.after.id);
    }
    // Ranked on narrow rows; full rows are fetched for the served page only. Every row is ranked,
    // so a plain table scan is the right plan. Left to itself, SQLite walked a phash band index
    // instead and fetched each row out of rowid order: 63ms against 22ms on a 34k-item library.
    const rows = sqlite
      .query(
        `SELECT m.id AS id, ${keyExpr} AS sort_key, m.path AS path, m.perceptual_hash AS hash,
                CASE WHEN COALESCE(s.raw, 0) > 0 THEN s.reason END AS reason,
                CASE WHEN COALESCE(s.raw, 0) > 0 THEN s.related END AS related
         FROM media m NOT INDEXED
         LEFT JOIN discover_scores s ON s.snapshot = ${snap.id} AND s.media_id = m.id
         ${chunkConds.length ? 'WHERE ' + chunkConds.join(' AND ') : ''}
         ORDER BY sort_key DESC, m.id DESC
         LIMIT ?`,
      )
      .all(...chunkParams, chunk) as {
      id: number;
      sort_key: number;
      path: string;
      hash: string | null;
      reason: string | null;
      related: number | null;
    }[];
    if (rows.length < chunk) st.exhausted = true;
    if (rows.length) st.after = { key: rows[rows.length - 1].sort_key, id: rows[rows.length - 1].id };
    const fresh = rows.filter((r) => !st.reasons.has(r.id));
    for (const r of fresh) st.reasons.set(r.id, { tag: r.reason, related: r.related });
    st.diversifier.push(fresh.map((r) => ({ id: r.id, folder: folderOf(r.path), reason: r.reason, hash: r.hash })));
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

  const pageIds = stream.served.slice(offset, offset + query.limit);
  const rows = pageIds.length
    ? (sqlite
        .query(
          `SELECT m.*, l.name AS library_name,
                  (SELECT COUNT(*) FROM media_tags mt WHERE mt.media_id = m.id) AS tag_count
           FROM media m
           LEFT JOIN libraries l ON l.id = m.library_id
           WHERE m.id IN (${pageIds.map(() => '?').join(',')})`,
        )
        .all(...pageIds) as MediaSqlRow[])
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = pageIds.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const reason = stream.reasons.get(id);
    return [rowToMedia({ ...row, reason_tag: reason?.tag ?? null, reason_related: reason?.related ?? null })];
  });

  // Only the first page pays for the count; the client keeps the total from page one, the same
  // as /api/media.
  const total = cursor ? null : countMedia(conds, params);
  const nextCursor = stream.served.length > offset + query.limit ? encodeCursor([offset + query.limit, snap.id]) : null;
  return { items, nextCursor, total };
}

discoverRouter.get(
  '/api/discover',
  wrap(async (req, res) => {
    res.json(discoverFeed(req.query as z.input<typeof discoverQuerySchema>));
  }),
);
