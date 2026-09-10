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
  });
});
