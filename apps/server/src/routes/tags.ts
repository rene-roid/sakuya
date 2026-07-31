import { Router } from 'express';
import { z } from 'zod';
import { sqlite } from '../db';
import { wrap } from '../lib/http';
import type { TagCount } from '@sakuya/shared';

export const tagsRouter = Router();

const querySchema = z.object({
  q: z.string().optional(),
  libraryId: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

tagsRouter.get(
  '/api/tags',
  wrap(async (req, res) => {
    const { q, libraryId, limit } = querySchema.parse(req.query);
    let rows: TagCount[];
    if (libraryId !== undefined) {
      rows = sqlite
        .query(
          `SELECT t.name, t.category, COUNT(*) AS count
           FROM media_tags mt
           JOIN tags t ON t.id = mt.tag_id
           JOIN media m ON m.id = mt.media_id
           WHERE m.library_id = ? ${q ? 'AND t.name LIKE ?' : ''}
           GROUP BY t.id ORDER BY count DESC, t.name LIMIT ?`,
        )
        .all(...([libraryId, ...(q ? [`%${q}%`] : []), limit] as any[])) as TagCount[];
    } else {
      rows = sqlite
        .query(
          `SELECT name, category, usage_count AS count FROM tags
           WHERE usage_count > 0 ${q ? 'AND name LIKE ?' : ''}
           ORDER BY usage_count DESC, name LIMIT ?`,
        )
        .all(...((q ? [`%${q}%`, limit] : [limit]) as any[])) as TagCount[];
    }
    res.json(rows);
  }),
);
