import path from 'node:path';
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { TRANSCODES_DIR, LIMITS } from '../lib/config';
import { db, schema } from '../db';
import { probeVideo } from './scanner';
import { enqueueJob, eachWithProgress, type JobHandle } from './jobQueue';
import { run, FFMPEG_PATH } from '../lib/run';

const SAFE_CONTAINERS = new Set(['.mp4', '.webm', '.m4v']);
const SAFE_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);
const SAFE_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis']);

export function transcodePathFor(mediaId: number): string {
  return path.join(TRANSCODES_DIR, `${mediaId}.mp4`);
}

/** The path the browser should actually be served: the transcoded file if one exists, else the original. */
export function playablePathFor(mediaId: number, sourcePath: string): string {
  const transcoded = transcodePathFor(mediaId);
  return fs.existsSync(transcoded) ? transcoded : sourcePath;
}

// ponytail: extension+codec allowlist, not real container introspection; widen if a real file trips a false negative.
async function needsTranscode(filePath: string): Promise<boolean> {
  if (!SAFE_CONTAINERS.has(path.extname(filePath).toLowerCase())) return true;
  const { videoCodec, audioCodec } = await probeVideo(filePath);
  if (videoCodec && !SAFE_VIDEO_CODECS.has(videoCodec)) return true;
  if (audioCodec && !SAFE_AUDIO_CODECS.has(audioCodec)) return true;
  return false;
}

async function transcodeVideo(sourcePath: string, mediaId: number): Promise<string> {
  const dest = transcodePathFor(mediaId);
  const tmp = dest + '.part';
  await run(FFMPEG_PATH, [
    '-y',
    // Unset, this stays absent and libx264 keeps taking a thread per core, which is what it
    // did before these were configurable. Under a CPU budget it is the single biggest thing
    // to bound: a transcode is the longest-running job here and the only one that scales
    // itself across every core it can see.
    ...(LIMITS.ffmpegThreads ? ['-threads', String(LIMITS.ffmpegThreads)] : []),
    '-i', sourcePath,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    tmp,
  ]);
  fs.renameSync(tmp, dest);
  return dest;
}

async function processOne(mediaId: number): Promise<'transcoded' | 'skipped'> {
  const row = db.select().from(schema.media).where(eq(schema.media.id, mediaId)).get();
  let outcome: 'transcoded' | 'skipped' = 'skipped';
  if (row && row.type === 'video' && fs.existsSync(row.path) && (await needsTranscode(row.path))) {
    await transcodeVideo(row.path, row.id);
    outcome = 'transcoded';
  }
  db.update(schema.media).set({ transcodedAt: Date.now() }).where(eq(schema.media.id, mediaId)).run();
  return outcome;
}

export function enqueueTranscodeJob(mediaIds: number[], label: string, libraryId: number | null = null) {
  return enqueueJob(
    'transcode',
    label,
    async (job: JobHandle) => {
      job.update({ total: mediaIds.length, log: `Checking ${mediaIds.length} videos…` });
      let transcoded = 0;
      let skipped = 0;
      const errors = await eachWithProgress(
        job,
        mediaIds,
        (done, total) => `Processed ${done}/${total}…`,
        (id) => `transcode failed for media ${id}:`,
        async (id) => {
          if ((await processOne(id)) === 'transcoded') transcoded++;
          else skipped++;
        },
      );
      return `Completed. ${transcoded} transcoded, ${skipped} already playable${errors ? `, ${errors} errors` : ''}.`;
    },
    libraryId,
  );
}

export function enqueueBulkTranscodeCheck() {
  const ids = db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.type, 'video')).all();
  return enqueueTranscodeJob(
    ids.map((r) => r.id),
    'Check all videos for playback compatibility',
  );
}
