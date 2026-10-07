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
  key?: string;
}

const queue: QueuedJob[] = [];
let running = 0;
const runningKeys = new Set<string>();

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
  while (running < LIMITS.jobConcurrency) {
    const index = queue.findIndex((job) => !job.key || !runningKeys.has(job.key));
    if (index === -1) return;
    const [next] = queue.splice(index, 1);
    running++;
    if (next.key) runningKeys.add(next.key);
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
        if (next.key) runningKeys.delete(next.key);
        pump();
      });
  }
}

/**
 * Jobs that share a `key` never run at the same time. Asking for a key that is already waiting in
 * the queue returns that job, since it has not started and will see the same state.
 */
export function enqueueJob(
  type: JobType,
  label: string,
  fn: JobFn,
  libraryId: number | null = null,
  key?: string,
): Job {
  const waiting = key && queue.find((job) => job.key === key);
  if (waiting) return db.select().from(schema.jobs).where(eq(schema.jobs.id, waiting.id)).get()!;
  const now = Date.now();
  const inserted = db
    .insert(schema.jobs)
    .values({ type, label, libraryId, status: 'queued', log: 'Queued…', createdAt: now, updatedAt: now })
    .returning()
    .get();
  queue.push({ id: inserted.id, fn, key });
  broadcast(inserted.id);
  queueMicrotask(pump);
  return inserted;
}

export function listJobs(limit = 50): Job[] {
  // Ordering and slicing belong in SQL: this used to pull the entire jobs table into JS and sort
  // it there to hand back 50 rows, and jobs is append-only, so the cost grew with every scan.
  // By id rather than created_at: ids are AUTOINCREMENT and assigned at enqueue, the same moment
  // created_at is stamped, so the order matches and the rowid walk needs no sort over the table.
  return db.select().from(schema.jobs).orderBy(desc(schema.jobs.id)).limit(limit).all();
}

/**
 * Run `fn` over every item, logging and counting failures rather than aborting on the first one,
 * with a progress update every `every` items. Resolves with the number of failures.
 */
export async function eachWithProgress<T>(
  job: JobHandle,
  items: T[],
  progressLog: (done: number, total: number) => string,
  failMsg: (item: T) => string,
  fn: (item: T) => Promise<unknown>,
  every = 5,
): Promise<number> {
  let errors = 0;
  for (let i = 0; i < items.length; i++) {
    try {
      await fn(items[i]);
    } catch (err) {
      errors++;
      console.error(failMsg(items[i]), err);
    }
    if (i % every === 0 || i === items.length - 1) {
      job.update({ progress: i + 1, log: progressLog(i + 1, items.length) });
    }
  }
  return errors;
}
