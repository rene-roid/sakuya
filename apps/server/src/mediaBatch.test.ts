import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';

// Point the server at a throwaway data dir before anything opens the real database.
process.env.SAKUYA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-batch-'));
process.env.PORT = '38774';
const BASE = 'http://localhost:38774';

const { db, sqlite, schema } = await import('./db');
await import('./index'); // starts listening on PORT

const post = (url: string, body: unknown) =>
  fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const json = async (res: Response | Promise<Response>): Promise<any> => (await (await res).json()) as any;

const MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-batch-files-'));
const library = db.insert(schema.libraries).values({ name: 'batch', createdAt: Date.now() }).returning().get();

/** Creates a real file on disk plus its media row — rename tests need both to exist. */
function addMedia(filename: string, opts: { dir?: string; liked?: boolean } = {}) {
  const dir = opts.dir ?? MEDIA_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, filename);
  return db
    .insert(schema.media)
    .values({
      libraryId: library.id,
      source: 'folder',
      path: filePath,
      filename,
      type: 'image',
      sizeBytes: filename.length,
      liked: opts.liked ? 1 : 0,
      createdAt: Date.now(),
    })
    .returning()
    .get();
}

const tagsOf = (mediaId: number): string[] =>
  (
    sqlite
      .query('SELECT t.name FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.media_id = ? ORDER BY t.name')
      .all(mediaId) as { name: string }[]
  ).map((r) => r.name);

test('tags-batch adds to every selected file and removes only where present', async () => {
  const a = addMedia('tag-a.png');
  const b = addMedia('tag-b.png');
  const untouched = addMedia('tag-c.png');

  await post('/api/media/tags-batch', { ids: [a.id], add: ['solo'], category: 'general' });
  const added = await json(post('/api/media/tags-batch', { ids: [a.id, b.id], add: ['beach'], category: 'user' }));
  expect(added).toMatchObject({ ok: true, updated: 2, failed: [] });
  expect(tagsOf(a.id)).toEqual(['beach', 'solo']);
  expect(tagsOf(b.id)).toEqual(['beach']);
  expect(tagsOf(untouched.id)).toEqual([]);

  // "solo" only exists on a — removing it from both is a no-op for b, not a failure.
  const removed = await json(post('/api/media/tags-batch', { ids: [a.id, b.id], remove: ['solo'] }));
  expect(removed).toMatchObject({ ok: true, updated: 2, failed: [] });
  expect(tagsOf(a.id)).toEqual(['beach']);

  // Usage counts drive the tag sidebar, so they have to follow a bulk edit.
  const beach = db.select().from(schema.tags).where(eq(schema.tags.name, 'beach')).get();
  expect(beach?.usageCount).toBe(2);
  const solo = db.select().from(schema.tags).where(eq(schema.tags.name, 'solo')).get();
  expect(solo?.usageCount).toBe(0);
});

test('tags-batch reports missing ids instead of failing the whole call', async () => {
  const a = addMedia('tag-partial.png');
  const res = await json(post('/api/media/tags-batch', { ids: [a.id, 999999], add: ['sunset'] }));
  expect(res.updated).toBe(1);
  expect(res.failed).toEqual([{ id: 999999, error: 'Not found' }]);
  expect(tagsOf(a.id)).toEqual(['sunset']);
});

test('tags-batch rejects a call with nothing to do', async () => {
  const a = addMedia('tag-empty.png');
  const res = await post('/api/media/tags-batch', { ids: [a.id], add: [], remove: [] });
  expect(res.status).toBe(400);
});

test('like-batch flips liked state and clears likedAt on unlike', async () => {
  const a = addMedia('like-a.png');
  const b = addMedia('like-b.png', { liked: true });

  expect(await json(post('/api/media/like-batch', { ids: [a.id, b.id], liked: true }))).toMatchObject({ updated: 2 });
  const afterLike = db.select().from(schema.media).where(eq(schema.media.id, a.id)).get();
  expect(afterLike?.liked).toBe(1);
  expect(afterLike?.likedAt).toBeGreaterThan(0);

  await post('/api/media/like-batch', { ids: [a.id, b.id], liked: false });
  const afterUnlike = db.select().from(schema.media).where(eq(schema.media.id, a.id)).get();
  expect(afterUnlike?.liked).toBe(0);
  expect(afterUnlike?.likedAt).toBeNull();
});

test('rename-batch moves files on disk and keeps the db row in step', async () => {
  const a = addMedia('rename-a.png');
  const b = addMedia('rename-b.png');

  const res = await json(
    post('/api/media/rename-batch', {
      items: [
        { id: a.id, filename: 'trip_001.png' },
        { id: b.id, filename: 'trip_002.png' },
      ],
    }),
  );
  expect(res).toMatchObject({ ok: true, updated: 2, failed: [] });

  const rowA = db.select().from(schema.media).where(eq(schema.media.id, a.id)).get();
  expect(rowA?.filename).toBe('trip_001.png');
  expect(fs.existsSync(rowA!.path)).toBe(true);
  expect(fs.existsSync(a.path)).toBe(false);
});

test('rename-batch refuses collisions and path traversal, and applies the rest', async () => {
  const ok = addMedia('collide-ok.png');
  const one = addMedia('collide-one.png');
  const two = addMedia('collide-two.png');
  const sneaky = addMedia('collide-sneaky.png');
  const occupied = addMedia('collide-taken.png');
  // Exists on disk but is not part of this batch — nothing may be renamed on top of it.
  const bystander = addMedia('collide-bystander.png');

  const res = await json(
    post('/api/media/rename-batch', {
      items: [
        { id: ok.id, filename: 'collide-renamed.png' },
        // Two rows aiming at one name: the first wins, the second is refused.
        { id: one.id, filename: 'same.png' },
        { id: two.id, filename: 'same.png' },
        // A directory component must never escape the file's own folder.
        { id: sneaky.id, filename: '../escaped.png' },
        // The target is a file outside the batch, so only the filesystem check can catch it.
        { id: occupied.id, filename: 'collide-bystander.png' },
      ],
    }),
  );

  // collide-renamed.png, the first same.png, and the traversal attempt once it's been
  // flattened to a bare basename.
  expect(res.updated).toBe(3);
  const errors = Object.fromEntries(res.failed.map((f: { id: number; error: string }) => [f.id, f.error]));
  expect(errors[two.id]).toBe('Two files would end up with the same name');
  expect(errors[occupied.id]).toBe('A file with that name already exists');

  // path.basename strips "../", so the file lands beside its siblings rather than above them.
  const sneakyRow = db.select().from(schema.media).where(eq(schema.media.id, sneaky.id)).get();
  expect(sneakyRow?.filename).toBe('escaped.png');
  expect(path.dirname(sneakyRow!.path)).toBe(MEDIA_DIR);

  // The refused rows kept their original names and files, and the bystander is untouched.
  expect(db.select().from(schema.media).where(eq(schema.media.id, two.id)).get()?.filename).toBe('collide-two.png');
  expect(fs.existsSync(occupied.path)).toBe(true);
  expect(fs.readFileSync(bystander.path, 'utf8')).toBe('collide-bystander.png');
});

test('rename-batch treats an unchanged name as a no-op rather than a failure', async () => {
  const a = addMedia('noop.png');
  const res = await json(post('/api/media/rename-batch', { items: [{ id: a.id, filename: 'noop.png' }] }));
  expect(res).toMatchObject({ ok: true, updated: 0, failed: [] });
});

test('by-ids returns rows in the order asked for and drops unknown ids', async () => {
  const a = addMedia('order-a.png');
  const b = addMedia('order-b.png');
  const rows = await json(post('/api/media/by-ids', { ids: [b.id, 999999, a.id] }));
  expect(rows.map((m: { id: number }) => m.id)).toEqual([b.id, a.id]);
  expect(rows[0].filename).toBe('order-b.png');
});

test('tags-summary counts each tag across the selection', async () => {
  const a = addMedia('summary-a.png');
  const b = addMedia('summary-b.png');
  await post('/api/media/tags-batch', { ids: [a.id, b.id], add: ['shared'] });
  await post('/api/media/tags-batch', { ids: [a.id], add: ['lonely'] });

  const summary = await json(post('/api/media/tags-summary', { ids: [a.id, b.id] }));
  const counts = Object.fromEntries(summary.map((t: { name: string; count: number }) => [t.name, t.count]));
  expect(counts.shared).toBe(2);
  expect(counts.lonely).toBe(1);
});

test('/api/media/ids resolves the same set as the list, and is not parsed as an id', async () => {
  const liked = addMedia('ids-liked.png', { liked: true });
  addMedia('ids-plain.png');

  const all = await json(fetch(`${BASE}/api/media/ids?libraryId=${library.id}`));
  const listed = await json(fetch(`${BASE}/api/media?libraryId=${library.id}&limit=200`));
  expect(all.total).toBe(listed.total);
  expect(all.ids).toEqual(listed.items.map((m: { id: number }) => m.id));

  // The filter must narrow the same way the grid does.
  const likedOnly = await json(fetch(`${BASE}/api/media/ids?libraryId=${library.id}&liked=1`));
  expect(likedOnly.ids).toContain(liked.id);
  expect(likedOnly.total).toBe(likedOnly.ids.length);
});

test('a board can drop a whole selection at once, leaving the media alone', async () => {
  const a = addMedia('board-a.png');
  const b = addMedia('board-b.png');
  const keep = addMedia('board-keep.png');
  const board = await json(post('/api/boards', { name: 'Bulk' }));

  await post(`/api/boards/${board.id}/media`, { mediaIds: [a.id, b.id, keep.id] });
  const after = await json(post(`/api/boards/${board.id}/media/remove-batch`, { mediaIds: [a.id, b.id] }));
  expect(after.itemCount).toBe(1);

  // Removal is membership-only: the files and rows survive.
  expect(db.select().from(schema.media).where(eq(schema.media.id, a.id)).get()).toBeTruthy();
  expect(fs.existsSync(a.path)).toBe(true);
});
