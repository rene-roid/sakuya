import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { useTestConfig } from './testConfig';

// Throwaway data dir before anything opens the real database. No server is started: performCleanup
// is called directly so the retention cutoff can be driven from the test.
useTestConfig('cleanup');

const { db, sqlite, schema } = await import('./db');
const { THUMBS_DIR, TRANSCODES_DIR } = await import('./lib/config');
const { performCleanup } = await import('./services/cleanup');

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const OLD = NOW - 30 * DAY; // outside the 14-day retention window
const RECENT = NOW - 1 * DAY; // inside it

const library = db.insert(schema.libraries).values({ name: 'cleanup', createdAt: NOW }).returning().get();

const live = db
  .insert(schema.media)
  .values({
    libraryId: library.id,
    source: 'folder',
    path: '/nowhere/live.png',
    filename: 'live.png',
    type: 'image',
    sizeBytes: 1,
    createdAt: NOW,
  })
  .returning()
  .get();

// A thumbnail for a live row and one for a media id that no longer exists.
const ORPHAN_ID = 987_654;
fs.mkdirSync(THUMBS_DIR, { recursive: true });
fs.writeFileSync(path.join(THUMBS_DIR, `${live.id}.webp`), 'x');
fs.writeFileSync(path.join(THUMBS_DIR, `${ORPHAN_ID}.webp`), 'x');
// Not a thumbnail: the scan must leave unrelated files alone.
fs.writeFileSync(path.join(THUMBS_DIR, 'notes.txt'), 'x');

// Partial outputs. One left by a process that died two days ago, one still being written.
fs.mkdirSync(TRANSCODES_DIR, { recursive: true });
const partial = (dir: string, name: string, mtime: number) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'x');
  fs.utimesSync(file, mtime / 1000, mtime / 1000);
  return file;
};
const staleThumbPart = partial(THUMBS_DIR, `${live.id}.webp.4242.part`, NOW - 2 * DAY);
const activeThumbPart = partial(THUMBS_DIR, `${ORPHAN_ID}.webp.4242.part`, NOW - 60_000);
const staleTranscodePart = partial(TRANSCODES_DIR, `${live.id}.mp4.part`, NOW - 2 * DAY);
const activeTranscodePart = partial(TRANSCODES_DIR, `${ORPHAN_ID}.mp4.part`, NOW - 60_000);

// usage_count deliberately wrong, so the recompute has something to correct.
const tag = db
  .insert(schema.tags)
  .values({ name: 'cleanup_tag', category: 'user', usageCount: 99 })
  .returning()
  .get();
db.insert(schema.mediaTags).values({ mediaId: live.id, tagId: tag.id, confidence: null, source: 'user' }).run();

const insertJob = (status: 'done' | 'error' | 'queued' | 'running', createdAt: number) =>
  db
    .insert(schema.jobs)
    .values({ type: 'scan', label: 'j', status, createdAt, updatedAt: createdAt })
    .returning()
    .get();

const oldDone = insertJob('done', OLD);
const oldError = insertJob('error', OLD);
const recentDone = insertJob('done', RECENT);
const oldRunning = insertJob('running', OLD);
const oldQueued = insertJob('queued', OLD);

const batch = db
  .insert(schema.downloadBatches)
  .values({ libraryId: library.id, folderPath: '/nowhere', createdAt: OLD })
  .returning()
  .get();

const insertItem = (status: 'done' | 'error' | 'skipped' | 'running', updatedAt: number) =>
  db
    .insert(schema.downloadItems)
    .values({ batchId: batch.id, url: 'http://x', status, createdAt: OLD, updatedAt })
    .returning()
    .get();

const addLog = (itemId: number) =>
  db.insert(schema.downloadLogs).values({ itemId, line: 'log', createdAt: OLD }).run();

const finishedLongAgo = insertItem('done', OLD);
const finishedRecently = insertItem('done', RECENT);
const stillRunning = insertItem('running', OLD);
addLog(finishedLongAgo.id);
addLog(finishedLongAgo.id);
addLog(finishedRecently.id);
addLog(stillRunning.id);

const result = performCleanup(NOW);

const jobExists = (id: number) => !!db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get();
const logCount = (itemId: number) =>
  (sqlite.query('SELECT COUNT(*) AS c FROM download_logs WHERE item_id = ?').get(itemId) as { c: number }).c;

test('orphan thumbnails go, live ones and unrelated files stay', () => {
  expect(result.removedThumbs).toBe(2); // the orphan and the stale partial
  expect(fs.existsSync(path.join(THUMBS_DIR, `${ORPHAN_ID}.webp`))).toBe(false);
  expect(fs.existsSync(path.join(THUMBS_DIR, `${live.id}.webp`))).toBe(true);
  expect(fs.existsSync(path.join(THUMBS_DIR, 'notes.txt'))).toBe(true);
});

test('partial files a dead process left behind go, ones still being written stay', () => {
  expect(fs.existsSync(staleThumbPart)).toBe(false);
  expect(fs.existsSync(staleTranscodePart)).toBe(false);
  expect(result.removedTranscodes).toBe(1);

  expect(fs.existsSync(activeThumbPart)).toBe(true);
  expect(fs.existsSync(activeTranscodePart)).toBe(true);
});

test('tag usage counts are recomputed from media_tags', () => {
  const row = sqlite.query('SELECT usage_count AS c FROM tags WHERE id = ?').get(tag.id) as { c: number };
  expect(row.c).toBe(1);
  expect(result.resetTagCounts).toBeGreaterThan(0);
});

test('only finished jobs past the retention window are pruned', () => {
  expect(jobExists(oldDone.id)).toBe(false);
  expect(jobExists(oldError.id)).toBe(false);
  expect(result.prunedJobs).toBe(2);

  // Recent history and anything not finished must survive, however old.
  expect(jobExists(recentDone.id)).toBe(true);
  expect(jobExists(oldRunning.id)).toBe(true);
  expect(jobExists(oldQueued.id)).toBe(true);
});

test('download logs are pruned by when their item finished', () => {
  expect(logCount(finishedLongAgo.id)).toBe(0);
  expect(result.prunedDownloadLogs).toBe(2);

  // A recently finished item keeps its logs, and a running one keeps them regardless of age.
  expect(logCount(finishedRecently.id)).toBe(1);
  expect(logCount(stillRunning.id)).toBe(1);
});
