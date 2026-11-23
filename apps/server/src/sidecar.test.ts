import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { useTestConfig, waitForJob } from './testConfig';

const dataDir = useTestConfig('sidecar', { port: 38961 }); // M01
const BASE = 'http://localhost:38961';

const { applyPredictedTags } = await import('./services/tagger');
await import('./index');

const request = async (method: string, url: string, body?: unknown): Promise<any> => {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
};

const root = path.join(dataDir, 'downloads');
fs.mkdirSync(root);

let shade = 0;
async function writeImage(name: string) {
  shade += 20;
  await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: shade, g: 0, b: 0 } } })
    .png()
    .toFile(path.join(root, name));
}

let sidecarClock = Date.now() / 1000 - 1000;
function writeJson(name: string, content: unknown) {
  const file = path.join(root, name);
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  // Distinct mtimes, so a rewrite inside the same millisecond still reads as a change.
  sidecarClock += 10;
  fs.utimesSync(file, sidecarClock, sidecarClock);
}

const library = await request('POST', '/api/libraries', { name: 'downloads' });
await request('POST', `/api/libraries/${library.id}/folders`, { path: root });

async function scan() {
  const { job } = await request('POST', `/api/libraries/${library.id}/scan`);
  return waitForJob(job.id);
}

async function itemByName(filename: string) {
  const list = await request('GET', `/api/media?libraryId=${library.id}&limit=100`);
  const item = list.items.find((m: { filename: string }) => m.filename === filename);
  return request('GET', `/api/media/${item.id}`);
}

type Tag = { name: string; category: string; source: string };
const tagsOf = (detail: { tags: Tag[] }) =>
  detail.tags.map((t) => `${t.category}:${t.name}:${t.source}`).sort();

await writeImage('danbooru.png');
writeJson('danbooru.png.json', {
  category: 'danbooru',
  subcategory: 'post',
  id: 4242,
  tag_string_artist: 'david_revoy',
  tag_string_copyright: 'pepper&carrot',
  tag_string_character: 'pepper_(pepper&carrot) carrot_(pepper&carrot)',
  tag_string_general: '1girl witch_hat cat',
  tag_string_meta: 'highres',
  tag_string: 'david_revoy pepper&carrot 1girl witch_hat cat highres',
  rating: 'g',
  source: 'https://www.peppercarrot.com/en/webcomic/ep01.html',
});
await writeImage('gelbooru.jpg.png');
writeJson('gelbooru.jpg.png.json', {
  category: 'gelbooru',
  id: 77,
  tags: '1girl solo david_revoy pepper&carrot',
  tags_artist: ['david_revoy'],
  tags_copyright: ['pepper&carrot'],
  tags_character: [],
  tags_general: ['1girl', 'solo'],
});
await writeImage('pixiv.png');
writeJson('pixiv.png.json', {
  category: 'pixiv',
  id: 123456,
  title: 'Episode 1',
  user: { id: 1, name: 'David Revoy', account: 'deevad' },
  tags: ['オリジナル', 'Pepper&Carrot', 'witch'],
});
await writeImage('e621.png');
writeJson('e621.png.json', {
  category: 'e621',
  id: 5,
  tags: { artist: ['revoy'], general: ['fox'], species: ['canine'], meta: ['hi_res'], invalid: ['x'] },
});
await writeImage('tweet.png');
writeJson('tweet.png.json', {
  category: 'twitter',
  tweet_id: 111,
  author: { name: 'davidrevoy', nick: 'David Revoy' },
  user: { name: 'timeline_owner' },
  hashtags: ['krita'],
});
// The stem-named form, with fields no extractor mapping knows about.
await writeImage('generic.png');
writeJson('generic.json', {
  tags: ['Blue Sky', 'clouds'],
  post_url: 'https://example.org/p/9',
  unknown: { nested: [1, 2, 3] },
  width: 8,
});
await writeImage('unsafe.png');
writeJson('unsafe.png.json', { post_url: 'javascript:alert(1)', source: 'ftp://example.org/x', tags: ['ok'] });
await writeImage('malformed.png');
writeJson('malformed.png.json', '{"tags": ["never", ');
await writeImage('plain.png');

const firstScan = await scan();

describe('gallery-dl sidecars', () => {
  test('a sidecar adds artist and copyright tags and the source URL', async () => {
    const detail = await itemByName('danbooru.png');
    expect(tagsOf(detail)).toEqual([
      'artist:david_revoy:meta',
      'character:carrot_(pepper&carrot):meta',
      'character:pepper_(pepper&carrot):meta',
      'copyright:pepper&carrot:meta',
      'general:1girl:meta',
      'general:cat:meta',
      'general:witch_hat:meta',
    ]);
    expect(detail.sourceUrl).toBe('https://danbooru.donmai.us/posts/4242');
    // Artist and series come first, the order the viewer groups them in.
    expect(detail.tags.slice(0, 2).map((t: Tag) => t.category)).toEqual(['artist', 'copyright']);
  });

  test('gelbooru categorised tag lists map to their categories, and the post page is built from the id', async () => {
    const detail = await itemByName('gelbooru.jpg.png');
    expect(tagsOf(detail)).toEqual([
      'artist:david_revoy:meta',
      'copyright:pepper&carrot:meta',
      'general:1girl:meta',
      'general:solo:meta',
    ]);
    expect(detail.sourceUrl).toBe('https://gelbooru.com/index.php?page=post&s=view&id=77');
  });

  test('a pixiv user becomes the artist and its tags become general tags', async () => {
    const detail = await itemByName('pixiv.png');
    expect(tagsOf(detail)).toEqual([
      'artist:david_revoy:meta',
      // Uncategorised on pixiv, but the boorus above already filed it as a series.
      'copyright:pepper&carrot:meta',
      'general:witch:meta',
      'general:オリジナル:meta',
    ]);
    expect(detail.sourceUrl).toBe('https://www.pixiv.net/artworks/123456');
  });

  test('e621 tag groups map by key and skip meta and invalid', async () => {
    const detail = await itemByName('e621.png');
    expect(tagsOf(detail)).toEqual(['artist:revoy:meta', 'general:canine:meta', 'general:fox:meta']);
    expect(detail.sourceUrl).toBe('https://e621.net/posts/5');
  });

  test('a tweet author is the artist, not the timeline it was downloaded from', async () => {
    const detail = await itemByName('tweet.png');
    expect(tagsOf(detail)).toEqual(['artist:davidrevoy:meta']);
    expect(detail.sourceUrl).toBe('https://x.com/davidrevoy/status/111');
  });

  test('a generic tags array maps to general tags, unknown fields are ignored', async () => {
    const detail = await itemByName('generic.png');
    expect(tagsOf(detail)).toEqual(['general:blue_sky:meta', 'general:clouds:meta']);
    expect(detail.sourceUrl).toBe('https://example.org/p/9');
  });

  test('a source URL that is not http(s) is dropped', async () => {
    const detail = await itemByName('unsafe.png');
    expect(tagsOf(detail)).toEqual(['general:ok:meta']);
    expect(detail.sourceUrl).toBeNull();
  });

  test('a malformed sidecar is logged and the scan carries on', async () => {
    expect(firstScan.status).toBe('done');
    expect(firstScan.log).toBe('Completed. 9 indexed, 0 unchanged, 0 removed, 1 unreadable metadata files.');
    const detail = await itemByName('malformed.png');
    expect(detail.tags).toEqual([]);
    expect(detail.sourceUrl).toBeNull();
  });

  test('sidecars are not indexed as media', async () => {
    const list = await request('GET', `/api/media?libraryId=${library.id}&limit=100`);
    expect(list.total).toBe(9);
    expect(list.items.some((m: { filename: string }) => m.filename.endsWith('.json'))).toBe(false);
  });

  test('filtering by an artist finds only their items, and artists are listed by category', async () => {
    const list = await request('GET', `/api/media?tags=david_revoy&limit=100`);
    expect(list.items.map((m: { filename: string }) => m.filename).sort()).toEqual([
      'danbooru.png',
      'gelbooru.jpg.png',
      'pixiv.png',
    ]);
    const artists = await request('GET', `/api/tags?libraryId=${library.id}&category=artist`);
    expect(artists.map((t: { name: string; count: number }) => [t.name, t.count])).toEqual([
      ['david_revoy', 3],
      ['davidrevoy', 1],
      ['revoy', 1],
    ]);
  });

  test('an AI retag replaces only AI tags and keeps the sidecar ones', async () => {
    const before = await itemByName('danbooru.png');
    applyPredictedTags(before.id, [
      { name: 'cat', category: 'general', confidence: 0.9 },
      { name: 'smile', category: 'general', confidence: 0.8 },
    ]);
    const tagged = await request('GET', `/api/media/${before.id}`);
    expect(tagsOf(tagged)).toEqual([...tagsOf(before), 'general:smile:ai'].sort());

    applyPredictedTags(before.id, []);
    expect(tagsOf(await request('GET', `/api/media/${before.id}`))).toEqual(tagsOf(before));
  });

  test('a sidecar written next to an already indexed file is read on the next scan', async () => {
    expect(tagsOf(await itemByName('plain.png'))).toEqual([]);
    writeJson('plain.png.json', { category: 'danbooru', id: 9, tag_string_artist: 'late_artist' });
    const job = await scan();
    // The malformed sidecar hasn't changed since the first scan, so it isn't read (or counted) again.
    expect(job.log).toBe('Completed. 0 indexed, 9 unchanged, 0 removed.');
    const detail = await itemByName('plain.png');
    expect(tagsOf(detail)).toEqual(['artist:late_artist:meta']);
    expect(detail.sourceUrl).toBe('https://danbooru.donmai.us/posts/9');
  });

  test('a changed sidecar replaces its tags, and user tags and hand-removed ones stay as the user left them', async () => {
    const detail = await itemByName('generic.png');
    await request('PATCH', `/api/media/${detail.id}/tags`, { add: ['favourite'], remove: ['clouds'] });
    writeJson('generic.json', { tags: ['Blue Sky', 'clouds', 'sunset'], page_url: 'https://example.org/page/10' });
    await scan();
    const after = await request('GET', `/api/media/${detail.id}`);
    expect(tagsOf(after)).toEqual(['general:blue_sky:meta', 'general:sunset:meta', 'user:favourite:user']);
    expect(after.sourceUrl).toBe('https://example.org/page/10');
  });
});
