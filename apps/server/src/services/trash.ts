import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { BulkFailure, TrashItem, TrashPayload, TrashRemoveResult, TrashRestoreResult } from '@sakuya/shared';
import { sqlite } from '../db';
import { DATA_DIR } from '../lib/config';
import { chunkIds, type MediaRow } from '../lib/mediaByIds';
import { removeMediaRows } from './mediaRemoval';
import { refreshUsageCounts } from './tagger';
import { thumbPathFor } from './thumbnailer';
import { transcodePathFor } from './transcoder';
import { spritePathFor } from './videoSprite';

export const TRASH_DIR = path.join(DATA_DIR, 'trash');
export const TRASH_RETENTION_DAYS = 30;
const RETENTION_MS = TRASH_RETENTION_DAYS * 86_400_000;
const PURGE_INTERVAL_MS = 6 * 3_600_000;
const MOVE_CONCURRENCY = 8;

// Thumbnail, sprite and transcode ride along in a subfolder with no media extension, so they can never
// collide with the trashed file's own name.
const DERIVED = '.derived';
const THUMB = 'thumb.webp';
const SPRITE = 'sprite.webp';
const TRANSCODE = 'transcode.mp4';

export class TrashError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Rename = (from: string, to: string) => Promise<void>;

/**
 * rename(), or copy then unlink when the two paths sit on different filesystems (EXDEV), which is
 * the usual case for a library on another drive. The copy keeps the original mtime so a rescan of
 * a restored file doesn't take it for a changed one.
 */
export async function moveFile(from: string, to: string, rename: Rename = fsp.rename): Promise<void> {
  try {
    await rename(from, to);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
  }
  const stat = await fsp.stat(from);
  await fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL);
  try {
    await fsp.utimes(to, stat.atime, stat.mtime);
    await fsp.unlink(from);
  } catch (err) {
    await fsp.rm(to, { force: true });
    throw err;
  }
}

async function moveIfPresent(from: string, to: string): Promise<boolean> {
  if (!fs.existsSync(from)) return false;
  await fsp.mkdir(path.dirname(to), { recursive: true });
  return moveFile(from, to).then(
    () => true,
    () => false,
  );
}

interface Snapshot {
  media: Record<string, unknown>;
  libraryName: string | null;
  wasCover: boolean;
  tags: { name: string; category: string; source: string; confidence: number | null }[];
  vetoes: { name: string; category: string; createdAt: number }[];
  boards: { boardId: number; addedAt: number }[];
}

function snapshot(id: number): Snapshot {
  const media = sqlite.query('SELECT * FROM media WHERE id = ?').get(id) as Record<string, unknown>;
  const library = sqlite
    .query('SELECT name, thumbnail_media_id AS cover FROM libraries WHERE id = ?')
    .get(media.library_id as number) as { name: string; cover: number | null } | null;
  return {
    media,
    libraryName: library?.name ?? null,
    wasCover: library?.cover === id,
    tags: sqlite
      .query(
        `SELECT t.name, t.category, mt.source, mt.confidence FROM media_tags mt JOIN tags t ON t.id = mt.tag_id
         WHERE mt.media_id = ?`,
      )
      .all(id) as Snapshot['tags'],
    vetoes: sqlite
      .query(
        `SELECT t.name, t.category, v.created_at AS createdAt FROM media_tag_vetoes v JOIN tags t ON t.id = v.tag_id
         WHERE v.media_id = ?`,
      )
      .all(id) as Snapshot['vetoes'],
    boards: sqlite
      .query('SELECT board_id AS boardId, added_at AS addedAt FROM board_media WHERE media_id = ?')
      .all(id) as Snapshot['boards'],
  };
}

function freshTrashDir(mediaId: number, now: number): string {
  for (let n = 0; ; n++) {
    const name = `${now.toString(36)}-${mediaId}${n ? `-${n}` : ''}`;
    try {
      fs.mkdirSync(path.join(TRASH_DIR, name), { recursive: false });
      return name;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}

const insertTrash = () =>
  sqlite.prepare(
    `INSERT INTO trash (media_id, library_id, filename, type, size_bytes, original_path, trashed_path, trashed_at, media_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

export interface TrashOutcome {
  /** Ids whose rows are gone: moved to the trash, or already missing from disk. */
  removed: number[];
  failed: BulkFailure[];
}

/**
 * Delete media by moving each file into `<dataDir>/trash/<entry>/` and dropping its rows. A file
 * that is already gone from disk just loses its row, as before. A file that can't be moved (a
 * read-only folder, say) keeps its row and is reported as failed, rather than vanishing from the
 * library while it stays on disk.
 */
export async function trashMedia(rows: MediaRow[], now: number = Date.now()): Promise<TrashOutcome> {
  if (!rows.length) return { removed: [], failed: [] };
  fs.mkdirSync(TRASH_DIR, { recursive: true });
  const snapshots = new Map(rows.map((row) => [row.id, snapshot(row.id)]));
  const moved: { row: MediaRow; dir: string }[] = [];
  const gone: number[] = [];
  const failed: BulkFailure[] = [];

  const trashOne = async (row: MediaRow) => {
    if (!fs.existsSync(row.path)) {
      gone.push(row.id);
      return;
    }
    const dir = freshTrashDir(row.id, now);
    const abs = path.join(TRASH_DIR, dir);
    try {
      await moveFile(row.path, path.join(abs, path.basename(row.path)));
    } catch (err) {
      fs.rmSync(abs, { recursive: true, force: true });
      failed.push({ id: row.id, error: `Could not move to trash: ${(err as Error).message}` });
      return;
    }
    await moveIfPresent(thumbPathFor(row.id), path.join(abs, DERIVED, THUMB));
    await moveIfPresent(spritePathFor(row.id), path.join(abs, DERIVED, SPRITE));
    await moveIfPresent(transcodePathFor(row.id), path.join(abs, DERIVED, TRANSCODE));
    moved.push({ row, dir });
  };
  // A few at a time: one by one, a 500-item delete spent most of its time waiting on each rename.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(MOVE_CONCURRENCY, rows.length) }, async () => {
      while (next < rows.length) await trashOne(rows[next++]);
    }),
  );

  try {
    sqlite.transaction(() => {
      const insert = insertTrash();
      for (const { row, dir } of moved) {
        insert.run(
          row.id,
          row.libraryId,
          row.filename,
          row.type,
          row.sizeBytes,
          row.path,
          dir,
          now,
          JSON.stringify(snapshots.get(row.id)),
        );
      }
      removeMediaRows([...moved.map((m) => m.row.id), ...gone]);
    })();
  } catch (err) {
    for (const { row, dir } of moved) {
      await moveFile(path.join(TRASH_DIR, dir, path.basename(row.path)), row.path).catch(() => {});
      fs.rmSync(path.join(TRASH_DIR, dir), { recursive: true, force: true });
    }
    throw err;
  }
  return { removed: [...moved.map((m) => m.row.id), ...gone], failed };
}

interface TrashRow {
  id: number;
  media_id: number;
  library_id: number;
  filename: string;
  type: TrashItem['type'];
  size_bytes: number;
  original_path: string;
  trashed_path: string;
  trashed_at: number;
}

const ROW_COLUMNS = 'id, media_id, library_id, filename, type, size_bytes, original_path, trashed_path, trashed_at';

function trashRow(id: number): TrashRow {
  const row = sqlite.query(`SELECT ${ROW_COLUMNS} FROM trash WHERE id = ?`).get(id) as TrashRow | null;
  if (!row) throw new TrashError(404, 'Not in the trash');
  return row;
}

export function trashedFilePath(row: Pick<TrashRow, 'trashed_path' | 'original_path'>): string {
  return path.join(TRASH_DIR, row.trashed_path, path.basename(row.original_path));
}

export function trashThumbPath(id: number): string | null {
  const row = trashRow(id);
  const thumb = path.join(TRASH_DIR, row.trashed_path, DERIVED, THUMB);
  if (fs.existsSync(thumb)) return thumb;
  const file = trashedFilePath(row);
  return row.type === 'image' && fs.existsSync(file) ? file : null;
}

export function listTrash(): TrashPayload {
  const rows = sqlite
    .query(
      `SELECT ${ROW_COLUMNS.split(', ')
        .map((c) => `t.${c}`)
        .join(', ')}, l.name AS library_name
       FROM trash t LEFT JOIN libraries l ON l.id = t.library_id
       ORDER BY t.trashed_at DESC, t.id DESC`,
    )
    .all() as (TrashRow & { library_name: string | null })[];
  const items: TrashItem[] = rows.map((r) => ({
    id: r.id,
    mediaId: r.media_id,
    libraryId: r.library_id,
    libraryName: r.library_name,
    filename: r.filename,
    type: r.type,
    sizeBytes: r.size_bytes,
    originalPath: r.original_path,
    trashedAt: r.trashed_at,
    expiresAt: r.trashed_at + RETENTION_MS,
  }));
  return {
    items,
    count: items.length,
    totalBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
    retentionDays: TRASH_RETENTION_DAYS,
  };
}

/** `photo.jpg` → `photo (restored).jpg`, `photo (restored 2).jpg`, … the first name free on disk and in the index. */
function freePath(original: string): string {
  const taken = (p: string) => fs.existsSync(p) || !!sqlite.query('SELECT 1 FROM media WHERE path = ?').get(p);
  if (!taken(original)) return original;
  const ext = path.extname(original);
  const stem = original.slice(0, original.length - ext.length);
  for (let n = 1; ; n++) {
    const candidate = `${stem} (restored${n > 1 ? ` ${n}` : ''})${ext}`;
    if (!taken(candidate)) return candidate;
  }
}

function tagId(name: string, category: string): number {
  const existing = sqlite.query('SELECT id FROM tags WHERE name = ?').get(name) as { id: number } | null;
  if (existing) return existing.id;
  return (
    sqlite.query('INSERT INTO tags (name, category) VALUES (?, ?) RETURNING id').get(name, category) as {
      id: number;
    }
  ).id;
}

/**
 * Put a trashed file back at its original path and re-insert its media row under the same id, so
 * its thumbnail, transcode, tags, like, boards and vetoes all come back with it. Refuses (409) when
 * the library or the original folder is gone; a file now sitting at the original path makes the
 * item come back under a "(restored)" name instead.
 */
export async function restoreFromTrash(id: number): Promise<TrashRestoreResult> {
  const row = trashRow(id);
  const snap = JSON.parse(
    (sqlite.query('SELECT media_json AS j FROM trash WHERE id = ?').get(id) as { j: string }).j,
  ) as Snapshot;
  if (!sqlite.query('SELECT 1 FROM libraries WHERE id = ?').get(row.library_id)) {
    throw new TrashError(
      409,
      `The library ${snap.libraryName ? `"${snap.libraryName}" ` : ''}this item belonged to no longer exists`,
    );
  }
  const folder = path.dirname(row.original_path);
  if (!fs.existsSync(folder)) throw new TrashError(409, `The folder ${folder} no longer exists`);
  const source = trashedFilePath(row);
  if (!fs.existsSync(source)) throw new TrashError(410, 'The file is missing from the trash folder');

  const target = freePath(row.original_path);
  await moveFile(source, target);

  const idFree = !sqlite.query('SELECT 1 FROM media WHERE id = ?').get(row.media_id);
  const derived = path.join(TRASH_DIR, row.trashed_path, DERIVED);
  let mediaId = row.media_id;
  const touchedTags: number[] = [];
  try {
    sqlite.transaction(() => {
      const live = new Set((sqlite.query('PRAGMA table_info(media)').all() as { name: string }[]).map((c) => c.name));
      const values: Record<string, unknown> = { ...snap.media, path: target, filename: path.basename(target) };
      if (!idFree) delete values.id;
      const columns = Object.keys(values).filter((c) => live.has(c));
      const inserted = sqlite
        .query(`INSERT INTO media (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) RETURNING id`)
        .get(...(columns.map((c) => values[c]) as never[])) as { id: number };
      mediaId = inserted.id;

      const link = sqlite.prepare(
        'INSERT OR IGNORE INTO media_tags (media_id, tag_id, confidence, source) VALUES (?, ?, ?, ?)',
      );
      for (const tag of snap.tags) {
        const tid = tagId(tag.name, tag.category);
        link.run(mediaId, tid, tag.confidence, tag.source);
        touchedTags.push(tid);
      }
      const veto = sqlite.prepare(
        'INSERT OR IGNORE INTO media_tag_vetoes (media_id, tag_id, created_at) VALUES (?, ?, ?)',
      );
      for (const v of snap.vetoes) veto.run(mediaId, tagId(v.name, v.category), v.createdAt);
      const board = sqlite.prepare(
        `INSERT OR IGNORE INTO board_media (board_id, media_id, added_at)
         SELECT id, ?, ? FROM boards WHERE id = ?`,
      );
      for (const b of snap.boards) board.run(mediaId, b.addedAt, b.boardId);
      if (snap.wasCover) {
        sqlite
          .query('UPDATE libraries SET thumbnail_media_id = ? WHERE id = ? AND thumbnail_media_id IS NULL')
          .run(mediaId, row.library_id);
      }
      sqlite.query('DELETE FROM trash WHERE id = ?').run(id);
    })();
  } catch (err) {
    await moveFile(target, source).catch(() => {});
    throw err;
  }

  // Derived files are named by media id, so they only fit back when the id was reused.
  const thumbBack = idFree && (await moveIfPresent(path.join(derived, THUMB), thumbPathFor(mediaId)));
  const transcodeBack = idFree && (await moveIfPresent(path.join(derived, TRANSCODE), transcodePathFor(mediaId)));
  const spriteBack = idFree && (await moveIfPresent(path.join(derived, SPRITE), spritePathFor(mediaId)));
  sqlite
    .query(
      `UPDATE media SET thumbnail_path = ?, transcoded_at = CASE WHEN ? THEN transcoded_at ELSE NULL END,
         sprite_frames = CASE WHEN ? THEN sprite_frames ELSE NULL END,
         sprite_at = CASE WHEN ? THEN sprite_at ELSE NULL END
       WHERE id = ?`,
    )
    .run(thumbBack ? thumbPathFor(mediaId) : null, transcodeBack ? 1 : 0, spriteBack ? 1 : 0, spriteBack ? 1 : 0, mediaId);
  fs.rmSync(path.join(TRASH_DIR, row.trashed_path), { recursive: true, force: true });
  refreshUsageCounts(touchedTags);
  return { ok: true, mediaId, path: target, renamed: target !== row.original_path };
}

function removeEntries(rows: Pick<TrashRow, 'id' | 'trashed_path' | 'size_bytes'>[]): TrashRemoveResult {
  for (const part of chunkIds(rows.map((r) => r.id))) {
    sqlite.query(`DELETE FROM trash WHERE id IN (${part.map(() => '?').join(',')})`).run(...part);
  }
  for (const r of rows) fs.rmSync(path.join(TRASH_DIR, r.trashed_path), { recursive: true, force: true });
  return { ok: true, removed: rows.length, freedBytes: rows.reduce((sum, r) => sum + r.size_bytes, 0) };
}

export function deleteFromTrash(id: number): TrashRemoveResult {
  return removeEntries([trashRow(id)]);
}

/** Delete everything in the trash, including folders no row points at (left by a crash or a restored backup). */
export function emptyTrash(): TrashRemoveResult {
  const result = removeEntries(sqlite.query('SELECT id, trashed_path, size_bytes FROM trash').all() as TrashRow[]);
  if (fs.existsSync(TRASH_DIR)) {
    for (const entry of fs.readdirSync(TRASH_DIR))
      fs.rmSync(path.join(TRASH_DIR, entry), { recursive: true, force: true });
  }
  return result;
}

/** Delete entries trashed more than 30 days before `now`. */
export function purgeTrash(now: number = Date.now()): TrashRemoveResult {
  return removeEntries(
    sqlite
      .query('SELECT id, trashed_path, size_bytes FROM trash WHERE trashed_at < ?')
      .all(now - RETENTION_MS) as TrashRow[],
  );
}

/**
 * Purge on boot and every six hours. The cleanup job purges too, but its schedule is off by
 * default, and a trash that never empties is a disk that slowly fills.
 */
export function startTrashPurge(): void {
  const run = () => {
    try {
      const { removed } = purgeTrash();
      if (removed) console.log(`[sakuya] purged ${removed} trash items older than ${TRASH_RETENTION_DAYS} days`);
    } catch (err) {
      console.error('[sakuya] trash purge failed', err);
    }
  };
  run();
  setInterval(run, PURGE_INTERVAL_MS).unref();
}
