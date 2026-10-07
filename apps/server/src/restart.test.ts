import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import path from 'node:path';
import { useTestConfig } from './testConfig';

const dataDir = useTestConfig('restart');

// The state a server killed mid-scan leaves behind: the folder was marked scanning and never finished.
const previous = new Database(path.join(dataDir, 'tbge.db'), { create: true });
previous.exec(`
CREATE TABLE folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
INSERT INTO folders (library_id, path, status, created_at) VALUES
  (1, '/media/interrupted', 'scanning', 0),
  (1, '/media/finished', 'indexed', 0);
`);
previous.close();

const { sqlite } = await import('./db');

test('a folder left scanning by a crash reads as errored after a restart', () => {
  expect(sqlite.query('SELECT path, status FROM folders ORDER BY id').all()).toEqual([
    { path: '/media/interrupted', status: 'error' },
    { path: '/media/finished', status: 'indexed' },
  ]);
});
