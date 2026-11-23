import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { useTestConfig } from './testConfig';

// Point the server at a throwaway data dir before anything opens the real database.
useTestConfig('discover', { port: 38772 });
const BASE = 'http://localhost:38772';

const { db, schema, sqlite } = await import('./db');
const { bumpTasteVersion } = await import('./lib/tasteVersion');
const { phashColumns } = await import('./lib/phashBands');
await import('./index'); // starts listening on PORT

const json = async (res: Response | Promise<Response>): Promise<any> => (await (await res).json()) as any;

const lib = db.insert(schema.libraries).values({ name: 'test', createdAt: Date.now() }).returning().get();

function addMedia(
  filename: string,
  tagNames: string[],
  engagement: Partial<typeof schema.media.$inferInsert> = {},
  folder = '/tmp',
) {
  const item = db
    .insert(schema.media)
    .values({
      libraryId: lib.id,
      source: 'upload',
      path: `${folder}/${filename}`,
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

test('a like is reflected in the next feed rather than waiting out the profile cache', async () => {
  // "spreadsheet" carries no engagement, so `unrelated` sits at the bottom with no credited tag.
  const before = await json(fetch(`${BASE}/api/discover?surprise=0`));
  expect(before.items.find((m: { id: number }) => m.id === unrelated.id).reasonTag).toBeUndefined();

  await fetch(`${BASE}/api/media/${unrelated.id}/like`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ liked: true }),
  });

  // The profile is cached between requests; the like has to invalidate it, not wait for the TTL.
  const after = await json(fetch(`${BASE}/api/discover?surprise=0`));
  expect(after.items.find((m: { id: number }) => m.id === unrelated.id).reasonTag).toBe('spreadsheet');
});

test('a scroll keeps its ordering when the profile changes between pages', async () => {
  const seenIds: number[] = [];
  const first = await json(fetch(`${BASE}/api/discover?limit=2&surprise=0`));
  seenIds.push(...first.items.map((m: { id: number }) => m.id));

  // Opening a first-page item in the viewer marks it seen, which sinks its score. Re-scored with
  // the new profile, the rest of this scroll would rank it below the cursor and serve it again.
  await fetch(`${BASE}/api/media/${first.items[0].id}/progress`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ progress: 0, view: true }),
  });

  let cursor = first.nextCursor;
  while (cursor) {
    const page = await json(fetch(`${BASE}/api/discover?limit=2&surprise=0&cursor=${cursor}`));
    expect(page.total).toBeNull();
    seenIds.push(...page.items.map((m: { id: number }) => m.id));
    cursor = page.nextCursor;
  }
  expect(new Set(seenIds).size).toBe(seenIds.length);
  expect(seenIds).toHaveLength(first.total);

  // A fresh feed does pick up the view: the item sinks from the top.
  const fresh = await json(fetch(`${BASE}/api/discover?limit=2&surprise=0`));
  expect(fresh.items[0].id).not.toBe(first.items[0].id);
});

// From here on each test seeds its own library, so it can assert the whole order literally.
const DAY = 86_400_000;
const NOW = Date.now();

function resetLibrary() {
  sqlite.exec(`DELETE FROM media_tags; DELETE FROM media; DELETE FROM tags;`);
  // Direct writes skip the API, so tell the profile cache itself.
  bumpTasteVersion();
}

/** One item per folder unless told otherwise, so the folder rule stays out of scoring tests. */
const add = (name: string, tags: string[], extra: Partial<typeof schema.media.$inferInsert> = {}, folder = `/lib/${name}`) =>
  addMedia(`${name}.png`, tags, extra, folder).id;
const likedOn = (at: number) => ({ liked: 1, likedAt: at, viewCount: 1, lastViewedAt: at });
const feedIds = async (q = 'surprise=0') =>
  (await json(fetch(`${BASE}/api/discover?limit=200&${q}`))).items.map((m: { id: number }) => m.id) as number[];

test('five strong tags beat forty weak ones', async () => {
  resetLibrary();
  const strong = ['s1', 's2', 's3', 's4', 's5'];
  const weak = Array.from({ length: 40 }, (_, i) => `w${i}`);
  // Every strong tag is on three liked items; every weak one on a single liked item and on ten
  // others nobody engaged with, so each weak tag is worth a fifth of a strong one.
  const liked = [1, 2, 3].map((i) => add(`liked${i}`, strong, likedOn(NOW - 1000)));
  const weakLiked = add('weak-liked', weak, likedOn(NOW - 1000));
  const filler = Array.from({ length: 10 }, (_, i) => add(`filler${i}`, weak));
  const fiveStrong = add('five-strong', strong);
  const fortyWeak = add('forty-weak', weak);

  // Summing every match scored fortyWeak 40 x 0.28 = 11.2 against fiveStrong's 5 x 1.4 = 7.
  // Counting the five best, fortyWeak is down to 1.4. Liked items sink as already seen.
  expect(await feedIds()).toEqual([fiveStrong, ...liked.reverse(), fortyWeak, ...filler.reverse(), weakLiked]);
});

test('a fresh like outweighs an old one', async () => {
  resetLibrary();
  const rainLiked = [1, 2].map((i) => add(`rain-liked${i}`, ['rain'], likedOn(NOW - 1000)));
  const snowLiked = [1, 2].map((i) => add(`snow-liked${i}`, ['snow'], likedOn(NOW - 365 * DAY)));
  const rain = add('rain', ['rain']);
  // Inserted last, so with the two likes weighed alike it would win the tie on id.
  const snow = add('snow', ['snow']);

  expect(await feedIds()).toEqual([rain, ...rainLiked.reverse(), snow, ...snowLiked.reverse()]);
});

test('a 1 s open does not count as a view, a 2 s one does', async () => {
  resetLibrary();
  const id = add('opened', ['harbour']);
  const progress = (body: object) =>
    fetch(`${BASE}/api/media/${id}/progress`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const row = () => db.select().from(schema.media).where(eq(schema.media.id, id)).get()!;

  expect((await progress({ view: true, openSeconds: 1 })).status).toBe(200);
  expect(row().viewCount).toBe(0);
  expect(row().lastViewedAt).toBeNull();
  // Skipped past, so "harbour" carries no taste and the item isn't sunk as seen.
  const feed = await json(fetch(`${BASE}/api/discover?surprise=0`));
  expect(feed.items[0].reasonTag).toBeUndefined();

  await progress({ view: true, openSeconds: 2 });
  expect(row().viewCount).toBe(1);
  expect(row().lastViewedAt).toBeGreaterThan(NOW - 1);
});

test('one folder never fills a window of twenty', async () => {
  resetLibrary();
  const others = Array.from({ length: 60 }, (_, i) => add(`other${i}`, []));
  const batch = Array.from({ length: 30 }, (_, i) => add(`shot${i}`, ['cat'], {}, '/lib/batch'));
  const liked = add('liked-cat', ['cat'], likedOn(NOW - 1000), '/lib/liked');
  const ids = await feedIds();
  const newest = [...batch].reverse();

  // Ranked alone, all thirty shots would come first. Four of them, then the liked item (a fifth
  // "cat" card is still within the reason cap), then items from other folders.
  expect(ids.slice(0, 20)).toEqual([...newest.slice(0, 4), liked, ...[...others].reverse().slice(0, 15)]);
  for (let i = 0; i + 20 <= 60; i++) {
    expect(ids.slice(i, i + 20).filter((id) => batch.includes(id)).length).toBeLessThanOrEqual(4);
  }
  // Nothing is dropped: the rest of the batch comes later.
  expect(new Set(ids).size).toBe(91);
});

test('near-duplicates collapse to one per page, wherever they were saved', async () => {
  resetLibrary();
  const others = Array.from({ length: 70 }, (_, i) => add(`other${i}`, []));
  const dupes = Array.from({ length: 10 }, (_, i) =>
    add(`copy${i}`, ['cat'], phashColumns(`ffff0000ffff00${(i * 3).toString(16).padStart(2, '0')}`)),
  );
  add('liked-cat', ['cat'], likedOn(NOW - 1000));
  const page = (await json(fetch(`${BASE}/api/discover?surprise=0&limit=60`))).items.map((m: { id: number }) => m.id);

  expect(page[0]).toBe(dupes[9]);
  expect(page.filter((id: number) => dupes.includes(id))).toEqual([dupes[9]]);
  expect(page).toContain(others[69]);
});

test('pagination never repeats or skips an item, whatever the page size', async () => {
  resetLibrary();
  // Three folders of batches, a reason tag shared by most, near-duplicate hashes: every rule
  // defers something, which is what a keyset cursor couldn't follow.
  for (let i = 0; i < 90; i++) {
    add(`item${i}`, i % 3 ? ['cat'] : ['dog'], phashColumns(i % 4 ? null : `00000000000000${(i % 16).toString(16)}0`), `/lib/f${i % 3}`);
  }
  add('liked-cat', ['cat'], likedOn(NOW - 1000));
  add('liked-dog', ['dog'], likedOn(NOW - 2000));
  const whole = await feedIds('surprise=0.3&seed=5');

  const walked: number[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: { id: number }[]; nextCursor: string | null } = await json(
      fetch(`${BASE}/api/discover?surprise=0.3&seed=5&limit=7${cursor ? `&cursor=${cursor}` : ''}`),
    );
    walked.push(...page.items.map((m) => m.id));
    cursor = page.nextCursor;
  } while (cursor);

  expect(walked).toEqual(whole);
  expect(new Set(walked).size).toBe(92);
  // A keyset cursor from before the feed was re-ranked is refused rather than misread as an offset.
  const legacy = Buffer.from(JSON.stringify([0.43, 12, 1])).toString('base64url');
  expect((await fetch(`${BASE}/api/discover?cursor=${legacy}`)).status).toBe(400);
});
