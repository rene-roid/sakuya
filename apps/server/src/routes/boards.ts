import { Router } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, sqlite, schema } from '../db';
import { wrap, intParam } from '../lib/http';
import type { BoardWithStats } from '@sakuya/shared';

export const boardsRouter = Router();

function boardWithStats(row: typeof schema.boards.$inferSelect): BoardWithStats {
  const stats = sqlite
    .query(
      `SELECT COUNT(*) AS c,
              (SELECT media_id FROM board_media WHERE board_id = ? ORDER BY added_at DESC LIMIT 1) AS thumb
       FROM board_media WHERE board_id = ?`,
    )
    .get(row.id, row.id) as { c: number; thumb: number | null };
  return { id: row.id, name: row.name, createdAt: row.createdAt, itemCount: stats.c, thumbMediaId: stats.thumb };
}

boardsRouter.get(
  '/api/boards',
  wrap(async (_req, res) => {
    const rows = db.select().from(schema.boards).orderBy(schema.boards.createdAt).all();
    res.json(rows.map(boardWithStats));
  }),
);

boardsRouter.get(
  '/api/boards/:id',
  wrap(async (req, res) => {
    const row = db.select().from(schema.boards).where(eq(schema.boards.id, intParam(req.params.id))).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(boardWithStats(row));
  }),
);

const nameBody = z.object({ name: z.string().trim().min(1).max(120) });

boardsRouter.post(
  '/api/boards',
  wrap(async (req, res) => {
    const { name } = nameBody.parse(req.body);
    const row = db.insert(schema.boards).values({ name, createdAt: Date.now() }).returning().get();
    res.status(201).json(boardWithStats(row));
  }),
);

boardsRouter.patch(
  '/api/boards/:id',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const { name } = nameBody.parse(req.body);
    const row = db.update(schema.boards).set({ name }).where(eq(schema.boards.id, id)).returning().get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(boardWithStats(row));
  }),
);

boardsRouter.delete(
  '/api/boards/:id',
  wrap(async (req, res) => {
    // board_media rows cascade; the media files themselves are untouched.
    db.delete(schema.boards).where(eq(schema.boards.id, intParam(req.params.id))).run();
    res.json({ ok: true });
  }),
);

const mediaIdsBody = z.object({ mediaIds: z.array(z.number().int()).min(1) });

boardsRouter.post(
  '/api/boards/:id/media',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const board = db.select().from(schema.boards).where(eq(schema.boards.id, id)).get();
    if (!board) return res.status(404).json({ error: 'Not found' });
    const { mediaIds } = mediaIdsBody.parse(req.body);
    const now = Date.now();
    db.insert(schema.boardMedia)
      .values(mediaIds.map((mediaId) => ({ boardId: id, mediaId, addedAt: now })))
      .onConflictDoNothing()
      .run();
    res.json(boardWithStats(board));
  }),
);

boardsRouter.delete(
  '/api/boards/:id/media/:mediaId',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    db.delete(schema.boardMedia)
      .where(and(eq(schema.boardMedia.boardId, id), eq(schema.boardMedia.mediaId, intParam(req.params.mediaId))))
      .run();
    res.json({ ok: true });
  }),
);
