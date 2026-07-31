import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';
import { THUMBS_DIR } from '../lib/config';

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
