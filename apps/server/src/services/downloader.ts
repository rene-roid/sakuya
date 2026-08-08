import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { eq, and, gt } from 'drizzle-orm';
import { db, schema } from '../db';
import { downloaderConcurrency } from '../lib/settings';
import { detectGalleryDl } from './galleryDl';
import { enqueueScanJob } from './scanner';
import type { DownloadBatchWithItems, DownloadBatch, DownloadItem, DownloadLogLine } from '@sakuya/shared';

export const downloaderEvents = new EventEmitter();
downloaderEvents.setMaxListeners(100);

interface RunningEntry {
  child: ChildProcess;
  killIntent: 'pause' | 'skip' | null;
}

const queue: number[] = [];
const runningProcs = new Map<number, RunningEntry>();
let running = 0;

function rowToBatch(row: typeof schema.downloadBatches.$inferSelect): DownloadBatch {
  return {
    id: row.id,
    libraryId: row.libraryId,
    folderPath: row.folderPath,
    extraArgs: row.extraArgs,
    cookieFileId: row.cookieFileId,
    createdAt: row.createdAt,
  };
}

function rowToItem(row: typeof schema.downloadItems.$inferSelect): DownloadItem {
  return {
    id: row.id,
    batchId: row.batchId,
    url: row.url,
    status: row.status,
    filesDownloaded: row.filesDownloaded,
    pid: row.pid,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function getItem(id: number) {
  return db.select().from(schema.downloadItems).where(eq(schema.downloadItems.id, id)).get();
}

function broadcastItem(id: number) {
  const row = getItem(id);
  if (row) downloaderEvents.emit('item', rowToItem(row));
}

function patchItem(id: number, patch: Partial<typeof schema.downloadItems.$inferInsert>) {
  db.update(schema.downloadItems)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(schema.downloadItems.id, id))
    .run();
  broadcastItem(id);
}

function appendLog(itemId: number, line: string) {
  const row = db
    .insert(schema.downloadLogs)
    .values({ itemId, line, createdAt: Date.now() })
    .returning()
    .get();
  const log: DownloadLogLine = { id: row.id, itemId, line, createdAt: row.createdAt };
  downloaderEvents.emit('log', log);
}

function handleStdoutLine(itemId: number, folderPath: string, rawLine: string) {
  const line = rawLine.replace(/\r$/, '');
  if (!line.trim()) return;
  appendLog(itemId, line);
  const resolved = path.isAbsolute(line) ? path.normalize(line) : path.resolve(folderPath, line);
  const folderResolved = path.resolve(folderPath);
  if (!resolved.startsWith(folderResolved + path.sep) && resolved !== folderResolved) return;
  try {
    if (!fs.statSync(resolved).isFile()) return;
  } catch {
    return;
  }
  db.insert(schema.downloadFiles).values({ itemId, path: resolved }).run();
  const row = getItem(itemId);
  if (row) patchItem(itemId, { filesDownloaded: row.filesDownloaded + 1 });
}

function maybeCompleteBatch(batchId: number) {
  const batch = db.select().from(schema.downloadBatches).where(eq(schema.downloadBatches.id, batchId)).get();
  if (!batch) return;
  const items = db.select().from(schema.downloadItems).where(eq(schema.downloadItems.batchId, batchId)).all();
  if (items.length === 0) return;
  const allTerminal = items.every((i) => i.status === 'done' || i.status === 'error' || i.status === 'skipped');
  if (allTerminal) enqueueScanJob(batch.libraryId);
}

/** Minimal shell-style word splitter (quotes supported, no shell expansion). */
function parseArgs(input: string): string[] {
  const args: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) {
    args.push(match[1] ?? match[2] ?? match[3]);
  }
  return args;
}

function removeEmptyDirsUpTo(startDir: string, stopAt: string) {
  const stopResolved = path.resolve(stopAt);
  let dir = path.resolve(startDir);
  while (dir !== stopResolved && dir.startsWith(stopResolved + path.sep)) {
    try {
      if (fs.readdirSync(dir).length > 0) break;
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    } catch {
      break;
    }
  }
}

function pump() {
  const concurrency = downloaderConcurrency();
  while (running < concurrency && queue.length > 0) {
    const itemId = queue.shift()!;
    running++;
    runOne(itemId).finally(() => {
      running--;
      pump();
    });
  }
}

async function runOne(itemId: number): Promise<void> {
  const item = getItem(itemId);
  if (!item || item.status !== 'queued') return;
  const batch = db.select().from(schema.downloadBatches).where(eq(schema.downloadBatches.id, item.batchId)).get();
  if (!batch) return;

  const galleryDl = await detectGalleryDl();
  if (!galleryDl.installed || !galleryDl.path) {
    patchItem(itemId, { status: 'error', errorMessage: 'gallery-dl is not installed' });
    maybeCompleteBatch(item.batchId);
    return;
  }

  let cookiePath: string | null = null;
  if (batch.cookieFileId) {
    const cookie = db
      .select()
      .from(schema.downloadCookies)
      .where(eq(schema.downloadCookies.id, batch.cookieFileId))
      .get();
    cookiePath = cookie?.storedPath ?? null;
  }
  const extraArgs = batch.extraArgs ? parseArgs(batch.extraArgs) : [];
  const args = [item.url, '-d', batch.folderPath, ...(cookiePath ? ['--cookies', cookiePath] : []), ...extraArgs];

  patchItem(itemId, { status: 'running' });

  await new Promise<void>((resolve) => {
    const child = spawn(galleryDl.path!, args, { cwd: batch.folderPath, stdio: ['ignore', 'pipe', 'pipe'] });
    runningProcs.set(itemId, { child, killIntent: null });
    patchItem(itemId, { pid: child.pid ?? null });

    let stdoutBuf = '';
    let stderrBuf = '';
    let lastStderrLine = '';

    child.stdout?.on('data', (d) => {
      stdoutBuf += d.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) handleStdoutLine(itemId, batch.folderPath, line);
    });
    child.stderr?.on('data', (d) => {
      stderrBuf += d.toString();
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          lastStderrLine = line.trim();
          appendLog(itemId, line);
        }
      }
    });
    child.on('error', (err) => {
      lastStderrLine = err.message;
    });
    child.on('close', (code) => {
      if (stdoutBuf.trim()) handleStdoutLine(itemId, batch.folderPath, stdoutBuf);
      if (stderrBuf.trim()) {
        lastStderrLine = stderrBuf.trim();
        appendLog(itemId, stderrBuf);
      }
      const entry = runningProcs.get(itemId);
      runningProcs.delete(itemId);
      const killIntent = entry?.killIntent ?? null;

      let terminal = false;
      if (killIntent === 'pause') {
        // status already set to 'paused' by pauseItem(); leave as-is.
      } else if (killIntent === 'skip') {
        terminal = true; // status already set to 'skipped' by skipItem()/removeItem().
      } else if (code === 0) {
        patchItem(itemId, { status: 'done', pid: null });
        terminal = true;
      } else {
        patchItem(itemId, { status: 'error', pid: null, errorMessage: lastStderrLine || `exited with code ${code}` });
        terminal = true;
      }
      if (killIntent) patchItem(itemId, { pid: null });
      if (terminal) maybeCompleteBatch(item.batchId);
      resolve();
    });
  });
}

export function enqueueBatch(opts: {
  libraryId: number;
  folderPath: string;
  urls: string[];
  extraArgs?: string | null;
  cookieFileId?: number | null;
}): DownloadBatchWithItems {
  const now = Date.now();
  const batchRow = db
    .insert(schema.downloadBatches)
    .values({
      libraryId: opts.libraryId,
      folderPath: opts.folderPath,
      extraArgs: opts.extraArgs ?? null,
      cookieFileId: opts.cookieFileId ?? null,
      createdAt: now,
    })
    .returning()
    .get();

  const itemRows = opts.urls.map((url) =>
    db
      .insert(schema.downloadItems)
      .values({ batchId: batchRow.id, url, status: 'queued', createdAt: now, updatedAt: now })
      .returning()
      .get(),
  );
  for (const row of itemRows) queue.push(row.id);
  queueMicrotask(pump);

  return { ...rowToBatch(batchRow), items: itemRows.map(rowToItem) };
}

export function listBatches(): DownloadBatchWithItems[] {
  const batches = db.select().from(schema.downloadBatches).all();
  return batches
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((b) => ({
      ...rowToBatch(b),
      items: db
        .select()
        .from(schema.downloadItems)
        .where(eq(schema.downloadItems.batchId, b.id))
        .all()
        .map(rowToItem),
    }));
}

export function listItemLogs(itemId: number, afterId = 0): DownloadLogLine[] {
  return db
    .select()
    .from(schema.downloadLogs)
    .where(and(eq(schema.downloadLogs.itemId, itemId), gt(schema.downloadLogs.id, afterId)))
    .all()
    .map((r) => ({ id: r.id, itemId: r.itemId, line: r.line, createdAt: r.createdAt }));
}

export function pauseItem(id: number): void {
  const item = getItem(id);
  if (!item) throw new Error('Item not found');
  if (item.status === 'queued') {
    const idx = queue.indexOf(id);
    if (idx !== -1) queue.splice(idx, 1);
    patchItem(id, { status: 'paused' });
    return;
  }
  if (item.status === 'running') {
    const entry = runningProcs.get(id);
    if (entry) {
      entry.killIntent = 'pause';
      patchItem(id, { status: 'paused' });
      entry.child.kill();
    }
  }
}

export function resumeItem(id: number): void {
  const item = getItem(id);
  if (!item) throw new Error('Item not found');
  if (item.status !== 'paused' && item.status !== 'error' && item.status !== 'skipped') return;
  patchItem(id, { status: 'queued', errorMessage: null });
  queue.push(id);
  pump();
}

export function skipItem(id: number): void {
  const item = getItem(id);
  if (!item) throw new Error('Item not found');
  if (item.status === 'queued') {
    const idx = queue.indexOf(id);
    if (idx !== -1) queue.splice(idx, 1);
    patchItem(id, { status: 'skipped' });
    maybeCompleteBatch(item.batchId);
    return;
  }
  if (item.status === 'running') {
    const entry = runningProcs.get(id);
    if (entry) {
      entry.killIntent = 'skip';
      patchItem(id, { status: 'skipped' });
      entry.child.kill();
    }
    return;
  }
  patchItem(id, { status: 'skipped' });
  maybeCompleteBatch(item.batchId);
}

export function removeItem(id: number, opts: { deleteFiles: boolean }): void {
  const item = getItem(id);
  if (!item) throw new Error('Item not found');

  const entry = runningProcs.get(id);
  if (entry) {
    entry.killIntent = 'skip';
    entry.child.kill();
    runningProcs.delete(id);
  }
  const qIdx = queue.indexOf(id);
  if (qIdx !== -1) queue.splice(qIdx, 1);

  if (opts.deleteFiles) {
    const batch = db.select().from(schema.downloadBatches).where(eq(schema.downloadBatches.id, item.batchId)).get();
    const files = db.select().from(schema.downloadFiles).where(eq(schema.downloadFiles.itemId, id)).all();
    const parentDirs = new Set<string>();
    for (const f of files) {
      fs.rmSync(f.path, { force: true });
      parentDirs.add(path.dirname(f.path));
    }
    if (batch) {
      for (const dir of parentDirs) removeEmptyDirsUpTo(dir, batch.folderPath);
    }
  }

  db.delete(schema.downloadFiles).where(eq(schema.downloadFiles.itemId, id)).run();
  db.delete(schema.downloadLogs).where(eq(schema.downloadLogs.itemId, id)).run();
  db.delete(schema.downloadItems).where(eq(schema.downloadItems.id, id)).run();
  downloaderEvents.emit('removed', { id, batchId: item.batchId });
}

/** Walks all registered folders to find the library that owns (or is an ancestor of) `inputPath`. */
export function resolveLibraryForPath(inputPath: string): number | null {
  const resolved = path.resolve(inputPath);
  const allFolders = db.select().from(schema.folders).all();
  for (const f of allFolders) {
    const folderResolved = path.resolve(f.path);
    if (resolved === folderResolved || resolved.startsWith(folderResolved + path.sep)) {
      return f.libraryId;
    }
  }
  return null;
}

// Requeue items left 'queued' by a server restart (see db/index.ts migration).
const pending = db.select({ id: schema.downloadItems.id }).from(schema.downloadItems).where(eq(schema.downloadItems.status, 'queued')).all();
for (const row of pending) queue.push(row.id);
queueMicrotask(pump);
