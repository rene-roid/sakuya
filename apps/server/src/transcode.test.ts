import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { useTestConfig, waitForJob } from './testConfig';

const dataDir = useTestConfig('transcode');

const { db, schema } = await import('./db');
const { enqueueTranscodeJob, transcodePathFor } = await import('./services/transcoder');
const { run, FFMPEG_PATH } = await import('./lib/run');

/** An indexed one-second mkv, which browsers can't play, so it always needs a transcode. */
async function mkvMedia(name: string) {
  const source = path.join(dataDir, `${name}.mkv`);
  await run(FFMPEG_PATH, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=10', source]);
  return db
    .insert(schema.media)
    .values({
      libraryId: 1,
      source: 'folder',
      path: source,
      filename: `${name}.mkv`,
      type: 'video',
      sizeBytes: fs.statSync(source).size,
      createdAt: Date.now(),
    })
    .returning()
    .get();
}

test('a video in a container browsers cannot play is transcoded to mp4', async () => {
  const media = await mkvMedia('clip');
  const row = await waitForJob(enqueueTranscodeJob([media.id], 'transcode').id);

  expect(row.log).toContain('1 transcoded');
  expect(fs.existsSync(transcodePathFor(media.id))).toBe(true);
  expect(fs.readdirSync(path.dirname(transcodePathFor(media.id))).filter((f) => f.endsWith('.part'))).toEqual([]);
});

test('two jobs transcoding the same video at once share one encode', async () => {
  // The bulk "check all videos" job has no queue key, so it can run beside a library's
  // after-scan transcode. Both used to encode into the same <id>.mp4.part.
  const media = await mkvMedia('shared');
  const [a, b] = [enqueueTranscodeJob([media.id], 'first'), enqueueTranscodeJob([media.id], 'second')];
  const rows = [await waitForJob(a.id), await waitForJob(b.id)];

  for (const row of rows) {
    expect(row.status).toBe('done');
    expect(row.log).not.toContain('error');
  }
  expect(fs.existsSync(transcodePathFor(media.id))).toBe(true);
});

test('a video whose transcode is newer than its source is not encoded again', async () => {
  const media = await mkvMedia('kept');
  await waitForJob(enqueueTranscodeJob([media.id], 'first').id);
  const before = fs.statSync(transcodePathFor(media.id)).mtimeMs;

  const again = await waitForJob(enqueueTranscodeJob([media.id], 'again').id);
  expect(again.log).toContain('0 transcoded, 1 already playable');
  expect(fs.statSync(transcodePathFor(media.id)).mtimeMs).toBe(before);
});

const { dispatchAfterScan } = await import('./services/jobScheduler');
const { jobEvents } = await import('./services/jobQueue');
const { setSetting } = await import('./lib/settings');

/** A library with two generated videos. `index` adds the next one as a scan would. */
async function videoLibrary(name: string) {
  setSetting('video_transcode_enabled', '1');
  const lib = db.insert(schema.libraries).values({ name, createdAt: Date.now() }).returning().get();
  const sources: string[] = [];
  for (const video of ['first', 'second']) {
    const source = path.join(dataDir, `${name}-${video}.mkv`);
    await run(FFMPEG_PATH, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=10', source]);
    sources.push(source);
  }
  const indexed: { id: number }[] = [];
  const index = () => {
    const source = sources[indexed.length];
    const row = db
      .insert(schema.media)
      .values({
        libraryId: lib.id,
        source: 'folder',
        path: source,
        filename: path.basename(source),
        type: 'video',
        createdAt: Date.now(),
      })
      .returning()
      .get();
    indexed.push(row);
  };
  const transcoded = async () => {
    const jobs = () =>
      db
        .select()
        .from(schema.jobs)
        .where(and(eq(schema.jobs.libraryId, lib.id), eq(schema.jobs.type, 'transcode')))
        .all();
    while (jobs().some((job) => job.status === 'queued' || job.status === 'running')) await Bun.sleep(20);
    return indexed.map((m) => fs.existsSync(transcodePathFor(m.id)));
  };
  return { lib, index, transcoded };
}

test('a video a later scan finds while a transcode of its library runs still gets transcoded', async () => {
  const { lib, index, transcoded } = await videoLibrary('running');
  const running = new Set<number>();
  let overlapped = false;
  let rescanned = false;
  const onJob = (row: { id: number; type: string; libraryId: number | null; status: string }) => {
    if (row.type !== 'transcode' || row.libraryId !== lib.id) return;
    if (row.status === 'running') running.add(row.id);
    else running.delete(row.id);
    if (running.size > 1) overlapped = true;
    if (row.status === 'running' && !rescanned) {
      rescanned = true;
      index();
      dispatchAfterScan(lib.id);
    }
  };
  jobEvents.on('job', onJob);

  index();
  dispatchAfterScan(lib.id);
  const done = await transcoded();
  jobEvents.off('job', onJob);
  expect(done).toEqual([true, true]);
  expect(overlapped).toBe(false);
});

test('a video a later scan finds while a transcode of its library waits in the queue still gets transcoded', async () => {
  const { lib, index, transcoded } = await videoLibrary('waiting');
  index();
  dispatchAfterScan(lib.id);
  index();
  dispatchAfterScan(lib.id);
  expect(await transcoded()).toEqual([true, true]);
});
