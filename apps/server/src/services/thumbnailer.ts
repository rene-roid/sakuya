import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';
import { eq } from 'drizzle-orm';
import { THUMBS_DIR } from '../lib/config';
import { db, schema } from '../db';
import { enqueueJob, type JobHandle } from './jobQueue';
import { mediaRowsByIds, type MediaRow } from '../lib/mediaByIds';

const ffmpegPath: string = (ffmpegStatic as unknown as string) ?? 'ffmpeg';

export function thumbPathFor(mediaId: number): string {
  return path.join(THUMBS_DIR, `${mediaId}.webp`);
}

/** Extract a single frame as a webp — used for video thumbnails, and as a fallback for images sharp can't decode. */
async function ffmpegFrameToWebp(sourcePath: string, dest: string, seekSeconds: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const args = [
      '-y',
      // Extracting a single frame doesn't benefit from multi-threaded decode;
      // capping this keeps bulk regeneration from eating every core and
      // starving request handling / other services on the host.
      '-threads', '1',
      '-ss', seekSeconds.toFixed(2),
      '-i', sourcePath,
      '-frames:v', '1',
      '-vf', 'scale=512:-2',
      '-f', 'webp',
      dest,
    ];
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(dest)) resolve();
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.slice(-300)}`));
    });
  });
}

async function generateImageThumbnail(sourcePath: string, dest: string): Promise<void> {
  try {
    await sharp(sourcePath, { animated: false })
      .rotate()
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(dest);
  } catch {
    // sharp/libvips can't decode this format — fall back to ffmpeg, which reads far more formats.
    await ffmpegFrameToWebp(sourcePath, dest, 0);
  }
}

async function generateVideoThumbnail(sourcePath: string, dest: string, durationSeconds: number | null): Promise<void> {
  const seek = durationSeconds && durationSeconds > 1 ? durationSeconds * 0.3 : 0;
  await ffmpegFrameToWebp(sourcePath, dest, seek);
}

const inFlight = new Map<number, Promise<string>>();

/**
 * Concurrent calls for one media id share a single generation. A grid and a dashboard row asking
 * for the same missing thumbnail used to start two encoders writing the same file, and whichever
 * request finished first could send the other's half-written output.
 *
 * Output goes to a temp name and is renamed into place, so a request serving the thumbnail
 * mid-regeneration sends the old file or the new one, never a truncated mix.
 */
export function generateThumbnail(
  sourcePath: string,
  mediaId: number,
  type: 'image' | 'video',
  durationSeconds: number | null,
): Promise<string> {
  const pending = inFlight.get(mediaId);
  if (pending) return pending;
  const dest = thumbPathFor(mediaId);
  const tmp = `${dest}.${process.pid}.part`;
  const work = (async () => {
    try {
      if (type === 'video') await generateVideoThumbnail(sourcePath, tmp, durationSeconds);
      else await generateImageThumbnail(sourcePath, tmp);
      await fs.promises.rename(tmp, dest);
      return dest;
    } catch (err) {
      await fs.promises.rm(tmp, { force: true });
      throw err;
    } finally {
      inFlight.delete(mediaId);
    }
  })();
  inFlight.set(mediaId, work);
  return work;
}

/** Shared worker for both "regenerate everything" and "regenerate this selection". */
function regenerateJob(label: string, rows: (typeof schema.media.$inferSelect)[], libraryId: number | null = null) {
  return enqueueJob('thumbnail', label, async (job: JobHandle) => {
    job.update({ total: rows.length, log: `Regenerating ${rows.length} thumbnails…` });
    let regenerated = 0;
    let errors = 0;

    for (let i = 0; i < rows.length; i++) {
      try {
        if (fs.existsSync(rows[i].path)) {
          await generateThumbnail(rows[i].path, rows[i].id, rows[i].type, rows[i].durationSeconds ?? null);
          db.update(schema.media).set({ thumbnailPath: thumbPathFor(rows[i].id) }).where(eq(schema.media.id, rows[i].id)).run();
          regenerated++;
        }
      } catch (err) {
        errors++;
        console.error(`thumbnail regeneration failed for media ${rows[i].id}:`, err);
      }
      if (i % 5 === 0 || i === rows.length - 1) {
        job.update({ progress: i + 1, log: `Regenerated ${i + 1}/${rows.length} thumbnails…` });
      }
    }

    return `Completed. ${regenerated} regenerated${errors ? `, ${errors} errors` : ''}.`;
  }, libraryId);
}

export function enqueueBulkThumbnailRegenerate() {
  return regenerateJob('Regenerate all thumbnails', db.select().from(schema.media).all());
}

/** Regenerate thumbnails for an explicit selection (bulk action in the grid). */
export function enqueueThumbnailRegenerate(mediaIds: number[], libraryId: number | null = null) {
  // One query per chunk rather than one per id: bulk regeneration is routinely handed
  // thousands of ids, and the per-id lookup dominated the enqueue.
  const byId = mediaRowsByIds(mediaIds);
  const rows = mediaIds.map((id) => byId.get(id)).filter((row): row is MediaRow => !!row);
  return regenerateJob(`Regenerate ${rows.length} thumbnail${rows.length === 1 ? '' : 's'}`, rows, libraryId);
}
