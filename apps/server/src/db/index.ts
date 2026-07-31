import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { DB_PATH } from '../lib/config';
import * as schema from './schema';

export const sqlite = new Database(DB_PATH, { create: true });
sqlite.exec('PRAGMA journal_mode = WAL;');
sqlite.exec('PRAGMA foreign_keys = ON;');

sqlite.exec(`
CREATE TABLE IF NOT EXISTS libraries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'mixed',
  thumbnail_media_id INTEGER,
  created_at INTEGER NOT NULL,
  last_visited_at INTEGER,
  auto_scan_interval INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
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
  view_progress REAL NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS media_path_idx ON media(path);
CREATE INDEX IF NOT EXISTS media_library_idx ON media(library_id);
CREATE INDEX IF NOT EXISTS media_created_idx ON media(created_at);
CREATE INDEX IF NOT EXISTS media_type_idx ON media(type);
CREATE INDEX IF NOT EXISTS media_hash_idx ON media(content_hash);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  usage_count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_name_idx ON tags(name);
CREATE TABLE IF NOT EXISTS media_tags (
  media_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  confidence REAL,
  source TEXT NOT NULL DEFAULT 'user',
  PRIMARY KEY (media_id, tag_id)
);
CREATE INDEX IF NOT EXISTS media_tags_tag_idx ON media_tags(tag_id);
CREATE INDEX IF NOT EXISTS media_tags_media_idx ON media_tags(media_id);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  library_id INTEGER,
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  log TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// Migrate existing databases: add columns that may not exist yet.
try { sqlite.exec('ALTER TABLE libraries ADD COLUMN auto_scan_interval INTEGER NOT NULL DEFAULT 0'); } catch {}

// Jobs interrupted by a server restart can never finish — mark them as errored.
sqlite.exec(
  `UPDATE jobs SET status = 'error', log = log || ' (interrupted by restart)' WHERE status IN ('queued', 'running')`,
);

export const db = drizzle(sqlite, { schema });
export { schema };
