import { Router } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, sqlite, schema } from '../db';
import { wrap, intParam } from '../lib/http';
import { thumbPathFor, generateThumbnail } from '../services/thumbnailer';
import { enqueueTagJob, modelReady, upsertTag, refreshUsageCounts } from '../services/tagger';
import type { Media, MediaDetail, MediaListResponse } from '@sakuya/shared';

export const mediaRouter = Router();

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

const listQuerySchema = z.object({
  libraryId: z.coerce.number().int().optional(),
  type: z.enum(['image', 'video']).optional(),
  tags: z.string().optional(),
  q: z.string().optional(),
  sort: z.enum(['recent', 'name', 'random']).default('recent'),
  dir: z.enum(['asc', 'desc']).optional(),
  seed: z.coerce.number().int().default(1),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

mediaRouter.get(
  '/api/media',
  wrap(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const dir = query.dir ?? (query.sort === 'recent' ? 'desc' : 'asc');
    const tagNames = (query.tags ?? '')
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    const conds: string[] = [];
    const params: unknown[] = [];
    if (query.libraryId !== undefined) {
      conds.push('m.library_id = ?');
      params.push(query.libraryId);
    }
    if (query.type) {
      conds.push('m.type = ?');
      params.push(query.type);
    }
    if (query.q) {
      conds.push(
        `(m.filename LIKE ? OR m.id IN (SELECT mt.media_id FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE t.name LIKE ?))`,
      );
      params.push(`%${query.q}%`, `%${query.q}%`);
    }
    if (tagNames.length) {
      const placeholders = tagNames.map(() => '?').join(',');
      conds.push(
        `m.id IN (SELECT mt.media_id FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE t.name IN (${placeholders}) GROUP BY mt.media_id HAVING COUNT(DISTINCT t.id) = ?)`,
      );
      params.push(...tagNames, tagNames.length);
    }

    // Deterministic sort key per mode; random uses a seeded hash so pagination stays stable.
    const seed = query.seed % 2147483647;
    const keyExpr =
      query.sort === 'name'
        ? 'lower(m.filename)'
        : query.sort === 'random'
          ? `(((m.id + ${seed}) * 2654435761) % 2147483647)`
          : 'm.created_at';

    const countRow = sqlite
      .query(`SELECT COUNT(*) AS c FROM media m ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}`)
      .get(...(params as any[])) as { c: number };

    const pageConds = [...conds];
    const pageParams = [...params];
    if (query.cursor) {
      try {
        const [key, id] = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        pageConds.push(`(${keyExpr}, m.id) ${dir === 'asc' ? '>' : '<'} (?, ?)`);
        pageParams.push(key, id);
      } catch {
        throw Object.assign(new Error('Invalid cursor'), { status: 400 });
      }
    }

    const sql = `
      SELECT m.*, ${keyExpr} AS sort_key, l.name AS library_name,
             (SELECT COUNT(*) FROM media_tags mt WHERE mt.media_id = m.id) AS tag_count
      FROM media m
      LEFT JOIN libraries l ON l.id = m.library_id
      ${pageConds.length ? 'WHERE ' + pageConds.join(' AND ') : ''}
      ORDER BY ${keyExpr} ${dir === 'asc' ? 'ASC' : 'DESC'}, m.id ${dir === 'asc' ? 'ASC' : 'DESC'}
      LIMIT ?`;
    const rows = sqlite.query(sql).all(...(pageParams as any[]), query.limit) as any[];

    let nextCursor: string | null = null;
    if (rows.length === query.limit) {
      const last = rows[rows.length - 1];
      nextCursor = Buffer.from(JSON.stringify([last.sort_key, last.id])).toString('base64url');
    }
    const body: MediaListResponse = { items: rows.map(rowToMedia), nextCursor, total: countRow.c };
    res.json(body);
  }),
);

function getDetail(id: number): MediaDetail | null {
  const row = sqlite
    .query(
      `SELECT m.*, l.name AS library_name,
              (SELECT COUNT(*) FROM media_tags mt WHERE mt.media_id = m.id) AS tag_count
       FROM media m LEFT JOIN libraries l ON l.id = m.library_id WHERE m.id = ?`,
    )
    .get(id) as any;
  if (!row) return null;
  const tagRows = sqlite
    .query(
      `SELECT t.name, t.category, mt.confidence, mt.source
       FROM media_tags mt JOIN tags t ON t.id = mt.tag_id
       WHERE mt.media_id = ?
       ORDER BY CASE t.category WHEN 'rating' THEN 0 WHEN 'character' THEN 1 ELSE 2 END, mt.confidence DESC, t.name`,
    )
    .all(id) as any[];
  return { ...rowToMedia(row), tags: tagRows };
}

mediaRouter.get(
  '/api/media/:id',
  wrap(async (req, res) => {
    const detail = getDetail(intParam(req.params.id));
    if (!detail) return res.status(404).json({ error: 'Not found' });
    res.json(detail);
  }),
);

mediaRouter.get(
  '/api/media/:id/file',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row || !fs.existsSync(row.path)) return res.status(404).json({ error: 'Not found' });
    // res.sendFile handles Range requests, ETag and conditional GETs.
    res.sendFile(row.path, { acceptRanges: true, cacheControl: true, maxAge: '1h' });
  }),
);

mediaRouter.get(
  '/api/media/:id/thumbnail',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    const thumb = thumbPathFor(id);
    if (!fs.existsSync(thumb)) {
      if (!fs.existsSync(row.path)) return res.status(404).json({ error: 'Source missing' });
      await generateThumbnail(row.path, id, row.type, row.durationSeconds);
      db.update(schema.media).set({ thumbnailPath: thumb }).where(eq(schema.media.id, id)).run();
    }
    res.sendFile(thumb, { cacheControl: true, maxAge: '7d', immutable: false });
  }),
);

mediaRouter.post(
  '/api/media/:id/thumbnail/regenerate',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!fs.existsSync(row.path)) return res.status(404).json({ error: 'Source missing' });
    const thumb = await generateThumbnail(row.path, id, row.type, row.durationSeconds);
    db.update(schema.media).set({ thumbnailPath: thumb }).where(eq(schema.media.id, id)).run();
    res.json({ ok: true });
  }),
);

const tagsPatchSchema = z.object({
  add: z.array(z.string().min(1)).default([]),
  remove: z.array(z.string().min(1)).default([]),
});

mediaRouter.patch(
  '/api/media/:id/tags',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    const body = tagsPatchSchema.parse(req.body);
    const touched: number[] = [];
    for (const raw of body.add) {
      const name = raw.trim().toLowerCase().replace(/\s+/g, '_');
      if (!name) continue;
      const tagId = upsertTag(name, 'user');
      db.insert(schema.mediaTags)
        .values({ mediaId: id, tagId, confidence: null, source: 'user' })
        .onConflictDoNothing()
        .run();
      touched.push(tagId);
    }
    for (const raw of body.remove) {
      const name = raw.trim().toLowerCase();
      const tag = db.select().from(schema.tags).where(eq(schema.tags.name, name)).get();
      if (!tag) continue;
      db.delete(schema.mediaTags)
        .where(and(eq(schema.mediaTags.mediaId, id), eq(schema.mediaTags.tagId, tag.id)))
        .run();
      touched.push(tag.id);
    }
    refreshUsageCounts(touched);
    res.json(getDetail(id));
  }),
);

mediaRouter.post(
  '/api/media/:id/retag',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!modelReady()) return res.status(409).json({ error: 'Tagger model not downloaded' });
    const job = enqueueTagJob([id], `AI tag: ${row.filename}`, row.libraryId);
    res.json({ job });
  }),
);

const progressSchema = z.object({ progress: z.number().min(0).max(1) });

mediaRouter.patch(
  '/api/media/:id/progress',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const body = progressSchema.parse(req.body);
    db.update(schema.media)
      .set({ viewProgress: body.progress, lastViewedAt: Date.now() })
      .where(eq(schema.media.id, id))
      .run();
    res.json({ ok: true });
  }),
);
