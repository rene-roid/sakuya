import { expect, test } from 'bun:test';
import { MIN_BUN_VERSION, isOlderVersion, unsupportedBunMessage } from '@sakuya/shared/runtime';
import { JOB_MEMORY_ENV, currentJobMemoryLimit } from './lib/windowsJob';

test('version comparison is numeric, not lexical', () => {
  expect(isOlderVersion('1.3.6', '1.4.2')).toBe(true);
  expect(isOlderVersion('1.4.1', '1.4.2')).toBe(true);
  expect(isOlderVersion('1.4.2', '1.4.2')).toBe(false);
  expect(isOlderVersion('1.4.10', '1.4.2')).toBe(false);
  expect(isOlderVersion('1.10.0', '1.4.2')).toBe(false);
  expect(isOlderVersion('2.0.0', '1.4.2')).toBe(false);
  expect(isOlderVersion('1.4.2-canary.1', '1.4.2')).toBe(false);
});

test('old Bun is refused, current Bun and Node pass', () => {
  expect(unsupportedBunMessage('1.3.6')).toContain('bun upgrade');
  expect(unsupportedBunMessage(MIN_BUN_VERSION)).toBeNull();
  expect(unsupportedBunMessage(undefined)).toBeNull();
  // The suite itself must be running on a supported Bun.
  expect(unsupportedBunMessage()).toBeNull();
});

test('the launcher-applied job memory limit is reported even though the job cannot be queried', () => {
  expect(currentJobMemoryLimit({ [JOB_MEMORY_ENV]: String(2 * 1024 ** 3) })).toBe(2 * 1024 ** 3);
});
