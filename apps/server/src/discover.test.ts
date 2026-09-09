import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';

// Point the server at a throwaway data dir before anything opens the real database.
process.env.SAKUYA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-discover-'));
process.env.PORT = '38772';
const BASE = 'http://localhost:38772';

const { db, schema } = await import('./db');
await import('./index'); // starts listening on PORT

const json = async (res: Response | Promise<Response>): Promise<any> => (await (await res).json()) as any;

const lib = db.insert(schema.libraries).values({ name: 'test', createdAt: Date.now() }).returning().get();

function addMedia(filename: string, tagNames: string[], engagement: Partial<typeof schema.media.$inferInsert> = {}) {
  const item = db
    .insert(schema.media)
    .values({
      libraryId: lib.id,
      source: 'upload',
      path: `/tmp/${filename}`,
      filename,
      type: filename.endsWith('.mp4') ? 'video' : 'image',
      createdAt: Date.now(),
      ...engagement,
    })
    .returning()
    .get();
  for (const name of tagNames) {
    const tag =
      db.select().from(schema.tags).where(eq(schema.tags.name, name)).get() ??
      db.insert(schema.tags).values({ name }).returning().get();
    db.insert(schema.mediaTags).values({ mediaId: item.id, tagId: tag.id }).run();
  }
  return item;
}

// Liked: the taste signal. "sunset" is the tag the user actually engages with; "beach" only ever
// appears next to it, so it should ride along as an adjacent tag.
addMedia('liked-a.png', ['sunset', 'beach'], { liked: 1, likedAt: Date.now() });
addMedia('liked-b.png', ['sunset'], { liked: 1, likedAt: Date.now() });
const wanted = addMedia('match.png', ['sunset']);
const adjacent = addMedia('adjacent.png', ['beach']);
const unrelated = addMedia('unrelated.png', ['spreadsheet']);
const seen = addMedia('seen.png', ['sunset'], { viewCount: 9, lastViewedAt: Date.now() });
addMedia('clip.mp4', ['sunset'], {});

// "driftwood" is never engaged with directly — it only ever appears next to "sunset". It should
// reach the profile through co-occurrence alone and be flagged as related, not as your taste.
addMedia('bridge-a.png', ['sunset', 'driftwood']);
addMedia('bridge-b.png', ['sunset', 'driftwood']);
const relatedOnly = addMedia('driftwood-only.png', ['driftwood']);

test('taste profile ranks matching tags first, credits the tag, and sinks already-seen media', async () => {
  const feed = await json(fetch(`${BASE}/api/discover?surprise=0`));
  const ids = feed.items.map((m: { id: number }) => m.id);

  expect(feed.total).toBe(10);
  // A pure-taste feed leads with the strongest tag match, and the card can say why.
  expect(ids.indexOf(wanted.id)).toBeLessThan(ids.indexOf(adjacent.id));
  expect(feed.items[ids.indexOf(wanted.id)].reasonTag).toBe('sunset');
  // Co-occurrence pulls in "beach" content the user never explicitly engaged with...
  expect(ids.indexOf(adjacent.id)).toBeLessThan(ids.indexOf(unrelated.id));
  expect(feed.items[ids.indexOf(adjacent.id)].reasonTag).toBe('beach');
  // A tag reached only through co-occurrence surfaces content of its own, and says so — the card
  // shouldn't claim you engaged with "driftwood" when you never did.
  expect(feed.items[ids.indexOf(relatedOnly.id)].reasonTag).toBe('driftwood');
  expect(feed.items[ids.indexOf(relatedOnly.id)].reasonRelated).toBe(true);
  // "beach" and "sunset" you engaged with directly, so they are not flagged as related.
  expect(feed.items[ids.indexOf(wanted.id)].reasonRelated).toBeUndefined();
  expect(feed.items[ids.indexOf(adjacent.id)].reasonRelated).toBeUndefined();
  // ...and an unmatched item still shows up rather than being excluded.
  expect(ids).toContain(unrelated.id);
  // Seen media is downweighted, not dropped: same tag as `wanted`, but ranked below it.
  expect(ids.indexOf(seen.id)).toBeGreaterThan(ids.indexOf(wanted.id));
  expect(feed.items[ids.indexOf(unrelated.id)].reasonTag).toBeUndefined();
});

test('the type filter splits the feed, and surprise=1 with limit=1 is one random pick', async () => {
  const images = await json(fetch(`${BASE}/api/discover?type=image&surprise=0`));
  expect(images.items.every((m: { type: string }) => m.type === 'image')).toBe(true);
  expect(images.total).toBe(9);

  // "I'm feeling lucky": the mix is pure randomness, so the seed alone decides the pick.
  const lucky = await json(fetch(`${BASE}/api/discover?surprise=1&limit=1&seed=7`));
  expect(lucky.items).toHaveLength(1);
  expect(await json(fetch(`${BASE}/api/discover?surprise=1&limit=1&seed=7`))).toEqual(lucky);
  const other = await json(fetch(`${BASE}/api/discover?surprise=1&limit=1&seed=4242`));
  expect(other.items[0].id).not.toBe(lucky.items[0].id);
});

test('cursor pagination walks every item exactly once', async () => {
  const first = await json(fetch(`${BASE}/api/discover?limit=3&surprise=0.5&seed=3`));
  expect(first.items).toHaveLength(3);
  const second = await json(fetch(`${BASE}/api/discover?limit=3&surprise=0.5&seed=3&cursor=${first.nextCursor}`));
  const ids = [...first.items, ...second.items].map((m: { id: number }) => m.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('dwell time on an image feeds the profile like watch time does on a video', async () => {
  const dwelledA = addMedia('dwelled-a.png', ['macro']);
  const dwelledB = addMedia('dwelled-b.png', ['macro']);
  const target = addMedia('macro-match.png', ['macro']);
  const rank = (feed: any, id: number) => feed.items.findIndex((m: { id: number }) => m.id === id);

  // Nothing has been dwelled on yet, so "macro" carries no taste signal at all.
  const before = await json(fetch(`${BASE}/api/discover?surprise=0`));
  expect(before.items[rank(before, target.id)].reasonTag).toBeUndefined();
  expect(rank(before, target.id)).toBeGreaterThan(rank(before, adjacent.id));

  for (const item of [dwelledA, dwelledB]) {
    await fetch(`${BASE}/api/media/${item.id}/progress`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress: 0, dwellDelta: 200 }),
    });
  }
  expect(db.select().from(schema.media).where(eq(schema.media.id, dwelledA.id)).get()!.dwellSeconds).toBe(200);

  // Time spent staring at two macro images is enough on its own to promote a third one
  // above content that only got there by tag adjacency.
  const after = await json(fetch(`${BASE}/api/discover?surprise=0`));
  expect(after.items[rank(after, target.id)].reasonTag).toBe('macro');
  expect(rank(after, target.id)).toBeLessThan(rank(after, adjacent.id));
});
