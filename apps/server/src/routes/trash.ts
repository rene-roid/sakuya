import { Router } from 'express';
import { intParam, wrap } from '../lib/http';
import { deleteFromTrash, emptyTrash, listTrash, restoreFromTrash, trashThumbPath } from '../services/trash';

// TrashError carries a status, which the app's error handler answers with.
export const trashRouter = Router();

trashRouter.get(
  '/api/trash',
  wrap(async (_req, res) => {
    res.json(listTrash());
  }),
);

trashRouter.get(
  '/api/trash/:id/thumb',
  wrap(async (req, res) => {
    const file = trashThumbPath(intParam(req.params.id));
    if (!file) return res.status(404).json({ error: 'No preview' });
    res.sendFile(file);
  }),
);

trashRouter.post(
  '/api/trash/:id/restore',
  wrap(async (req, res) => {
    res.json(await restoreFromTrash(intParam(req.params.id)));
  }),
);

trashRouter.delete(
  '/api/trash/:id',
  wrap(async (req, res) => {
    res.json(deleteFromTrash(intParam(req.params.id)));
  }),
);

trashRouter.delete(
  '/api/trash',
  wrap(async (_req, res) => {
    res.json(emptyTrash());
  }),
);
