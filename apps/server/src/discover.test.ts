import { describe, expect, test } from 'bun:test';
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
  sqlite.exec(`DELETE FROM media_tags; DELETE FROM media; DELETE FROM tags; DELETE FROM tag_preferences;
               DELETE FROM media_feedback; DELETE FROM settings WHERE key LIKE 'discover_%';`);
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

const send = (method: string, path: string, body?: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const setMode = (tag: string, mode: string | null) => send('PUT', `/api/discover/tags/${encodeURIComponent(tag)}`, { mode });
const hide = (mediaId: number, hidden = true) => send('POST', '/api/discover/feedback', { mediaId, hidden });

/** Two tags liked alike, one unseen item each; beta's item wins the tie on id. */
function seedAlphaBeta() {
  resetLibrary();
  const likedA = [1, 2].map((i) => add(`liked-a${i}`, ['alpha'], likedOn(NOW - 1000)));
  const likedB = [1, 2].map((i) => add(`liked-b${i}`, ['beta'], likedOn(NOW - 1000)));
  const alpha = add('alpha', ['alpha']);
  const beta = add('beta', ['beta']);
  return { likedA, likedB, alpha, beta };
}

test('boost raises an item above an unboosted peer, and clearing it restores the order', async () => {
  const { likedA, likedB, alpha, beta } = seedAlphaBeta();
  const before = [beta, alpha, likedB[1], likedB[0], likedA[1], likedA[0]];
  expect(await feedIds()).toEqual(before);

  expect((await setMode('alpha', 'boost')).status).toBe(200);
  // Doubled, alpha's unseen item leads and even its already-seen ones (x0.4 of a doubled
  // weight) sit right under beta's unseen one (half the new best score).
  expect(await feedIds()).toEqual([alpha, beta, likedA[1], likedA[0], likedB[1], likedB[0]]);

  await setMode('alpha', null);
  expect(await feedIds()).toEqual(before);
});

test('less of a tag cuts it to a quarter without hiding anything', async () => {
  const { likedA, likedB, alpha, beta } = seedAlphaBeta();
  await setMode('beta', 'less');
  // beta's unseen item (0.25) now ranks under alpha's already-seen ones (0.4), but stays.
  expect(await feedIds()).toEqual([alpha, likedA[1], likedA[0], beta, likedB[1], likedB[0]]);
  const feed = await json(fetch(`${BASE}/api/discover?surprise=0`));
  expect(feed.total).toBe(6);
  expect(feed.items[3].reasonTag).toBe('beta');
});

test('a muted tag removes its items from the feed and its total, and unmuting brings them back', async () => {
  resetLibrary();
  const rainLiked = add('rain-liked', ['rain'], likedOn(NOW - 1000));
  const snowLiked = add('snow-liked', ['snow'], likedOn(NOW - 1000));
  const rain = add('rain', ['rain', 'street']);
  const snow = add('snow', ['snow']);
  const plain = add('plain', ['street']);

  await setMode('rain', 'mute');
  const feed = await json(fetch(`${BASE}/api/discover?surprise=0`));
  expect(feed.items.map((m: { id: number }) => m.id)).toEqual([snow, snowLiked, plain]);
  expect(feed.total).toBe(3);

  await setMode('rain', null);
  expect((await feedIds()).sort((a, b) => a - b)).toEqual([rainLiked, snowLiked, rain, snow, plain]);
});

test('every taste tag muted: the profile says so and the feed falls back to random', async () => {
  seedAlphaBeta();
  const plain = add('plain', []);
  await setMode('alpha', 'mute');
  await setMode('beta', 'mute');
  const profile = await json(fetch(`${BASE}/api/discover/profile`));
  expect(profile.activeTags).toBe(0);
  expect(profile.tags.map((t: { name: string; mode: string }) => [t.name, t.mode])).toEqual([
    ['alpha', 'mute'],
    ['beta', 'mute'],
  ]);
  const feed = await json(fetch(`${BASE}/api/discover?surprise=0`));
  expect(feed.items.map((m: { id: number }) => m.id)).toEqual([plain]);
  expect(feed.items[0].reasonTag).toBeUndefined();
});

test('hidden items never return, and undoing the hide puts them back in place', async () => {
  const { likedA, likedB, alpha, beta } = seedAlphaBeta();
  const before = await feedIds();

  expect((await hide(beta)).status).toBe(200);
  const after = await feedIds();
  expect(after).not.toContain(beta);
  expect(after).toEqual([alpha, likedA[1], likedA[0], likedB[1], likedB[0]]);
  // A reshuffle or a pure-random feed doesn't bring it back either.
  expect(await feedIds('surprise=1&seed=99')).not.toContain(beta);
  expect((await json(fetch(`${BASE}/api/discover/profile`))).hiddenCount).toBe(1);

  await hide(beta, false);
  expect(await feedIds()).toEqual(before);
  expect((await hide(999_999)).status).toBe(404);
});

test('not interested lowers the hidden item\'s tags a little', async () => {
  resetLibrary();
  // Same usage for both tags (three items each), so only the hide tells them apart.
  [1, 2].forEach((i) => add(`liked-cat${i}`, ['cat'], likedOn(NOW - 1000)));
  [1, 2].forEach((i) => add(`liked-dog${i}`, ['dog'], likedOn(NOW - 1000)));
  const cat = add('cat', ['cat']);
  add('dog', ['dog']);
  const weights = async () =>
    Object.fromEntries(
      (await json(fetch(`${BASE}/api/discover/profile`))).tags.map((t: { name: string; weight: number }) => [
        t.name,
        t.weight,
      ]),
    );
  expect(await weights()).toEqual({ cat: 1, dog: 1 });
  await hide(cat);
  // Two likes with one view each are 2 x 5.6 = 11.2; the hide takes 1.5 of that.
  const after = await weights();
  expect(after.dog).toBe(1);
  expect(after.cat).toBeCloseTo(9.7 / 11.2, 6);
});

test('the taste panel lists display names, neighbours and preferences', async () => {
  resetLibrary();
  add('liked1', ['hatsune_miku', 'stage'], likedOn(NOW - 1000));
  add('liked2', ['hatsune_miku'], likedOn(NOW - 1000));
  add('bridge1', ['hatsune_miku', 'microphone']);
  add('bridge2', ['hatsune_miku', 'microphone']);
  sqlite.exec(`UPDATE tags SET category = 'character', display_name = 'Miku' WHERE name = 'hatsune_miku'`);
  await setMode('stage', 'less');
  await setMode('long_gone', 'boost');
  const profile = await json(fetch(`${BASE}/api/discover/profile`));
  expect(profile.activeTags).toBe(2);
  const rounded = profile.tags.map((t: { weight: number }) => ({ ...t, weight: Math.round(t.weight * 1000) / 1000 }));
  expect(rounded).toEqual([
    { name: 'hatsune_miku', category: 'character', displayName: 'Miku', weight: 1, related: false, mode: null },
    // Bars show engagement before preferences: stage's one like, 5.6 / (1 + 8), against miku's
    // 11.2 / (4 + 8).
    { name: 'stage', category: 'general', displayName: null, weight: 0.667, related: false, mode: 'less' },
    // A neighbour enters at 0.35 of the weakest seed, which is stage after "less" cut it to a
    // quarter: 0.622 x 0.25 x 0.35 / 0.933.
    { name: 'microphone', category: 'general', displayName: null, weight: 0.058, related: true, mode: null },
    // A preference on a tag no item carries any more is still listed, so it can be taken back.
    { name: 'long_gone', category: 'general', displayName: null, weight: 0, related: false, mode: 'boost' },
  ]);
  expect((await setMode('stage', 'loud' as string)).status).toBe(400);
});

describe('shelves', () => {
  const DAYS = (n: number) => NOW - n * DAY;
  const old = { createdAt: DAYS(10) };
  let ids: Record<string, number[]>;

  function seedShelves() {
    resetLibrary();
    const liked = { ...likedOn(NOW - 1000), ...old };
    ids = {
      foxLiked: [1, 2, 3, 4, 5].map((i) => add(`fox-liked${i}`, ['fox'], liked)),
      owlLiked: [1, 2, 3].map((i) => add(`owl-liked${i}`, ['owl'], liked)),
      fox: [1, 2, 3, 4].map((i) => add(`fox${i}`, ['fox'], old)),
      // "forest" only ever travels with fox, so it's a neighbour, never your own taste.
      bridge: [1, 2].map((i) => add(`bridge${i}`, ['fox', 'forest'], old)),
      owl: [1, 2, 3].map((i) => add(`owl${i}`, ['owl'], old)),
      forest: [1, 2, 3].map((i) => add(`forest${i}`, ['forest'], old)),
      heronOld: [1, 2, 3].map((i) =>
        add(`heron-old${i}`, ['heron'], { liked: 1, likedAt: DAYS(90), viewCount: 1, lastViewedAt: DAYS(90), ...old }),
      ),
      heronOpened: [add('heron-opened', ['heron'], { liked: 1, likedAt: DAYS(90), viewCount: 2, lastViewedAt: DAYS(10), ...old })],
      heronRecent: [add('heron-recent', ['heron'], { liked: 1, likedAt: DAYS(20), viewCount: 1, lastViewedAt: DAYS(20), ...old })],
      fresh: [1, 2, 3].map((i) => add(`new${i}`, ['plain'], { createdAt: NOW - 1000 })),
    };
    sqlite.query(`INSERT INTO settings (key, value) VALUES ('discover_last_visit', ?)`).run(String(DAYS(5)));
  }

  const shelves = async (q = 'surprise=0') => (await json(fetch(`${BASE}/api/discover/shelves?${q}`))).shelves;
  const shelfIds = (list: { id: string; items: { id: number }[] }[]) =>
    Object.fromEntries(list.map((s) => [s.id, s.items.map((m) => m.id)]));
  const desc = (xs: number[]) => [...xs].reverse();

  test('each shelf holds exactly what its title says, and empty shelves are left off', async () => {
    seedShelves();
    const list = await shelves();
    expect(list.map((s: { id: string; title: string }) => [s.id, s.title])).toEqual([
      ['like:fox', 'Because you like fox'],
      ['like:owl', 'Because you like owl'],
      // heron is the third taste tag, but every heron item is already liked: no shelf.
      ['new', 'New since your last visit'],
      ['rediscover', 'Rediscover'],
      ['offbeat', 'Off the beaten path'],
    ]);
    expect(shelfIds(list)).toEqual({
      // Unseen only. The bridges carry fox and forest, so they score above fox alone.
      'like:fox': [...desc(ids.bridge), ...desc(ids.fox)],
      'like:owl': desc(ids.owl),
      new: desc(ids.fresh),
      // Liked over 60 days ago and not opened for 30: not the one opened 10 days ago, not the
      // one liked 20 days ago.
      rediscover: desc(ids.heronOld),
      // Best match is a neighbour tag, not one you engaged with.
      offbeat: desc(ids.forest),
    });
    expect(list[0].tag).toBe('fox');
    expect(list[4].items[0].reasonTag).toBe('forest');
    expect(list[4].items[0].reasonRelated).toBe(true);
  });

  test('see all is the feed narrowed to the shelf, paged and counted', async () => {
    seedShelves();
    const first = await json(fetch(`${BASE}/api/discover?shelf=like:fox&surprise=0&limit=4`));
    expect(first.total).toBe(6);
    expect(first.items.map((m: { id: number }) => m.id)).toEqual([...desc(ids.bridge), ...desc(ids.fox).slice(0, 2)]);
    const second = await json(fetch(`${BASE}/api/discover?shelf=like:fox&surprise=0&limit=4&cursor=${first.nextCursor}`));
    expect(second.items.map((m: { id: number }) => m.id)).toEqual(desc(ids.fox).slice(2));
    expect(second.nextCursor).toBeNull();

    expect((await feedIds('surprise=0&shelf=rediscover')).sort((a, b) => a - b)).toEqual(ids.heronOld);
    expect((await fetch(`${BASE}/api/discover?shelf=nonsense`)).status).toBe(404);
    expect((await fetch(`${BASE}/api/discover?shelf=like:no_such_tag`)).status).toBe(404);
  });

  test('muting the top tag hands its shelf to the next tag and empties everything it carried', async () => {
    seedShelves();
    await setMode('fox', 'mute');
    const list = await shelves();
    // forest was only a neighbour of fox, so off the beaten path goes with it.
    expect(list.map((s: { id: string }) => s.id)).toEqual(['like:owl', 'new', 'rediscover']);
    const shown = list.flatMap((s: { items: { id: number }[] }) => s.items.map((m) => m.id));
    for (const id of [...ids.fox, ...ids.bridge]) expect(shown).not.toContain(id);
  });

  test('a cold start shows only the shelves that need no taste', async () => {
    resetLibrary();
    const fresh = [1, 2, 3].map((i) => add(`new${i}`, ['plain'], { createdAt: NOW - 1000 }));
    sqlite.query(`INSERT INTO settings (key, value) VALUES ('discover_last_visit', ?)`).run(String(DAYS(1)));
    expect(shelfIds(await shelves())).toEqual({ new: desc(fresh) });
  });

  test('the last visit moves only after a break, not on every page open', async () => {
    resetLibrary();
    const setting = (key: string) =>
      (sqlite.query(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | null)?.value ?? null;
    // First ever visit: nothing to compare against yet, so no "new" shelf.
    await shelves('visit=1');
    expect(setting('discover_last_visit')).toBeNull();
    const firstOpen = Number(setting('discover_visit_at'));
    expect(firstOpen).toBeGreaterThanOrEqual(NOW);

    // A reload a moment later is the same visit.
    await shelves('visit=1');
    expect(setting('discover_last_visit')).toBeNull();

    // Back after an hour: the previous visit is what "new" is measured from.
    sqlite.query(`UPDATE settings SET value = ? WHERE key = 'discover_visit_at'`).run(String(NOW - 3_600_000));
    await shelves('visit=1');
    expect(setting('discover_last_visit')).toBe(String(NOW - 3_600_000));
  });
});

describe('more like this', () => {
  function seedLike() {
    resetLibrary();
    const items = {
      source: add('source', ['rain', 'umbrella', 'outdoors', 'general']),
      both: add('both', ['rain', 'umbrella']),
      rainOnly: add('rain-only', ['rain']),
      umbrellaOnly: add('umbrella-only', ['umbrella']),
      umbrella2: add('umbrella2', ['umbrella']),
      outdoors: [1, 2, 3, 4, 5].map((i) => add(`outdoors${i}`, ['outdoors'])),
      ratingOnly: add('rating-only', ['general']),
      untagged: add('untagged', []),
    };
    sqlite.exec(`UPDATE tags SET category = 'rating' WHERE name = 'general'`);
    return items;
  }
  const like = async (id: number) => json(fetch(`${BASE}/api/discover/like/${id}`));
  const likeIds = async (id: number) => (await like(id)).items.map((m: { id: number }) => m.id);

  test('a rare shared tag outranks a common one, and sharing two beats sharing one', async () => {
    const it = seedLike();
    // 12 items: rain is on 3 (ln 4 = 1.39), umbrella on 4 (ln 3 = 1.10), outdoors on 6 (ln 2 = 0.69).
    const res = await like(it.source);
    expect(res.source.id).toBe(it.source);
    expect(res.items.map((m: { id: number }) => m.id)).toEqual([
      it.both,
      it.rainOnly,
      it.umbrella2,
      it.umbrellaOnly,
      ...[...it.outdoors].reverse(),
    ]);
    // The card credits the rarest tag each item shares.
    expect(res.items.map((m: { reasonTag: string }) => m.reasonTag)).toEqual([
      'rain',
      'rain',
      'umbrella',
      'umbrella',
      'outdoors',
      'outdoors',
      'outdoors',
      'outdoors',
      'outdoors',
    ]);
  });

  test('hidden items and muted tags are left out', async () => {
    const it = seedLike();
    await hide(it.both);
    await setMode('outdoors', 'mute');
    expect(await likeIds(it.source)).toEqual([it.rainOnly, it.umbrella2, it.umbrellaOnly]);
  });

  test('an untagged or rating-only item has nothing to match, and a missing one is a 404', async () => {
    const it = seedLike();
    expect(await likeIds(it.untagged)).toEqual([]);
    expect(await likeIds(it.ratingOnly)).toEqual([]);
    expect((await fetch(`${BASE}/api/discover/like/999999`)).status).toBe(404);
    expect((await fetch(`${BASE}/api/discover/like/abc`)).status).toBe(400);
  });
});
