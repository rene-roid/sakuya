import { Router } from 'express';
import { wrap } from '../lib/http';
import { taggerStatus, enqueueModelDownload } from '../services/tagger';

export const taggerRouter = Router();

taggerRouter.get(
  '/api/tagger/status',
  wrap(async (_req, res) => {
    res.json(taggerStatus());
  }),
);

taggerRouter.post(
  '/api/tagger/download',
  wrap(async (_req, res) => {
    const status = taggerStatus();
    if (status.status === 'downloading') return res.status(409).json({ error: 'Download already running' });
    if (status.status === 'ready') return res.status(409).json({ error: 'Model already downloaded' });
    const job = enqueueModelDownload();
    res.json({ job });
  }),
);
