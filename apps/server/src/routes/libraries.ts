import { Router } from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, sqlite, schema } from '../db';
import { wrap, intParam } from '../lib/http';
import { enqueueScanJob } from '../services/scanner';
import { scheduleAll } from '../services/jobScheduler';
import { thumbPathFor } from '../services/thumbnailer';
import { UPLOADS_DIR } from '../lib/config';
import type { LibraryWithStats } from '@sakuya/shared';

export const librariesRouter = Router();

export function libraryWithStats(row: typeof schema.libraries.$inferSelect): LibraryWithStats {
  const count = sqlite.query('SELECT COUNT(*) AS c FROM media WHERE library_id = ?').get(row.id) as { c: number };
  const thumb =
    row.thumbnailMediaId ??
    ((sqlite
      .query('SELECT id FROM media WHERE library_id = ? ORDER BY created_at DESC, id DESC LIMIT 1')
      .get(row.id) as { id: number } | null)?.id ?? null);
  const libFolders = db.select().from(schema.folders).where(eq(schema.folders.libraryId, row.id)).all();
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    thumbnailMediaId: row.thumbnailMediaId,
    customImagePath: row.customImagePath ?? null,
    createdAt: row.createdAt,
    lastVisitedAt: row.lastVisitedAt,
    autoScanInterval: row.autoScanInterval,
    itemCount: count.c,
    // Cover precedence: custom uploaded image wins; otherwise a media thumbnail.
    thumbMediaId: row.customImagePath ? null : thumb,
    folders: libFolders,
  };
}

librariesRouter.get(
  '/api/libraries',
  wrap(async (_req, res) => {
    const rows = db.select().from(schema.libraries).all();
    res.json(rows.map(libraryWithStats));
  }),
);

librariesRouter.get(
  '/api/libraries/:id',
  wrap(async (req, res) => {
    const row = db.select().from(schema.libraries).where(eq(schema.libraries.id, intParam(req.params.id))).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    db.update(schema.libraries).set({ lastVisitedAt: Date.now() }).where(eq(schema.libraries.id, row.id)).run();
    res.json(libraryWithStats(row));
  }),
);

const libraryBodySchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(['image', 'video', 'mixed']).default('mixed'),
  autoScanInterval: z.number().int().min(0).default(0),
});

librariesRouter.post(
  '/api/libraries',
  wrap(async (req, res) => {
    const body = libraryBodySchema.parse(req.body);
    const row = db
      .insert(schema.libraries)
      .values({ name: body.name, type: body.type, autoScanInterval: body.autoScanInterval, createdAt: Date.now() })
      .returning()
      .get();
    scheduleAll();
    res.status(201).json(libraryWithStats(row));
  }),
);

librariesRouter.patch(
  '/api/libraries/:id',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const body = libraryBodySchema.partial().extend({ thumbnailMediaId: z.number().nullable().optional() }).parse(req.body);
    const row = db.update(schema.libraries).set(body).where(eq(schema.libraries.id, id)).returning().get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(libraryWithStats(row));
  }),
);

librariesRouter.delete(
  '/api/libraries/:id',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const mediaRows = db.select().from(schema.media).where(eq(schema.media.libraryId, id)).all();
    for (const m of mediaRows) {
      fs.rmSync(thumbPathFor(m.id), { force: true });
      if (m.source === 'upload') fs.rmSync(m.path, { force: true });
      db.delete(schema.mediaTags).where(eq(schema.mediaTags.mediaId, m.id)).run();
    }
    db.delete(schema.media).where(eq(schema.media.libraryId, id)).run();
    db.delete(schema.folders).where(eq(schema.folders.libraryId, id)).run();
    db.delete(schema.libraries).where(eq(schema.libraries.id, id)).run();
    sqlite.exec('UPDATE tags SET usage_count = (SELECT COUNT(*) FROM media_tags WHERE tag_id = tags.id)');
    res.json({ ok: true });
  }),
);

const folderBodySchema = z.object({ path: z.string().min(1) });

librariesRouter.post(
  '/api/libraries/:id/folders',
  wrap(async (req, res) => {
    const libraryId = intParam(req.params.id);
    const lib = db.select().from(schema.libraries).where(eq(schema.libraries.id, libraryId)).get();
    if (!lib) return res.status(404).json({ error: 'Library not found' });
    const folderPath = path.resolve(folderBodySchema.parse(req.body).path);
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      return res.status(400).json({ error: `Not a directory: ${folderPath}` });
    }
    const dup = db
      .select()
      .from(schema.folders)
      .where(and(eq(schema.folders.libraryId, libraryId), eq(schema.folders.path, folderPath)))
      .get();
    if (dup) return res.status(409).json({ error: 'Folder already attached' });
    const row = db
      .insert(schema.folders)
      .values({ libraryId, path: folderPath, status: 'pending', createdAt: Date.now() })
      .returning()
      .get();
    res.status(201).json(row);
  }),
);

librariesRouter.delete(
  '/api/folders/:id',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const folder = db.select().from(schema.folders).where(eq(schema.folders.id, id)).get();
    if (!folder) return res.status(404).json({ error: 'Not found' });
    // Remove indexed media that lives under this folder root.
    const rows = db
      .select()
      .from(schema.media)
      .where(and(eq(schema.media.libraryId, folder.libraryId), eq(schema.media.source, 'folder')))
      .all();
    for (const m of rows) {
      if (m.path.startsWith(folder.path + path.sep) || m.path === folder.path) {
        fs.rmSync(thumbPathFor(m.id), { force: true });
        db.delete(schema.mediaTags).where(eq(schema.mediaTags.mediaId, m.id)).run();
        db.delete(schema.media).where(eq(schema.media.id, m.id)).run();
      }
    }
    db.delete(schema.folders).where(eq(schema.folders.id, id)).run();
    sqlite.exec('UPDATE tags SET usage_count = (SELECT COUNT(*) FROM media_tags WHERE tag_id = tags.id)');
    res.json({ ok: true });
  }),
);

librariesRouter.post(
  '/api/libraries/:id/scan',
  wrap(async (req, res) => {
    const job = enqueueScanJob(intParam(req.params.id));
    res.json({ job });
  }),
);

// Serve a library's custom cover image (if set).
librariesRouter.get(
  '/api/libraries/:id/cover',
  wrap(async (req, res) => {
    const row = db.select().from(schema.libraries).where(eq(schema.libraries.id, intParam(req.params.id))).get();
    if (!row || !row.customImagePath || !fs.existsSync(row.customImagePath)) {
      return res.status(404).json({ error: 'No custom cover' });
    }
    res.sendFile(row.customImagePath, { cacheControl: true, maxAge: '1h' });
  }),
);

// Upload a custom cover image (multipart). Overrides the auto/media cover until removed.
librariesRouter.post(
  '/api/libraries/:id/cover',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const lib = db.select().from(schema.libraries).where(eq(schema.libraries.id, id)).get();
    if (!lib) return res.status(404).json({ error: 'Not found' });

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const request = new Request('http://localhost/api/libraries/cover', {
      method: 'POST',
      headers: { 'content-type': req.headers['content-type'] ?? '' },
      body: Buffer.concat(chunks),
    });
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return res.status(400).json({ error: 'No file provided' });

    const ext = (path.extname((file as any).name || '') || '.jpg').toLowerCase();
    const dest = path.join(UPLOADS_DIR, `cover-${id}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    await fsp.writeFile(dest, Buffer.from(await (file as any).arrayBuffer()));

    // Remove any previous custom cover file.
    if (lib.customImagePath) await fsp.unlink(lib.customImagePath).catch(() => {});
    const row = db
      .update(schema.libraries)
      .set({ customImagePath: dest })
      .where(eq(schema.libraries.id, id))
      .returning()
      .get();
    res.json(libraryWithStats(row));
  }),
);

// Remove the custom cover, re-enabling the auto/media cover.
librariesRouter.delete(
  '/api/libraries/:id/cover',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const lib = db.select().from(schema.libraries).where(eq(schema.libraries.id, id)).get();
    if (!lib) return res.status(404).json({ error: 'Not found' });
    if (lib.customImagePath) await fsp.unlink(lib.customImagePath).catch(() => {});
    const row = db
      .update(schema.libraries)
      .set({ customImagePath: null })
      .where(eq(schema.libraries.id, id))
      .returning()
      .get();
    res.json(libraryWithStats(row));
  }),
);
