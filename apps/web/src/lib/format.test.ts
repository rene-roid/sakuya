import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { formatBytes, formatDuration, timeAgo } from './format';

afterEach(() => {
  setSystemTime();
});

test('formatBytes picks the largest unit that keeps the number at least 1', () => {
  expect(formatBytes(0)).toBe('0 B');
  expect(formatBytes(512)).toBe('512 B');
  expect(formatBytes(1024)).toBe('1.0 KB');
  expect(formatBytes(1536)).toBe('1.5 KB');
  expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GB');
  // Past the last unit it keeps counting in TB rather than running off the list.
  expect(formatBytes(2048 * 1024 ** 4)).toBe('2048.0 TB');
});

test('formatDuration shows hours only when there are some', () => {
  expect(formatDuration(null)).toBeNull();
  expect(formatDuration(Number.NaN)).toBeNull();
  expect(formatDuration(0)).toBe('0:00');
  expect(formatDuration(59.6)).toBe('1:00');
  expect(formatDuration(605)).toBe('10:05');
  expect(formatDuration(3600 + 2 * 60 + 3)).toBe('1:02:03');
});

test('timeAgo counts minutes, hours and days, then falls back to a date', () => {
  const now = new Date(2026, 0, 31, 12, 0, 0).getTime();
  setSystemTime(now);
  expect(timeAgo(null)).toBe('—');
  expect(timeAgo(now - 30_000)).toBe('just now');
  expect(timeAgo(now - 5 * 60_000)).toBe('5 min ago');
  expect(timeAgo(now - 60 * 60_000)).toBe('1 hour ago');
  expect(timeAgo(now - 23 * 60 * 60_000)).toBe('23 hours ago');
  expect(timeAgo(now - 24 * 60 * 60_000)).toBe('1 day ago');
  expect(timeAgo(now - 29 * 24 * 60 * 60_000)).toBe('29 days ago');
  const old = now - 45 * 24 * 60 * 60_000;
  expect(timeAgo(old)).toBe(new Date(old).toLocaleDateString());
});
