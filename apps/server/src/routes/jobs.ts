import { Router } from 'express';
import { z } from 'zod';
import { wrap } from '../lib/http';
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
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`data: ${JSON.stringify({ type: 'snapshot', jobs: listJobs() })}\n\n`);

  const onJob = (job: Job) => {
    res.write(`data: ${JSON.stringify({ type: 'job', job })}\n\n`);
  };
  jobEvents.on('job', onJob);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    jobEvents.off('job', onJob);
  });
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
