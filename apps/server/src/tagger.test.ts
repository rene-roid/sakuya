import { describe, expect, test } from 'bun:test';
import { useTestConfig } from './testConfig';

// The tagger module opens the database on import, so it needs a throwaway data dir.
useTestConfig('tagger', { port: 38923 }); // T01
const BASE = 'http://localhost:38923';

const { parseLabels, selectTags, applyPredictedTags } = await import('./services/tagger');
const { db, sqlite, schema } = await import('./db');
await import('./index');

const labels = parseLabels(
  [
    'tag_id,name,category,count',
    '9999999,general,9,100',
    '9999998,explicit,9,100',
    '1,1girl,0,500',
    '2,solo,0,400',
    '3,hakurei_reimu,4,300',
    '4,red_bow,0,200',
  ].join('\n') + '\n',
);

const names = (tags: { name: string }[]) => tags.map((t) => t.name);

describe('parseLabels', () => {
  test('reads one label per output, skipping the header, with booru categories mapped', () => {
    expect(labels).toEqual([
      { name: 'general', category: 'rating' },
      { name: 'explicit', category: 'rating' },
      { name: '1girl', category: 'general' },
      { name: 'solo', category: 'general' },
      { name: 'hakurei_reimu', category: 'character' },
      { name: 'red_bow', category: 'general' },
    ]);
  });
});

describe('selectTags', () => {
  test('keeps tags at or over the threshold and the best rating, highest first', () => {
    const tags = selectTags(new Float32Array([0.1, 0.8, 0.9, 0.5, 0.6, 0.49]), labels, 0.5);
    expect(names(tags)).toEqual(['1girl', 'explicit', 'hakurei_reimu', 'solo']);
    expect(tags.find((t) => t.name === 'hakurei_reimu')?.category).toBe('character');
    expect(tags.find((t) => t.name === 'explicit')?.confidence).toBeCloseTo(0.8);
  });

  test('always reports one rating, however unsure the model is', () => {
    const tags = selectTags(new Float32Array([0.02, 0.01, 0, 0, 0, 0]), labels, 0.35);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ name: 'general', category: 'rating' });
  });

  test('raw logits are squashed through a sigmoid first', () => {
    // logit 0 is 0.5, logit -5 is ~0.007, logit 5 is ~0.993
    const tags = selectTags(new Float32Array([-5, 5, 0, -5, -5, -5]), labels, 0.5);
    expect(names(tags)).toEqual(['explicit', '1girl']);
    expect(tags[1].confidence).toBeCloseTo(0.5);
  });

  test('an output longer or shorter than the label list is read up to the shorter one', () => {
    expect(names(selectTags(new Float32Array([0.9, 0.1, 0.7]), labels, 0.5))).toEqual(['general', '1girl']);
    expect(names(selectTags(new Float32Array([0, 0, 0, 0, 0, 0, 1, 1]), labels, 0.5))).toEqual(['general']);
  });
});

describe('AI tag vetoes', () => {
  const library = db.insert(schema.libraries).values({ name: 'veto', createdAt: Date.now() }).returning().get();
  let n = 0;
  const addItem = () =>
    db
      .insert(schema.media)
      .values({
        libraryId: library.id,
        source: 'folder',
        path: `/nowhere/veto-${++n}.png`,
        filename: `veto-${n}.png`,
        type: 'image',
        createdAt: Date.now(),
      })
      .returning()
      .get().id;

  const predicted = [
    { name: 'solo', category: 'general' as const, confidence: 0.9 },
    { name: 'simple_background', category: 'general' as const, confidence: 0.7 },
    { name: 'white_background', category: 'general' as const, confidence: 0.6 },
    { name: 'general', category: 'rating' as const, confidence: 0.8 },
  ];

  const detailTags = async (id: number) => {
    const detail = (await (await fetch(`${BASE}/api/media/${id}`)).json()) as {
      tags: { name: string; source: string }[];
    };
    return detail.tags.map((t) => `${t.name}:${t.source}`).sort();
  };
  const patchTags = (id: number, body: unknown) =>
    fetch(`${BASE}/api/media/${id}/tags`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const vetoCount = (id: number) =>
    (sqlite.query('SELECT COUNT(*) AS c FROM media_tag_vetoes WHERE media_id = ?').get(id) as { c: number }).c;

  test('a removed AI tag is not re-added by retag', async () => {
    const id = addItem();
    applyPredictedTags(id, predicted);
    expect((await patchTags(id, { remove: ['simple_background', 'white_background'] })).status).toBe(200);

    expect(applyPredictedTags(id, predicted)).toBe(2);
    expect(await detailTags(id)).toEqual(['general:ai', 'solo:ai']);
  });

  test('re-adding a vetoed tag clears the veto', async () => {
    const id = addItem();
    applyPredictedTags(id, predicted);
    await patchTags(id, { remove: ['simple_background'] });
    expect(vetoCount(id)).toBe(1);

    await patchTags(id, { add: ['simple_background'] });
    expect(vetoCount(id)).toBe(0);
    applyPredictedTags(id, predicted);
    expect(await detailTags(id)).toEqual(['general:ai', 'simple_background:user', 'solo:ai', 'white_background:ai']);
  });

  test('removing a user tag records no veto', async () => {
    const id = addItem();
    await patchTags(id, { add: ['my_tag'] });
    await patchTags(id, { remove: ['my_tag'] });
    expect(vetoCount(id)).toBe(0);
  });

  test('bulk removal vetoes the AI tag on every item, and bulk add clears it', async () => {
    const ids = [addItem(), addItem(), addItem()];
    for (const id of ids) applyPredictedTags(id, predicted);
    const batch = (body: unknown) =>
      fetch(`${BASE}/api/media/tags-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    await batch({ ids, remove: ['solo'] });
    for (const id of ids) applyPredictedTags(id, predicted);
    for (const id of ids) {
      expect(await detailTags(id)).toEqual(['general:ai', 'simple_background:ai', 'white_background:ai']);
    }

    await batch({ ids: ids.slice(0, 1), add: ['solo'] });
    expect(ids.map(vetoCount)).toEqual([0, 1, 1]);
  });

  test('deleting an item drops its vetoes', async () => {
    const id = addItem();
    applyPredictedTags(id, predicted);
    await patchTags(id, { remove: ['solo'] });
    expect(vetoCount(id)).toBe(1);
    expect((await fetch(`${BASE}/api/media/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect(vetoCount(id)).toBe(0);
  });
});
