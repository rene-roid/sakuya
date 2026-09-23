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

const root = path.join(dataDir, 'library-root');
const parked = path.join(dataDir, 'library-root-unmounted');

async function writeImage(name: string, color: string) {
  await sharp({ create: { width: 8, height: 8, channels: 3, background: color } })
    .png()
    .toFile(path.join(root, name));
}

async function scan() {
  const job = enqueueScanJob(lib.id);
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
const lib = db.insert(schema.libraries).values({ name: 'scan', createdAt: Date.now() }).returning().get();
const folder = db
  .insert(schema.folders)
  .values({ libraryId: lib.id, path: root, createdAt: Date.now() })
  .returning()
  .get();

test('a scan indexes the folder', async () => {
  const job = await scan();
  expect(job.status).toBe('done');
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
