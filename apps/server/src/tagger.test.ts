import { describe, expect, test } from 'bun:test';
import { useTestConfig } from './testConfig';

// The tagger module opens the database on import, so it needs a throwaway data dir.
useTestConfig('tagger');

const { parseLabels, selectTags } = await import('./services/tagger');

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
