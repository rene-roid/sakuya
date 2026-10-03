import { Router } from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { wrap, intParam, readFormData, formFiles, sanitizeFilename, openEventStream } from '../lib/http';
import { DOWNLOADER_COOKIES_DIR } from '../lib/config';
import { detectGalleryDl, installGalleryDl } from '../services/galleryDl';
import {
  enqueueBatch,
  listBatches,
  listItemLogs,
  pauseItem,
  resumeItem,
  skipItem,
  redoItem,
  removeItem,
  resolveLibraryForPath,
  downloaderEvents,
} from '../services/downloader';
import {
  startConsoleSession,
  stopConsoleSession,
  writeConsoleInput,
  getConsoleStatus,
  getConsoleBuffer,
  consoleEvents,
} from '../services/consoleSession';
import { attachFolder, libraryWithStats } from './libraries';
import type { DownloadBatchWithItems, DownloadItem, DownloadCookie, DownloadLogLine, ConsoleSessionStatus } from '@sakuya/shared';

export const downloaderRouter = Router();

downloaderRouter.get(
  '/api/downloader/status',
  wrap(async (_req, res) => {
    res.json(await detectGalleryDl());
  }),
);

downloaderRouter.post(
  '/api/downloader/install',
  wrap(async (_req, res) => {
    const status = await detectGalleryDl();
    if (status.installed) return res.status(409).json({ error: 'gallery-dl is already installed' });
    const job = installGalleryDl();
    res.json({ job });
  }),
);

downloaderRouter.get(
  '/api/downloader/resolve-path',
  wrap(async (req, res) => {
    const raw = String(req.query.path ?? '');
    if (!raw.trim()) return res.json({ library: null });
    const libraryId = resolveLibraryForPath(raw);
    if (libraryId === null) return res.json({ library: null });
    const lib = db.select().from(schema.libraries).where(eq(schema.libraries.id, libraryId)).get();
    res.json({ library: lib ? libraryWithStats(lib) : null });
  }),
);

function cookieToPayload(row: typeof schema.downloadCookies.$inferSelect): DownloadCookie {
  return { id: row.id, filename: row.filename, uploadedAt: row.uploadedAt };
}

downloaderRouter.get(
  '/api/downloader/cookies',
  wrap(async (_req, res) => {
    const rows = db.select().from(schema.downloadCookies).all();
    res.json(rows.map(cookieToPayload));
  }),
);

downloaderRouter.post(
  '/api/downloader/cookies',
  wrap(async (req, res) => {
    const files = formFiles(await readFormData(req), 'files');
    if (files.length === 0) return res.status(400).json({ error: 'No files provided' });

    const created: DownloadCookie[] = [];
    for (const file of files) {
      const filename = sanitizeFilename(file.name || 'cookies.txt');
      const dest = path.join(DOWNLOADER_COOKIES_DIR, `${crypto.randomBytes(6).toString('hex')}-${filename}`);
      await fsp.writeFile(dest, Buffer.from(await file.arrayBuffer()));
      const row = db
        .insert(schema.downloadCookies)
        .values({ filename, storedPath: dest, uploadedAt: Date.now() })
        .returning()
        .get();
      created.push(cookieToPayload(row));
    }
    res.status(201).json(created);
  }),
);

downloaderRouter.delete(
  '/api/downloader/cookies/:id',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.downloadCookies).where(eq(schema.downloadCookies.id, id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    await fsp.unlink(row.storedPath).catch(() => {});
    db.delete(schema.downloadCookies).where(eq(schema.downloadCookies.id, id)).run();
    res.json({ ok: true });
  }),
);

const batchBodySchema = z.object({
  libraryId: z.number().int().positive(),
  folderPath: z.string().min(1),
  urls: z.array(z.string().min(1)).min(1),
  extraArgs: z.string().optional(),
  cookieFileId: z.number().int().positive().nullable().optional(),
});

downloaderRouter.post(
  '/api/downloader/batches',
  wrap(async (req, res) => {
    const body = batchBodySchema.parse(req.body);
    const folderPath = path.resolve(body.folderPath);

    const lib = db.select().from(schema.libraries).where(eq(schema.libraries.id, body.libraryId)).get();
    if (!lib) return res.status(404).json({ error: 'Library not found' });

    const owningLibraryId = resolveLibraryForPath(folderPath);
    if (owningLibraryId !== null && owningLibraryId !== body.libraryId) {
      return res.status(409).json({ error: `Folder already belongs to another library (#${owningLibraryId})` });
    }

    if (body.cookieFileId) {
      const cookie = db.select().from(schema.downloadCookies).where(eq(schema.downloadCookies.id, body.cookieFileId)).get();
      if (!cookie) return res.status(400).json({ error: 'Cookie file not found' });
    }

    fs.mkdirSync(folderPath, { recursive: true });
    attachFolder(body.libraryId, folderPath);

    const batch = enqueueBatch({
      libraryId: body.libraryId,
      folderPath,
      urls: body.urls,
      extraArgs: body.extraArgs ?? null,
      cookieFileId: body.cookieFileId ?? null,
    });
    res.status(201).json(batch);
  }),
);

downloaderRouter.get(
  '/api/downloader/batches',
  wrap(async (_req, res) => {
    res.json(listBatches());
  }),
);

downloaderRouter.get(
  '/api/downloader/items/:id/logs',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const after = req.query.after ? intParam(String(req.query.after)) : 0;
    res.json(listItemLogs(id, after));
  }),
);

downloaderRouter.post(
  '/api/downloader/items/:id/pause',
  wrap(async (req, res) => {
    pauseItem(intParam(req.params.id));
    res.json({ ok: true });
  }),
);

downloaderRouter.post(
  '/api/downloader/items/:id/resume',
  wrap(async (req, res) => {
    resumeItem(intParam(req.params.id));
    res.json({ ok: true });
  }),
);

downloaderRouter.post(
  '/api/downloader/items/:id/skip',
  wrap(async (req, res) => {
    skipItem(intParam(req.params.id));
    res.json({ ok: true });
  }),
);

downloaderRouter.post(
  '/api/downloader/items/:id/redo',
  wrap(async (req, res) => {
    redoItem(intParam(req.params.id));
    res.json({ ok: true });
  }),
);

const removeBodySchema = z.object({ deleteFiles: z.boolean().default(false) });

downloaderRouter.delete(
  '/api/downloader/items/:id',
  wrap(async (req, res) => {
    const body = removeBodySchema.parse(req.body ?? {});
    removeItem(intParam(req.params.id), body);
    res.json({ ok: true });
  }),
);

downloaderRouter.get(
  '/api/downloader/console/status',
  wrap(async (_req, res) => {
    res.json(getConsoleStatus());
  }),
);

const consoleStartSchema = z.object({ command: z.string().min(1) });

downloaderRouter.post(
  '/api/downloader/console/start',
  wrap(async (req, res) => {
    const body = consoleStartSchema.parse(req.body);
    try {
      await startConsoleSession(body.command.trim());
    } catch (err: any) {
      return res.status(err.status ?? 400).json({ error: err.message });
    }
    res.json(getConsoleStatus());
  }),
);

const consoleInputSchema = z.object({ text: z.string() });

downloaderRouter.post(
  '/api/downloader/console/input',
  wrap(async (req, res) => {
    const body = consoleInputSchema.parse(req.body);
    writeConsoleInput(body.text);
    res.json({ ok: true });
  }),
);

downloaderRouter.post(
  '/api/downloader/console/stop',
  wrap(async (_req, res) => {
    stopConsoleSession();
    res.json({ ok: true });
  }),
);

downloaderRouter.get('/api/downloader/console/stream', (req, res) => {
  const stream = openEventStream(req, res);
  stream.send({ type: 'snapshot', buffer: getConsoleBuffer(), status: getConsoleStatus() });

  const onData = (chunk: string) => stream.send({ type: 'data', chunk });
  const onStatus = (status: ConsoleSessionStatus) => stream.send({ type: 'status', status });
  consoleEvents.on('data', onData);
  consoleEvents.on('status', onStatus);
  stream.onClose(() => {
    consoleEvents.off('data', onData);
    consoleEvents.off('status', onStatus);
  });
});

downloaderRouter.get('/api/downloader/stream', (req, res) => {
  const stream = openEventStream(req, res);
  stream.send({ type: 'snapshot', batches: listBatches() });

  const onBatch = (batch: DownloadBatchWithItems) => stream.send({ type: 'batch', batch });
  const onItem = (item: DownloadItem) => stream.send({ type: 'item', item });
  const onLog = (log: DownloadLogLine) => stream.send({ type: 'log', log });
  const onRemoved = (payload: { id: number; batchId: number }) => stream.send({ type: 'removed', ...payload });
  downloaderEvents.on('batch', onBatch);
  downloaderEvents.on('item', onItem);
  downloaderEvents.on('log', onLog);
  downloaderEvents.on('removed', onRemoved);
  stream.onClose(() => {
    downloaderEvents.off('batch', onBatch);
    downloaderEvents.off('item', onItem);
    downloaderEvents.off('log', onLog);
    downloaderEvents.off('removed', onRemoved);
  });
});
