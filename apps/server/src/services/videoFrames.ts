import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { DATA_DIR } from '../lib/config';
import { run, FFMPEG_PATH } from '../lib/run';
import { computeDHash, hammingDistance } from './perceptualHash';

/** Per-process scratch for extracted frames, inside the data dir so a boot can sweep what a crash left. */
const FRAMES_DIR = path.join(DATA_DIR, 'video-frames');

/** Intros and outros are often black or a title card; frames inside this margin are skipped. */
const EDGE_SECONDS = 1;
/** Closer than this, two samples are usually the same picture and only cost another inference. */
const MIN_SPACING_SECONDS = 0.5;

/**
 * Where to grab `count` frames from a video `durationSeconds` long: evenly spaced, each in the
 * middle of its share of the video, skipping the first and last second when the video is long
 * enough to spare them. Short videos get fewer frames; an unknown duration gets none.
 */
export function frameTimes(durationSeconds: number | null, count: number): number[] {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || count < 1) return [];
  const margin = durationSeconds >= EDGE_SECONDS * 2 + MIN_SPACING_SECONDS * 2 ? EDGE_SECONDS : 0;
  const window = durationSeconds - margin * 2;
  const n = Math.max(1, Math.min(count, Math.floor(window / MIN_SPACING_SECONDS)));
  return Array.from({ length: n }, (_, i) => Math.round((margin + (window * (i + 0.5)) / n) * 100) / 100);
}

/** dHash distance at or under which two frames have the same layout; the "similar images" cut-off. */
const SAME_LAYOUT_DISTANCE = 10;
/** dHash ignores colour, so a red and a blue frame of one layout also need their mean colours this close (0-255). */
const SAME_COLOUR_DISTANCE = 24;

export interface FrameSignature {
  hash: string;
  /** Mean red, green and blue. */
  mean: [number, number, number];
}

export async function frameSignature(imagePath: string): Promise<FrameSignature> {
  const { channels } = await sharp(imagePath).stats();
  return { hash: await computeDHash(imagePath), mean: [channels[0].mean, channels[1].mean, channels[2].mean] };
}

function sameFrame(a: FrameSignature, b: FrameSignature): boolean {
  return (
    hammingDistance(a.hash, b.hash) <= SAME_LAYOUT_DISTANCE &&
    a.mean.every((v, i) => Math.abs(v - b.mean[i]) <= SAME_COLOUR_DISTANCE)
  );
}

/**
 * Indexes of the frames worth running the tagger on: each frame unless it looks like one already
 * kept. A still or single-scene video would otherwise pay five inferences for one picture's tags.
 */
export function distinctFrames(signatures: FrameSignature[]): number[] {
  const kept: number[] = [];
  for (const [i, signature] of signatures.entries()) {
    if (!kept.some((k) => sameFrame(signatures[k], signature))) kept.push(i);
  }
  return kept;
}

/** Remove frame folders a killed process left behind. */
export function clearStaleFrames(): void {
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
}

/**
 * Extract one frame per time into a fresh temp folder, hand their paths to `use`, then delete the
 * folder. A time ffmpeg can't decode (past a truncated end, a broken keyframe) is skipped, so
 * `use` can receive fewer paths than times, or none.
 */
export async function withVideoFrames<T>(
  sourcePath: string,
  times: number[],
  use: (framePaths: string[]) => Promise<T>,
): Promise<T> {
  await fsp.mkdir(FRAMES_DIR, { recursive: true });
  const dir = await fsp.mkdtemp(path.join(FRAMES_DIR, 'f-'));
  try {
    const frames: string[] = [];
    for (const [i, t] of times.entries()) {
      const dest = path.join(dir, `${i}.png`);
      try {
        // One thread, one frame at a time: the same budget as thumbnail extraction, so a tag job
        // over a video folder never runs more decoders than a thumbnail job would.
        await run(FFMPEG_PATH, [
          '-v',
          'error',
          '-threads',
          '1',
          '-ss',
          t.toFixed(2),
          '-i',
          sourcePath,
          '-frames:v',
          '1',
          '-vf',
          'scale=640:640:force_original_aspect_ratio=decrease',
          '-y',
          dest,
        ]);
      } catch {
        continue;
      }
      if (fs.existsSync(dest)) frames.push(dest);
    }
    return await use(frames);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}
