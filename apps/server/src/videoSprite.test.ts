import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { Media, MediaListResponse, TrashPayload } from '@sakuya/shared';
import { useTestConfig, waitForJob } from './testConfig';

const PORT = 38977; // V02
const dataDir = useTestConfig('sprite', { port: PORT });
const BASE = `http://localhost:${PORT}`;

const { sqlite } = await import('./db');
const { run, FFMPEG_PATH } = await import('./lib/run');
const { spritePathFor } = await import('./services/videoSprite');
const { performCleanup } = await import('./services/cleanup');
const { THUMBS_DIR } = await import('./lib/config');
await import('./index');

const root = path.join(dataDir, 'library');
fs.mkdirSync(root);

const send = (method: string, url: string, body?: unknown) =>
  fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** testsrc draws a moving pattern and a frame counter, so every sampled frame differs. */
async function writeVideo(name: string, size: string, seconds: number, rate = 10) {
  const out = path.join(root, name);
  const tmp = path.join(dataDir, `tmp-${name}`);
  await run(FFMPEG_PATH, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc=duration=${seconds}:size=${size}:rate=${rate}`,
    // A keyframe every two seconds, like most real encodes, so keyframe-only seeks land near their slot.
    '-g',
    String(rate * 2),
    '-pix_fmt',
    'yuv420p',
    '-f',
    'mp4',
    tmp,
  ]);
  fs.renameSync(tmp, out);
}

const lib = (await (await send('POST', '/api/libraries', { name: 'Sprites' })).json()) as { id: number };
await send('POST', `/api/libraries/${lib.id}/folders`, { path: root });

async function idleSpriteJobs() {
  const busy = () =>
    sqlite.query(`SELECT 1 FROM jobs WHERE type = 'thumbnail' AND status IN ('queued', 'running') LIMIT 1`).get();
  while (busy()) await Bun.sleep(20);
}

async function scan() {
  const { job } = (await (await send('POST', `/api/libraries/${lib.id}/scan`)).json()) as { job: { id: number } };
  expect((await waitForJob(job.id)).status).toBe('done');
  await idleSpriteJobs();
}

async function item(filename: string): Promise<Media> {
  const res = (await (await send('GET', `/api/media?libraryId=${lib.id}`)).json()) as MediaListResponse;
  return res.items.find((m) => m.filename === filename)!;
}

/** Sprite size and how many of its frames are distinct. */
async function inspect(res: Response, frames: number) {
  const buf = Buffer.from(await res.arrayBuffer());
  const { width, height, format } = await sharp(buf).metadata();
  const hashes = new Set<string>();
  for (let i = 0; i < frames; i++) {
    const w = width! / frames;
    const raw = await sharp(buf)
      .extract({ left: i * w, top: 0, width: w, height: height! })
      .raw()
      .toBuffer();
    hashes.add(createHash('sha1').update(raw).digest('hex'));
  }
  return { format, width, height, distinct: hashes.size };
}

await writeVideo('wide.mp4', '480x270', 4);
await writeVideo('tall.mp4', '180x320', 3);
await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ff0000' } })
  .png()
  .toFile(path.join(root, 'still.png'));
await scan();

test('the after-scan job gives every video a ten-frame sprite and lists its metadata', async () => {
  const wide = await item('wide.mp4');
  expect(wide.sprite).toEqual({ frames: 10, intervalSeconds: 0.4, version: expect.any(Number) });
  expect((await item('tall.mp4')).sprite).toMatchObject({ frames: 10, intervalSeconds: 0.3 });
  expect((await item('still.png')).sprite).toBeUndefined();

  const res = await send('GET', `/api/media/${wide.id}/sprite?v=${wide.sprite!.version}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/webp');
  expect(res.headers.get('x-sprite-frames')).toBe('10');
  expect(res.headers.get('x-sprite-interval')).toBe('0.400');
  expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
  // 480x270 scaled so its short side is 240: 426x240 per frame, ten side by side.
  expect(await inspect(res, 10)).toEqual({ format: 'webp', width: 4260, height: 240, distinct: 10 });
});

test('a portrait video keeps its orientation in the sprite', async () => {
  const tall = await item('tall.mp4');
  const res = await send('GET', `/api/media/${tall.id}/sprite`);
  expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
  expect(await inspect(res, 10)).toEqual({ format: 'webp', width: 2400, height: 426, distinct: 10 });
});

test('an image has no sprite', async () => {
  const still = await item('still.png');
  const res = await send('GET', `/api/media/${still.id}/sprite`);
  expect(res.status).toBe(404);
  expect(fs.existsSync(spritePathFor(still.id))).toBe(false);
});

test('a missing sprite is made on demand when a card asks for it', async () => {
  const tall = await item('tall.mp4');
  fs.rmSync(spritePathFor(tall.id));
  sqlite.query('UPDATE media SET sprite_frames = NULL, sprite_at = NULL WHERE id = ?').run(tall.id);
  expect((await item('tall.mp4')).sprite).toBeUndefined();

  const res = await send('GET', `/api/media/${tall.id}/sprite`);
  expect(res.status).toBe(200);
  expect(fs.existsSync(spritePathFor(tall.id))).toBe(true);
  expect((await item('tall.mp4')).sprite).toMatchObject({ frames: 10, intervalSeconds: 0.3 });
});

test('with the thumbnail cache off the sprite is not served', async () => {
  const wide = await item('wide.mp4');
  await send('PATCH', '/api/settings', { thumbnail_cache_enabled: '0' });
  expect((await send('GET', `/api/media/${wide.id}/sprite`)).status).toBe(404);
  await send('PATCH', '/api/settings', { thumbnail_cache_enabled: '1' });
  expect((await send('GET', `/api/media/${wide.id}/sprite`)).status).toBe(200);
});

test('a video whose file changes gets a new sprite on the next scan', async () => {
  const before = await item('wide.mp4');
  await writeVideo('wide.mp4', '480x270', 6);
  await scan();
  const after = await item('wide.mp4');
  expect(after.id).toBe(before.id);
  expect(after.sprite).toMatchObject({ frames: 10, intervalSeconds: 0.6 });
  expect(after.sprite!.version).toBeGreaterThan(before.sprite!.version);
});

test('deleting a video moves its sprite out with it and restoring brings it back', async () => {
  const wide = await item('wide.mp4');
  expect((await send('DELETE', `/api/media/${wide.id}`)).status).toBe(200);
  expect(fs.existsSync(spritePathFor(wide.id))).toBe(false);
  expect((await send('GET', `/api/media/${wide.id}/sprite`)).status).toBe(404);

  const trash = (await (await send('GET', '/api/trash')).json()) as TrashPayload;
  const entry = trash.items.find((t) => t.mediaId === wide.id)!;
  expect((await send('POST', `/api/trash/${entry.id}/restore`)).status).toBe(200);
  expect(fs.existsSync(spritePathFor(wide.id))).toBe(true);
  expect((await item('wide.mp4')).sprite).toEqual(wide.sprite);
});

test('longer videos are sampled by seeking, and still give ten distinct frames', async () => {
  await writeVideo('minute.mp4', '160x90', 70, 2);
  await writeVideo('long.mp4', '160x90', 320, 1);
  await scan();
  for (const [name, interval] of [
    ['minute.mp4', 7],
    ['long.mp4', 32],
  ] as const) {
    const media = await item(name);
    expect(media.sprite).toMatchObject({ frames: 10, intervalSeconds: interval });
    // 160x90 scaled up so its short side is 240.
    expect(await inspect(await send('GET', `/api/media/${media.id}/sprite`), 10)).toEqual({
      format: 'webp',
      width: 4260,
      height: 240,
      distinct: 10,
    });
  }
});

test('cleanup removes the sprite of a media row that no longer exists', () => {
  const orphan = path.join(THUMBS_DIR, '987654.sprite.webp');
  fs.writeFileSync(orphan, 'x');
  const tall = sqlite.query(`SELECT id FROM media WHERE filename = 'tall.mp4'`).get() as { id: number };
  performCleanup();
  expect(fs.existsSync(orphan)).toBe(false);
  expect(fs.existsSync(spritePathFor(tall.id))).toBe(true);
});
