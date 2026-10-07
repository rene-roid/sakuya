import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { useTestConfig } from './testConfig';

const dataDir = useTestConfig('transcode');

const { db, schema } = await import('./db');
const { enqueueTranscodeJob, transcodePathFor } = await import('./services/transcoder');
const { run, FFMPEG_PATH } = await import('./lib/run');

test('a video in a container browsers cannot play is transcoded to mp4', async () => {
  const source = path.join(dataDir, 'clip.mkv');
  await run(FFMPEG_PATH, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=10', source]);
  const media = db
    .insert(schema.media)
    .values({
      libraryId: 1,
      source: 'folder',
      path: source,
      filename: 'clip.mkv',
      type: 'video',
      sizeBytes: fs.statSync(source).size,
      createdAt: Date.now(),
    })
    .returning()
    .get();

  const job = enqueueTranscodeJob([media.id], 'transcode');
  let row;
  do {
    await Bun.sleep(20);
    row = db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get()!;
  } while (row.status !== 'done' && row.status !== 'error');

  expect(row.log).toContain('1 transcoded');
  expect(fs.existsSync(transcodePathFor(media.id))).toBe(true);
  expect(fs.readdirSync(path.dirname(transcodePathFor(media.id))).filter((f) => f.endsWith('.part'))).toEqual([]);
});
