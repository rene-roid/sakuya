import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-migrations-'));
process.env.SAKUYA_DATA_DIR = dataDir;

// A DB last booted before the transcode release: it has every column up to v8, no transcoded_at,
// and (like every DB from that era) user_version 0. Docker users who skipped that release hit this.
const legacy = new Database(path.join(dataDir, 'tbge.db'), { create: true });
legacy.exec(`
CREATE TABLE libraries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'mixed',
  thumbnail_media_id INTEGER,
  custom_image_path TEXT,
  created_at INTEGER NOT NULL,
  last_visited_at INTEGER,
  auto_scan_interval INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  path TEXT NOT NULL,
  filename TEXT NOT NULL,
  type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  duration_seconds REAL,
  thumbnail_path TEXT,
  content_hash TEXT,
  mtime INTEGER,
  created_at INTEGER NOT NULL,
  indexed_at INTEGER,
  tagged_at INTEGER,
  last_viewed_at INTEGER,
  view_progress REAL NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  watched_seconds REAL NOT NULL DEFAULT 0,
  liked INTEGER NOT NULL DEFAULT 0,
  liked_at INTEGER,
  perceptual_hash TEXT
);
`);
legacy.close();

describe('schema migrations', () => {
  test('add the columns a pre-user_version database is missing', async () => {
    await import('./db');

    const db = new Database(path.join(dataDir, 'tbge.db'));
    const cols = (db.query('PRAGMA table_info(media)').all() as { name: string }[]).map((c) => c.name);
    db.close();

    expect(cols).toContain('transcoded_at');
    expect(cols).toContain('dwell_seconds');
    // Perceptual-hash bands: added long after this legacy snapshot was taken.
    expect(cols).toContain('phash_b0');
    expect(cols).toContain('phash_b7');
  });

  test('the phash band indexes exist on a migrated database', async () => {
    await import('./db');

    const db = new Database(path.join(dataDir, 'tbge.db'));
    const indexes = (db.query(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as { name: string }[]).map(
      (r) => r.name,
    );
    db.close();

    // These are created after the migrations rather than in the CREATE TABLE block, because that
    // block runs first and would reference columns an existing database doesn't have yet.
    for (let i = 0; i < 8; i++) expect(indexes).toContain(`media_phash_b${i}_idx`);
  });

  test('the live schema matches the Drizzle definitions', async () => {
    const { sqlite, schema } = await import('./db');
    const { getTableConfig } = await import('drizzle-orm/sqlite-core');

    // db/index.ts hand-writes CREATE TABLE while schema.ts declares the same tables for Drizzle.
    // Two sources of truth is what let `transcoded_at` go missing while user_version claimed the
    // database was current, so compare them directly rather than trusting they were kept in step.
    const tables = Object.values(schema).filter((t): t is never => {
      try {
        getTableConfig(t as never);
        return true;
      } catch {
        return false;
      }
    });
    expect(tables.length).toBeGreaterThan(0);

    for (const table of tables) {
      const { name, columns } = getTableConfig(table);
      const live = (sqlite.query(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);
      expect({ table: name, columns: live.slice().sort() }).toEqual({
        table: name,
        columns: columns.map((c) => c.name).sort(),
      });
    }
  });
});
