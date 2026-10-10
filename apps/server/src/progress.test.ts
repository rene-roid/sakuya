import { expect, test } from 'bun:test';
import { useTestConfig } from './testConfig';

useTestConfig('progress', { port: 38791 });
const BASE = 'http://localhost:38791';

const { db, schema } = await import('./db');
await import('./index');

const library = db.insert(schema.libraries).values({ name: 'progress', createdAt: Date.now() }).returning().get();
const video = db
  .insert(schema.media)
  .values({
    libraryId: library.id,
    source: 'folder',
    path: '/nowhere/progress.mp4',
    filename: 'progress.mp4',
    type: 'video',
    sizeBytes: 100,
    createdAt: Date.now(),
  })
  .returning()
  .get();

const patch = (body: object) =>
  fetch(`${BASE}/api/media/${video.id}/progress`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const detail = async (): Promise<any> => (await fetch(`${BASE}/api/media/${video.id}`)).json();

test('opening an item again counts a view without touching its resume point', async () => {
  expect((await patch({ progress: 0.6 })).status).toBe(200);

  expect((await patch({ view: true })).status).toBe(200);

  const row = await detail();
  expect(row.viewProgress).toBe(0.6);
  expect(row.viewCount).toBe(1);
});

test('dwell time alone leaves the resume point alone', async () => {
  await patch({ progress: 0.4 });

  expect((await patch({ dwellDelta: 5 })).status).toBe(200);

  const row = await detail();
  expect(row.viewProgress).toBe(0.4);
  expect(row.dwellSeconds).toBe(5);
});
