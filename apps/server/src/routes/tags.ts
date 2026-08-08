import { Router } from 'express';
import { z } from 'zod';
import { sqlite } from '../db';
import { wrap } from '../lib/http';
import type { TagCount } from '@sakuya/shared';

export const tagsRouter = Router();

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
    const categoryPlaceholders = categories ? categories.map(() => '?').join(',') : '';
    // Ratings are a small, fixed set — return all of them rather than truncating to `limit`.
    const applyLimit = categories?.length !== 1 || categories[0] !== 'rating';

    let rows: TagCount[];
    if (libraryId !== undefined) {
      rows = sqlite
        .query(
          `SELECT t.name, t.category, COUNT(*) AS count
           FROM media_tags mt
           JOIN tags t ON t.id = mt.tag_id
           JOIN media m ON m.id = mt.media_id
           WHERE m.library_id = ? ${q ? 'AND t.name LIKE ?' : ''} ${categories ? `AND t.category IN (${categoryPlaceholders})` : ''}
           GROUP BY t.id ORDER BY count DESC, t.name ${applyLimit ? 'LIMIT ?' : ''}`,
        )
        .all(
          ...([
            libraryId,
            ...(q ? [`%${q}%`] : []),
            ...(categories ?? []),
            ...(applyLimit ? [limit] : []),
          ] as any[]),
        ) as TagCount[];
    } else {
      rows = sqlite
        .query(
          `SELECT name, category, usage_count AS count FROM tags
           WHERE usage_count > 0 ${q ? 'AND name LIKE ?' : ''} ${categories ? `AND category IN (${categoryPlaceholders})` : ''}
           ORDER BY usage_count DESC, name ${applyLimit ? 'LIMIT ?' : ''}`,
        )
        .all(
          ...([
            ...(q ? [`%${q}%`] : []),
            ...(categories ?? []),
            ...(applyLimit ? [limit] : []),
          ] as any[]),
        ) as TagCount[];
    }
    res.json(rows);
  }),
);
