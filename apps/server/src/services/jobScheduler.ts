import { eq, and, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '../db';
import { enqueueScanJob } from './scanner';
import { enqueueTagJob, enqueueHashJob, modelReady } from './tagger';
import { enqueueCleanupJob } from './cleanup';
import { aiTaggingEnabled } from '../lib/settings';

type ScheduleJobType = 'scan' | 'tag' | 'hash' | 'cleanup';
type ScheduleMode = 'off' | 'interval' | 'after-scan';

interface Schedule {
  mode: ScheduleMode;
  intervalMinutes: number;
}

const timers = new Map<string, ReturnType<typeof setInterval>>();

function activeJobForLibrary(libraryId: number | null, jobType: ScheduleJobType): boolean {
  const active = db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(
      and(
        libraryId === null ? isNull(schema.jobs.libraryId) : eq(schema.jobs.libraryId, libraryId),
        eq(schema.jobs.type, jobType),
        inArray(schema.jobs.status, ['queued', 'running']),
      ),
    )
    .all();
  return active.length > 0;
}

export function resolveSchedule(jobType: ScheduleJobType, libraryId: number | null): Schedule {
  const row = db
    .select()
    .from(schema.jobSchedules)
    .where(
      and(
        eq(schema.jobSchedules.jobType, jobType),
        libraryId ? eq(schema.jobSchedules.libraryId, libraryId) : isNull(schema.jobSchedules.libraryId),
      ),
    )
    .get();

  if (libraryId) {
    // Per-library: if no explicit row or useGlobal is set, fall through to the global default.
    if (!row || row.useGlobal) return resolveSchedule(jobType, null);
    return { mode: row.mode as ScheduleMode, intervalMinutes: row.intervalMinutes };
  }
  if (!row) return { mode: 'off', intervalMinutes: 0 };
  return { mode: row.mode as ScheduleMode, intervalMinutes: row.intervalMinutes };
}

function untaggedIdsForLibrary(libraryId: number): number[] {
  return db
    .select({ id: schema.media.id })
    .from(schema.media)
    .where(and(eq(schema.media.libraryId, libraryId), isNull(schema.media.taggedAt)))
    .all()
    .map((r) => r.id);
}

function unhashedImageIdsForLibrary(libraryId: number): number[] {
  return db
    .select({ id: schema.media.id })
    .from(schema.media)
    .where(
      and(
        eq(schema.media.libraryId, libraryId),
        eq(schema.media.type, 'image'),
        isNull(schema.media.perceptualHash),
      ),
    )
    .all()
    .map((r) => r.id);
}

function libraryName(libraryId: number): string {
  const lib = db.select().from(schema.libraries).where(eq(schema.libraries.id, libraryId)).get();
  return lib?.name ?? 'Library';
}

function dispatchTagForLibrary(libraryId: number): void {
  if (!aiTaggingEnabled() || !modelReady()) return;
  const ids = untaggedIdsForLibrary(libraryId);
  if (ids.length) enqueueTagJob(ids, `AI tag: ${libraryName(libraryId)}`, libraryId);
}

function dispatchHashForLibrary(libraryId: number): void {
  const ids = unhashedImageIdsForLibrary(libraryId);
  if (ids.length) enqueueHashJob(ids, libraryId);
}

function dispatchForLibrary(jobType: ScheduleJobType, libraryId: number): void {
  if (activeJobForLibrary(jobType === 'cleanup' ? null : libraryId, jobType)) return;
  try {
    if (jobType === 'scan') enqueueScanJob(libraryId);
    else if (jobType === 'tag') dispatchTagForLibrary(libraryId);
    else if (jobType === 'hash') dispatchHashForLibrary(libraryId);
    else if (jobType === 'cleanup') enqueueCleanupJob();
  } catch (err) {
    console.error(`[job-scheduler] failed to dispatch ${jobType} for library ${libraryId}:`, err);
  }
}

/**
 * Enqueue the follow-up jobs configured to run right after a scan.
 * Called from the scan handler once indexing completes.
 */
export function dispatchAfterScan(libraryId: number): void {
  const tagSchedule = resolveSchedule('tag', libraryId);
  if (tagSchedule.mode === 'after-scan') dispatchTagForLibrary(libraryId);

  const hashSchedule = resolveSchedule('hash', libraryId);
  if (hashSchedule.mode === 'after-scan') dispatchHashForLibrary(libraryId);
}

/**
 * Manually trigger jobs for a scope now.
 * - `jobType` omitted: run every configured job for every library in scope (matches "Run all for this library").
 * - `jobType` set: run only that job type for every library in scope (matches per-type "Run all now" on globals).
 * Semantics:
 *   - scan  → always fires unless mode is 'off' (which itself means no scan wanted).
 *   - tag/hash on 'after-scan' → chained by dispatchAfterScan when the scan completes.
 *   - tag/hash on 'interval' or triggered directly → fires now.
 */
export function runAllNow(scope: 'global' | number, jobType?: ScheduleJobType): void {
  const libraryIds =
    scope === 'global'
      ? db.select({ id: schema.libraries.id }).from(schema.libraries).all().map((r) => r.id)
      : [scope];

  for (const libraryId of libraryIds) {
    if (!jobType || jobType === 'scan') {
      const scanSchedule = resolveSchedule('scan', libraryId);
      if (scanSchedule.mode !== 'off' || jobType === 'scan') {
        dispatchForLibrary('scan', libraryId);
      }
    }
    if (!jobType || jobType === 'tag') {
      const tagSchedule = resolveSchedule('tag', libraryId);
      if (jobType === 'tag' || tagSchedule.mode === 'interval') {
        dispatchForLibrary('tag', libraryId);
      }
    }
    if (!jobType || jobType === 'hash') {
      const hashSchedule = resolveSchedule('hash', libraryId);
      if (jobType === 'hash' || hashSchedule.mode === 'interval') {
        dispatchForLibrary('hash', libraryId);
      }
    }
  }

  if (scope === 'global' && (!jobType || jobType === 'cleanup')) {
    const cleanupSchedule = resolveSchedule('cleanup', null);
    if (jobType === 'cleanup' || cleanupSchedule.mode === 'interval') {
      dispatchForLibrary('cleanup', 0);
    }
  }
}

function setTimer(jobType: ScheduleJobType, libraryId: number | null, schedule: Schedule): void {
  const key = `${jobType}:${libraryId ?? 0}`;
  const existing = timers.get(key);
  if (existing) clearInterval(existing);

  if (schedule.mode !== 'interval' || schedule.intervalMinutes <= 0) {
    timers.delete(key);
    return;
  }

  const ms = schedule.intervalMinutes * 60 * 1000;
  const timer = setInterval(() => {
    if (libraryId !== null) {
      dispatchForLibrary(jobType, libraryId);
    } else {
      dispatchForLibrary(jobType, 0);
    }
  }, ms);
  timers.set(key, timer);
}

/**
 * Clear all existing timers, then arm a new one per (jobType, library) whose effective mode is `interval`.
 * Global defaults with mode `interval` apply to every library that inherits via `useGlobal` or has no row.
 */
export function scheduleAll(): void {
  for (const timer of timers.values()) clearInterval(timer);
  timers.clear();

  const libs = db.select({ id: schema.libraries.id }).from(schema.libraries).all();
  const perLibraryTypes: ScheduleJobType[] = ['scan', 'tag', 'hash'];

  for (const jobType of perLibraryTypes) {
    for (const lib of libs) {
      const schedule = resolveSchedule(jobType, lib.id);
      setTimer(jobType, lib.id, schedule);
    }
  }

  const cleanupSchedule = resolveSchedule('cleanup', null);
  setTimer('cleanup', null, cleanupSchedule);

  console.log(`[job-scheduler] initialized ${timers.size} interval timers`);
}

export function initScheduler(): void {
  scheduleAll();
}
