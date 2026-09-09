import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';

// Point the server at a throwaway data dir before anything opens the real database.
process.env.SAKUYA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-boards-'));
process.env.PORT = '38771';
const BASE = 'http://localhost:38771';

const { db, sqlite, schema } = await import('./db');
await import('./index'); // starts listening on PORT

const post = (url: string, body: unknown) =>
  fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const json = async (res: Response | Promise<Response>): Promise<any> => (await (await res).json()) as any;

test('a board scopes the media list, and memberships cascade away with the media', async () => {
  const lib = db.insert(schema.libraries).values({ name: 'test', createdAt: Date.now() }).returning().get();
  const addMedia = (filename: string) =>
    db
      .insert(schema.media)
      .values({
        libraryId: lib.id,
        source: 'upload',
        path: `/tmp/${filename}`,
        filename,
        type: 'image',
        createdAt: Date.now(),
      })
      .returning()
      .get();
  const onBoard = addMedia('on-board.png');
  addMedia('off-board.png');

  const board = await json(post('/api/boards', { name: 'Trip' }));
  expect((await json(post(`/api/boards/${board.id}/media`, { mediaIds: [onBoard.id] }))).itemCount).toBe(1);

  // Only board members come back when the list is filtered by boardId.
  const listed = await json(fetch(`${BASE}/api/media?boardId=${board.id}`));
  expect(listed.items.map((m: { id: number }) => m.id)).toEqual([onBoard.id]);
  expect(listed.total).toBe(1);

  // The membership is visible on the item itself — that's what the viewer edits.
  const detail = await json(fetch(`${BASE}/api/media/${onBoard.id}`));
  expect(detail.boards.map((b: { name: string }) => b.name)).toEqual(['Trip']);

  db.delete(schema.media).where(eq(schema.media.id, onBoard.id)).run();
  expect((sqlite.query('SELECT COUNT(*) AS c FROM board_media').get() as { c: number }).c).toBe(0);

  // Deleting a board drops its memberships too, leaving the media alone.
  const other = addMedia('other.png');
  await post(`/api/boards/${board.id}/media`, { mediaIds: [other.id] });
  await fetch(`${BASE}/api/boards/${board.id}`, { method: 'DELETE' });
  expect((sqlite.query('SELECT COUNT(*) AS c FROM board_media').get() as { c: number }).c).toBe(0);
  expect(db.select().from(schema.media).where(eq(schema.media.id, other.id)).get()).toBeTruthy();
});
