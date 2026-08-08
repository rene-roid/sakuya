import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { DB_PATH } from '../lib/config';
import * as schema from './schema';

export const sqlite = new Database(DB_PATH, { create: true });
sqlite.exec('PRAGMA journal_mode = WAL;');
sqlite.exec('PRAGMA foreign_keys = ON;');

// A discarded downloader prototype used group_id-based download_groups/download_items tables.
// The current schema is batch_id-based (download_batches/download_items); drop the legacy pair
// so the tables below can be (re)created cleanly. Nothing salvageable was left in them: their
// one row pointed at an already-deleted library and a downloads/ folder that no longer exists on disk.
const legacyItemColumns = sqlite.query(`PRAGMA table_info(download_items)`).all() as { name: string }[];
if (legacyItemColumns.some((c) => c.name === 'group_id')) {
  sqlite.exec('DROP TABLE IF EXISTS download_items');
  sqlite.exec('DROP TABLE IF EXISTS download_groups');
}

sqlite.exec(`
CREATE TABLE IF NOT EXISTS libraries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'mixed',
  thumbnail_media_id INTEGER,
  custom_image_path TEXT,
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
  view_progress REAL NOT NULL DEFAULT 0,
  liked INTEGER NOT NULL DEFAULT 0,
  liked_at INTEGER,
  perceptual_hash TEXT
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
CREATE TABLE IF NOT EXISTS job_schedules (
  job_type TEXT NOT NULL,
  library_id INTEGER,
  mode TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL DEFAULT 0,
  use_global INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (job_type, library_id)
);
CREATE TABLE IF NOT EXISTS download_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL,
  folder_path TEXT NOT NULL,
  extra_args TEXT,
  cookie_file_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS download_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  files_downloaded INTEGER NOT NULL DEFAULT 0,
  pid INTEGER,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS download_items_batch_idx ON download_items(batch_id);
CREATE TABLE IF NOT EXISTS download_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  line TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS download_logs_item_idx ON download_logs(item_id);
CREATE TABLE IF NOT EXISTS download_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS download_files_item_idx ON download_files(item_id);
CREATE TABLE IF NOT EXISTS download_cookies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL
);
`);

// Migrate existing databases: add columns that may not exist yet.
try { sqlite.exec('ALTER TABLE libraries ADD COLUMN auto_scan_interval INTEGER NOT NULL DEFAULT 0'); } catch {}
try { sqlite.exec('ALTER TABLE libraries ADD COLUMN custom_image_path TEXT'); } catch {}
try { sqlite.exec('ALTER TABLE media ADD COLUMN liked INTEGER NOT NULL DEFAULT 0'); } catch {}
try { sqlite.exec('ALTER TABLE media ADD COLUMN liked_at INTEGER'); } catch {}
try { sqlite.exec('ALTER TABLE media ADD COLUMN perceptual_hash TEXT'); } catch {}
try { sqlite.exec('CREATE INDEX IF NOT EXISTS media_liked_idx ON media(liked)'); } catch {}

// Jobs interrupted by a server restart can never finish — mark them as errored.
sqlite.exec(
  `UPDATE jobs SET status = 'error', log = log || ' (interrupted by restart)' WHERE status IN ('queued', 'running')`,
);

// Download items interrupted by a server restart lose their tracked process — mark running as queued
// (gallery-dl resumes safely on re-run) and clear stale pids.
sqlite.exec(`UPDATE download_items SET status = 'queued', pid = NULL WHERE status IN ('running', 'queued')`);

export const db = drizzle(sqlite, { schema });
export { schema };

// Seed global defaults for job schedules if none exist yet.
const globalCount = sqlite.query('SELECT COUNT(*) AS c FROM job_schedules WHERE library_id IS NULL').get() as { c: number };
if (globalCount.c === 0) {
  const insertGlobal = sqlite.prepare(
    'INSERT OR IGNORE INTO job_schedules (job_type, library_id, mode, interval_minutes, use_global) VALUES (?, NULL, ?, 0, 0)',
  );
  insertGlobal.run('scan', 'off');
  insertGlobal.run('tag', 'after-scan');
  insertGlobal.run('hash', 'after-scan');
  insertGlobal.run('cleanup', 'off');
}

// Migrate legacy per-library autoScanInterval values into job_schedules once.
const libRows = sqlite
  .query('SELECT id, auto_scan_interval FROM libraries WHERE auto_scan_interval > 0')
  .all() as { id: number; auto_scan_interval: number }[];
if (libRows.length > 0) {
  const insertLib = sqlite.prepare(
    "INSERT OR IGNORE INTO job_schedules (job_type, library_id, mode, interval_minutes, use_global) VALUES ('scan', ?, 'interval', ?, 0)",
  );
  for (const lib of libRows) insertLib.run(lib.id, lib.auto_scan_interval);
}
