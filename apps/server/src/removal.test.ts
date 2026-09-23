import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { useTestConfig } from './testConfig';

useTestConfig('removal', { port: 38779 });
const BASE = 'http://localhost:38779';

const { db, schema } = await import('./db');
await import('./index'); // starts listening on PORT

function addLibrary(name: string) {
  return db.insert(schema.libraries).values({ name, createdAt: Date.now() }).returning().get();
}

function addMedia(libraryId: number, filename: string, tagNames: string[]) {
  const item = db
    .insert(schema.media)
    .values({
      libraryId,
      source: 'upload',
      path: `/tmp/removal-${filename}`,
      filename,
      type: 'image',
      createdAt: Date.now(),
    })
    .returning()
    .get();
  for (const name of tagNames) {
    const tag =
      db.select().from(schema.tags).where(eq(schema.tags.name, name)).get() ??
      db.insert(schema.tags).values({ name }).returning().get();
    db.insert(schema.mediaTags).values({ mediaId: item.id, tagId: tag.id }).run();
  }
  db.run(`UPDATE tags SET usage_count = (SELECT COUNT(*) FROM media_tags WHERE tag_id = tags.id)`);
  return item;
}

const usage = (name: string) => db.select().from(schema.tags).where(eq(schema.tags.name, name)).get()!.usageCount;

test('deleting media updates tag usage counts and clears a library cover pointing at it', async () => {
  const lib = addLibrary('delete-one');
  const a = addMedia(lib.id, 'a.png', ['only_on_a', 'shared']);
  addMedia(lib.id, 'b.png', ['shared']);
  db.update(schema.libraries).set({ thumbnailMediaId: a.id }).where(eq(schema.libraries.id, lib.id)).run();
  expect(usage('only_on_a')).toBe(1);
  expect(usage('shared')).toBe(2);

  const res = await fetch(`${BASE}/api/media/${a.id}`, { method: 'DELETE' });
  expect(res.status).toBe(200);

  // A stale count kept "only_on_a" in the tag sidebar, leading to an empty result set.
  expect(usage('only_on_a')).toBe(0);
  expect(usage('shared')).toBe(1);
  expect(db.select().from(schema.libraries).where(eq(schema.libraries.id, lib.id)).get()!.thumbnailMediaId).toBeNull();
  const tags = (await (await fetch(`${BASE}/api/tags?q=only_on_a`)).json()) as unknown[];
  expect(tags).toHaveLength(0);
});

test('batch delete updates tag usage counts', async () => {
  const lib = addLibrary('delete-batch');
  const a = addMedia(lib.id, 'batch-a.png', ['batch_tag']);
  const b = addMedia(lib.id, 'batch-b.png', ['batch_tag']);
  expect(usage('batch_tag')).toBe(2);
  await fetch(`${BASE}/api/media/delete-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [a.id, b.id] }),
  });
  expect(usage('batch_tag')).toBe(0);
});

test('deleting a library removes its media, tag links and job schedules', async () => {
  const lib = addLibrary('delete-lib');
  const a = addMedia(lib.id, 'lib-a.png', ['lib_tag']);
  db.insert(schema.jobSchedules)
    .values({ jobType: 'scan', libraryId: lib.id, mode: 'interval', intervalMinutes: 60, useGlobal: 0 })
    .run();

  const res = await fetch(`${BASE}/api/libraries/${lib.id}`, { method: 'DELETE' });
  expect(res.status).toBe(200);

  expect(db.select().from(schema.media).where(eq(schema.media.id, a.id)).get()).toBeUndefined();
  expect(db.select().from(schema.mediaTags).where(eq(schema.mediaTags.mediaId, a.id)).all()).toHaveLength(0);
  // A leftover schedule re-armed an interval timer that tried to scan the deleted library forever.
  expect(db.select().from(schema.jobSchedules).where(eq(schema.jobSchedules.libraryId, lib.id)).all()).toHaveLength(0);
  expect(usage('lib_tag')).toBe(0);
});
