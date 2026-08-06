import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';
import { eq } from 'drizzle-orm';
import { THUMBS_DIR } from '../lib/config';
import { db, schema } from '../db';
import { enqueueJob, type JobHandle } from './jobQueue';

const ffmpegPath: string = (ffmpegStatic as unknown as string) ?? 'ffmpeg';

export function thumbPathFor(mediaId: number): string {
  return path.join(THUMBS_DIR, `${mediaId}.webp`);
}

export async function generateImageThumbnail(sourcePath: string, mediaId: number): Promise<string> {
  const dest = thumbPathFor(mediaId);
  await sharp(sourcePath, { animated: false })
    .rotate()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(dest);
  return dest;
}

export async function generateVideoThumbnail(
  sourcePath: string,
  mediaId: number,
  durationSeconds: number | null,
): Promise<string> {
  const dest = thumbPathFor(mediaId);
  const seek = durationSeconds && durationSeconds > 1 ? durationSeconds * 0.3 : 0;
  await new Promise<void>((resolve, reject) => {
    const args = [
      '-y',
      '-ss', seek.toFixed(2),
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
  return dest;
}

export async function generateThumbnail(
  sourcePath: string,
  mediaId: number,
  type: 'image' | 'video',
  durationSeconds: number | null,
): Promise<string> {
  return type === 'video'
    ? generateVideoThumbnail(sourcePath, mediaId, durationSeconds)
    : generateImageThumbnail(sourcePath, mediaId);
}

export function enqueueBulkThumbnailRegenerate() {
  return enqueueJob('thumbnail', 'Regenerate all thumbnails', async (job: JobHandle) => {
    const allMedia = db.select().from(schema.media).all();
    job.update({ total: allMedia.length, log: `Regenerating ${allMedia.length} thumbnails…` });
    let regenerated = 0;
    let errors = 0;

    for (let i = 0; i < allMedia.length; i++) {
      try {
        if (fs.existsSync(allMedia[i].path)) {
          await generateThumbnail(allMedia[i].path, allMedia[i].id, allMedia[i].type, allMedia[i].durationSeconds ?? null);
          regenerated++;
        }
      } catch (err) {
        errors++;
        console.error(`thumbnail regeneration failed for media ${allMedia[i].id}:`, err);
      }
      if (i % 5 === 0 || i === allMedia.length - 1) {
        job.update({ progress: i + 1, log: `Regenerated ${i + 1}/${allMedia.length} thumbnails…` });
      }
    }

    return `Completed. ${regenerated} regenerated${errors ? `, ${errors} errors` : ''}.`;
  });
}
