import { Router } from 'express';
import { wrap } from '../lib/http';
import { taggerStatus, enqueueModelDownload, enqueueTagJob, modelReady, untaggedMediaIds } from '../services/tagger';

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

taggerRouter.post(
  '/api/tagger/tag-all',
  wrap(async (_req, res) => {
    if (!modelReady()) return res.status(409).json({ error: 'Tagger model not downloaded' });
    const ids = untaggedMediaIds();
    if (!ids.length) return res.status(409).json({ error: 'No untagged files' });
    const job = enqueueTagJob(ids, `AI tag all (${ids.length} files)`);
    res.json({ job });
  }),
);
