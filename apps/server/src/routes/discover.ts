import { Router } from 'express';
import { z } from 'zod';
import { sqlite } from '../db';
import { wrap } from '../lib/http';
import { rowToMedia } from '../lib/rowToMedia';
import type { MediaListResponse } from '@sakuya/shared';

export const discoverRouter = Router();

const discoverQuerySchema = z.object({
  type: z.enum(['image', 'video']).optional(),
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
 * ponytail: recomputed per request off the full media_tags table — fine at library scale, cache
 * it (or persist per-tag weights on write) if a huge library makes /api/discover feel slow.
 */
function buildProfile(): ProfileTag[] {
  const rows = sqlite
    .query(
      `SELECT mt.tag_id AS tagId, t.name AS name,
              (SELECT COUNT(*) FROM media_tags x WHERE x.tag_id = mt.tag_id) AS usage,
              SUM(m.liked * 5.0
                  + MIN(m.view_count, 8) * 0.6
                  + MIN(m.watched_seconds / 60.0, 10) * 0.5
                  + MIN(m.dwell_seconds / 20.0, 10) * 0.5) AS engagement
       FROM media m
       JOIN media_tags mt ON mt.media_id = m.id
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

discoverRouter.get(
  '/api/discover',
  wrap(async (req, res) => {
    const query = discoverQuerySchema.parse(req.query);
    const profile = buildProfile();

    // A single-row placeholder keeps one SQL path when nothing has been liked or viewed yet:
    // every score is 0, so the feed is pure random — which is the right cold start anyway.
    const rows = profile.length ? profile : [{ tagId: -1, name: '', weight: 0, related: false }];
    const profileValues = rows.map(() => '(?, ?, ?, ?)').join(', ');
    const profileParams = rows.flatMap((t) => [t.tagId, t.weight, t.name, t.related ? 1 : 0]);
    const withProfile = `WITH profile(tag_id, weight, name, related) AS (VALUES ${profileValues})`;

    // Scale scores by the best-matching item so the taste half of the mix is comparable to the
    // random half (which is already 0..1).
    const maxScore =
      ((
        sqlite
          .query(
            `${withProfile}
             SELECT MAX(raw) AS best FROM (
               SELECT SUM(p.weight) AS raw FROM media_tags mt
               JOIN profile p ON p.tag_id = mt.tag_id GROUP BY mt.media_id
             )`,
          )
          .get(...profileParams) as { best: number | null }
      ).best ?? 0) || 1;

    const conds: string[] = [];
    const params: unknown[] = [];
    if (query.type) {
      conds.push('m.type = ?');
      params.push(query.type);
    }

    // One deterministic sort key blends taste score with a seeded per-item random value, so the
    // surprise slider is just a mix ratio and cursor pagination stays stable across pages.
    const seed = query.seed % 2147483647;
    const taste = `MIN(COALESCE(s.raw, 0) / ${maxScore}, 1.0) * (CASE WHEN m.view_count > 0 OR m.last_viewed_at IS NOT NULL THEN ${SEEN_FACTOR} ELSE 1.0 END)`;
    const random = `((((m.id + ${seed}) * 2654435761) % 2147483647) / 2147483647.0)`;
    const keyExpr = `(${1 - query.surprise} * ${taste} + ${query.surprise} * ${random})`;

    const countRow = sqlite
      .query(`SELECT COUNT(*) AS c FROM media m ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}`)
      .get(...(params as any[])) as { c: number };

    const pageConds = [...conds];
    const pageParams = [...params];
    if (query.cursor) {
      try {
        const [key, id] = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        pageConds.push(`(${keyExpr}, m.id) < (?, ?)`);
        pageParams.push(key, id);
      } catch {
        throw Object.assign(new Error('Invalid cursor'), { status: 400 });
      }
    }

    // MAX(p.weight) is what makes the bare p.name/p.related columns resolve to the winning row
    // (SQLite's documented min/max aggregate behaviour) — that name is the tag the card credits.
    const sql = `
      ${withProfile},
      scored AS (
        SELECT mt.media_id AS media_id, SUM(p.weight) AS raw, MAX(p.weight) AS best,
               p.name AS reason, p.related AS related
        FROM media_tags mt JOIN profile p ON p.tag_id = mt.tag_id
        GROUP BY mt.media_id
      )
      SELECT m.*, ${keyExpr} AS sort_key, l.name AS library_name,
             CASE WHEN COALESCE(s.raw, 0) > 0 THEN s.reason END AS reason_tag,
             CASE WHEN COALESCE(s.raw, 0) > 0 THEN s.related END AS reason_related,
             (SELECT COUNT(*) FROM media_tags mt WHERE mt.media_id = m.id) AS tag_count
      FROM media m
      LEFT JOIN libraries l ON l.id = m.library_id
      LEFT JOIN scored s ON s.media_id = m.id
      ${pageConds.length ? 'WHERE ' + pageConds.join(' AND ') : ''}
      ORDER BY sort_key DESC, m.id DESC
      LIMIT ?`;
    const items = sqlite.query(sql).all(...profileParams, ...(pageParams as any[]), query.limit) as any[];

    let nextCursor: string | null = null;
    if (items.length === query.limit) {
      const last = items[items.length - 1];
      nextCursor = Buffer.from(JSON.stringify([last.sort_key, last.id])).toString('base64url');
    }
    const body: MediaListResponse = { items: items.map(rowToMedia), nextCursor, total: countRow.c };
    res.json(body);
  }),
);
