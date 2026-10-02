import { Router } from 'express';
import { z } from 'zod';
import { wrap, openEventStream } from '../lib/http';
import { listJobs, jobEvents } from '../services/jobQueue';
import { runAllNow } from '../services/jobScheduler';
import type { Job } from '@sakuya/shared';

export const jobsRouter = Router();

jobsRouter.get(
  '/api/jobs',
  wrap(async (_req, res) => {
    res.json(listJobs());
  }),
);

jobsRouter.get('/api/jobs/stream', (req, res) => {
  const stream = openEventStream(req, res);
  stream.send({ type: 'snapshot', jobs: listJobs() });

  const onJob = (job: Job) => stream.send({ type: 'job', job });
  jobEvents.on('job', onJob);
  stream.onClose(() => jobEvents.off('job', onJob));
});

jobsRouter.post(
  '/api/jobs/run-now',
  wrap(async (req, res) => {
    const body = z
      .object({
        scope: z.union([z.literal('global'), z.object({ libraryId: z.number() })]),
        jobType: z.enum(['scan', 'tag', 'hash', 'cleanup']).optional(),
      })
      .parse(req.body);

    runAllNow(body.scope === 'global' ? 'global' : body.scope.libraryId, body.jobType);
    res.json({ ok: true });
  }),
);
