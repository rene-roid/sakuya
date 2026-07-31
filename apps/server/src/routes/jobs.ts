import { Router } from 'express';
import { wrap } from '../lib/http';
import { listJobs, jobEvents } from '../services/jobQueue';
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
