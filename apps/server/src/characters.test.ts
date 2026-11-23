import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { useTestConfig, waitForJob } from './testConfig';

// ML02: synthetic embeddings only, so CI never downloads the real models.
const dataDir = useTestConfig('characters', { port: 38957 });
const BASE = 'http://localhost:38957';

const { db, sqlite, schema } = await import('./db');
await import('./index');
const { dot, packFloat16, unpackFloat16, normalize } = await import('./lib/vectors');
const { clusterIncrementally } = await import('./lib/characterClusters');
const { DEFAULT_CCIP_PARAMS } = await import('./services/characterModels');
const { clusterDetections, clusterParams, saveDetections, enqueueCharacterJob, characterCropDirFor } =
  await import('./services/characters');
const { removeMediaRows } = await import('./services/mediaRemoval');
const { upsertTag } = await import('./services/tagger');

const DIMS = 768;
const params = clusterParams(DEFAULT_CCIP_PARAMS);

/** A deterministic pseudo-random unit vector. */
function randomUnit(seed: number): Float32Array {
  let s = seed;
  const v = new Float32Array(DIMS);
  for (let i = 0; i < DIMS; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    v[i] = s / 2147483648 - 0.5;
  }
  return normalize(v);
}

/**
 * `base` moved toward `toward` until their cosine is `cosine`. At the published CCIP constants the
 * difference is (1 - cosine) / 2: cosine 0.9 is 0.05 (same character), 0.6 is 0.2 (not).
 */
function near(base: Float32Array, toward: Float32Array, cosine: number): Float32Array {
  const d = base.reduce((sum, x, i) => sum + x * toward[i], 0);
  const ortho = normalize(toward.map((x, i) => x - d * base[i]));
  const sin = Math.sqrt(1 - cosine * cosine);
  return base.map((x, i) => cosine * x + sin * ortho[i]);
}

const post = (url: string, body?: unknown) =>
  fetch(BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (res: Response | Promise<Response>): Promise<any> => (await (await res).json()) as any;

const lib = db.insert(schema.libraries).values({ name: 'chars', createdAt: Date.now() }).returning().get();
let mediaCount = 0;
async function addMedia(): Promise<number> {
  const file = path.join(dataDir, `page-${++mediaCount}.png`);
  await sharp({ create: { width: 400, height: 200, channels: 3, background: { r: 200, g: 80, b: 40 } } })
    .png()
    .toFile(file);
  return db
    .insert(schema.media)
    .values({
      libraryId: lib.id,
      source: 'folder',
      path: file,
      filename: path.basename(file),
      type: 'image',
      createdAt: Date.now(),
    })
    .returning()
    .get().id;
}

function detect(mediaId: number, embeddings: Float32Array[]): number[] {
  return saveDetections(
    mediaId,
    embeddings.map((embedding, i) => ({
      bbox: { x: 0.1 + i * 0.4, y: 0.2, w: 0.3, h: 0.5 },
      score: 0.9 - i / 10,
      embedding,
    })),
  );
}

function linksOf(tagName: string): { media_id: number; source: string }[] {
  return sqlite
    .query(
      `SELECT mt.media_id, mt.source FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE t.name = ? ORDER BY mt.media_id`,
    )
    .all(tagName) as { media_id: number; source: string }[];
}

function tagMedia(mediaId: number, name: string, category: 'general' | 'character', source: 'ai' | 'user') {
  sqlite
    .query('INSERT INTO media_tags (media_id, tag_id, confidence, source) VALUES (?, ?, ?, ?)')
    .run(mediaId, upsertTag(name, category), source === 'ai' ? 0.9 : null, source);
}

describe('vectors', () => {
  test('float16 round trip within 1e-3', () => {
    const v = randomUnit(7).map((x) => x * 40);
    const back = unpackFloat16(packFloat16(v));
    expect(packFloat16(v).byteLength).toBe(1536);
    let worst = 0;
    for (let i = 0; i < DIMS; i++) worst = Math.max(worst, Math.abs(back[i] - v[i]) / Math.max(1, Math.abs(v[i])));
    expect(worst).toBeLessThan(1e-3);
    expect([...unpackFloat16(packFloat16([0, 1, -2, 0.5, 65504]))]).toEqual([0, 1, -2, 0.5, 65504]);
  });
});

describe('clusterIncrementally', () => {
  const a = randomUnit(1);
  const b = randomUnit(2);

  test('nearest neighbour picks the closer character', () => {
    // Within 0.2 of both characters (differences 0.11 and 0.18), nearer to a.
    const between = near(normalize(a.map((x, i) => x + b[i])), a, 0.995);
    const nodes = [
      { id: 1, vec: a, characterId: 10 },
      { id: 2, vec: b, characterId: 20 },
      { id: 3, vec: near(a, randomUnit(3), 0.9), characterId: null },
      { id: 4, vec: near(b, randomUnit(4), 0.9), characterId: null },
      { id: 5, vec: between, characterId: null },
    ];
    const out = clusterIncrementally(nodes, new Set([3, 4, 5]), { ...params, assignThreshold: 0.2 });
    expect([...out.assigned.entries()].sort()).toEqual([
      [3, 10],
      [4, 20],
      [5, 10],
    ]);
    expect(out.created).toEqual([]);
  });

  test('linked new detections form a cluster; a lone one stays unassigned', () => {
    const c = randomUnit(5);
    const nodes = [
      { id: 1, vec: a, characterId: 10 },
      { id: 2, vec: c, characterId: null },
      { id: 3, vec: near(c, randomUnit(6), 0.9), characterId: null },
      { id: 4, vec: randomUnit(8), characterId: null },
    ];
    const out = clusterIncrementally(nodes, new Set([3, 4]), params);
    expect(out.assigned.size).toBe(0);
    expect(out.created.map((g) => g.sort())).toEqual([[2, 3]]);
  });

  test('a chain of close links does not drift into one cluster', () => {
    // Six points along an arc, each 0.09 from the next (inside eps 0.1) but the ends 0.98 apart.
    const o = normalize(b.map((x, i) => x - dot(a, b) * a[i]));
    const step = Math.acos(1 - 2 * 0.09);
    const nodes = [0, 1, 2, 3, 4, 5].map((k) => ({
      id: k + 1,
      vec: a.map((x, i) => Math.cos(k * step) * x + Math.sin(k * step) * o[i]),
      characterId: null,
    }));
    const all = new Set(nodes.map((n) => n.id));
    expect(clusterIncrementally(nodes, all, { ...params, mergeLimit: 1 }).created.map((g) => g.length)).toEqual([6]);
    const checked = clusterIncrementally(nodes, all, params).created;
    expect(checked.map((g) => g.sort())).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  test('a detection close to two characters never merges them', () => {
    const mid = normalize(a.map((x, i) => x + b[i]));
    const nodes = [
      { id: 1, vec: near(mid, a, 0.97), characterId: 10 },
      { id: 2, vec: near(mid, b, 0.97), characterId: 20 },
      { id: 3, vec: mid, characterId: null },
    ];
    const out = clusterIncrementally(nodes, new Set([3]), params);
    expect(out.assigned.size).toBe(1);
    expect(out.created).toEqual([]);
  });
});

describe('characters API', () => {
  const pepper = randomUnit(100);
  const carrot = randomUnit(200);
  const ids: Record<string, number> = {};

  test('detections cluster into unnamed characters, with counts and covers', async () => {
    for (const k of ['p1', 'p2', 'p3', 'c1', 'c2', 'lone']) ids[k] = await addMedia();
    detect(ids.p1, [near(pepper, randomUnit(11), 0.92)]);
    detect(ids.p2, [near(pepper, randomUnit(12), 0.92)]);
    // Pepper and Carrot together on one page.
    const group = detect(ids.p3, [near(pepper, randomUnit(13), 0.92), near(carrot, randomUnit(14), 0.92)]);
    detect(ids.c1, [near(carrot, randomUnit(15), 0.92)]);
    detect(ids.c2, []);
    const lone = detect(ids.lone, [randomUnit(300)]);
    const all = (sqlite.query('SELECT id FROM character_detections').all() as { id: number }[]).map((r) => r.id);
    expect(clusterDetections(all, params)).toEqual({ assigned: 0, created: 2 });
    ids.groupPepper = group[0];
    ids.groupCarrot = group[1];
    ids.loneDetection = lone[0];

    const list = await json(fetch(`${BASE}/api/characters`));
    expect(list.named).toEqual([]);
    expect(list.suggested).toEqual([]);
    expect(list.unnamed.map((c: any) => [c.mediaCount, c.detectionCount, c.name])).toEqual([
      [3, 3, null],
      [2, 2, null],
    ]);
    expect(list.unassignedCount).toBe(1);
    ids.pepperChar = list.unnamed[0].id;
    ids.carrotChar = list.unnamed[1].id;
    // The cover is the highest-scoring detection until one is chosen.
    expect(list.unnamed[0].coverUrl).toBe(`/api/characters/crops/${list.unnamed[0].coverDetectionId}`);

    const status = await json(fetch(`${BASE}/api/characters/status`));
    expect(status).toMatchObject({
      status: 'absent',
      enabled: false,
      pendingCount: 0,
      detectionCount: 6,
      characterCount: 2,
    });
  });

  test('a repeated scan of the same media adds nothing', () => {
    expect(detect(ids.p1, [pepper])).toEqual([]);
    expect((sqlite.query('SELECT COUNT(*) AS c FROM character_detections').get() as { c: number }).c).toBe(6);
  });

  test('a cluster whose solo images mostly carry one WD character tag gets it suggested', async () => {
    for (const k of ['p1', 'p2', 'p3']) tagMedia(ids[k], 'solo', 'general', 'ai');
    tagMedia(ids.p1, 'pepper_(pepper&carrot)', 'character', 'ai');
    tagMedia(ids.p2, 'pepper_(pepper&carrot)', 'character', 'ai');
    const list = await json(fetch(`${BASE}/api/characters`));
    expect(list.suggested.map((c: any) => [c.id, c.suggestion])).toEqual([
      [ids.pepperChar, { tag: 'pepper_(pepper&carrot)', mediaCount: 2, soloCount: 3 }],
    ]);
    expect(list.unnamed.map((c: any) => c.id)).toEqual([ids.carrotChar]);
  });

  test('accepting the suggestion names the character and links every member with source character', async () => {
    const named = await json(post(`/api/characters/${ids.pepperChar}/accept-suggestion`));
    expect(named).toMatchObject({
      id: ids.pepperChar,
      name: 'pepper_(pepper&carrot)',
      suggestion: null,
      mediaCount: 3,
    });
    expect(linksOf('pepper_(pepper&carrot)')).toEqual([
      { media_id: ids.p1, source: 'character' },
      { media_id: ids.p2, source: 'character' },
      { media_id: ids.p3, source: 'character' },
    ]);
    const tag = sqlite.query(`SELECT category, usage_count FROM tags WHERE name = 'pepper_(pepper&carrot)'`).get();
    expect(tag).toEqual({ category: 'character', usage_count: 3 });
    expect((await post(`/api/characters/${ids.carrotChar}/accept-suggestion`)).status).toBe(409);
  });

  test('retag keeps character links', () => {
    // What tagOneMedia does to an item's old AI tags before writing the new ones.
    sqlite.query(`DELETE FROM media_tags WHERE media_id IN (?, ?, ?) AND source = 'ai'`).run(ids.p1, ids.p2, ids.p3);
    expect(linksOf('pepper_(pepper&carrot)').map((l) => l.media_id)).toEqual([ids.p1, ids.p2, ids.p3]);
    expect(linksOf('solo')).toEqual([]);
  });

  test('naming creates a character tag, but never takes over a general tag', async () => {
    upsertTag('carrot', 'general');
    const refused = await post(`/api/characters/${ids.carrotChar}/name`, { name: 'Carrot' });
    expect(refused.status).toBe(409);
    expect((await json(refused)).error).toContain('carrot_(character)');

    const named = await json(post(`/api/characters/${ids.carrotChar}/name`, { name: 'Carrot (cat)' }));
    expect(named.name).toBe('carrot_(cat)');
    expect(sqlite.query(`SELECT category FROM tags WHERE name = 'carrot_(cat)'`).get()).toEqual({
      category: 'character',
    });
    expect(linksOf('carrot_(cat)').map((l) => l.media_id)).toEqual([ids.p3, ids.c1]);
    expect(linksOf('carrot')).toEqual([]);

    const media = await json(fetch(`${BASE}/api/media?tags=carrot_(cat)`));
    expect(media.items.map((m: any) => m.id).sort()).toEqual([ids.p3, ids.c1]);
  });

  test('a new detection of a named character is assigned and linked', async () => {
    ids.p4 = await addMedia();
    const [det] = detect(ids.p4, [near(pepper, randomUnit(16), 0.93)]);
    ids.p4Detection = det;
    expect(clusterDetections([det], params)).toEqual({ assigned: 1, created: 0 });
    expect(linksOf('pepper_(pepper&carrot)').map((l) => l.media_id)).toContain(ids.p4);
  });

  test('reject keeps the detection off that character after a re-run', async () => {
    const rejected = await json(post(`/api/character-detections/${ids.p4Detection}/reject`));
    expect(rejected).toMatchObject({ assignment: 'rejected', characterId: ids.pepperChar, characterName: null });
    expect(linksOf('pepper_(pepper&carrot)').map((l) => l.media_id)).not.toContain(ids.p4);

    ids.p5 = await addMedia();
    const [next] = detect(ids.p5, [near(pepper, randomUnit(17), 0.93)]);
    clusterDetections([next, ids.p4Detection], params);
    const dets = await json(fetch(`${BASE}/api/media/${ids.p4}/detections`));
    expect(dets.map((d: any) => [d.assignment, d.characterId])).toEqual([['rejected', ids.pepperChar]]);
    expect(linksOf('pepper_(pepper&carrot)').map((l) => l.media_id)).toEqual([ids.p1, ids.p2, ids.p3, ids.p5]);
  });

  test('detections for one media item carry their box, score and character name', async () => {
    const dets = await json(fetch(`${BASE}/api/media/${ids.p3}/detections`));
    expect(dets.map((d: any) => [d.id, d.characterName, d.assignment])).toEqual([
      [ids.groupPepper, 'pepper_(pepper&carrot)', 'auto'],
      [ids.groupCarrot, 'carrot_(cat)', 'auto'],
    ]);
    expect(dets[1].bbox).toEqual({ x: 0.5, y: 0.2, w: 0.3, h: 0.5 });
    expect(dets[1].score).toBeCloseTo(0.8);
  });

  test('set cover and hide', async () => {
    expect((await post(`/api/characters/${ids.pepperChar}/cover`, { detectionId: ids.groupCarrot })).status).toBe(400);
    const covered = await json(post(`/api/characters/${ids.pepperChar}/cover`, { detectionId: ids.groupPepper }));
    expect(covered.coverUrl).toBe(`/api/characters/crops/${ids.groupPepper}`);

    await post(`/api/characters/${ids.carrotChar}/hidden`, { hidden: true });
    const list = await json(fetch(`${BASE}/api/characters`));
    expect(list.named.map((c: any) => c.id)).toEqual([ids.pepperChar]);
    const all = await json(fetch(`${BASE}/api/characters?hidden=1`));
    expect(all.named.map((c: any) => [c.id, c.hidden])).toEqual([
      [ids.pepperChar, false],
      [ids.carrotChar, true],
    ]);
    // Hiding leaves the tag alone.
    expect(linksOf('carrot_(cat)').map((l) => l.media_id)).toEqual([ids.p3, ids.c1]);
  });

  test('one character’s media, with its detections', async () => {
    const page = await json(fetch(`${BASE}/api/characters/${ids.pepperChar}/media?limit=3`));
    expect(page.total).toBe(4);
    expect(page.items.map((m: any) => m.id)).toEqual([ids.p5, ids.p3, ids.p2]);
    expect(page.nextOffset).toBe(3);
    expect(page.detections.map((d: any) => d.mediaId)).toEqual([ids.p2, ids.p3, ids.p5]);
  });

  test('the crop endpoint serves a cached webp of the box', async () => {
    const res = await fetch(`${BASE}/api/characters/crops/${ids.groupCarrot}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([120, 100]);
    expect(fs.existsSync(path.join(characterCropDirFor(ids.p3), `${ids.groupCarrot}.webp`))).toBe(true);
  });

  test('merge moves detections', async () => {
    const merged = await json(post(`/api/characters/${ids.carrotChar}/merge`, { into: ids.pepperChar }));
    expect(merged).toMatchObject({
      id: ids.pepperChar,
      name: 'pepper_(pepper&carrot)',
      mediaCount: 5,
      detectionCount: 6,
    });
    expect((await fetch(`${BASE}/api/characters/${ids.carrotChar}`)).status).toBe(404);
    expect(linksOf('carrot_(cat)')).toEqual([]);
    expect(linksOf('pepper_(pepper&carrot)').map((l) => l.media_id)).toEqual([ids.p1, ids.p2, ids.p3, ids.c1, ids.p5]);
    // The rejection moved along and still holds.
    const p4 = await json(fetch(`${BASE}/api/media/${ids.p4}/detections`));
    expect(p4[0].assignment).toBe('rejected');
  });

  test('a detection can be put in a character by hand', async () => {
    const assigned = await json(
      post(`/api/character-detections/${ids.loneDetection}/assign`, { characterId: ids.pepperChar }),
    );
    expect(assigned).toMatchObject({ assignment: 'user', characterName: 'pepper_(pepper&carrot)' });
    expect(linksOf('pepper_(pepper&carrot)').map((l) => l.media_id)).toContain(ids.lone);
  });

  test('deleting media removes its detections and crops', async () => {
    removeMediaRows([ids.p3]);
    expect(sqlite.query('SELECT COUNT(*) AS c FROM character_detections WHERE media_id = ?').get(ids.p3)).toEqual({
      c: 0,
    });
    expect(sqlite.query('SELECT COUNT(*) AS c FROM character_scans WHERE media_id = ?').get(ids.p3)).toEqual({ c: 0 });
    // Files are removed in the background, after the rows.
    for (let i = 0; i < 100 && fs.existsSync(characterCropDirFor(ids.p3)); i++) await Bun.sleep(10);
    expect(fs.existsSync(characterCropDirFor(ids.p3))).toBe(false);
    expect(sqlite.query('SELECT cover_detection_id FROM characters WHERE id = ?').get(ids.pepperChar)).toEqual({
      cover_detection_id: null,
    });
  });

  test('the job fails naming the download step when the models are absent', async () => {
    const pending = await addMedia();
    expect((await json(fetch(`${BASE}/api/characters/status`))).pendingCount).toBe(1);
    expect((await post('/api/characters/run')).status).toBe(409);
    const job = await waitForJob(enqueueCharacterJob([pending], 'test').id);
    expect(job.status).toBe('error');
    expect(job.log).toContain('Download them in Settings > AI Tagging');
  });
});

describe('characters and tag implications', () => {
  test('a named character carries what its tag implies, and drops it when renamed', async () => {
    const saffron = randomUnit(900);
    const media = [await addMedia(), await addMedia()];
    const dets = media.flatMap((id, i) => detect(id, [near(saffron, randomUnit(910 + i), 0.93)]));
    expect(clusterDetections(dets, params)).toEqual({ assigned: 0, created: 1 });
    const charId = (sqlite.query('SELECT character_id FROM character_detections WHERE id = ?').get(dets[0]) as {
      character_id: number;
    }).character_id;

    const named = await post(`/api/characters/${charId}/name`, { name: 'saffron_(pepper&carrot)' });
    expect([named.status, (await json(named)).name]).toEqual([200, 'saffron_(pepper&carrot)']);
    const implication = await post('/api/tag-relations/implications', {
      tag: 'saffron_(pepper&carrot)',
      implies: 'pepper&carrot',
      category: 'copyright',
    });
    expect(implication.status).toBe(200);
    expect(linksOf('pepper&carrot')).toEqual(media.map((id) => ({ media_id: id, source: 'implied' })));

    const later = await addMedia();
    const [det] = detect(later, [near(saffron, randomUnit(920), 0.93)]);
    clusterDetections([det], params);
    expect(linksOf('pepper&carrot').map((l) => l.media_id)).toEqual([...media, later]);

    await json(post(`/api/characters/${charId}/name`, { name: 'saffron_the_witch' }));
    expect(linksOf('saffron_(pepper&carrot)')).toEqual([]);
    expect(linksOf('pepper&carrot')).toEqual([]);
  });
});
