import { Router } from 'express';
import { wrap } from '../lib/http';
import { enqueueEmbeddingJob, semanticStatus, unembeddedMediaIds } from '../services/semantic';
import { clipModelsReady, enqueueClipModelDownload } from '../services/semanticModels';

export const semanticRouter = Router();

semanticRouter.get(
  '/api/semantic/status',
  wrap(async (_req, res) => {
    res.json(semanticStatus());
  }),
);

semanticRouter.post(
  '/api/semantic/download',
  wrap(async (_req, res) => {
    const { status } = semanticStatus();
    if (status === 'downloading') return res.status(409).json({ error: 'Download already running' });
    if (status === 'ready') return res.status(409).json({ error: 'Search model already downloaded' });
    res.json({ job: enqueueClipModelDownload() });
  }),
);

semanticRouter.post(
  '/api/semantic/run',
  wrap(async (_req, res) => {
    if (!clipModelsReady()) return res.status(409).json({ error: 'Search model not downloaded' });
    const ids = unembeddedMediaIds();
    if (!ids.length) return res.status(409).json({ error: 'Every file is already indexed' });
    res.json({ job: enqueueEmbeddingJob(ids, `Index for search (${ids.length} files)`) });
  }),
);
