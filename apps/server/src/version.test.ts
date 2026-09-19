import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Importing lib/config has a side effect: it mkdirs the whole data tree. Point it at a temp dir
// so running the suite doesn't create ~/.sakuya on a machine that has never run the app.
process.env.SAKUYA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-version-'));

/**
 * The app version lives in three places that used to drift apart: the root package.json, the
 * APP_VERSION that Settings > System renders, and the newest release-notes file, which is what
 * UpdateToast compares against GitHub. A user seeing "0.1.0" in Settings while running 1.4.0 has
 * no way to tell which is lying, so pin all three together here.
 */
const repoRoot = path.resolve(import.meta.dir, '..', '..', '..');
const releasesDir = path.join(repoRoot, 'apps', 'web', 'src', 'releases');

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function newestRelease(): string {
  const versions = fs
    .readdirSync(releasesDir)
    .map((name) => name.match(/^(\d+\.\d+\.\d+)\.md$/)?.[1])
    .filter((v): v is string => Boolean(v))
    .sort(compareVersions);
  return versions[versions.length - 1];
}

const rootVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;

describe('app version', () => {
  test('root package.json matches the newest release notes', () => {
    expect(rootVersion).toBe(newestRelease());
  });

  test('APP_VERSION is read from the root package.json', async () => {
    const { APP_VERSION } = await import('./lib/config');
    expect(APP_VERSION).toBe(rootVersion);
  });

  test('every release file is named X.Y.Z.md', () => {
    const stray = fs.readdirSync(releasesDir).filter((name) => !/^\d+\.\d+\.\d+\.md$/.test(name));
    expect(stray).toEqual([]);
  });
});
