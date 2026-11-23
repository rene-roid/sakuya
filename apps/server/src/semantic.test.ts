import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type {
  DiscoverLikeResponse,
  Job,
  Media,
  MediaIdsResponse,
  MediaListResponse,
  SemanticStatus,
} from '@sakuya/shared';
import { useTestConfig, waitForJob } from './testConfig';

// ML04: synthetic vectors and a fake encoder only, so CI never downloads the real model.
const dataDir = useTestConfig('semantic', { port: 38974 });
const BASE = 'http://localhost:38974';

const { db, sqlite, schema } = await import('./db');
await import('./index');
const { ClipTokenizer, START_TOKEN, END_TOKEN } = await import('./lib/clipTokenizer');
const { normalize } = await import('./lib/vectors');
const { setClipEncoder } = await import('./services/semanticModels');
const { saveEmbedding, rankByVector, topAfter, clearDescriptionCache } = await import('./services/semantic');
const { fuseRankings } = await import('./routes/discover');
const { upsertTag } = await import('./services/tagger');
const { removeMediaRows } = await import('./services/mediaRemoval');
const { CLIP_MODEL_FILES, CLIP_MODELS_DIR } = await import('./lib/config');

const unit = (...xs: number[]) => normalize(Float32Array.from(xs));

/** Descriptions the fake text encoder knows, as directions in a 4-d space: red, green, blue, text. */
const TEXT: Record<string, Float32Array> = {
  'red umbrella in the rain': unit(1, 0, 0, 0),
  'a green forest': unit(0, 1, 0, 0),
  'the blue sea': unit(0, 0, 1, 0),
  赤い傘: unit(1, 0, 0, 0),
};
const encoded: string[] = [];

/** The image vector is the picture's mean colour, so a red fixture embeds near "red umbrella". */
setClipEncoder({
  async image(file) {
    const { channels } = await sharp(file).stats();
    return unit(channels[0].mean, channels[1].mean, channels[2].mean, 0);
  },
  async text(query) {
    encoded.push(query);
    return TEXT[query] ?? unit(0, 0, 0, 1);
  },
});

const json = async <T>(res: Response | Promise<Response>): Promise<T> => (await (await res).json()) as T;
const post = (url: string, body?: unknown) =>
  fetch(BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const patchSettings = (body: Record<string, string>) =>
  fetch(`${BASE}/api/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const libA = db.insert(schema.libraries).values({ name: 'a', createdAt: Date.now() }).returning().get();
const libB = db.insert(schema.libraries).values({ name: 'b', createdAt: Date.now() }).returning().get();

async function addMedia(
  name: string,
  rgb: [number, number, number],
  opts: { libraryId?: number; type?: 'image' | 'video'; tags?: string[] } = {},
): Promise<number> {
  const file = path.join(dataDir, `${name}.png`);
  await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .png()
    .toFile(file);
  const id = db
    .insert(schema.media)
    .values({
      libraryId: opts.libraryId ?? libA.id,
      source: 'folder',
      path: file,
      filename: `${name}.png`,
      type: opts.type ?? 'image',
      createdAt: Date.now(),
    })
    .returning()
    .get().id;
  for (const tag of opts.tags ?? []) {
    sqlite
      .query(`INSERT INTO media_tags (media_id, tag_id, confidence, source) VALUES (?, ?, NULL, 'user')`)
      .run(id, upsertTag(tag, 'general'));
  }
  return id;
}

const names = async (url: string): Promise<string[]> =>
  (await json<MediaListResponse>(fetch(BASE + url))).items.map((m: Media) => m.filename);

function installFakeModelFiles() {
  for (const f of CLIP_MODEL_FILES) fs.writeFileSync(path.join(CLIP_MODELS_DIR, f.file), 'fake');
}

describe('CLIP tokenizer', () => {
  // A toy vocabulary: the merges build "cat</w>" and "ca" but not "dog", which stays in letters.
  const vocab: Record<string, number> = {
    a: 1,
    'a</w>': 2,
    c: 3,
    t: 4,
    't</w>': 5,
    ca: 6,
    'cat</w>': 7,
    d: 8,
    o: 9,
    'g</w>': 10,
    '!</w>': 11,
    Ã: 12,
    '©</w>': 13,
  };
  const tok = new ClipTokenizer(vocab, '#version: 0.2\nc a\nca t</w>\n');

  test('merges by rank and marks word ends', () => {
    expect(tok.encodeText('a cat')).toEqual([2, 7]);
    expect(tok.encodeText('dog')).toEqual([8, 9, 10]);
    expect(tok.encodeText('ca')).toEqual([3, 2]);
  });

  test('lowercases, collapses whitespace and splits punctuation off words', () => {
    expect(tok.encodeText('  A\n\tCAT! ')).toEqual([2, 7, 11]);
  });

  test('byte-encodes non-ASCII text instead of failing on it', () => {
    // é is bytes C3 A9, which the byte map shows as "Ã" and "©".
    expect(tok.encodeText('é')).toEqual([12, 13]);
  });

  test('wraps in start and end tokens and cuts to the 77-token context', () => {
    expect(tok.encode('a cat')).toEqual([START_TOKEN, 2, 7, END_TOKEN]);
    const long = tok.encode(Array(100).fill('a').join(' '));
    expect(long.length).toBe(77);
    expect(long[0]).toBe(START_TOKEN);
    expect(long[76]).toBe(END_TOKEN);
  });
});

describe('ranking', () => {
  test('query ranking follows cosine order', () => {
    const ids = [9001, 9002, 9003, 9004];
    for (const id of ids) {
      sqlite
        .query(
          `INSERT INTO media (id, library_id, source, path, filename, type, created_at) VALUES (?, ?, 'folder', ?, ?, 'image', 0)`,
        )
        .run(id, libB.id, `/nowhere/${id}.png`, `${id}.png`);
    }
    // Cosines to (1, 0, 0, 0): 0.6, 1, -0.8, 0.
    saveEmbedding(9001, Float32Array.from([0.6, 0.8, 0, 0]));
    saveEmbedding(9002, Float32Array.from([1, 0, 0, 0]));
    saveEmbedding(9003, Float32Array.from([-0.8, 0, 0.6, 0]));
    saveEmbedding(9004, Float32Array.from([0, 0, 0, 1]));
    const ranked = rankByVector(Float32Array.from([1, 0, 0, 0]), new Set(ids));
    expect(ranked.map((r) => r.id)).toEqual([9002, 9001, 9004, 9003]);
    // Stored as float16: 0.6 comes back as 0.60009765625.
    expect(ranked.map((r) => r.score)).toEqual([1, 0.60009765625, 0, -0.7998046875]);
    removeMediaRows(ids);
  });

  test('a page is the best items after the cursor, ties going to the newer id', () => {
    const ranking = { ids: Int32Array.from([1, 2, 3, 4, 5]), scores: Float64Array.from([0.5, 0.9, 0.5, 0.1, 0.5]) };
    expect(topAfter(ranking, 2)).toEqual([
      { id: 2, score: 0.9 },
      { id: 5, score: 0.5 },
    ]);
    expect(topAfter(ranking, 2, { id: 5, score: 0.5 }).map((r) => r.id)).toEqual([3, 1]);
    expect(topAfter(ranking, 9, { id: 1, score: 0.5 }).map((r) => r.id)).toEqual([4]);
    expect(topAfter(ranking, 9, undefined, new Set([2, 3])).map((r) => r.id)).toEqual([5, 1, 4]);
  });

  test('fusion adds each list’s reciprocal rank, weighted', () => {
    // k = 1: a = 1/2 + 1/4 = 0.75, b = 1/3 + 1/2 = 0.833, c = 1/4, d = 1/3.
    expect(
      fuseRankings(
        [
          { ids: [1, 2, 3], weight: 1 },
          { ids: [2, 4, 1], weight: 1 },
        ],
        10,
        1,
      ),
    ).toEqual([2, 1, 4, 3]);
    // Doubling the second list puts its leader first.
    expect(
      fuseRankings(
        [
          { ids: [1, 2, 3], weight: 1 },
          { ids: [4, 2], weight: 2 },
        ],
        2,
        1,
      ),
    ).toEqual([4, 2]);
  });
});

describe('search by description', () => {
  let red: number, crimson: number, green: number, redVideo: number;

  test('reports why it cannot run until enabled, downloaded and indexed', async () => {
    red = await addMedia('red', [230, 20, 20], { tags: ['umbrella'] });
    crimson = await addMedia('crimson', [180, 40, 60]);
    green = await addMedia('green', [20, 200, 30], { tags: ['umbrella'] });
    await addMedia('blue', [10, 30, 220]);
    redVideo = await addMedia('red-video', [200, 10, 10], { type: 'video' });
    await addMedia('red-b', [210, 30, 30], { libraryId: libB.id });

    const search = () => json<MediaListResponse>(fetch(`${BASE}/api/media?describe=red%20umbrella%20in%20the%20rain`));
    let body = await search();
    expect(body.semantic).toEqual({ status: 'disabled', embeddedCount: 0, pendingCount: 6 });
    expect(body.items).toEqual([]);

    await patchSettings({ semantic_search_enabled: '1' });
    expect((await search()).semantic?.status).toBe('no-model');
    expect((await json<SemanticStatus>(fetch(`${BASE}/api/semantic/status`))).status).toBe('absent');
    expect((await post('/api/semantic/run')).status).toBe(409);

    installFakeModelFiles();
    body = await search();
    expect(body.semantic).toEqual({ status: 'empty', embeddedCount: 0, pendingCount: 6 });
    expect(encoded).toEqual([]);
  });

  test('the embeddings job indexes every file once, videos from their thumbnail', async () => {
    // A video is read from its thumbnail frame; give the red video a red one.
    const { thumbPathFor } = await import('./services/thumbnailer');
    fs.mkdirSync(path.dirname(thumbPathFor(redVideo)), { recursive: true });
    await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 10, b: 10 } } })
      .webp()
      .toFile(thumbPathFor(redVideo));

    const { job } = await json<{ job: Job }>(post('/api/semantic/run'));
    const done = await waitForJob(job.id);
    expect(done.status).toBe('done');
    expect(done.log).toContain('Completed. 6 files indexed.');
    const status = await json<SemanticStatus>(fetch(`${BASE}/api/semantic/status`));
    expect(status).toMatchObject({ status: 'ready', enabled: true, embeddedCount: 6, pendingCount: 0 });

    // Nothing left to do: a second run is refused and the count stays.
    expect((await post('/api/semantic/run')).status).toBe(409);
    expect((sqlite.query('SELECT COUNT(*) AS c FROM media_embeddings').get() as { c: number }).c).toBe(6);
  });

  test('ranks the grid by fit to the description', async () => {
    const body = await json<MediaListResponse>(fetch(`${BASE}/api/media?describe=red%20umbrella%20in%20the%20rain`));
    expect(body.semantic).toEqual({ status: 'ready', embeddedCount: 6, pendingCount: 0 });
    expect(body.total).toBe(6);
    expect(body.items.map((m: Media) => m.filename)).toEqual([
      'red-video.png',
      'red.png',
      'red-b.png',
      'crimson.png',
      'green.png',
      'blue.png',
    ]);
    expect(await names('/api/media?describe=the%20blue%20sea&limit=1')).toEqual(['blue.png']);
  });

  test('pages through the ranking with a cursor', async () => {
    const seen: string[] = [];
    let cursor = '';
    for (let i = 0; i < 4; i++) {
      const page = await json<MediaListResponse>(
        fetch(`${BASE}/api/media?describe=a%20green%20forest&limit=2${cursor ? `&cursor=${cursor}` : ''}`),
      );
      seen.push(...page.items.map((m: Media) => m.filename));
      if (i > 0) expect(page.total).toBeNull();
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(['green.png', 'crimson.png', 'red-b.png', 'blue.png', 'red.png', 'red-video.png']);
    expect(
      (await fetch(`${BASE}/api/media?describe=x&cursor=${Buffer.from('["a",1]').toString('base64url')}`)).status,
    ).toBe(400);
  });

  test('combines with the library, type, tag and text filters', async () => {
    const q = '/api/media?describe=red%20umbrella%20in%20the%20rain';
    expect(await names(`${q}&type=image`)).toEqual(['red.png', 'red-b.png', 'crimson.png', 'green.png', 'blue.png']);
    expect(await names(`${q}&libraryId=${libB.id}`)).toEqual(['red-b.png']);
    expect(await names(`${q}&tags=umbrella`)).toEqual(['red.png', 'green.png']);
    expect(await names(`${q}&q=crimson`)).toEqual(['crimson.png']);
    const ids = await json<MediaIdsResponse>(
      fetch(`${BASE}/api/media/ids?describe=red%20umbrella%20in%20the%20rain&tags=umbrella`),
    );
    expect(ids).toEqual({ ids: [red, green], total: 2 });
  });

  test('takes any language, and an empty description is the normal grid', async () => {
    const body = await json<MediaListResponse>(fetch(`${BASE}/api/media?describe=${encodeURIComponent('赤い傘')}`));
    expect(body.semantic?.status).toBe('ready');
    expect(body.items.map((m: Media) => m.filename)).toEqual([
      'red-video.png',
      'red.png',
      'red-b.png',
      'crimson.png',
      'green.png',
      'blue.png',
    ]);
    const plain = await json<MediaListResponse>(fetch(`${BASE}/api/media?describe=%20&sort=name`));
    expect(plain.semantic).toBeUndefined();
    expect(plain.items.map((m: Media) => m.filename)).toEqual([
      'blue.png',
      'crimson.png',
      'green.png',
      'red-b.png',
      'red-video.png',
      'red.png',
    ]);
  });

  test('encodes a description once however many pages are read', async () => {
    clearDescriptionCache();
    encoded.length = 0;
    await fetch(`${BASE}/api/media?describe=the%20blue%20sea&limit=1`);
    await fetch(`${BASE}/api/media?describe=The%20Blue%20Sea&limit=2`);
    expect(encoded).toEqual(['the blue sea']);
  });

  test('a deleted file leaves the ranking and its embedding goes with it', async () => {
    removeMediaRows([crimson]);
    expect(await names('/api/media?describe=red%20umbrella%20in%20the%20rain&type=image')).toEqual([
      'red.png',
      'red-b.png',
      'green.png',
      'blue.png',
    ]);
    expect(sqlite.query('SELECT 1 FROM media_embeddings WHERE media_id = ?').get(crimson)).toBeNull();
  });

  test('new files are indexed after a scan when enabled', async () => {
    const { dispatchAfterScan } = await import('./services/jobScheduler');
    const orange = await addMedia('orange', [240, 120, 0]);
    dispatchAfterScan(libA.id);
    const job = db
      .select()
      .from(schema.jobs)
      .all()
      .filter((j) => j.type === 'embeddings')
      .at(-1)!;
    expect(job.label).toBe('Index for search: a');
    await waitForJob(job.id);
    expect(sqlite.query('SELECT 1 FROM media_embeddings WHERE media_id = ?').get(orange)).not.toBeNull();
  });
});

describe('more like this', () => {
  test('blends image neighbours into the shared-tag ranking, tags alone when off', async () => {
    const src = await addMedia('like-src', [250, 0, 0], { tags: ['rare_hat'] });
    const tagTwin = await addMedia('like-tag-twin', [0, 0, 250], { tags: ['rare_hat'] });
    const lookAlike = await addMedia('like-look-alike', [245, 5, 5]);
    await waitForJob((await json<{ job: Job }>(post('/api/semantic/run'))).job.id);

    const like = await json<DiscoverLikeResponse>(fetch(`${BASE}/api/discover/like/${src}?limit=4`));
    expect(like.ranking).toBe('visual');
    const ids = like.items.map((m: Media) => m.id);
    // Each leads one list, so they tie on 1 / (k + 1) and the newer id goes first.
    expect(ids.slice(0, 2)).toEqual([lookAlike, tagTwin]);
    expect(ids.length).toBe(4);
    expect(ids).not.toContain(src);

    // A hidden item stays out of the image neighbours too.
    await post('/api/discover/feedback', { mediaId: lookAlike, hidden: true });
    expect(
      (await json<DiscoverLikeResponse>(fetch(`${BASE}/api/discover/like/${src}?limit=4`))).items.map(
        (m: Media) => m.id,
      ),
    ).not.toContain(lookAlike);
    await post('/api/discover/feedback', { mediaId: lookAlike, hidden: false });

    await patchSettings({ semantic_search_enabled: '0' });
    const tagsOnly = await json<DiscoverLikeResponse>(fetch(`${BASE}/api/discover/like/${src}`));
    expect(tagsOnly.ranking).toBe('tags');
    expect(tagsOnly.items.map((m: Media) => m.id)).toEqual([tagTwin]);
  });
});
