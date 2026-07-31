import { eq, and, inArray } from 'drizzle-orm';
import { db, schema } from '../db';
import { enqueueScanJob } from './scanner';

const timers = new Map<number, ReturnType<typeof setInterval>>();

function shouldSkip(libraryId: number): boolean {
  const active = db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.libraryId, libraryId),
        eq(schema.jobs.type, 'scan'),
        inArray(schema.jobs.status, ['queued', 'running']),
      ),
    )
    .all();
  return active.length > 0;
}

export function scheduleLibrary(libraryId: number, intervalMinutes: number): void {
  const existing = timers.get(libraryId);
  if (existing) clearInterval(existing);

  if (intervalMinutes <= 0) {
    timers.delete(libraryId);
    return;
  }

  const ms = intervalMinutes * 60 * 1000;
  const timer = setInterval(() => {
    if (!shouldSkip(libraryId)) {
      try {
        enqueueScanJob(libraryId);
      } catch (err) {
        console.error(`[auto-scan] failed to enqueue scan for library ${libraryId}:`, err);
      }
    }
  }, ms);
  timers.set(libraryId, timer);
}

export function initAutoScans(): void {
  const libs = db.select().from(schema.libraries).all();
  for (const lib of libs) {
    if (lib.autoScanInterval > 0) {
      scheduleLibrary(lib.id, lib.autoScanInterval);
    }
  }
  console.log(`[auto-scan] initialized timers for ${libs.filter((l) => l.autoScanInterval > 0).length} libraries`);
}
