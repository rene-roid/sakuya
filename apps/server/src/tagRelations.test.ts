import { describe, expect, test } from 'bun:test';
import { useTestConfig, waitForJob } from './testConfig';

useTestConfig('tagrelations', { port: 38962 }); // M02
const BASE = 'http://localhost:38962';

const { db, sqlite, schema } = await import('./db');
const { applyPredictedTags } = await import('./services/tagger');
await import('./index');

async function call(method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const get = async (url: string) => (await call('GET', url)).body;

const library = db.insert(schema.libraries).values({ name: 'relations', createdAt: Date.now() }).returning().get();
let n = 0;
function addItem(): number {
  n++;
  return db
    .insert(schema.media)
    .values({
      libraryId: library.id,
      source: 'folder',
      path: `/nowhere/rel-${n}.png`,
      filename: `rel-${n}.png`,
      type: 'image',
      sizeBytes: 1,
      createdAt: Date.now(),
    })
    .returning()
    .get().id;
}

const addTags = (id: number, add: string[], category = 'user') =>
  call('PATCH', `/api/media/${id}/tags`, { add, category });
const removeTags = (id: number, remove: string[]) => call('PATCH', `/api/media/${id}/tags`, { remove });
const tagsOf = async (id: number): Promise<string[]> =>
  ((await get(`/api/media/${id}`)).tags as { name: string; source: string }[])
    .map((t) => `${t.name}:${t.source}`)
    .sort();
const idsFor = async (query: string): Promise<number[]> =>
  ((await get(`/api/media?${query}&limit=100`)).items as { id: number }[]).map((m) => m.id).sort((a, b) => a - b);

const byUser = addItem();
const byAi = addItem();
const both = addItem();
await addTags(byUser, ['uraraka']);
applyPredictedTags(byAi, [{ name: 'uraraka', category: 'character', confidence: 0.9 }]);
await addTags(both, ['uraraka', 'uraraka_ochako'], 'character');

describe('tag siblings', () => {
  test('a sibling moves links', async () => {
    const res = await call('POST', '/api/tag-relations/siblings', { from: 'uraraka', to: 'uraraka_ochako' });
    expect(res.status).toBe(200);
    expect(res.body.job).toBeNull();
    expect(res.body.siblings.map((s: any) => `${s.from.name}->${s.to.name}`)).toEqual(['uraraka->uraraka_ochako']);

    expect(await tagsOf(byUser)).toEqual(['uraraka_ochako:user']);
    expect(await tagsOf(byAi)).toEqual(['uraraka_ochako:ai']);
    expect(await tagsOf(both)).toEqual(['uraraka_ochako:user']);
    const counts = sqlite
      .query(`SELECT name, usage_count AS c FROM tags WHERE name LIKE 'uraraka%' ORDER BY name`)
      .all();
    expect(counts).toEqual([
      { name: 'uraraka', c: 0 },
      { name: 'uraraka_ochako', c: 3 },
    ]);
  });

  test('search for the old name finds the target', async () => {
    expect(await idsFor('tags=uraraka')).toEqual([byUser, byAi, both]);
    const suggestions = await get('/api/tags?q=urara');
    expect(suggestions.map((t: { name: string; count: number }) => [t.name, t.count])).toEqual([['uraraka_ochako', 3]]);
  });

  test('applying an alias applies its target, by hand and by the AI', async () => {
    const res = await call('POST', '/api/tag-relations/siblings', {
      from: 'deku',
      to: 'midoriya_izuku',
      category: 'character',
    });
    expect(res.status).toBe(200);
    const item = addItem();
    await addTags(item, ['Deku']);
    expect(await tagsOf(item)).toEqual(['midoriya_izuku:user']);
    const tagged = addItem();
    applyPredictedTags(tagged, [{ name: 'deku', category: 'character', confidence: 0.95 }]);
    expect(await tagsOf(tagged)).toEqual(['midoriya_izuku:ai']);
    // Free text too: "deku" is no prefix of anything those items carry.
    expect(await idsFor('q=deku')).toEqual([item, tagged]);
    expect(await get('/api/tags?q=deku')).toEqual([
      { name: 'midoriya_izuku', category: 'character', displayName: null, count: 2 },
    ]);
  });

  test('merging a tag into its own alias is rejected', async () => {
    const res = await call('POST', '/api/tag-relations/siblings', { from: 'midoriya_izuku', to: 'deku' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('"deku" is already merged into "midoriya_izuku"');
    const again = await call('POST', '/api/tag-relations/siblings', { from: 'deku', to: 'izuku' });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('"deku" is already merged into "midoriya_izuku"');
  });
});

describe('tag implications', () => {
  test('an implication adds the series to every item with the character', async () => {
    const res = await call('POST', '/api/tag-relations/implications', {
      tag: 'uraraka_ochako',
      implies: 'boku_no_hero_academia',
      category: 'copyright',
    });
    expect(res.status).toBe(200);
    expect(res.body.implications.map((i: any) => `${i.tag.name}->${i.implies.name}:${i.implies.category}`)).toEqual([
      'uraraka_ochako->boku_no_hero_academia:copyright',
    ]);
    for (const id of [byUser, byAi, both]) {
      expect(await tagsOf(id)).toEqual([
        'boku_no_hero_academia:implied',
        `uraraka_ochako:${id === byAi ? 'ai' : 'user'}`,
      ]);
    }
    expect(await idsFor('tags=boku_no_hero_academia')).toEqual([byUser, byAi, both]);
  });

  test('implications chain, and an alias on either side resolves to its target', async () => {
    await call('POST', '/api/tag-relations/implications', { tag: 'boku_no_hero_academia', implies: 'shonen_jump' });
    const res = await call('POST', '/api/tag-relations/implications', {
      tag: 'deku',
      implies: 'boku_no_hero_academia',
    });
    expect(res.status).toBe(200);
    expect(res.body.implications.map((i: any) => `${i.tag.name}->${i.implies.name}`)).toEqual([
      'boku_no_hero_academia->shonen_jump',
      'midoriya_izuku->boku_no_hero_academia',
      'uraraka_ochako->boku_no_hero_academia',
    ]);
    expect(await tagsOf(byUser)).toEqual([
      'boku_no_hero_academia:implied',
      'shonen_jump:implied',
      'uraraka_ochako:user',
    ]);
  });

  test('applying the character by hand brings its implied tags along', async () => {
    const item = addItem();
    await addTags(item, ['uraraka']);
    expect(await tagsOf(item)).toEqual(['boku_no_hero_academia:implied', 'shonen_jump:implied', 'uraraka_ochako:user']);
  });

  test('a cycle is rejected and nothing changes', async () => {
    const before = await get('/api/tag-relations');
    const loop = await call('POST', '/api/tag-relations/implications', {
      tag: 'shonen_jump',
      implies: 'uraraka_ochako',
    });
    expect(loop.status).toBe(400);
    expect(loop.body.error).toBe('"uraraka_ochako" already implies "shonen_jump", so this would loop');
    const self = await call('POST', '/api/tag-relations/implications', { tag: 'uraraka', implies: 'uraraka_ochako' });
    expect(self.status).toBe(400);
    expect(self.body.error).toBe('A tag cannot imply itself');
    // Merging would turn shonen_jump -> ... -> uraraka_ochako into a loop through the merged tag.
    const merge = await call('POST', '/api/tag-relations/siblings', { from: 'shonen_jump', to: 'uraraka_ochako' });
    expect(merge.status).toBe(400);
    expect(merge.body.error).toBe('Merging "shonen_jump" into "uraraka_ochako" would make their implications loop');
    expect(await get('/api/tag-relations')).toEqual(before);
    expect(await tagsOf(byUser)).toEqual([
      'boku_no_hero_academia:implied',
      'shonen_jump:implied',
      'uraraka_ochako:user',
    ]);
  });

  test('removing the source tag takes its implied tags with it', async () => {
    await removeTags(byUser, ['uraraka_ochako']);
    expect(await tagsOf(byUser)).toEqual([]);
  });

  test('a retag recomputes implied tags instead of wiping them', async () => {
    applyPredictedTags(byAi, [{ name: 'smile', category: 'general', confidence: 0.7 }]);
    expect(await tagsOf(byAi)).toEqual(['smile:ai']);
    applyPredictedTags(byAi, [{ name: 'uraraka', category: 'character', confidence: 0.9 }]);
    expect(await tagsOf(byAi)).toEqual(['boku_no_hero_academia:implied', 'shonen_jump:implied', 'uraraka_ochako:ai']);
  });

  test('an implied tag removed by hand stays off', async () => {
    await removeTags(byAi, ['shonen_jump']);
    applyPredictedTags(byAi, [{ name: 'uraraka_ochako', category: 'character', confidence: 0.9 }]);
    expect(await tagsOf(byAi)).toEqual(['boku_no_hero_academia:implied', 'uraraka_ochako:ai']);
  });

  test('removing an implication removes only implied links', async () => {
    // Added by hand on top of the implication: it must survive the implication going away.
    await addTags(both, ['boku_no_hero_academia']);
    expect(await tagsOf(both)).toContain('boku_no_hero_academia:user');
    const res = await call('DELETE', '/api/tag-relations/implications/uraraka_ochako/boku_no_hero_academia');
    expect(res.status).toBe(200);
    expect(await tagsOf(both)).toEqual(['boku_no_hero_academia:user', 'shonen_jump:implied', 'uraraka_ochako:user']);
    expect(await tagsOf(byAi)).toEqual(['uraraka_ochako:ai']);
    const missing = await call('DELETE', '/api/tag-relations/implications/uraraka_ochako/boku_no_hero_academia');
    expect(missing.status).toBe(404);
  });

  test('removing a sibling stops the alias resolving, and merged links stay put', async () => {
    const res = await call('DELETE', '/api/tag-relations/siblings/uraraka');
    expect(res.status).toBe(200);
    expect(res.body.siblings.map((s: any) => s.from.name)).toEqual(['deku']);
    expect(await tagsOf(both)).toEqual(['boku_no_hero_academia:user', 'shonen_jump:implied', 'uraraka_ochako:user']);
    const item = addItem();
    await addTags(item, ['uraraka']);
    expect(await tagsOf(item)).toEqual(['uraraka:user']);
  });

  test('a large backfill runs as a job', async () => {
    const tag = db.insert(schema.tags).values({ name: 'crowd', category: 'general' }).returning().get();
    const insertMedia = sqlite.prepare(
      `INSERT INTO media (library_id, source, path, filename, type, size_bytes, created_at)
       VALUES (?, 'folder', ?, ?, 'image', 1, 0) RETURNING id`,
    );
    const link = sqlite.prepare(`INSERT INTO media_tags (media_id, tag_id, source) VALUES (?, ?, 'ai')`);
    sqlite.transaction(() => {
      for (let i = 0; i < 5001; i++) {
        const { id } = insertMedia.get(library.id, `/nowhere/crowd-${i}.png`, `crowd-${i}.png`) as { id: number };
        link.run(id, tag.id);
      }
    })();
    const res = await call('POST', '/api/tag-relations/implications', { tag: 'crowd', implies: 'many_people' });
    expect(res.status).toBe(200);
    expect(res.body.job.type).toBe('tag-relations');
    expect((await waitForJob(res.body.job.id)).log).toBe('Completed. 5001 items updated.');
    const implied = sqlite
      .query(
        `SELECT COUNT(*) AS c FROM media_tags mt JOIN tags t ON t.id = mt.tag_id
         WHERE t.name = 'many_people' AND mt.source = 'implied'`,
      )
      .get();
    expect(implied).toEqual({ c: 5001 });
    expect(sqlite.query(`SELECT usage_count AS c FROM tags WHERE name = 'many_people'`).get()).toEqual({ c: 5001 });
  }, 30_000);
});
