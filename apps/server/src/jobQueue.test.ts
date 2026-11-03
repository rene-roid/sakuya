import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { useTestConfig } from './testConfig';

useTestConfig('jobqueue');

const { db, schema } = await import('./db');
const { enqueueJob, listJobs } = await import('./services/jobQueue');

const status = (id: number) => db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get()!.status;

async function settled(id: number) {
  for (let i = 0; i < 200 && !['done', 'error'].includes(status(id)); i++) await Bun.sleep(5);
  return status(id);
}

test('the job list is newest first and capped at the limit', () => {
  for (const label of ['first', 'second', 'third']) enqueueJob('cleanup', label, async () => {});
  expect(listJobs(2).map((job) => job.label)).toEqual(['third', 'second']);
});

test('a job whose body throws before returning a promise fails and frees its key', async () => {
  // What enqueueCatchUp's body does when reading the pending ids throws: it is not async, so the
  // error is thrown from the call itself rather than through a rejected promise.
  const throwsSync = (): Promise<string> => {
    throw new Error('pending ids unavailable');
  };
  const broken = enqueueJob('tag', 'throws synchronously', throwsSync, null, 'tag:sync-throw');
  expect(await settled(broken.id)).toBe('error');

  const next = enqueueJob('tag', 'same key afterwards', async () => 'ran', null, 'tag:sync-throw');
  expect(await settled(next.id)).toBe('done');
});
