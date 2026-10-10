import { Router } from 'express';
import { z } from 'zod';
import { sqlite } from '../db';
import { wrap } from '../lib/http';
import { tagLinksVersion } from '../services/tagger';
import type { TagCount } from '@sakuya/shared';

export const tagsRouter = Router();

/**
 * LIKE pattern matching `q` as a literal substring. Unescaped, `_` is a single-character wildcard,
 * and it appears in most tag names: searching "long_h" also matched "longXh…".
 */
function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
}

/**
 * Per-library tag counts, ordered as autocomplete shows them, keyed by the tag-links version they
 * were counted at. Counting every link in a library costs a few hundred ms on a 34k-item library
 * and only changes when a media gains or loses a tag, so each keystroke reuses it. Tag names and
 * categories are not cached; they are filtered live against the tags table.
 */
const countsByLibrary = new Map<number, { id: number; count: number }[]>();
let countedAtVersion = -1;

function countsForLibrary(libraryId: number): { id: number; count: number }[] {
  if (countedAtVersion !== tagLinksVersion()) {
    countsByLibrary.clear();
    countedAtVersion = tagLinksVersion();
  }
  let counts = countsByLibrary.get(libraryId);
  if (!counts) {
    counts = sqlite
      .query(
        // Counted before joining tags: carrying the tag row through the GROUP BY cost ~30% more.
        `WITH counts AS (
           SELECT mt.tag_id AS id, COUNT(*) AS count
           FROM media m JOIN media_tags mt ON mt.media_id = m.id
           WHERE m.library_id = ?
           GROUP BY mt.tag_id
         )
         SELECT counts.id, counts.count FROM counts JOIN tags t ON t.id = counts.id
         ORDER BY counts.count DESC, t.name`,
      )
      .all(libraryId) as { id: number; count: number }[];
    countsByLibrary.set(libraryId, counts);
  }
  return counts;
}

const querySchema = z.object({
  q: z.string().optional(),
  libraryId: z.coerce.number().int().optional(),
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

tagsRouter.get(
  '/api/tags',
  wrap(async (req, res) => {
    const { q, libraryId, category, limit } = querySchema.parse(req.query);
    const categories = category ? category.split(',') : undefined;
    // Ratings are a small, fixed set — return all of them rather than truncating to `limit`.
    const applyLimit = categories?.length !== 1 || categories[0] !== 'rating';
    const filters = `${q ? "AND t.name LIKE ? ESCAPE '\\'" : ''} ${categories ? `AND t.category IN (${categories.map(() => '?').join(',')})` : ''}`;
    const params = [...(q ? [likeContains(q)] : []), ...(categories ?? [])];

    let rows: TagCount[];
    if (libraryId !== undefined) {
      const tags = sqlite
        .query(`SELECT t.id, t.name, t.category FROM tags t WHERE 1 ${filters}`)
        .all(...params) as (Omit<TagCount, 'count'> & { id: number })[];
      const matching = new Map(tags.map((t) => [t.id, t]));
      rows = [];
      for (const { id, count } of countsForLibrary(libraryId)) {
        const tag = matching.get(id);
        if (!tag) continue;
        rows.push({ name: tag.name, category: tag.category, count });
        if (applyLimit && rows.length === limit) break;
      }
    } else {
      // Unscoped counts are the cached usage_count, which keeps autocomplete off a full media_tags
      // aggregate.
      rows = sqlite
        .query(
          `SELECT t.name, t.category, t.usage_count AS count FROM tags t
           WHERE t.usage_count > 0 ${filters}
           ORDER BY t.usage_count DESC, t.name ${applyLimit ? 'LIMIT ?' : ''}`,
        )
        .all(...params, ...(applyLimit ? [limit] : [])) as TagCount[];
    }
    res.json(rows);
  }),
);
