import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { useTestConfig } from './testConfig';

// Throwaway data dir before anything opens the real database. No server: the scan job runs
// in-process through the job queue.
const dataDir = useTestConfig('scan');

const { db, schema } = await import('./db');
const { enqueueScanJob } = await import('./services/scanner');
const { jobEvents } = await import('./services/jobQueue');
const { removeMediaRows } = await import('./services/mediaRemoval');

const root = path.join(dataDir, 'library-root');
const parked = path.join(dataDir, 'library-root-unmounted');

async function writeImage(name: string, color: string) {
  await sharp({ create: { width: 8, height: 8, channels: 3, background: color } })
    .png()
    .toFile(path.join(root, name));
}

async function scan(libraryId = lib.id) {
  const job = enqueueScanJob(libraryId);
  for (;;) {
    const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get()!;
    if (row.status === 'done' || row.status === 'error') return row;
    await Bun.sleep(10);
  }
}

const mediaCount = () => db.select().from(schema.media).where(eq(schema.media.libraryId, lib.id)).all().length;

fs.mkdirSync(root);
await writeImage('a.png', '#ff0000');
await writeImage('b.png', '#00ff00');
// TypeScript, not an MPEG transport stream: must be skipped, not probed and logged as an error.
fs.writeFileSync(path.join(root, 'main.ts'), 'export const x = 1;\n'.repeat(20));
const lib = db.insert(schema.libraries).values({ name: 'scan', createdAt: Date.now() }).returning().get();
const folder = db
  .insert(schema.folders)
  .values({ libraryId: lib.id, path: root, createdAt: Date.now() })
  .returning()
  .get();

test('a scan indexes the folder', async () => {
  const job = await scan();
  expect(job.status).toBe('done');
  expect(job.log).not.toContain('error');
  expect(mediaCount()).toBe(2);
});

test('a scan of an unreachable folder keeps its media instead of pruning everything', async () => {
  // What an unmounted drive or a missing Docker volume looks like from here.
  fs.renameSync(root, parked);
  const job = await scan();
  expect(job.status).toBe('error');
  expect(job.log).toContain('Kept 2 items');
  expect(mediaCount()).toBe(2);
  expect(db.select().from(schema.folders).where(eq(schema.folders.id, folder.id)).get()!.status).toBe('error');

  // An empty mountpoint left behind is the same situation.
  fs.mkdirSync(root);
  expect((await scan()).status).toBe('error');
  expect(mediaCount()).toBe(2);
  fs.rmdirSync(root);
  fs.renameSync(parked, root);
});

test('files deleted from a folder that is still there are pruned', async () => {
  fs.rmSync(path.join(root, 'a.png'));
  const job = await scan();
  expect(job.status).toBe('done');
  expect(job.log).toContain('1 removed');
  expect(mediaCount()).toBe(1);
});

test('replacing every file in a folder still prunes the old ones', async () => {
  fs.rmSync(path.join(root, 'b.png'));
  await writeImage('c.png', '#0000ff');
  const job = await scan();
  expect(job.status).toBe('done');
  expect(mediaCount()).toBe(1);
  expect(db.select().from(schema.media).where(eq(schema.media.libraryId, lib.id)).get()!.filename).toBe('c.png');
});

test.skipIf(process.getuid?.() === 0)('files in a folder the server cannot read are kept', async () => {
  const locked = path.join(root, 'locked');
  fs.mkdirSync(locked);
  await writeImage('locked/d.png', '#ffff00');
  expect((await scan()).status).toBe('done');
  expect(mediaCount()).toBe(2);

  fs.chmodSync(locked, 0o000);
  try {
    await scan();
    expect(mediaCount()).toBe(2);
  } finally {
    fs.chmodSync(locked, 0o755);
  }
  fs.rmSync(locked, { recursive: true });
  await scan();
  expect(mediaCount()).toBe(1);
});

test('an unmounted folder nested inside another folder of the library keeps its media', async () => {
  const inner = path.join(root, 'inner');
  const innerParked = path.join(dataDir, 'inner-unmounted');
  fs.mkdirSync(inner);
  await writeImage('inner/e.png', '#00ffff');
  await writeImage('inner/f.png', '#ff00ff');
  const innerFolder = db
    .insert(schema.folders)
    .values({ libraryId: lib.id, path: inner, createdAt: Date.now() })
    .returning()
    .get();
  const first = await scan();
  expect(first.status).toBe('done');
  expect(first.log).toContain('2 indexed, 1 unchanged');
  expect(mediaCount()).toBe(3);

  fs.renameSync(inner, innerParked);
  fs.mkdirSync(inner);
  const job = await scan();
  expect(job.status).toBe('error');
  expect(job.log).toContain('Kept 2 items');
  expect(mediaCount()).toBe(3);
  expect(db.select().from(schema.folders).where(eq(schema.folders.id, innerFolder.id)).get()!.status).toBe('error');
  expect(db.select().from(schema.folders).where(eq(schema.folders.id, folder.id)).get()!.status).toBe('indexed');
  fs.rmdirSync(inner);
  fs.renameSync(innerParked, inner);
});

test('a folder symlinked inside another folder of the library gets its files indexed', async () => {
  const outer = path.join(dataDir, 'linked-outer');
  const share = path.join(dataDir, 'linked-share');
  fs.mkdirSync(outer);
  fs.mkdirSync(share);
  fs.symlinkSync(share, path.join(outer, 'nas'));
  await sharp({ create: { width: 8, height: 8, channels: 3, background: '#404040' } })
    .png()
    .toFile(path.join(share, 'g.png'));
  const library = db.insert(schema.libraries).values({ name: 'linked', createdAt: Date.now() }).returning().get();
  for (const folderPath of [outer, path.join(outer, 'nas')]) {
    db.insert(schema.folders).values({ libraryId: library.id, path: folderPath, createdAt: Date.now() }).run();
  }

  const job = await scan(library.id);
  expect(job.status).toBe('done');
  const indexed = db.select().from(schema.media).where(eq(schema.media.libraryId, library.id)).all();
  expect(indexed.map((m) => m.path)).toEqual([path.join(outer, 'nas', 'g.png')]);
});

test('scans of one library never run at the same time', async () => {
  for (let i = 0; i < 20; i++) await writeImage(`burst-${i}.png`, `#${(i * 12).toString(16).padStart(2, '0')}8080`);
  const queuedTwice = [enqueueScanJob(lib.id), enqueueScanJob(lib.id)];
  expect(queuedTwice[1].id).toBe(queuedTwice[0].id);

  const status = (id: number) => db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get()!;
  while (status(queuedTwice[0].id).status === 'queued') await Bun.sleep(1);
  const second = enqueueScanJob(lib.id);
  expect(second.id).not.toBe(queuedTwice[0].id);

  let overlapped = false;
  for (;;) {
    const [a, b] = [status(queuedTwice[0].id), status(second.id)];
    if (a.status === 'running' && b.status === 'running') overlapped = true;
    if (['done', 'error'].includes(a.status) && ['done', 'error'].includes(b.status)) {
      expect(a.log).not.toContain('error');
      expect(b.log).not.toContain('error');
      break;
    }
    await Bun.sleep(1);
  }
  expect(overlapped).toBe(false);
});

/**
 * Scan a fresh library of three images, running `remove` (what the delete-library or
 * detach-folder route does) as soon as the first file is indexed, while the scan is mid-way.
 */
async function scanWhileRemoving(name: string, remove: (libraryId: number, folderId: number) => void) {
  const dir = path.join(dataDir, name);
  fs.mkdirSync(dir);
  for (const color of ['#101010', '#202020', '#303030']) {
    await sharp({ create: { width: 8, height: 8, channels: 3, background: color } })
      .png()
      .toFile(path.join(dir, `${color.slice(1)}.png`));
  }
  const library = db.insert(schema.libraries).values({ name, createdAt: Date.now() }).returning().get();
  const attached = db
    .insert(schema.folders)
    .values({ libraryId: library.id, path: dir, createdAt: Date.now() })
    .returning()
    .get();
  const job = enqueueScanJob(library.id);
  const onJob = (row: { id: number; progress: number }) => {
    if (row.id !== job.id || row.progress !== 1) return;
    jobEvents.off('job', onJob);
    remove(library.id, attached.id);
  };
  jobEvents.on('job', onJob);
  for (;;) {
    const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get()!;
    if (row.status === 'done' || row.status === 'error') break;
    await Bun.sleep(10);
  }
  return db.select().from(schema.media).where(eq(schema.media.libraryId, library.id)).all().length;
}

const indexedIn = (libraryId: number) =>
  db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.libraryId, libraryId)).all();

test('a folder detached mid-scan gets no rows back from that scan', async () => {
  const left = await scanWhileRemoving('detached-mid-scan', (libraryId, folderId) => {
    removeMediaRows(indexedIn(libraryId).map((m) => m.id));
    db.delete(schema.folders).where(eq(schema.folders.id, folderId)).run();
  });
  expect(left).toBe(0);
});

test('a library deleted mid-scan gets no rows back from that scan', async () => {
  const left = await scanWhileRemoving('deleted-mid-scan', (libraryId) => {
    removeMediaRows(indexedIn(libraryId).map((m) => m.id));
    db.delete(schema.folders).where(eq(schema.folders.libraryId, libraryId)).run();
    db.delete(schema.libraries).where(eq(schema.libraries.id, libraryId)).run();
  });
  expect(left).toBe(0);
});
