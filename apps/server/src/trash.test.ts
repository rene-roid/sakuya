import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { MediaDetail, MediaListResponse, TrashPayload } from '@sakuya/shared';
import { useTestConfig, waitForJob } from './testConfig';

const PORT = 38961; // P02
const dataDir = useTestConfig('trash', { port: PORT });
const BASE = `http://localhost:${PORT}`;

const { sqlite } = await import('./db');
const { emptyTrash, moveFile, TRASH_DIR } = await import('./services/trash');
await import('./index');

const root = path.join(dataDir, 'library');
fs.mkdirSync(root);

const send = (method: string, url: string, body?: unknown) =>
  fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const getJson = async <T>(url: string): Promise<T> => (await fetch(`${BASE}${url}`)).json() as Promise<T>;

async function writeImage(name: string, color: string) {
  await sharp({ create: { width: 16, height: 16, channels: 3, background: color } })
    .png()
    .toFile(path.join(root, name));
}

const lib = (await (await send('POST', '/api/libraries', { name: 'Trash test' })).json()) as { id: number };
await send('POST', `/api/libraries/${lib.id}/folders`, { path: root });

async function scan() {
  const { job } = (await (await send('POST', `/api/libraries/${lib.id}/scan`)).json()) as { job: { id: number } };
  expect((await waitForJob(job.id)).status).toBe('done');
}

async function listed(): Promise<string[]> {
  const res = await getJson<MediaListResponse>(`/api/media?libraryId=${lib.id}&sort=name&dir=asc`);
  return res.items.map((m) => m.filename);
}

const idOf = (filename: string) =>
  (sqlite.query('SELECT id FROM media WHERE filename = ?').get(filename) as { id: number } | null)?.id;

await writeImage('red.png', '#ff0000');
await writeImage('green.png', '#00ff00');
await writeImage('blue.png', '#0000ff');
await writeImage('grey.png', '#808080');
await scan();

test('the library starts with four scanned images', async () => {
  expect(await listed()).toEqual(['blue.png', 'green.png', 'grey.png', 'red.png']);
});

test('delete moves the file into the trash and restore brings it back with its tags, like and board', async () => {
  const id = idOf('red.png')!;
  await send('PATCH', `/api/media/${id}/tags`, { add: ['crimson', 'sunset'] });
  await send('PATCH', `/api/media/${id}/like`, { liked: true });
  const board = (await (await send('POST', '/api/boards', { name: 'Reds' })).json()) as { id: number };
  await send('POST', `/api/boards/${board.id}/media`, { mediaIds: [id] });
  const thumb = path.join(dataDir, 'thumbnails', `${id}.webp`);
  expect(fs.existsSync(thumb)).toBe(true);
  const transcode = path.join(dataDir, 'transcodes', `${id}.mp4`);
  fs.writeFileSync(transcode, 'transcoded');

  expect((await send('DELETE', `/api/media/${id}`)).status).toBe(200);
  expect(fs.existsSync(transcode)).toBe(false);

  expect(fs.existsSync(path.join(root, 'red.png'))).toBe(false);
  expect(fs.existsSync(thumb)).toBe(false);
  expect(await listed()).toEqual(['blue.png', 'green.png', 'grey.png']);
  const trash = await getJson<TrashPayload>('/api/trash');
  expect(trash.count).toBe(1);
  expect(trash.retentionDays).toBe(30);
  const [item] = trash.items;
  expect(item).toMatchObject({
    mediaId: id,
    filename: 'red.png',
    type: 'image',
    libraryName: 'Trash test',
    originalPath: path.join(root, 'red.png'),
  });
  expect(item.expiresAt - item.trashedAt).toBe(30 * 86_400_000);
  expect(trash.totalBytes).toBe(item.sizeBytes);
  expect(item.sizeBytes).toBe(fs.statSync(path.join(TRASH_DIR, fs.readdirSync(TRASH_DIR)[0], 'red.png')).size);
  expect((await fetch(`${BASE}/api/trash/${item.id}/thumb`)).headers.get('content-type')).toContain('image/webp');

  const restored = await (await send('POST', `/api/trash/${item.id}/restore`)).json();
  expect(restored).toEqual({ ok: true, mediaId: id, path: path.join(root, 'red.png'), renamed: false });

  expect(fs.existsSync(path.join(root, 'red.png'))).toBe(true);
  expect(fs.existsSync(thumb)).toBe(true);
  expect(fs.readFileSync(transcode, 'utf8')).toBe('transcoded');
  expect(await listed()).toEqual(['blue.png', 'green.png', 'grey.png', 'red.png']);
  const detail = await getJson<MediaDetail>(`/api/media/${id}`);
  expect(detail.tags.map((t) => t.name).sort()).toEqual(['crimson', 'sunset']);
  expect(detail.liked).toBe(true);
  expect(detail.boards.map((b) => b.name)).toEqual(['Reds']);
  expect(sqlite.query('SELECT thumbnail_path AS t FROM media WHERE id = ?').get(id)).toEqual({ t: thumb });
  const usage = sqlite.query(`SELECT usage_count AS c FROM tags WHERE name = 'crimson'`).get() as { c: number };
  expect(usage.c).toBe(1);
  expect((await getJson<TrashPayload>('/api/trash')).count).toBe(0);
  expect(fs.readdirSync(TRASH_DIR)).toEqual([]);
});

test('a rescan does not re-add a trashed file', async () => {
  const id = idOf('blue.png')!;
  await send('POST', '/api/media/delete-batch', { ids: [id] });
  await scan();
  expect(await listed()).toEqual(['green.png', 'grey.png', 'red.png']);
  const [item] = (await getJson<TrashPayload>('/api/trash')).items;
  expect(item.filename).toBe('blue.png');
});

test('a file now at the original path makes restore bring the item back under a new name', async () => {
  const [item] = (await getJson<TrashPayload>('/api/trash')).items;
  await writeImage('blue.png', '#0000aa');

  const res = await send('POST', `/api/trash/${item.id}/restore`);
  expect(await res.json()).toEqual({
    ok: true,
    mediaId: item.mediaId,
    path: path.join(root, 'blue (restored).png'),
    renamed: true,
  });
  expect(fs.existsSync(path.join(root, 'blue.png'))).toBe(true);
  expect(fs.existsSync(path.join(root, 'blue (restored).png'))).toBe(true);
  await scan();
  expect(await listed()).toEqual(['blue (restored).png', 'blue.png', 'green.png', 'grey.png', 'red.png']);
});

test('restore answers 409 with the path when the original folder is gone, and the item stays', async () => {
  const sub = path.join(root, 'sub');
  fs.mkdirSync(sub);
  await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffff00' } })
    .png()
    .toFile(path.join(sub, 'yellow.png'));
  await scan();
  await send('DELETE', `/api/media/${idOf('yellow.png')}`);
  fs.rmdirSync(sub);
  const [item] = (await getJson<TrashPayload>('/api/trash')).items;

  const res = await send('POST', `/api/trash/${item.id}/restore`);
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: `The folder ${sub} no longer exists` });
  expect((await getJson<TrashPayload>('/api/trash')).items.map((i) => i.filename)).toEqual(['yellow.png']);

  const gone = await (await send('DELETE', `/api/trash/${item.id}`)).json();
  expect(gone).toEqual({ ok: true, removed: 1, freedBytes: item.sizeBytes });
  expect((await getJson<TrashPayload>('/api/trash')).count).toBe(0);
});

test('a file that cannot be moved keeps its row and is reported as failed', async () => {
  if (process.getuid?.() === 0) return; // root ignores the read-only bit
  const locked = path.join(root, 'locked');
  fs.mkdirSync(locked);
  await sharp({ create: { width: 16, height: 16, channels: 3, background: '#00ffff' } })
    .png()
    .toFile(path.join(locked, 'cyan.png'));
  await scan();
  const id = idOf('cyan.png')!;
  fs.chmodSync(locked, 0o555);
  try {
    const res = (await (await send('POST', '/api/media/delete-batch', { ids: [id] })).json()) as {
      deleted: number;
      failed: { id: number; error: string }[];
    };
    expect(res.deleted).toBe(0);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].id).toBe(id);
    expect(res.failed[0].error).toStartWith('Could not move to trash: ');
    expect(idOf('cyan.png')).toBe(id);
    expect(fs.existsSync(path.join(locked, 'cyan.png'))).toBe(true);
    expect((await getJson<TrashPayload>('/api/trash')).count).toBe(0);
  } finally {
    fs.chmodSync(locked, 0o755);
  }
});

test('cleanup purges only items trashed more than 30 days ago', async () => {
  await send('POST', '/api/media/delete-batch', { ids: [idOf('green.png'), idOf('grey.png')] });
  const DAY = 86_400_000;
  sqlite.query(`UPDATE trash SET trashed_at = ? WHERE filename = 'green.png'`).run(Date.now() - 31 * DAY);
  sqlite.query(`UPDATE trash SET trashed_at = ? WHERE filename = 'grey.png'`).run(Date.now() - 29 * DAY);

  const result = (await (await send('POST', '/api/system/cleanup')).json()) as { purgedTrash: number };
  expect(result.purgedTrash).toBe(1);
  const trash = await getJson<TrashPayload>('/api/trash');
  expect(trash.items.map((i) => i.filename)).toEqual(['grey.png']);
  expect(fs.readdirSync(TRASH_DIR)).toHaveLength(1);
});

test('empty trash deletes every item and its files', async () => {
  await send('POST', '/api/media/delete-batch', { ids: [idOf('red.png'), idOf('blue.png')] });
  const before = await getJson<TrashPayload>('/api/trash');
  expect(before.items.map((i) => i.filename).sort()).toEqual(['blue.png', 'grey.png', 'red.png']);

  const res = await (await send('DELETE', '/api/trash')).json();
  expect(res).toEqual({ ok: true, removed: 3, freedBytes: before.totalBytes });
  expect(await getJson<TrashPayload>('/api/trash')).toEqual({ items: [], count: 0, totalBytes: 0, retentionDays: 30 });
  expect(fs.readdirSync(TRASH_DIR)).toEqual([]);
  expect(fs.existsSync(path.join(root, 'red.png'))).toBe(false);
});

test('moveFile copies then unlinks when rename crosses filesystems, keeping the mtime', async () => {
  const from = path.join(dataDir, 'cross-src.bin');
  const to = path.join(dataDir, 'cross-dst.bin');
  fs.writeFileSync(from, 'payload');
  const mtime = new Date('2024-05-01T12:00:00Z');
  fs.utimesSync(from, mtime, mtime);
  const exdev = async () => {
    throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
  };

  await moveFile(from, to, exdev);

  expect(fs.existsSync(from)).toBe(false);
  expect(fs.readFileSync(to, 'utf8')).toBe('payload');
  expect(fs.statSync(to).mtimeMs).toBe(mtime.getTime());
});

test('moveFile leaves the source alone on any other rename error', async () => {
  const from = path.join(dataDir, 'perm-src.bin');
  fs.writeFileSync(from, 'payload');
  const eacces = async () => {
    throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
  };

  await expect(moveFile(from, path.join(dataDir, 'perm-dst.bin'), eacces)).rejects.toThrow('permission denied');
  expect(fs.readFileSync(from, 'utf8')).toBe('payload');
  expect(fs.existsSync(path.join(dataDir, 'perm-dst.bin'))).toBe(false);
});

test('emptying the trash while a bulk delete is still moving files leaves that delete whole', async () => {
  const bulk = path.join(root, 'bulk');
  fs.mkdirSync(bulk);
  const names = Array.from({ length: 120 }, (_, i) => `bulk/b${i}.png`);
  for (const name of names) await writeImage(name, '#445566');
  await scan();
  const ids = names.map((n) => idOf(path.basename(n))!);

  const deleting = send('POST', '/api/media/delete-batch', { ids }).then((r) => r.json());
  const landed = () =>
    fs.existsSync(TRASH_DIR) &&
    fs.readdirSync(TRASH_DIR).some((d) => fs.readdirSync(path.join(TRASH_DIR, d)).some((f) => f.endsWith('.png')));
  while (!landed()) await new Promise((resolve) => setImmediate(resolve));
  expect(sqlite.query('SELECT COUNT(*) AS c FROM trash').get()).toEqual({ c: 0 });
  emptyTrash();

  expect(await deleting).toEqual({ ok: true, deleted: 120, failed: [] });
  const rows = sqlite.query('SELECT trashed_path AS dir, filename FROM trash').all() as { dir: string; filename: string }[];
  expect(rows).toHaveLength(120);
  expect(rows.filter((r) => !fs.existsSync(path.join(TRASH_DIR, r.dir, r.filename)))).toEqual([]);
  const [item] = (await getJson<TrashPayload>('/api/trash')).items;
  expect((await send('POST', `/api/trash/${item.id}/restore`)).status).toBe(200);
  expect(fs.existsSync(path.join(bulk, item.filename))).toBe(true);
  await send('DELETE', '/api/trash');
});

test('a delete whose database write fails puts the file and its thumbnail and transcode back', async () => {
  await writeImage('orange.png', '#ff8800');
  await scan();
  const id = idOf('orange.png')!;
  const thumb = path.join(dataDir, 'thumbnails', `${id}.webp`);
  const transcode = path.join(dataDir, 'transcodes', `${id}.mp4`);
  fs.writeFileSync(transcode, 'transcoded');
  expect(fs.existsSync(thumb)).toBe(true);
  sqlite.exec(`CREATE TEMP TRIGGER trash_fails BEFORE INSERT ON trash BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
  try {
    expect((await send('DELETE', `/api/media/${id}`)).status).toBe(500);
  } finally {
    sqlite.exec('DROP TRIGGER temp.trash_fails');
  }
  expect(idOf('orange.png')).toBe(id);
  expect(fs.existsSync(path.join(root, 'orange.png'))).toBe(true);
  expect(fs.existsSync(thumb)).toBe(true);
  expect(fs.readFileSync(transcode, 'utf8')).toBe('transcoded');
  expect(fs.readdirSync(TRASH_DIR)).toEqual([]);
});

test('a gallery-dl sidecar goes to the trash with its file and comes back on restore', async () => {
  await writeImage('post.png', '#123456');
  const sidecar = path.join(root, 'post.png.json');
  fs.writeFileSync(sidecar, JSON.stringify({ category: 'danbooru', id: 7, tag_string_artist: 'david_revoy' }));
  await scan();
  const id = idOf('post.png')!;
  expect((await getJson<MediaDetail>(`/api/media/${id}`)).tags.map((t) => `${t.name}:${t.source}`)).toEqual([
    'david_revoy:meta',
  ]);

  expect((await send('DELETE', `/api/media/${id}`)).status).toBe(200);
  expect(fs.existsSync(sidecar)).toBe(false);
  const [item] = (await getJson<TrashPayload>('/api/trash')).items;
  await send('POST', `/api/trash/${item.id}/restore`);
  expect(JSON.parse(fs.readFileSync(sidecar, 'utf8')).tag_string_artist).toBe('david_revoy');
  await scan();
  expect((await getJson<MediaDetail>(`/api/media/${id}`)).tags.map((t) => `${t.name}:${t.source}`)).toEqual([
    'david_revoy:meta',
  ]);
});
