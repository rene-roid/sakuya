import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { UPLOADS_DIR } from '../lib/config';
import { wrap } from '../lib/http';
import { indexFile, mediaTypeForExt } from '../services/scanner';
import { aiTaggingEnabled } from '../lib/settings';
import { enqueueTagJob, modelReady } from '../services/tagger';

export const uploadsRouter = Router();

function sanitize(name: string): string {
  return path.basename(name).replace(/[^\w.\-()\[\] ]+/g, '_').slice(-120);
}

uploadsRouter.post(
  '/api/uploads',
  wrap(async (req, res) => {
    // Buffer the raw body and let Bun's fetch primitives parse the multipart form.
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const request = new Request('http://localhost/api/uploads', {
      method: 'POST',
      headers: { 'content-type': req.headers['content-type'] ?? '' },
      body: Buffer.concat(chunks),
    });
    const form = await request.formData();

    const libraryId = Number(form.get('libraryId'));
    if (!Number.isInteger(libraryId) || libraryId <= 0) {
      return res.status(400).json({ error: 'libraryId is required' });
    }
    const files = form
      .getAll('files')
      .filter((f) => typeof f !== 'string') as unknown as Array<{ name: string; arrayBuffer(): Promise<ArrayBuffer> }>;
    if (!files.length) return res.status(400).json({ error: 'No files provided' });

    const mediaIds: number[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      if (!mediaTypeForExt(path.extname(file.name))) {
        rejected.push(file.name);
        continue;
      }
      const unique = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}-${sanitize(file.name)}`;
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
