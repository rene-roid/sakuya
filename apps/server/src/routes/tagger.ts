import { Router } from 'express';
import { z } from 'zod';
import { wrap } from '../lib/http';
import {
  taggerStatus,
  enqueueModelDownload,
  enqueueTagJob,
  modelReady,
  untaggedMediaIds,
  selectModel,
  enqueueHashJob,
  unhashedImageIds,
} from '../services/tagger';
import { MODEL_REGISTRY } from '../lib/config';
import type { TaggerModel } from '@sakuya/shared';

export const taggerRouter = Router();

taggerRouter.get(
  '/api/tagger/status',
  wrap(async (_req, res) => {
    res.json(taggerStatus());
  }),
);

taggerRouter.get(
  '/api/tagger/models',
  wrap(async (_req, res) => {
    const models: TaggerModel[] = MODEL_REGISTRY.map((m) => ({ id: m.id, label: m.label, repo: m.repo }));
    res.json(models);
  }),
);

const selectSchema = z.object({ modelId: z.string().min(1) });

taggerRouter.post(
  '/api/tagger/select',
  wrap(async (req, res) => {
    const { modelId } = selectSchema.parse(req.body);
    selectModel(modelId);
    res.json(taggerStatus());
  }),
);

taggerRouter.post(
  '/api/tagger/hash-all',
  wrap(async (_req, res) => {
    const ids = unhashedImageIds();
    if (!ids.length) return res.status(409).json({ error: 'No images need hashing' });
    const job = enqueueHashJob(ids);
    res.json({ job });
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
