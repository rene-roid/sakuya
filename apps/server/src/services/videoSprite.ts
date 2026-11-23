import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import sharp, { type Sharp } from 'sharp';
import { and, eq, isNull } from 'drizzle-orm';
import { THUMBS_DIR } from '../lib/config';
import { db, schema } from '../db';
import { FFMPEG_PATH } from '../lib/run';
import { thumbnailCacheEnabled } from '../lib/settings';
import { mediaIdsWhere } from '../lib/mediaByIds';
import { enqueueJob, eachWithProgress, type JobHandle } from './jobQueue';

export const SPRITE_FRAMES = 10;
/** Each frame's short side, so a frame cropped to fill a square grid card still has 240 rows. */
const FRAME_SHORT_SIDE = 240;
/** Caps the long side of very wide or tall videos; the whole strip must stay under webp's 16383px. */
const FRAME_LONG_SIDE = 640;
/**
 * Above this spacing every frame lands in its own GOP, so a keyframe-only seek is both distinct and
 * close to its slot, and it skips decoding up to a whole GOP per frame.
 */
const KEYFRAME_ONLY_INTERVAL_S = 30;
/** Up to this length one decode of the whole video beats ten seeks (measured on the fixture videos). */
const SINGLE_PASS_MAX_S = 60;
/** Hover asks for missing sprites one card at a time; this keeps a sweep across a grid from forking an encoder per card. */
const MAX_PARALLEL = 2;

type SpriteRow = Pick<typeof schema.media.$inferSelect, 'id' | 'path' | 'type' | 'durationSeconds'>;

export function spritePathFor(mediaId: number): string {
  return path.join(THUMBS_DIR, `${mediaId}.sprite.webp`);
}

export function spriteFrameTimes(durationSeconds: number, frames = SPRITE_FRAMES): number[] {
  return Array.from({ length: frames }, (_, i) => (durationSeconds * (i + 0.5)) / frames);
}

/** A sprite written after the source last changed. */
export function hasCurrentSprite(mediaId: number, sourcePath: string): boolean {
  try {
    return fs.statSync(spritePathFor(mediaId)).mtimeMs >= fs.statSync(sourcePath).mtimeMs;
  } catch {
    return false;
  }
}

export function removeSprite(mediaId: number): void {
  fs.rmSync(spritePathFor(mediaId), { force: true });
}

const SCALE = `scale=w='trunc(iw*min(${FRAME_SHORT_SIDE}/min(iw\\,ih)\\,${FRAME_LONG_SIDE}/max(iw\\,ih))/2)*2':h=-2,setsar=1`;

/** Run ffmpeg writing one PNG to stdout; resolves null when it wrote nothing. */
function ffmpegPng(args: string[]): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      FFMPEG_PATH,
      ['-v', 'error', '-threads', '1', ...args, '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const chunks: Buffer[] = [];
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => chunks.push(d));
    proc.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited with ${code}: ${stderr.slice(-300)}`));
      resolve(chunks.length ? Buffer.concat(chunks) : null);
    });
  });
}

/**
 * The whole strip from one decode pass, taking the first frame at or after each slot. Cheaper than
 * ten seeks while the video is short, since each seek decodes from its keyframe in a fresh process.
 */
function singlePassStrip(sourcePath: string, intervalSeconds: number): Promise<Buffer | null> {
  const slot = `(selected_n+0.5)*${intervalSeconds.toFixed(3)}`;
  return ffmpegPng([
    // Frames nothing else references can be dropped without corrupting the rest, which roughly
    // halves the decode.
    '-skip_frame',
    'noref',
    '-i',
    sourcePath,
    '-an',
    '-vf',
    `select='gte(t-start_t\\,${slot})',${SCALE},tile=${SPRITE_FRAMES}x1`,
    '-frames:v',
    '1',
  ]);
}

function seekFrame(sourcePath: string, seconds: number, keyframeOnly: boolean): Promise<Buffer | null> {
  return ffmpegPng([
    '-skip_frame',
    keyframeOnly ? 'nokey' : 'noref',
    ...(keyframeOnly ? ['-noaccurate_seek'] : []),
    '-ss',
    seconds.toFixed(3),
    '-i',
    sourcePath,
    '-an',
    '-vf',
    SCALE,
    '-frames:v',
    '1',
  ]);
}

async function seekStrip(sourcePath: string, durationSeconds: number): Promise<Sharp> {
  const keyframeOnly = durationSeconds / SPRITE_FRAMES >= KEYFRAME_ONLY_INTERVAL_S;
  const frames: Buffer[] = [];
  for (const t of spriteFrameTimes(durationSeconds)) {
    const frame = await seekFrame(sourcePath, t, keyframeOnly);
    // A slot past the last decodable frame repeats the previous one rather than leaving a hole.
    if (frame) frames.push(frame);
    else if (frames.length) frames.push(frames[frames.length - 1]);
  }
  if (frames.length < SPRITE_FRAMES) throw new Error('ffmpeg produced no frames');
  const { width, height } = await sharp(frames[0]).metadata();
  if (!width || !height) throw new Error('unreadable frame');
  const tiles = await Promise.all(
    frames.map(async (frame, i) => ({
      input: await sharp(frame).resize(width, height, { fit: 'cover' }).toBuffer(),
      left: i * width,
      top: 0,
    })),
  );
  return sharp({ create: { width: width * SPRITE_FRAMES, height, channels: 3, background: '#000' } }).composite(tiles);
}

async function writeSprite(sourcePath: string, durationSeconds: number, dest: string): Promise<void> {
  let strip: Sharp;
  if (durationSeconds <= SINGLE_PASS_MAX_S) {
    const png = await singlePassStrip(sourcePath, durationSeconds / SPRITE_FRAMES);
    if (!png) throw new Error('ffmpeg produced no frames');
    strip = sharp(png);
  } else {
    strip = await seekStrip(sourcePath, durationSeconds);
  }
  await strip.webp({ quality: 70 }).toFile(dest);
}

let active = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const inFlight = new Map<number, Promise<boolean>>();

/**
 * Write the sprite for one video and record it on the row. Resolves false, with `sprite_frames`
 * set to 0 so the after-scan job stops retrying, when the video yields no frames.
 *
 * Like thumbnails, concurrent calls for one id share one run and the file is renamed into place.
 */
export function generateSprite(row: SpriteRow): Promise<boolean> {
  const pending = inFlight.get(row.id);
  if (pending) return pending;
  const dest = spritePathFor(row.id);
  const tmp = `${dest}.${process.pid}.part`;
  const record = (frames: number) =>
    db
      .update(schema.media)
      .set({ spriteFrames: frames, spriteAt: Date.now() })
      .where(eq(schema.media.id, row.id))
      .run();
  const work = withSlot(async () => {
    try {
      if (row.type !== 'video' || !row.durationSeconds || row.durationSeconds <= 0) {
        throw new Error('not a video with a known duration');
      }
      await writeSprite(row.path, row.durationSeconds, tmp);
      await fs.promises.rename(tmp, dest);
      record(SPRITE_FRAMES);
      return true;
    } catch (err) {
      await fs.promises.rm(tmp, { force: true });
      console.error(`sprite generation failed for media ${row.id}:`, err);
      record(0);
      return false;
    }
  }).finally(() => inFlight.delete(row.id));
  inFlight.set(row.id, work);
  return work;
}

export async function runSpriteJob(job: JobHandle, mediaIds: number[]): Promise<string> {
  job.update({ total: mediaIds.length, log: `Making previews for ${mediaIds.length} videos…` });
  let made = 0;
  let failed = 0;
  await eachWithProgress(
    job,
    mediaIds,
    (done, total) => `Made ${done}/${total} video previews…`,
    (id) => `sprite generation failed for media ${id}:`,
    async (id) => {
      const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
      if (!row || row.type !== 'video' || !fs.existsSync(row.path)) return;
      if (await generateSprite(row)) made++;
      else failed++;
    },
  );
  return `Completed. ${made} video previews made${failed ? `, ${failed} videos without frames` : ''}.`;
}

/**
 * Queue sprites for a library's videos that have none. Ids are read when the job starts, so one
 * still waiting covers what later scans add.
 */
export function enqueueSpriteCatchUp(libraryId: number): void {
  if (!thumbnailCacheEnabled()) return;
  const pending = () =>
    mediaIdsWhere(and(eq(schema.media.type, 'video'), isNull(schema.media.spriteFrames)), libraryId);
  if (!pending().length) return;
  const lib = db
    .select({ name: schema.libraries.name })
    .from(schema.libraries)
    .where(eq(schema.libraries.id, libraryId))
    .get();
  enqueueJob(
    'thumbnail',
    `Video previews: ${lib?.name ?? 'Library'}`,
    (job) => runSpriteJob(job, pending()),
    libraryId,
    `sprite:${libraryId}`,
  );
}
