import { EventEmitter } from 'node:events';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
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

const CONCURRENCY = 2;
const queue: QueuedJob[] = [];
let running = 0;

function rowToJob(row: typeof schema.jobs.$inferSelect): Job {
  return {
    id: row.id,
    type: row.type as JobType,
    libraryId: row.libraryId,
    label: row.label,
    status: row.status,
    progress: row.progress,
    total: row.total,
    log: row.log,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function broadcast(id: number) {
  const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get();
  if (row) jobEvents.emit('job', rowToJob(row));
}

function patchJob(id: number, patch: Partial<typeof schema.jobs.$inferInsert>) {
  db.update(schema.jobs)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(schema.jobs.id, id))
    .run();
  broadcast(id);
}

function pump() {
  while (running < CONCURRENCY && queue.length > 0) {
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
  return rowToJob(inserted);
}

export function listJobs(limit = 50): Job[] {
  const rows = db.select().from(schema.jobs).all();
  return rows
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(rowToJob);
}
