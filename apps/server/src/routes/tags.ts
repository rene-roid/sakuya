import { Router } from 'express';
import { z } from 'zod';
import { sqlite } from '../db';
import { wrap } from '../lib/http';
import type { TagCount } from '@sakuya/shared';

export const tagsRouter = Router();

/**
 * LIKE pattern matching `q` as a literal substring. Unescaped, `_` is a single-character wildcard,
 * and it appears in most tag names: searching "long_h" also matched "longXh…".
 */
function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
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
    const params = [...(q ? [likeContains(q)] : []), ...(categories ?? []), ...(applyLimit ? [limit] : [])];

    // Library-scoped counts have to be aggregated; the unscoped ones are the cached usage_count,
    // which keeps autocomplete off a full media_tags aggregate.
    const rows = (
      libraryId !== undefined
        ? sqlite
            .query(
              `SELECT t.name, t.category, COUNT(*) AS count
               FROM media_tags mt
               JOIN tags t ON t.id = mt.tag_id
               JOIN media m ON m.id = mt.media_id
               WHERE m.library_id = ? ${filters}
               GROUP BY t.id ORDER BY count DESC, t.name ${applyLimit ? 'LIMIT ?' : ''}`,
            )
            .all(libraryId, ...params)
        : sqlite
            .query(
              `SELECT t.name, t.category, t.usage_count AS count FROM tags t
               WHERE t.usage_count > 0 ${filters}
               ORDER BY t.usage_count DESC, t.name ${applyLimit ? 'LIMIT ?' : ''}`,
            )
            .all(...params)
    ) as TagCount[];
    res.json(rows);
  }),
);
