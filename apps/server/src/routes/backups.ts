import { Router } from 'express';
import type { BackupsPayload } from '@sakuya/shared';
import { wrap } from '../lib/http';
import { backupKeep } from '../lib/settings';
import { BACKUPS_DIR, enqueueBackupJob, listBackups } from '../services/backup';

export const backupsRouter = Router();

backupsRouter.get(
  '/api/backups',
  wrap(async (_req, res) => {
    const payload: BackupsPayload = { backups: listBackups(), keep: backupKeep(), dir: BACKUPS_DIR };
    res.json(payload);
  }),
);

/** Queue a backup now. Answers with the job, which a caller polls through /api/jobs until it is done. */
backupsRouter.post(
  '/api/backups',
  wrap(async (_req, res) => {
    res.status(202).json(enqueueBackupJob());
  }),
);
