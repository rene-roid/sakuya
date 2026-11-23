import { expect, test } from 'bun:test';
import { exploreQueryString, parseFilters } from './useFilters';

const CASES = [
  '',
  'tags=solo,blue_hair',
  'liked=1&type=video',
  'library=3&tags=solo&sort=name',
  'sort=name&dir=desc',
  'sort=random&seed=42',
  'sort=size',
  'sort=size&dir=asc',
  'q=beach&type=image',
  'q=beach&q=sunset&tags=solo',
  'describe=a%20witch%20flying%20on%20a%20broom&type=image',
];

test('exploreQueryString survives a parse round-trip', () => {
  for (const qs of CASES) {
    const saved = exploreQueryString(parseFilters(new URLSearchParams(qs)));
    expect(parseFilters(new URLSearchParams(saved))).toEqual(parseFilters(new URLSearchParams(qs)));
  }
});

test('a describe search reads back trimmed, and a blank one is no search', () => {
  expect(parseFilters(new URLSearchParams('describe=%20a%20cat%20')).describe).toBe('a cat');
  expect(parseFilters(new URLSearchParams('describe=%20')).describe).toBeUndefined();
  expect(exploreQueryString(parseFilters(new URLSearchParams('describe=a+cat&tags=solo')))).toBe(
    'tags=solo&describe=a+cat',
  );
});
