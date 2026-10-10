import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { useTestConfig } from './testConfig';

useTestConfig('validation', { port: 38780 });
const BASE = 'http://localhost:38780';

const { db, sqlite, schema } = await import('./db');
const { DOWNLOADER_COOKIES_DIR, DOWNLOADER_DIR } = await import('./lib/config');
await import('./index');

const send = (method: string, url: string, body: unknown) =>
  fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('an uploaded cookie file cannot be written outside the cookies folder', async () => {
  const form = new FormData();
  form.append('files', new File(['# Netscape HTTP Cookie File'], '../../../escaped.txt'));
  const res = await fetch(BASE + '/api/downloader/cookies', { method: 'POST', body: form });
  expect(res.status).toBe(201);

  const row = db.select().from(schema.downloadCookies).get()!;
  expect(path.dirname(row.storedPath)).toBe(DOWNLOADER_COOKIES_DIR);
  expect(fs.existsSync(row.storedPath)).toBe(true);
  expect(fs.existsSync(path.join(DOWNLOADER_DIR, 'escaped.txt'))).toBe(false);
});

test('adding a deleted media id to a board skips it instead of failing the whole add', async () => {
  const lib = db.insert(schema.libraries).values({ name: 'lib', createdAt: Date.now() }).returning().get();
  const media = db
    .insert(schema.media)
    .values({
      libraryId: lib.id,
      source: 'upload',
      path: '/tmp/kept.png',
      filename: 'kept.png',
      type: 'image',
      createdAt: Date.now(),
    })
    .returning()
    .get();
  const board = (await (await send('POST', '/api/boards', { name: 'b' })).json()) as { id: number };

  const res = await send('POST', `/api/boards/${board.id}/media`, { mediaIds: [media.id, 999_999] });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { itemCount: number }).itemCount).toBe(1);

  const removed = await send('POST', `/api/boards/${board.id}/media/remove-batch`, { mediaIds: [media.id, 999_999] });
  expect(((await removed.json()) as { itemCount: number }).itemCount).toBe(0);
});

test('a settings patch with one unknown key changes nothing', async () => {
  const before = sqlite.query(`SELECT value FROM settings WHERE key = 'accent_color'`).get() as {
    value: string;
  } | null;
  const res = await send('PATCH', '/api/settings', { accent_color: '#123456', not_a_setting: '1' });
  expect(res.status).toBe(400);
  const after = sqlite.query(`SELECT value FROM settings WHERE key = 'accent_color'`).get() as { value: string } | null;
  expect(after?.value).toBe(before?.value);
});

test('tag search treats _ and % as literal characters', async () => {
  const lib = db.insert(schema.libraries).values({ name: 'tags', createdAt: Date.now() }).returning().get();
  const media = db
    .insert(schema.media)
    .values({
      libraryId: lib.id,
      source: 'upload',
      path: '/tmp/tagged.png',
      filename: 'tagged.png',
      type: 'image',
      createdAt: Date.now(),
    })
    .returning()
    .get();
  await send('PATCH', `/api/media/${media.id}/tags`, { add: ['long_hair', 'longxhair', '100%_done'] });

  const names = async (url: string) =>
    ((await (await fetch(BASE + url)).json()) as { name: string }[]).map((t) => t.name).sort();
  for (const scope of ['', `&libraryId=${lib.id}`]) {
    expect(await names(`/api/tags?q=long_h${scope}`)).toEqual(['long_hair']);
    expect(await names(`/api/tags?q=${encodeURIComponent('0%_')}${scope}`)).toEqual(['100%_done']);
  }
});

test('attaching the same folder twice is refused', async () => {
  const lib = db.insert(schema.libraries).values({ name: 'folders', createdAt: Date.now() }).returning().get();
  const dir = fs.mkdtempSync(path.join(DOWNLOADER_DIR, 'folder-'));
  expect((await send('POST', `/api/libraries/${lib.id}/folders`, { path: dir })).status).toBe(201);
  expect((await send('POST', `/api/libraries/${lib.id}/folders`, { path: dir })).status).toBe(409);
});

test('system info reports the thumbnail folder size', async () => {
  const { THUMBS_DIR } = await import('./lib/config');
  fs.writeFileSync(path.join(THUMBS_DIR, 'size-probe.webp'), Buffer.alloc(1234));
  const info = (await (await fetch(BASE + '/api/system')).json()) as { thumbBytes: number };
  expect(info.thumbBytes).toBeGreaterThanOrEqual(1234);
});

test('an upload into a library that does not exist is a 404 and indexes nothing', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#f00' } }).png().toBuffer();
  const form = new FormData();
  form.append('libraryId', '999999');
  form.append('files', new File([png], 'orphan.png'));
  const res = await fetch(BASE + '/api/uploads', { method: 'POST', body: form });
  expect(res.status).toBe(404);
  expect(sqlite.query(`SELECT COUNT(*) AS c FROM media WHERE library_id = 999999`).get()).toEqual({ c: 0 });
});

test('a library patch with nothing to change, or a fractional cover id, is a 400', async () => {
  const lib = db.insert(schema.libraries).values({ name: 'patch-me', createdAt: Date.now() }).returning().get();
  expect((await send('PATCH', `/api/libraries/${lib.id}`, {})).status).toBe(400);
  expect((await send('PATCH', `/api/libraries/${lib.id}`, { thumbnailMediaId: 1.5 })).status).toBe(400);
  const renamed = await send('PATCH', `/api/libraries/${lib.id}`, { name: 'patched' });
  expect(((await renamed.json()) as { name: string }).name).toBe('patched');
});

test('a cursor that is not a list of plain values is a 400', async () => {
  const cursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const list = (c: string) => fetch(`${BASE}/api/media?cursor=${c}`);
  expect((await list(cursor([{ a: 1 }, 1]))).status).toBe(400);
  expect((await list(cursor('ab'))).status).toBe(400);
  expect((await list(cursor([0, 0]))).status).toBe(200);
  expect((await fetch(`${BASE}/api/discover?cursor=${cursor(['a', 1, 1])}`)).status).toBe(400);
});
