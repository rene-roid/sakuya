import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-similar-'));
process.env.SAKUYA_DATA_DIR = dataDir;
process.env.PORT = '38776';
const BASE = 'http://localhost:38776';

// Seed the database *before* importing ./db, so these rows look like ones hashed by a build that
// predates the band columns: a perceptual_hash with no bands. Importing ./db then runs the
// backfill over them, which is the upgrade path every existing install takes.
const seed = new Database(path.join(dataDir, 'tbge.db'), { create: true });
seed.exec(`
CREATE TABLE libraries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'mixed',
  thumbnail_media_id INTEGER, custom_image_path TEXT, created_at INTEGER NOT NULL,
  last_visited_at INTEGER, auto_scan_interval INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT, library_id INTEGER NOT NULL, source TEXT NOT NULL,
  path TEXT NOT NULL, filename TEXT NOT NULL, type TEXT NOT NULL, width INTEGER, height INTEGER,
  size_bytes INTEGER NOT NULL DEFAULT 0, duration_seconds REAL, thumbnail_path TEXT,
  content_hash TEXT, mtime INTEGER, created_at INTEGER NOT NULL, indexed_at INTEGER,
  tagged_at INTEGER, last_viewed_at INTEGER, view_progress REAL NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0, watched_seconds REAL NOT NULL DEFAULT 0,
  liked INTEGER NOT NULL DEFAULT 0, liked_at INTEGER, perceptual_hash TEXT
);
`);
seed.query(`INSERT INTO libraries (name, created_at) VALUES ('sim', 0)`).run();

/** Hashes chosen so the distance from `base` is exact and easy to read off. */
const HASHES = {
  base: '0000000000000000',
  identical: '0000000000000000',
  near: '0000000000000001', // distance 1
  mid: '000000000000000f', // distance 4
  far: 'ffffffffffffffff', // distance 64
};

const ids: Record<string, number> = {};
for (const [name, hash] of Object.entries(HASHES)) {
  seed
    .query(
      `INSERT INTO media (library_id, source, path, filename, type, size_bytes, created_at, perceptual_hash)
       VALUES (1, 'folder', ?, ?, 'image', 10, 0, ?)`,
    )
    .run(`/nowhere/${name}.png`, `${name}.png`, hash);
  ids[name] = (seed.query(`SELECT last_insert_rowid() AS id`).get() as { id: number }).id;
}
seed.close();

const { sqlite } = await import('./db');
await import('./index');

const json = async (url: string): Promise<any> => (await (await fetch(BASE + url)).json()) as any;

describe('perceptual hash bands', () => {
  test('boot backfills bands for rows that only had a hash', () => {
    const row = sqlite
      .query(`SELECT phash_b0 AS b0, phash_b7 AS b7 FROM media WHERE id = ?`)
      .get(ids.mid) as { b0: number; b7: number };
    // '000000000000000f' → first byte 0x00, last byte 0x0f.
    expect(row.b0).toBe(0);
    expect(row.b7).toBe(0x0f);

    const unbanded = sqlite
      .query(`SELECT COUNT(*) AS c FROM media WHERE perceptual_hash IS NOT NULL AND phash_b0 IS NULL`)
      .get() as { c: number };
    expect(unbanded.c).toBe(0);
  });

  test('similar returns near hashes and excludes distant ones', async () => {
    const res = await json(`/api/media/${ids.base}/similar`);
    const similarIds = res.similar.map((m: { id: number }) => m.id);

    // Distance 0, 1 and 4 are all well inside the threshold of 10.
    expect(similarIds).toContain(ids.identical);
    expect(similarIds).toContain(ids.near);
    expect(similarIds).toContain(ids.mid);

    // Distance 64 shares no band and fails the distance check either way.
    expect(similarIds).not.toContain(ids.far);
    // The query subject is never its own match.
    expect(similarIds).not.toContain(ids.base);
  });

  test('results are ordered by increasing distance', async () => {
    const res = await json(`/api/media/${ids.base}/similar`);
    const order = res.similar.map((m: { id: number }) => m.id);
    expect(order.indexOf(ids.near)).toBeLessThan(order.indexOf(ids.mid));
  });
});

describe('phashBands', () => {
  test('splits a hash into eight bytes and rejects unusable input', async () => {
    const { phashBands } = await import('./lib/phashBands');

    expect(phashBands('0f1e2d3c4b5a6978')).toEqual([0x0f, 0x1e, 0x2d, 0x3c, 0x4b, 0x5a, 0x69, 0x78]);
    expect(phashBands('ffffffffffffffff')).toEqual([255, 255, 255, 255, 255, 255, 255, 255]);

    // Nulls rather than NaNs: a row with no usable hash simply never matches a band lookup,
    // which is the right outcome — NaN would silently poison the comparison instead.
    const empty = Array(8).fill(null);
    expect(phashBands(null)).toEqual(empty);
    expect(phashBands('')).toEqual(empty);
    expect(phashBands('abc')).toEqual(empty);
    expect(phashBands('zzzzzzzzzzzzzzzz')).toEqual(empty);
  });
});
