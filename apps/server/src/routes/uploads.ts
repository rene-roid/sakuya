import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { UPLOADS_DIR } from '../lib/config';
import { wrap, readFormData, formFiles, sanitizeFilename } from '../lib/http';
import { indexFile, mediaTypeForExt } from '../services/scanner';
import { aiTaggingEnabled } from '../lib/settings';
import { enqueueTagJob, modelReady } from '../services/tagger';

export const uploadsRouter = Router();

uploadsRouter.post(
  '/api/uploads',
  wrap(async (req, res) => {
    const form = await readFormData(req);

    const libraryId = Number(form.get('libraryId'));
    if (!Number.isInteger(libraryId) || libraryId <= 0) {
      return res.status(400).json({ error: 'libraryId is required' });
    }
    const files = formFiles(form, 'files');
    if (!files.length) return res.status(400).json({ error: 'No files provided' });

    const mediaIds: number[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      if (!mediaTypeForExt(path.extname(file.name))) {
        rejected.push(file.name);
        continue;
      }
      const unique = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}-${sanitizeFilename(file.name)}`;
      const dest = path.join(UPLOADS_DIR, unique);
      await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()));
      try {
        const id = await indexFile(dest, libraryId, 'upload');
        if (id !== null) mediaIds.push(id);
      } catch (err) {
        rejected.push(file.name);
        await fs.unlink(dest).catch(() => {});
        console.error(`upload index failed for ${file.name}:`, err);
      }
    }

    if (mediaIds.length && aiTaggingEnabled() && modelReady()) {
      enqueueTagJob(mediaIds, `AI tag: ${mediaIds.length} uploads`, libraryId);
    }
    res.status(201).json({ mediaIds, rejected });
  }),
);
