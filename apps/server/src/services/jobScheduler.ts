import { eq, and, inArray, isNull } from 'drizzle-orm';
import type { JobSchedule, ScheduleJobType } from '@sakuya/shared';
import { db, schema } from '../db';
import { enqueueScanJob } from './scanner';
import { runTagJob, runHashJob, modelReady, untaggedMediaIds, unhashedImageIds } from './tagger';
import { enqueueCleanupJob } from './cleanup';
import { runTranscodeJob } from './transcoder';
import { enqueueJob, type JobHandle } from './jobQueue';
import { aiTaggingEnabled, videoTranscodeEnabled } from '../lib/settings';
import { mediaIdsWhere } from '../lib/mediaByIds';

const timers = new Map<string, ReturnType<typeof setInterval>>();
const PER_LIBRARY_TYPES: ScheduleJobType[] = ['scan', 'tag', 'hash'];

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

export function resolveSchedule(jobType: ScheduleJobType, libraryId: number | null): JobSchedule {
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
    return { mode: row.mode, intervalMinutes: row.intervalMinutes };
  }
  if (!row) return { mode: 'off', intervalMinutes: 0 };
  return { mode: row.mode, intervalMinutes: row.intervalMinutes };
}

function libraryName(libraryId: number): string {
  const lib = db.select().from(schema.libraries).where(eq(schema.libraries.id, libraryId)).get();
  return lib?.name ?? 'Library';
}

/**
 * Queue a job that brings one library up to date. It reads the pending ids when it starts, not when
 * it is queued, so one still waiting covers what later scans index. One per library and type runs
 * at a time, so the next one starts after the current one has marked its ids done.
 */
function enqueueCatchUp(
  jobType: 'tag' | 'hash' | 'transcode',
  label: string,
  libraryId: number,
  pending: () => number[],
  run: (job: JobHandle, ids: number[]) => Promise<string>,
): void {
  if (!pending().length) return;
  enqueueJob(
    jobType,
    `${label}: ${libraryName(libraryId)}`,
    (job) => run(job, pending()),
    libraryId,
    `${jobType}:${libraryId}`,
  );
}

function dispatchTagForLibrary(libraryId: number): void {
  if (!aiTaggingEnabled() || !modelReady()) return;
  enqueueCatchUp('tag', 'AI tag', libraryId, () => untaggedMediaIds(libraryId), runTagJob);
}

function dispatchHashForLibrary(libraryId: number): void {
  enqueueCatchUp('hash', 'Compute image hashes', libraryId, () => unhashedImageIds(libraryId), runHashJob);
}

function dispatchTranscodeForLibrary(libraryId: number): void {
  if (!videoTranscodeEnabled()) return;
  const pending = () =>
    mediaIdsWhere(and(eq(schema.media.type, 'video'), isNull(schema.media.transcodedAt)), libraryId);
  enqueueCatchUp('transcode', 'Transcode', libraryId, pending, runTranscodeJob);
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

  dispatchTranscodeForLibrary(libraryId);
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
    for (const type of PER_LIBRARY_TYPES) {
      if (jobType && jobType !== type) continue;
      const { mode } = resolveSchedule(type, libraryId);
      // A scan runs whenever it isn't switched off; tag/hash only on their own interval (on
      // 'after-scan' they ride along with the scan instead).
      if (jobType === type || (type === 'scan' ? mode !== 'off' : mode === 'interval')) {
        dispatchForLibrary(type, libraryId);
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

function setTimer(jobType: ScheduleJobType, libraryId: number | null, schedule: JobSchedule): void {
  const key = `${jobType}:${libraryId ?? 0}`;
  const existing = timers.get(key);
  if (existing) clearInterval(existing);

  if (schedule.mode !== 'interval' || schedule.intervalMinutes <= 0) {
    timers.delete(key);
    return;
  }

  const ms = schedule.intervalMinutes * 60 * 1000;
  timers.set(key, setInterval(() => dispatchForLibrary(jobType, libraryId ?? 0), ms));
}

/**
 * Clear all existing timers, then arm a new one per (jobType, library) whose effective mode is `interval`.
 * Global defaults with mode `interval` apply to every library that inherits via `useGlobal` or has no row.
 */
export function scheduleAll(): void {
  for (const timer of timers.values()) clearInterval(timer);
  timers.clear();

  const libs = db.select({ id: schema.libraries.id }).from(schema.libraries).all();

  for (const jobType of PER_LIBRARY_TYPES) {
    for (const lib of libs) {
      const schedule = resolveSchedule(jobType, lib.id);
      setTimer(jobType, lib.id, schedule);
    }
  }

  const cleanupSchedule = resolveSchedule('cleanup', null);
  setTimer('cleanup', null, cleanupSchedule);

  console.log(`[job-scheduler] initialized ${timers.size} interval timers`);
}
