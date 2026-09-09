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
];

test('exploreQueryString survives a parse round-trip', () => {
  for (const qs of CASES) {
    const saved = exploreQueryString(parseFilters(new URLSearchParams(qs)));
    expect(parseFilters(new URLSearchParams(saved))).toEqual(parseFilters(new URLSearchParams(qs)));
  }
});
