import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, sqlite, schema } from '../db';
import { wrap, intParam } from '../lib/http';
import { thumbPathFor, generateThumbnail } from '../services/thumbnailer';
import { enqueueTagJob, modelReady, upsertTag, refreshUsageCounts } from '../services/tagger';
import { rowToMedia } from '../lib/rowToMedia';
import { thumbnailCacheEnabled } from '../lib/settings';
import { hammingDistance } from '../services/perceptualHash';
import type { DuplicatesResponse, MediaDetail, MediaListResponse, SimilarResponse } from '@sakuya/shared';

export const mediaRouter = Router();

const listQuerySchema = z.object({
  libraryId: z.coerce.number().int().optional(),
  type: z.enum(['image', 'video']).optional(),
  tags: z.string().optional(),
  liked: z.coerce.number().int().optional(),
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
    if (query.liked) {
      conds.push('m.liked = 1');
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

mediaRouter.get(
  '/api/media/duplicates',
  wrap(async (req, res) => {
    const hashRows = sqlite
      .query(
        `SELECT content_hash AS hash, COUNT(*) AS c FROM media
         WHERE content_hash IS NOT NULL
         GROUP BY content_hash HAVING COUNT(*) > 1`,
      )
      .all() as { hash: string; c: number }[];

    const groups: DuplicatesResponse['groups'] = [];
    let fileCount = 0;
    let wastedBytes = 0;
    for (const { hash } of hashRows) {
      const rows = sqlite
        .query(
          `SELECT m.*, l.name AS library_name,
                  (SELECT COUNT(*) FROM media_tags mt WHERE mt.media_id = m.id) AS tag_count
           FROM media m LEFT JOIN libraries l ON l.id = m.library_id
           WHERE m.content_hash = ?
           ORDER BY m.created_at ASC`,
        )
        .all(hash) as any[];
      const items = rows.map(rowToMedia);
      const groupWasted = items.slice(1).reduce((sum, m) => sum + m.sizeBytes, 0);
      groups.push({ contentHash: hash, items, wastedBytes: groupWasted });
      fileCount += items.length;
      wastedBytes += groupWasted;
    }
    groups.sort((a, b) => b.wastedBytes - a.wastedBytes);

    const body: DuplicatesResponse = { groups, groupCount: groups.length, fileCount, wastedBytes };
    res.json(body);
  }),
);

const deleteBatchSchema = z.object({ ids: z.array(z.number().int()).min(1) });

mediaRouter.post(
  '/api/media/delete-batch',
  wrap(async (req, res) => {
    const { ids } = deleteBatchSchema.parse(req.body);
    let deleted = 0;
    for (const id of ids) {
      const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
      if (!row) continue;
      db.delete(schema.mediaTags).where(eq(schema.mediaTags.mediaId, id)).run();
      db.delete(schema.media).where(eq(schema.media.id, id)).run();
      fs.unlink(row.path, () => {});
      fs.unlink(thumbPathFor(id), () => {});
      deleted++;
    }
    res.json({ ok: true, deleted });
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

const renameSchema = z.object({ filename: z.string().min(1) });

mediaRouter.patch(
  '/api/media/:id/rename',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    const { filename } = renameSchema.parse(req.body);
    const safeName = path.basename(filename.trim());
    if (!safeName || safeName === '.' || safeName === '..') {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    if (safeName === row.filename) return res.json(getDetail(id));
    const newPath = path.join(path.dirname(row.path), safeName);
    if (fs.existsSync(newPath)) return res.status(409).json({ error: 'A file with that name already exists' });
    if (!fs.existsSync(row.path)) return res.status(404).json({ error: 'Source file missing' });
    fs.renameSync(row.path, newPath);
    db.update(schema.media).set({ path: newPath, filename: safeName }).where(eq(schema.media.id, id)).run();
    res.json(getDetail(id));
  }),
);

mediaRouter.delete(
  '/api/media/:id',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    db.delete(schema.mediaTags).where(eq(schema.mediaTags.mediaId, id)).run();
    db.delete(schema.media).where(eq(schema.media.id, id)).run();
    fs.unlink(row.path, () => {});
    fs.unlink(thumbPathFor(id), () => {});
    res.json({ ok: true });
  }),
);

mediaRouter.post(
  '/api/media/:id/reveal',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row || !fs.existsSync(row.path)) return res.status(404).json({ error: 'Not found' });
    const proc =
      process.platform === 'win32'
        ? spawn('explorer.exe', [`/select,${row.path}`], { detached: true, stdio: 'ignore' })
        : process.platform === 'darwin'
          ? spawn('open', ['-R', row.path], { detached: true, stdio: 'ignore' })
          : spawn('xdg-open', [path.dirname(row.path)], { detached: true, stdio: 'ignore' });
    proc.on('error', () => {});
    proc.unref();
    res.json({ ok: true });
  }),
);

mediaRouter.get(
  '/api/media/:id/thumbnail',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    // When the thumbnail cache is disabled, serve the original image directly.
    // Videos always need a generated frame (a raw video is not a usable thumbnail).
    if (!thumbnailCacheEnabled() && row.type === 'image') {
      if (!fs.existsSync(row.path)) return res.status(404).json({ error: 'Source missing' });
      return res.sendFile(row.path, { cacheControl: true, maxAge: '1h' });
    }
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

const TAG_CATEGORIES = ['rating', 'general', 'character', 'user'] as const;

const tagsPatchSchema = z.object({
  add: z.array(z.string().min(1)).default([]),
  remove: z.array(z.string().min(1)).default([]),
  category: z.enum(TAG_CATEGORIES).default('user'),
  // Change an existing tag's global category: { name -> category }.
  setCategory: z.record(z.enum(TAG_CATEGORIES)).optional(),
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
      const tagId = upsertTag(name, body.category);
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
    if (body.setCategory) {
      for (const [rawName, category] of Object.entries(body.setCategory)) {
        const name = rawName.trim().toLowerCase();
        db.update(schema.tags).set({ category }).where(eq(schema.tags.name, name)).run();
      }
    }
    refreshUsageCounts(touched);
    res.json(getDetail(id));
  }),
);

const likeSchema = z.object({ liked: z.boolean() });

mediaRouter.patch(
  '/api/media/:id/like',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    const { liked } = likeSchema.parse(req.body);
    db.update(schema.media)
      .set({ liked: liked ? 1 : 0, likedAt: liked ? Date.now() : null })
      .where(eq(schema.media.id, id))
      .run();
    res.json(getDetail(id));
  }),
);

mediaRouter.get(
  '/api/media/:id/similar',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });

    // Exact duplicates: same cheap content hash (size + first 4 MB).
    const duplicates = row.contentHash
      ? (sqlite
          .query(
            `SELECT m.*, l.name AS library_name,
                    (SELECT COUNT(*) FROM media_tags mt WHERE mt.media_id = m.id) AS tag_count
             FROM media m LEFT JOIN libraries l ON l.id = m.library_id
             WHERE m.content_hash = ? AND m.id != ? LIMIT 24`,
          )
          .all(row.contentHash, id) as any[]).map(rowToMedia)
      : [];

    // Visual similarity: perceptual-hash hamming distance (images only).
    const dupIds = new Set(duplicates.map((d) => d.id));
    const similar: SimilarResponse['similar'] = [];
    if (row.perceptualHash) {
      const candidates = sqlite
        .query(
          `SELECT m.*, l.name AS library_name,
                  (SELECT COUNT(*) FROM media_tags mt WHERE mt.media_id = m.id) AS tag_count
           FROM media m LEFT JOIN libraries l ON l.id = m.library_id
           WHERE m.type = 'image' AND m.perceptual_hash IS NOT NULL AND m.id != ?`,
        )
        .all(id) as any[];
      const scored: { media: any; dist: number }[] = [];
      for (const cand of candidates) {
        if (dupIds.has(cand.id)) continue;
        const dist = hammingDistance(row.perceptualHash, cand.perceptual_hash);
        if (dist <= 10) scored.push({ media: cand, dist });
      }
      scored.sort((a, b) => a.dist - b.dist);
      for (const s of scored.slice(0, 12)) similar.push(rowToMedia(s.media));
    }

    const body: SimilarResponse = { duplicates, similar };
    res.json(body);
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
