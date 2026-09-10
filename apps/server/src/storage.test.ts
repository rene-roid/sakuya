import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateDataDir } from './lib/storage';

function makeDataDir(dbBytes = 'db'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-storage-'));
  fs.writeFileSync(path.join(dir, 'tbge.db'), dbBytes);
  fs.mkdirSync(path.join(dir, 'thumbnails'));
  fs.writeFileSync(path.join(dir, 'thumbnails', 'a.webp'), 'thumb');
  return dir;
}

describe('migrateDataDir', () => {
  test('copies every file and removes the source', () => {
    const from = makeDataDir();
    const to = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-target-')), '.sakuya');

    migrateDataDir(from, to);

    expect(fs.readFileSync(path.join(to, 'tbge.db'), 'utf8')).toBe('db');
    expect(fs.readFileSync(path.join(to, 'thumbnails', 'a.webp'), 'utf8')).toBe('thumb');
    expect(fs.existsSync(from)).toBe(false);
  });

  test('refuses a target that already holds a database, leaving the source alone', () => {
    const from = makeDataDir();
    const to = makeDataDir('other');

    expect(() => migrateDataDir(from, to)).toThrow(/already holds/);
    expect(fs.readFileSync(path.join(from, 'tbge.db'), 'utf8')).toBe('db');
    expect(fs.readFileSync(path.join(to, 'tbge.db'), 'utf8')).toBe('other');
  });

  test('refuses a no-op move onto itself', () => {
    const from = makeDataDir();
    expect(() => migrateDataDir(from, path.join(from, '.'))).toThrow(/same folder/);
    expect(fs.existsSync(path.join(from, 'tbge.db'))).toBe(true);
  });
});
