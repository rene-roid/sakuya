import { expect, test } from 'bun:test';
import { useTestConfig } from './testConfig';

useTestConfig('jobqueue');

const { enqueueJob, listJobs } = await import('./services/jobQueue');

test('the job list is newest first and capped at the limit', () => {
  for (const label of ['first', 'second', 'third']) enqueueJob('cleanup', label, async () => {});
  expect(listJobs(2).map((job) => job.label)).toEqual(['third', 'second']);
});
