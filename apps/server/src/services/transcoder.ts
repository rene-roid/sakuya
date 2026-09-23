import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { eq } from 'drizzle-orm';
import { TRANSCODES_DIR, LIMITS } from '../lib/config';
import { db, schema } from '../db';
import { probeVideo } from './scanner';
import { enqueueJob, type JobHandle } from './jobQueue';

const ffmpegPath: string = (ffmpegStatic as unknown as string) ?? 'ffmpeg';

/** Comfortably more than the 300 characters reported on failure, small enough to never matter. */
const STDERR_TAIL = 4_000;

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
  await new Promise<void>((resolve, reject) => {
    const args = [
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
    ];
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    // Keep only the tail: ffmpeg emits a progress line every few hundred ms and transcoding a
    // large video runs for hours, so appending the whole stream grew a string for the life of
    // the job when all that is ever read back is the last few hundred characters.
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr = (stderr + d).slice(-STDERR_TAIL)));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(tmp)) resolve();
      else reject(new Error(`ffmpeg transcode exited with ${code}: ${stderr.slice(-300)}`));
    });
  });
  fs.renameSync(tmp, dest);
  return dest;
}

async function processOne(mediaId: number): Promise<'transcoded' | 'skipped'> {
  const row = db.select().from(schema.media).where(eq(schema.media.id, mediaId)).get();
  if (!row || row.type !== 'video' || !fs.existsSync(row.path)) {
    db.update(schema.media).set({ transcodedAt: Date.now() }).where(eq(schema.media.id, mediaId)).run();
    return 'skipped';
  }
  let outcome: 'transcoded' | 'skipped' = 'skipped';
  if (await needsTranscode(row.path)) {
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
      let errors = 0;
      for (let i = 0; i < mediaIds.length; i++) {
        try {
          if ((await processOne(mediaIds[i])) === 'transcoded') transcoded++;
          else skipped++;
        } catch (err) {
          errors++;
          console.error(`transcode failed for media ${mediaIds[i]}:`, err);
        }
        job.update({ progress: i + 1, log: `Processed ${i + 1}/${mediaIds.length}…` });
      }
      return `Completed. ${transcoded} transcoded, ${skipped} already playable${errors ? `, ${errors} errors` : ''}.`;
    },
    libraryId,
  );
}

export function enqueueBulkTranscodeCheck() {
  return enqueueJob('transcode', 'Check all videos for playback compatibility', async (job: JobHandle) => {
    const allVideos = db
      .select({ id: schema.media.id })
      .from(schema.media)
      .where(eq(schema.media.type, 'video'))
      .all();
    job.update({ total: allVideos.length, log: `Checking ${allVideos.length} videos…` });
    let transcoded = 0;
    let skipped = 0;
    let errors = 0;
    for (let i = 0; i < allVideos.length; i++) {
      try {
        if ((await processOne(allVideos[i].id)) === 'transcoded') transcoded++;
        else skipped++;
      } catch (err) {
        errors++;
        console.error(`transcode failed for media ${allVideos[i].id}:`, err);
      }
      if (i % 5 === 0 || i === allVideos.length - 1) {
        job.update({ progress: i + 1, log: `Checked ${i + 1}/${allVideos.length}…` });
      }
    }
    return `Completed. ${transcoded} transcoded, ${skipped} already playable${errors ? `, ${errors} errors` : ''}.`;
  });
}
