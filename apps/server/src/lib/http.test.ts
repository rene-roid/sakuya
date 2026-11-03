import { describe, expect, test } from 'bun:test';
import { decodeCursor, encodeCursor, intParam, sanitizeFilename } from './http';

const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as { status?: number }).status;
  }
  return undefined;
};

describe('intParam', () => {
  test('accepts non-negative integers', () => {
    expect(intParam('0')).toBe(0);
    expect(intParam('42')).toBe(42);
  });

  test('anything else is a 400', () => {
    for (const bad of ['-1', '1.5', 'abc', 'NaN', 'Infinity', '1e400']) expect(status(() => intParam(bad))).toBe(400);
  });
});

describe('cursors', () => {
  test('round-trip the sort key and tiebreakers', () => {
    const parts = [1_700_000_000_000, 'Ünïcode name.png', null, 42];
    const cursor = encodeCursor(parts);
    expect(cursor).toMatch(/^[\w-]+$/); // base64url: safe in a query string as is
    expect(decodeCursor(cursor)).toEqual(parts);
  });

  test('anything that did not come from encodeCursor is a 400', () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    for (const bad of ['not base64 at all', encode({ a: 1 }), encode([{ nested: true }]), encode([[1]]), encode('x')]) {
      expect(status(() => decodeCursor(bad))).toBe(400);
    }
  });
});

describe('sanitizeFilename', () => {
  test('keeps an ordinary name', () => {
    expect(sanitizeFilename('My Photo (1) [edit].jpg')).toBe('My Photo (1) [edit].jpg');
  });

  test('drops any directory part, including Windows separators', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('..\\..\\evil.png')).not.toMatch(/[\\/]/);
  });

  test('replaces characters outside the safe set', () => {
    expect(sanitizeFilename('a:b*c?"<>|.png')).toBe('a_b_c_.png');
  });

  test('keeps the end of a long name, so the extension survives', () => {
    const long = sanitizeFilename(`${'x'.repeat(300)}.webm`);
    expect(long).toHaveLength(120);
    expect(long.endsWith('.webm')).toBe(true);
  });
});
