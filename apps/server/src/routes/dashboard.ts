import { Router } from 'express';
import { db, sqlite, schema } from '../db';
import { wrap } from '../lib/http';
import { libraryWithStats } from './libraries';
import { rowToMedia } from '../lib/rowToMedia';
import type { DashboardResponse } from '@sakuya/shared';

export const dashboardRouter = Router();

const MEDIA_SELECT = `
  SELECT m.*, l.name AS library_name,
         (SELECT COUNT(*) FROM media_tags mt WHERE mt.media_id = m.id) AS tag_count
  FROM media m LEFT JOIN libraries l ON l.id = m.library_id`;

dashboardRouter.get(
  '/api/dashboard',
  wrap(async (_req, res) => {
    const libs = db.select().from(schema.libraries).all();
    const continueWatching = (
      sqlite
        .query(`${MEDIA_SELECT} WHERE m.view_progress > 0.01 AND m.view_progress < 0.98 ORDER BY m.last_viewed_at DESC LIMIT 12`)
        .all() as any[]
    ).map(rowToMedia);
    const recentlyViewed = (
      sqlite
        .query(`${MEDIA_SELECT} WHERE m.last_viewed_at IS NOT NULL ORDER BY m.last_viewed_at DESC LIMIT 12`)
        .all() as any[]
    ).map(rowToMedia);
    const recentlyAdded = (
      sqlite.query(`${MEDIA_SELECT} ORDER BY m.created_at DESC, m.id DESC LIMIT 12`).all() as any[]
    ).map(rowToMedia);
    const likedCount = (sqlite.query('SELECT COUNT(*) AS c FROM media WHERE liked = 1').get() as { c: number }).c;
    const likedSample = sqlite
      .query('SELECT id FROM media WHERE liked = 1 ORDER BY liked_at DESC, id DESC LIMIT 1')
      .get() as { id: number } | null;
    const body: DashboardResponse = {
      libraries: libs.map(libraryWithStats),
      continueWatching,
      recentlyViewed,
      recentlyAdded,
      likedCount,
      likedSampleId: likedSample?.id ?? null,
    };
    res.json(body);
  }),
);
