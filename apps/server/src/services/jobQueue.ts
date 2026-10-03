import { EventEmitter } from 'node:events';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../db';
import { LIMITS } from '../lib/config';
import type { Job, JobType } from '@sakuya/shared';

export const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(100);

export interface JobHandle {
  id: number;
  update(patch: { progress?: number; total?: number; log?: string }): void;
}

type JobFn = (job: JobHandle) => Promise<string | void>;

interface QueuedJob {
  id: number;
  fn: JobFn;
}

const queue: QueuedJob[] = [];
let running = 0;

function broadcast(id: number) {
  const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get();
  if (row) jobEvents.emit('job', row);
}

function patchJob(id: number, patch: Partial<typeof schema.jobs.$inferInsert>) {
  db.update(schema.jobs)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(schema.jobs.id, id))
    .run();
  broadcast(id);
}

function pump() {
  while (running < LIMITS.jobConcurrency && queue.length > 0) {
    const next = queue.shift()!;
    running++;
    patchJob(next.id, { status: 'running' });
    const handle: JobHandle = {
      id: next.id,
      update(patch) {
        patchJob(next.id, patch);
      },
    };
    next
      .fn(handle)
      .then((finalLog) => {
        const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, next.id)).get();
        patchJob(next.id, {
          status: 'done',
          progress: row?.total || row?.progress || 100,
          log: finalLog ?? row?.log ?? 'Completed.',
        });
      })
      .catch((err) => {
        console.error(`[job ${next.id}] failed:`, err);
        patchJob(next.id, { status: 'error', log: `Error: ${err?.message ?? err}` });
      })
      .finally(() => {
        running--;
        pump();
      });
  }
}

export function enqueueJob(
  type: JobType,
  label: string,
  fn: JobFn,
  libraryId: number | null = null,
): Job {
  const now = Date.now();
  const inserted = db
    .insert(schema.jobs)
    .values({ type, label, libraryId, status: 'queued', log: 'Queued…', createdAt: now, updatedAt: now })
    .returning()
    .get();
  queue.push({ id: inserted.id, fn });
  broadcast(inserted.id);
  queueMicrotask(pump);
  return inserted;
}

export function listJobs(limit = 50): Job[] {
  // Ordering and slicing belong in SQL: this used to pull the entire jobs table into JS and sort
  // it there to hand back 50 rows, and jobs is append-only, so the cost grew with every scan.
  return db.select().from(schema.jobs).orderBy(desc(schema.jobs.createdAt)).limit(limit).all();
}

/**
 * Run `fn` over every item, logging and counting failures rather than aborting on the first one,
 * with a progress update every 5 items. Resolves with the number of failures.
 */
export async function eachWithProgress<T>(
  job: JobHandle,
  items: T[],
  progressLog: (done: number, total: number) => string,
  failMsg: (item: T) => string,
  fn: (item: T) => Promise<unknown>,
): Promise<number> {
  let errors = 0;
  for (let i = 0; i < items.length; i++) {
    try {
      await fn(items[i]);
    } catch (err) {
      errors++;
      console.error(failMsg(items[i]), err);
    }
    if (i % 5 === 0 || i === items.length - 1) {
      job.update({ progress: i + 1, log: progressLog(i + 1, items.length) });
    }
  }
  return errors;
}
