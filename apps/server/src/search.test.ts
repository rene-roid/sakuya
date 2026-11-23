import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { useTestConfig } from './testConfig';

useTestConfig('search', { port: 38777 });
const BASE = 'http://localhost:38777';

const { db, schema } = await import('./db');
await import('./index');

const json = async (url: string): Promise<any> => (await (await fetch(BASE + url)).json()) as any;
const post = (url: string, body: unknown) =>
  fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Deliberately neutral: the FTS `path` column indexes the whole path, so a directory named
// after anything the tests search for would match every row.
const MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mroot-'));
const library = db.insert(schema.libraries).values({ name: 'search', createdAt: Date.now() }).returning().get();

function addMedia(filename: string, tagNames: string[] = []) {
  const filePath = path.join(MEDIA_DIR, filename);
  fs.writeFileSync(filePath, filename);
  const item = db
    .insert(schema.media)
    .values({
      libraryId: library.id,
      source: 'folder',
      path: filePath,
      filename,
      type: 'image',
      sizeBytes: 1,
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
  return item;
}

const sakuya = addMedia('sakuya_izayoi.png', ['maid', 'silver_hair']);
const remilia = addMedia('remilia_scarlet.png', ['vampire', 'silver_hair']);
const dated = addMedia('IMG_20240101_123.jpg');

const idsOf = (res: any) => res.items.map((m: { id: number }) => m.id).sort((a: number, b: number) => a - b);

describe('free-text search', () => {
  test('matches a filename by whole token and by prefix', async () => {
    expect(idsOf(await json('/api/media?q=sakuya_izayoi.png'))).toEqual([sakuya.id]);
    expect(idsOf(await json('/api/media?q=sakuya'))).toEqual([sakuya.id]);
    expect(idsOf(await json('/api/media?q=saku'))).toEqual([sakuya.id]);
  });

  test('does not match mid-token, which is the FTS5 tradeoff', async () => {
    // Under the old LIKE '%term%' search this found sakuya_izayoi.png. Prefix matching is what
    // makes the search indexable; this test exists so the change is deliberate, not a surprise.
    expect(idsOf(await json('/api/media?q=aku'))).toEqual([]);
  });

  test('matches tag names as well as filenames', async () => {
    expect(idsOf(await json('/api/media?q=vampire'))).toEqual([remilia.id]);
    expect(idsOf(await json('/api/media?q=silver_hair'))).toEqual([sakuya.id, remilia.id].sort((a, b) => a - b));
  });

  test('repeated q params are ANDed', async () => {
    expect(idsOf(await json('/api/media?q=silver_hair&q=vampire'))).toEqual([remilia.id]);
    expect(idsOf(await json('/api/media?q=silver_hair&q=maid'))).toEqual([sakuya.id]);
    expect(idsOf(await json('/api/media?q=vampire&q=maid'))).toEqual([]);
  });

  test('filenames tokenize on underscores', async () => {
    expect(idsOf(await json('/api/media?q=2024'))).toEqual([dated.id]);
    // "0101" sits mid-token inside 20240101, so it does not match.
    expect(idsOf(await json('/api/media?q=0101'))).toEqual([]);
  });

  test('a term of pure punctuation matches nothing instead of erroring', async () => {
    const res = await fetch(`${BASE}/api/media?q=${encodeURIComponent('---')}`);
    expect(res.status).toBe(200);
    expect(idsOf(await res.json())).toEqual([]);
    // Quotes would break out of the quoted term if they weren't escaped.
    const quoted = await fetch(`${BASE}/api/media?q=${encodeURIComponent('a" OR "b')}`);
    expect(quoted.status).toBe(200);
  });

  test('/api/media and /api/media/ids agree on a search', async () => {
    const page = await json('/api/media?q=silver_hair&limit=100');
    const ids = await json('/api/media/ids?q=silver_hair');
    expect(ids.ids.slice().sort()).toEqual(idsOf(page));
    expect(ids.total).toBe(page.total);
  });
});

describe('tag filter', () => {
  test('several tags are ANDed', async () => {
    expect(idsOf(await json('/api/media?tags=silver_hair'))).toEqual([sakuya.id, remilia.id].sort((a, b) => a - b));
    expect(idsOf(await json('/api/media?tags=silver_hair,maid'))).toEqual([sakuya.id]);
    expect(idsOf(await json('/api/media?tags=maid,vampire'))).toEqual([]);
  });

  test('a tag named twice, in any spelling, counts once', async () => {
    expect(idsOf(await json('/api/media?tags=maid,maid'))).toEqual([sakuya.id]);
    expect(idsOf(await json(`/api/media?tags=${encodeURIComponent('Silver Hair,silver_hair,vampire')}`))).toEqual([
      remilia.id,
    ]);
    expect((await json('/api/media/ids?tags=maid,maid')).ids).toEqual([sakuya.id]);
  });
});

describe('search index stays in sync', () => {
  test('a rename moves the row to its new name', async () => {
    const item = addMedia('before_rename_zebrafish.png');
    expect(idsOf(await json('/api/media?q=zebrafish'))).toEqual([item.id]);

    await post('/api/media/rename-batch', { items: [{ id: item.id, filename: 'after_rename_quokka.png' }] });

    expect(idsOf(await json('/api/media?q=zebrafish'))).toEqual([]);
    expect(idsOf(await json('/api/media?q=quokka'))).toEqual([item.id]);
  });

  test('adding and removing a tag updates what matches', async () => {
    const item = addMedia('tagsync.png');
    expect(idsOf(await json('/api/media?q=wombatology'))).toEqual([]);

    await post('/api/media/tags-batch', { ids: [item.id], add: ['wombatology'], category: 'user' });
    expect(idsOf(await json('/api/media?q=wombatology'))).toEqual([item.id]);

    await post('/api/media/tags-batch', { ids: [item.id], remove: ['wombatology'] });
    expect(idsOf(await json('/api/media?q=wombatology'))).toEqual([]);
  });

  test('a deleted media row leaves the index', async () => {
    const item = addMedia('doomed_platypus.png');
    expect(idsOf(await json('/api/media?q=platypus'))).toEqual([item.id]);

    await post('/api/media/delete-batch', { ids: [item.id] });
    expect(idsOf(await json('/api/media?q=platypus'))).toEqual([]);
  });
});

describe('tag display names', () => {
  const patch = (name: string, body: unknown) =>
    fetch(`${BASE}/api/tags/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const item = addMedia('display_name_item.png');

  test('autocomplete matches a display name and returns the canonical name', async () => {
    await post('/api/media/tags-batch', { ids: [item.id], add: ['uraraka_ochako'], category: 'character' });
    await post('/api/media/tags-batch', { ids: [item.id], add: ['froppy_tag'], category: 'user' });
    expect(await json('/api/tags?q=Zero')).toEqual([]);

    const res = await patch('uraraka_ochako', { displayName: '  Zero   Gravity ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'uraraka_ochako', category: 'character', displayName: 'Zero Gravity' });

    expect(await json('/api/tags?q=zero')).toEqual([
      { name: 'uraraka_ochako', category: 'character', displayName: 'Zero Gravity', count: 1 },
    ]);
    expect(await json(`/api/tags?q=Grav&libraryId=${library.id}`)).toEqual([
      { name: 'uraraka_ochako', category: 'character', displayName: 'Zero Gravity', count: 1 },
    ]);
    // Filters and free-text search keep the canonical name.
    expect(idsOf(await json('/api/media?tags=uraraka_ochako'))).toEqual([item.id]);
    expect(idsOf(await json('/api/media?q=gravity'))).toEqual([]);
  });

  test('the media detail and tag info carry the display name', async () => {
    const detail = await json(`/api/media/${item.id}`);
    expect(detail.tags.find((t: { name: string }) => t.name === 'uraraka_ochako').displayName).toBe('Zero Gravity');
    expect(await json('/api/tags/info?names=uraraka_ochako,froppy_tag,no_such_tag')).toEqual([
      { name: 'froppy_tag', category: 'user', displayName: null },
      { name: 'uraraka_ochako', category: 'character', displayName: 'Zero Gravity' },
    ]);
  });

  test('a display name another tag already reads as is a 409 and changes nothing', async () => {
    const taken = await patch('froppy_tag', { displayName: 'zero gravity' });
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: string }).error).toBe('"uraraka_ochako" is already shown as "Zero Gravity"');
    const canonical = await patch('froppy_tag', { displayName: 'Uraraka Ochako' });
    expect(canonical.status).toBe(409);
    expect(((await canonical.json()) as { error: string }).error).toBe('"Uraraka Ochako" is the name of another tag');
    expect((await json('/api/tags/info?names=froppy_tag'))[0].displayName).toBeNull();
  });

  test('clearing a display name and renaming a missing tag', async () => {
    expect(await (await patch('uraraka_ochako', { displayName: '' })).json()).toEqual({
      name: 'uraraka_ochako',
      category: 'character',
      displayName: null,
    });
    expect((await patch('uraraka_ochako', { displayName: null })).status).toBe(200);
    expect(await json('/api/tags?q=zero')).toEqual([]);
    expect((await patch('no_such_tag', { displayName: 'x' })).status).toBe(404);
  });
});
