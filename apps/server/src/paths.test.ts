import { expect, test } from 'bun:test';
import { isUnder } from './lib/paths';

test('isUnder matches the root itself and anything beneath it', () => {
  expect(isUnder('/media/a', '/media/a')).toBe(true);
  expect(isUnder('/media/a/b.png', '/media/a')).toBe(true);
  expect(isUnder('/media/ab/c.png', '/media/a')).toBe(false);
  expect(isUnder('/media/b.png', '/media/a')).toBe(false);
});

test('isUnder works when the root is a filesystem root', () => {
  // `root + sep` is "//" here, which the old startsWith check could never match.
  expect(isUnder('/x.png', '/')).toBe(true);
  expect(isUnder('/media/x.png', '/')).toBe(true);
});
