import { expect, test } from 'bun:test';
import { normalizeTagName } from './index';

test('normalizeTagName lowercases and turns runs of whitespace into one underscore', () => {
  expect(normalizeTagName('  Blue   Hair ')).toBe('blue_hair');
  expect(normalizeTagName('Hakurei\tReimu')).toBe('hakurei_reimu');
  expect(normalizeTagName('already_normal')).toBe('already_normal');
  expect(normalizeTagName('   ')).toBe('');
});
