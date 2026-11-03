import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { JobType, ScheduleJobType, ScheduleMode } from '@sakuya/shared';
import { useTestConfig } from './testConfig';

// No server: scans and their follow-ups run in-process through the job queue.
const dataDir = useTestConfig('scheduler');

const { db, schema } = await import('./db');
const { resolveSchedule, dispatchAfterScan, runAllNow } = await import('./services/jobScheduler');
const { enqueueScanJob } = await import('./services/scanner');
const { setSetting } = await import('./lib/settings');

/** Replace the schedule row for (jobType, libraryId); null is the global default. */
function schedule(jobType: ScheduleJobType, libraryId: number | null, mode: ScheduleMode, useGlobal = false) {
  const scope =
    libraryId === null ? isNull(schema.jobSchedules.libraryId) : eq(schema.jobSchedules.libraryId, libraryId);
  db.delete(schema.jobSchedules)
    .where(and(eq(schema.jobSchedules.jobType, jobType), scope))
    .run();
  db.insert(schema.jobSchedules)
    .values({ jobType, libraryId, mode, intervalMinutes: mode === 'interval' ? 60 : 0, useGlobal: useGlobal ? 1 : 0 })
    .run();
}

/**
 * A library with one attached folder. `addUnhashed` writes a PNG there and indexes it the way a row
 * from before perceptual hashing looks: unchanged on disk, so a scan skips it, but with no hash.
 * `writeImage` and `index` are its two halves, for a test that must not await between dispatches.
 */
function library(name: string) {
  const lib = db.insert(schema.libraries).values({ name, createdAt: Date.now() }).returning().get();
  const root = path.join(dataDir, name);
  fs.mkdirSync(root);
  db.insert(schema.folders).values({ libraryId: lib.id, path: root, createdAt: Date.now() }).run();
  let count = 0;
  const writeImage = async () => {
    const file = path.join(root, `${count}.png`);
    const shade = (count++ * 40) % 256;
    await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: shade, g: 255 - shade, b: 9 } } })
      .png()
      .toFile(file);
    return file;
  };
  const index = (file: string) => {
    const stat = fs.statSync(file);
    db.insert(schema.media)
      .values({
        libraryId: lib.id,
        source: 'folder',
        path: file,
        filename: path.basename(file),
        type: 'image',
        sizeBytes: stat.size,
        mtime: Math.round(stat.mtimeMs),
        thumbnailPath: file,
        createdAt: Date.now(),
      })
      .run();
  };
  const addUnhashed = async () => index(await writeImage());
  return { lib, writeImage, index, addUnhashed };
}

const pending = (libraryId: number) =>
  db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.libraryId, libraryId), inArray(schema.jobs.status, ['queued', 'running'])))
    .all();

async function settle(libraryId: number) {
  do await Bun.sleep(20);
  while (pending(libraryId).length);
}

const jobsOf = (libraryId: number, type: JobType) =>
  db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.libraryId, libraryId), eq(schema.jobs.type, type)))
    .all();

const unhashed = (libraryId: number) =>
  db
    .select({ id: schema.media.id })
    .from(schema.media)
    .where(and(eq(schema.media.libraryId, libraryId), isNull(schema.media.perceptualHash)))
    .all().length;

describe('resolveSchedule', () => {
  test('a fresh database tags and hashes after each scan, and schedules nothing else', () => {
    expect(resolveSchedule('scan', null).mode).toBe('off');
    expect(resolveSchedule('tag', null).mode).toBe('after-scan');
    expect(resolveSchedule('hash', null).mode).toBe('after-scan');
    expect(resolveSchedule('cleanup', null).mode).toBe('off');
  });

  test('a library without its own row, or one set to follow the global, gets the global', () => {
    schedule('scan', null, 'interval');
    schedule('scan', 777, 'off', true);
    expect(resolveSchedule('scan', 776)).toEqual({ mode: 'interval', intervalMinutes: 60 });
    expect(resolveSchedule('scan', 777)).toEqual({ mode: 'interval', intervalMinutes: 60 });
    schedule('scan', null, 'off');
  });

  test("a library's own row wins over the global", () => {
    schedule('scan', 778, 'after-scan');
    expect(resolveSchedule('scan', 778)).toEqual({ mode: 'after-scan', intervalMinutes: 0 });
  });
});

describe('after-scan follow-ups', () => {
  test('a scan hashes the images it found without a hash', async () => {
    const { lib, addUnhashed } = library('scan-hashes');
    await addUnhashed();
    await addUnhashed();
    enqueueScanJob(lib.id);
    await settle(lib.id);
    expect(unhashed(lib.id)).toBe(0);
    expect(jobsOf(lib.id, 'hash').map((job) => job.status)).toEqual(['done']);
  });

  test('a follow-up queued while the last one waits joins it and covers both', async () => {
    const { lib, writeImage, index } = library('hash-joins');
    const [first, second] = [await writeImage(), await writeImage()];
    index(first);
    dispatchAfterScan(lib.id);
    index(second);
    dispatchAfterScan(lib.id);
    await settle(lib.id);
    expect(unhashed(lib.id)).toBe(0);
    expect(jobsOf(lib.id, 'hash')).toHaveLength(1);
  });

  test('nothing to hash queues no job', async () => {
    const { lib } = library('hash-nothing');
    dispatchAfterScan(lib.id);
    await settle(lib.id);
    expect(jobsOf(lib.id, 'hash')).toHaveLength(0);
  });

  test('hashing that is off, or on its own interval, does not ride along with a scan', async () => {
    for (const mode of ['off', 'interval'] as const) {
      const { lib, addUnhashed } = library(`hash-${mode}`);
      schedule('hash', lib.id, mode);
      await addUnhashed();
      dispatchAfterScan(lib.id);
      await settle(lib.id);
      expect(jobsOf(lib.id, 'hash')).toHaveLength(0);
      expect(unhashed(lib.id)).toBe(1);
    }
  });

  test('AI tagging waits for the model instead of queuing a job that would fail', async () => {
    setSetting('ai_tagging_enabled', '1');
    const { lib, addUnhashed } = library('tag-no-model');
    await addUnhashed();
    dispatchAfterScan(lib.id);
    await settle(lib.id);
    expect(jobsOf(lib.id, 'tag')).toHaveLength(0);
  });
});

describe('runAllNow', () => {
  test('runs a job type asked for by name, whatever its mode', async () => {
    const { lib, addUnhashed } = library('run-now-hash');
    schedule('hash', lib.id, 'off');
    await addUnhashed();
    runAllNow(lib.id, 'hash');
    await settle(lib.id);
    expect(unhashed(lib.id)).toBe(0);
  });

  test('"run all" for a library leaves after-scan and off jobs to the scan, and skips a scan that is off', async () => {
    const { lib, addUnhashed } = library('run-now-all');
    schedule('scan', lib.id, 'off');
    await addUnhashed();
    runAllNow(lib.id);
    await settle(lib.id);
    expect(jobsOf(lib.id, 'scan')).toHaveLength(0);
    expect(jobsOf(lib.id, 'hash')).toHaveLength(0);

    schedule('scan', lib.id, 'interval');
    runAllNow(lib.id);
    await settle(lib.id);
    expect(jobsOf(lib.id, 'scan')).toHaveLength(1);
    expect(unhashed(lib.id)).toBe(0); // hashed by the scan's after-scan follow-up
  });
});
