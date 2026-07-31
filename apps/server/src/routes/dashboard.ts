import { Router } from 'express';
import { db, sqlite, schema } from '../db';
import { wrap } from '../lib/http';
import { libraryWithStats } from './libraries';
import type { DashboardResponse, Media } from '@sakuya/shared';

export const dashboardRouter = Router();

function rowToMedia(row: any): Media {
  return {
    id: row.id,
    libraryId: row.library_id,
    source: row.source,
    path: row.path,
    filename: row.filename,
    type: row.type,
    width: row.width,
    height: row.height,
    sizeBytes: row.size_bytes,
    durationSeconds: row.duration_seconds,
    createdAt: row.created_at,
    indexedAt: row.indexed_at,
    taggedAt: row.tagged_at,
    lastViewedAt: row.last_viewed_at,
    viewProgress: row.view_progress,
    tagCount: row.tag_count ?? 0,
    libraryName: row.library_name ?? undefined,
  };
}

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
    const recentlyAdded = (
      sqlite.query(`${MEDIA_SELECT} ORDER BY m.created_at DESC, m.id DESC LIMIT 12`).all() as any[]
    ).map(rowToMedia);
    const body: DashboardResponse = {
      libraries: libs.map(libraryWithStats),
      continueWatching,
      recentlyAdded,
    };
    res.json(body);
  }),
);
