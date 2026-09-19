import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the server at a throwaway data dir before anything opens the real database.
process.env.SAKUYA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-list-'));
process.env.PORT = '38775';
const BASE = 'http://localhost:38775';

const { db, schema } = await import('./db');
await import('./index'); // starts listening on PORT

const json = async (url: string): Promise<any> => (await (await fetch(BASE + url)).json()) as any;

const library = db.insert(schema.libraries).values({ name: 'list', createdAt: Date.now() }).returning().get();

for (let i = 0; i < 25; i++) {
  db.insert(schema.media)
    .values({
      libraryId: library.id,
      source: 'folder',
      path: `/nowhere/list-${i}.png`,
      filename: `list-${i}.png`,
      type: i % 2 === 0 ? 'image' : 'video',
      sizeBytes: 100 + i,
      // Distinct timestamps keep the default recent sort deterministic.
      createdAt: 1_700_000_000_000 + i,
    })
    .run();
}

test('the first page carries the filtered total', async () => {
  const page = await json('/api/media?limit=10');
  expect(page.items).toHaveLength(10);
  expect(page.total).toBe(25);
  expect(page.nextCursor).toBeString();
});

test('cursor pages omit the total instead of recomputing it', async () => {
  const first = await json('/api/media?limit=10');
  const second = await json(`/api/media?limit=10&cursor=${encodeURIComponent(first.nextCursor)}`);

  // null, not 0: the client keeps page one's total, and 0 would read as "no matches".
  expect(second.total).toBeNull();
  expect(second.items).toHaveLength(10);
});

test('the total reflects the filter, not the library size', async () => {
  const images = await json('/api/media?limit=5&type=image');
  expect(images.total).toBe(13);
  const videos = await json('/api/media?limit=5&type=video');
  expect(videos.total).toBe(12);
});

test('paging with a cursor walks the whole result set exactly once', async () => {
  const seen: number[] = [];
  let cursor = '';
  for (let guard = 0; guard < 20; guard++) {
    const page = await json(`/api/media?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    seen.push(...page.items.map((m: any) => m.id));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  expect(seen).toHaveLength(25);
  expect(new Set(seen).size).toBe(25);
});

test('/api/media and /api/media/ids agree on what matches', async () => {
  const ids = await json('/api/media/ids?type=image');
  const page = await json('/api/media?limit=100&type=image');
  expect(ids.total).toBe(page.total);
  expect(ids.ids).toEqual(page.items.map((m: any) => m.id));
});
