import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { db, sqlite, schema } from '../db';
import { wrap, intParam } from '../lib/http';
import { thumbPathFor, generateThumbnail, enqueueThumbnailRegenerate } from '../services/thumbnailer';
import { enqueueTagJob, modelReady, upsertTag, refreshUsageCounts } from '../services/tagger';
import { playablePathFor, transcodePathFor } from '../services/transcoder';
import { rowToMedia } from '../lib/rowToMedia';
import { mediaRowsByIds, chunkIds } from '../lib/mediaByIds';
import { thumbnailCacheEnabled } from '../lib/settings';
import { hammingDistance } from '../services/perceptualHash';
import type {
  BulkFailure,
  BulkResult,
  DuplicatesResponse,
  MediaDetail,
  MediaIdsResponse,
  MediaListResponse,
  SimilarResponse,
} from '@sakuya/shared';

export const mediaRouter = Router();

const TAG_CATEGORIES = ['rating', 'general', 'character', 'user'] as const;

const filterSchema = z.object({
  libraryId: z.coerce.number().int().optional(),
  boardId: z.coerce.number().int().optional(),
  type: z.enum(['image', 'video']).optional(),
  tags: z.string().optional(),
  liked: z.coerce.number().int().optional(),
  q: z.union([z.string(), z.array(z.string())]).optional(),
  sort: z.enum(['recent', 'name', 'size', 'random']).default('recent'),
  dir: z.enum(['asc', 'desc']).optional(),
  seed: z.coerce.number().int().default(1),
});

const listQuerySchema = filterSchema.extend({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

type MediaFilterQuery = z.infer<typeof filterSchema>;

/**
 * WHERE fragments + bound params for a filter query. Shared by the paginated list and by
 * `/api/media/ids`, so "select all matching" can never drift from what the grid shows.
 */
function buildMediaFilter(query: MediaFilterQuery): { conds: string[]; params: unknown[] } {
  const tagNames = (query.tags ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const conds: string[] = [];
  const params: unknown[] = [];
  if (query.libraryId !== undefined) {
    conds.push('m.library_id = ?');
    params.push(query.libraryId);
  }
  if (query.boardId !== undefined) {
    conds.push('m.id IN (SELECT bm.media_id FROM board_media bm WHERE bm.board_id = ?)');
    params.push(query.boardId);
  }
  if (query.type) {
    conds.push('m.type = ?');
    params.push(query.type);
  }
  if (query.liked) {
    conds.push('m.liked = 1');
  }
  // Repeated ?q= params are ANDed, so several free-text terms can narrow one search.
  const qTerms = (Array.isArray(query.q) ? query.q : query.q ? [query.q] : [])
    .map((t) => t.trim())
    .filter(Boolean);
  for (const term of qTerms) {
    conds.push(
      `(m.path LIKE ? OR m.id IN (SELECT mt.media_id FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE t.name LIKE ?))`,
    );
    params.push(`%${term}%`, `%${term}%`);
  }
  if (tagNames.length) {
    const placeholders = tagNames.map(() => '?').join(',');
    conds.push(
      `m.id IN (SELECT mt.media_id FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE t.name IN (${placeholders}) GROUP BY mt.media_id HAVING COUNT(DISTINCT t.id) = ?)`,
    );
    params.push(...tagNames, tagNames.length);
  }
  return { conds, params };
}

/** Deterministic sort key per mode; random uses a seeded hash so pagination stays stable. */
function sortKeyExpr(query: MediaFilterQuery): string {
  const seed = query.seed % 2147483647;
  return query.sort === 'name'
    ? 'lower(m.filename)'
    : query.sort === 'size'
      ? 'm.size_bytes'
      : query.sort === 'random'
        ? `(((m.id + ${seed}) * 2654435761) % 2147483647)`
        : 'm.created_at';
}

function sortDir(query: MediaFilterQuery): 'asc' | 'desc' {
  return query.dir ?? (query.sort === 'name' ? 'asc' : 'desc');
}

mediaRouter.get(
  '/api/media',
  wrap(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const dir = sortDir(query);
    const { conds, params } = buildMediaFilter(query);
    const keyExpr = sortKeyExpr(query);

    // The count describes the filter, not the page, so only the first request of a result set
    // pays for it. Infinite scroll fetches page after page with identical filters, and a full
    // filtered COUNT(*) was the most expensive part of each of those fetches; the client keeps
    // the total it got from page one.
    const total = query.cursor
      ? null
      : (
          sqlite
            .query(`SELECT COUNT(*) AS c FROM media m ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}`)
            .get(...(params as any[])) as { c: number }
        ).c;

    const pageConds = [...conds];
    const pageParams = [...params];
    if (query.cursor) {
      try {
        const [key, id] = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        pageConds.push(`(${keyExpr}, m.id) ${dir === 'asc' ? '>' : '<'} (?, ?)`);
        pageParams.push(key, id);
      } catch {
        throw Object.assign(new Error('Invalid cursor'), { status: 400 });
      }
    }

    const sql = `
      SELECT m.*, ${keyExpr} AS sort_key, l.name AS library_name,
             (SELECT COUNT(*) FROM media_tags mt WHERE mt.media_id = m.id) AS tag_count
      FROM media m
      LEFT JOIN libraries l ON l.id = m.library_id
      ${pageConds.length ? 'WHERE ' + pageConds.join(' AND ') : ''}
      ORDER BY ${keyExpr} ${dir === 'asc' ? 'ASC' : 'DESC'}, m.id ${dir === 'asc' ? 'ASC' : 'DESC'}
      LIMIT ?`;
    const rows = sqlite.query(sql).all(...(pageParams as any[]), query.limit) as any[];

    let nextCursor: string | null = null;
    if (rows.length === query.limit) {
      const last = rows[rows.length - 1];
      nextCursor = Buffer.from(JSON.stringify([last.sort_key, last.id])).toString('base64url');
    }
    const body: MediaListResponse = { items: rows.map(rowToMedia), nextCursor, total };
    res.json(body);
  }),
);

// Must stay ahead of `/api/media/:id` — otherwise "ids" is parsed as an id and 400s.
mediaRouter.get(
  '/api/media/ids',
  wrap(async (req, res) => {
    const query = filterSchema.parse(req.query);
    const { conds, params } = buildMediaFilter(query);
    const keyExpr = sortKeyExpr(query);
    const dir = sortDir(query);
    const rows = sqlite
      .query(
        `SELECT m.id FROM media m
         ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
         ORDER BY ${keyExpr} ${dir === 'asc' ? 'ASC' : 'DESC'}, m.id ${dir === 'asc' ? 'ASC' : 'DESC'}`,
      )
      .all(...(params as any[])) as { id: number }[];
    const body: MediaIdsResponse = { ids: rows.map((r) => r.id), total: rows.length };
    res.json(body);
  }),
);

mediaRouter.get(
  '/api/media/duplicates',
  wrap(async (req, res) => {
    // One query for every duplicated row, grouped in JS. This used to run a query per hash
    // group, which on a library with thousands of duplicate groups meant thousands of
    // round trips. The IN subquery keeps the group set in SQL, so nothing has to be bound.
    const rows = sqlite
      .query(
        `SELECT m.*, l.name AS library_name,
                (SELECT COUNT(*) FROM media_tags mt WHERE mt.media_id = m.id) AS tag_count
         FROM media m LEFT JOIN libraries l ON l.id = m.library_id
         WHERE m.content_hash IN (
           SELECT content_hash FROM media
           WHERE content_hash IS NOT NULL
           GROUP BY content_hash HAVING COUNT(*) > 1
         )
         ORDER BY m.content_hash, m.created_at ASC`,
      )
      .all() as any[];

    // Rows arrive grouped and oldest-first within each group, so the first item of a group is
    // the original and the rest are what a cleanup would reclaim.
    const byHash = new Map<string, ReturnType<typeof rowToMedia>[]>();
    for (const row of rows) {
      const hash = row.content_hash as string;
      const list = byHash.get(hash);
      if (list) list.push(rowToMedia(row));
      else byHash.set(hash, [rowToMedia(row)]);
    }

    const groups: DuplicatesResponse['groups'] = [];
    let fileCount = 0;
    let wastedBytes = 0;
    for (const [hash, items] of byHash) {
      const groupWasted = items.slice(1).reduce((sum, m) => sum + m.sizeBytes, 0);
      groups.push({ contentHash: hash, items, wastedBytes: groupWasted });
      fileCount += items.length;
      wastedBytes += groupWasted;
    }
    groups.sort((a, b) => b.wastedBytes - a.wastedBytes);

    const body: DuplicatesResponse = { groups, groupCount: groups.length, fileCount, wastedBytes };
    res.json(body);
  }),
);

const deleteBatchSchema = z.object({ ids: z.array(z.number().int()).min(1) });

mediaRouter.post(
  '/api/media/delete-batch',
  wrap(async (req, res) => {
    const { ids } = deleteBatchSchema.parse(req.body);
    const rows = mediaRowsByIds(ids);
    const found = ids.filter((id) => rows.has(id));

    // Rows go first and atomically: a half-applied delete would leave media_tags pointing at
    // rows that no longer exist. Files are unlinked only once that commit succeeded.
    const apply = sqlite.transaction(() => {
      for (const part of chunkIds(found)) {
        db.delete(schema.mediaTags).where(inArray(schema.mediaTags.mediaId, part)).run();
        db.delete(schema.media).where(inArray(schema.media.id, part)).run();
      }
    });
    apply();

    for (const id of found) {
      fs.unlink(rows.get(id)!.path, () => {});
      fs.unlink(thumbPathFor(id), () => {});
      fs.unlink(transcodePathFor(id), () => {});
    }
    res.json({ ok: true, deleted: found.length });
  }),
);

const idsBody = z.object({ ids: z.array(z.number().int()).min(1).max(5000) });

/**
 * Rows for an explicit id list, in the order requested. A selection can span pages the grid
 * never loaded ("select all matching"), so bulk confirmations resolve names through here
 * rather than from whatever happens to be in the client's cache.
 */
mediaRouter.post(
  '/api/media/by-ids',
  wrap(async (req, res) => {
    const { ids } = idsBody.parse(req.body);
    const placeholders = ids.map(() => '?').join(',');
    const rows = sqlite
      .query(
        `SELECT m.*, l.name AS library_name,
                (SELECT COUNT(*) FROM media_tags mt WHERE mt.media_id = m.id) AS tag_count
         FROM media m LEFT JOIN libraries l ON l.id = m.library_id
         WHERE m.id IN (${placeholders})`,
      )
      .all(...(ids as any[])) as any[];
    const byId = new Map(rows.map((row) => [row.id as number, rowToMedia(row)]));
    res.json(ids.map((id) => byId.get(id)).filter(Boolean));
  }),
);

/** Tag histogram across a selection — powers the bulk "remove tags" picker and its confirm preview. */
mediaRouter.post(
  '/api/media/tags-summary',
  wrap(async (req, res) => {
    const { ids } = idsBody.parse(req.body);
    const placeholders = ids.map(() => '?').join(',');
    const rows = sqlite
      .query(
        `SELECT t.name, t.category, COUNT(*) AS count
         FROM media_tags mt JOIN tags t ON t.id = mt.tag_id
         WHERE mt.media_id IN (${placeholders})
         GROUP BY t.id ORDER BY count DESC, t.name`,
      )
      .all(...(ids as any[]));
    res.json(rows);
  }),
);

const tagsBatchSchema = z.object({
  ids: z.array(z.number().int()).min(1).max(5000),
  add: z.array(z.string().min(1)).default([]),
  remove: z.array(z.string().min(1)).default([]),
  category: z.enum(TAG_CATEGORIES).default('user'),
});

mediaRouter.post(
  '/api/media/tags-batch',
  wrap(async (req, res) => {
    const body = tagsBatchSchema.parse(req.body);
    const addNames = body.add.map((raw) => raw.trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean);
    const removeNames = body.remove.map((raw) => raw.trim().toLowerCase()).filter(Boolean);
    if (!addNames.length && !removeNames.length) {
      return res.status(400).json({ error: 'Nothing to add or remove' });
    }

    // Resolve every tag id once up front rather than per media row.
    const addTagIds = addNames.map((name) => upsertTag(name, body.category));
    const removeTagIds = removeNames
      .map((name) => db.select().from(schema.tags).where(eq(schema.tags.name, name)).get()?.id)
      .filter((id): id is number => id !== undefined);

    // Resolve every media row once too, rather than re-querying inside the loop.
    const rows = mediaRowsByIds(body.ids);
    const failed: BulkFailure[] = [];
    let updated = 0;
    const apply = sqlite.transaction(() => {
      for (const id of body.ids) {
        if (!rows.has(id)) {
          failed.push({ id, error: 'Not found' });
          continue;
        }
        for (const tagId of addTagIds) {
          db.insert(schema.mediaTags)
            .values({ mediaId: id, tagId, confidence: null, source: 'user' })
            .onConflictDoNothing()
            .run();
        }
        for (const tagId of removeTagIds) {
          db.delete(schema.mediaTags)
            .where(and(eq(schema.mediaTags.mediaId, id), eq(schema.mediaTags.tagId, tagId)))
            .run();
        }
        updated++;
      }
    });
    apply();
    refreshUsageCounts([...addTagIds, ...removeTagIds]);

    const result: BulkResult = { ok: true, updated, failed };
    res.json(result);
  }),
);

const likeBatchSchema = z.object({
  ids: z.array(z.number().int()).min(1).max(5000),
  liked: z.boolean(),
});

mediaRouter.post(
  '/api/media/like-batch',
  wrap(async (req, res) => {
    const { ids, liked } = likeBatchSchema.parse(req.body);
    const rows = mediaRowsByIds(ids);
    const failed: BulkFailure[] = ids.filter((id) => !rows.has(id)).map((id) => ({ id, error: 'Not found' }));
    const found = ids.filter((id) => rows.has(id));

    // One timestamp for the whole batch rather than one per row: these were liked by a single
    // action, and a shared value keeps "liked at" ordering stable within the selection.
    const likedAt = liked ? Date.now() : null;
    const apply = sqlite.transaction(() => {
      for (const part of chunkIds(found)) {
        db.update(schema.media)
          .set({ liked: liked ? 1 : 0, likedAt })
          .where(inArray(schema.media.id, part))
          .run();
      }
    });
    apply();
    const body: BulkResult = { ok: true, updated: found.length, failed };
    res.json(body);
  }),
);

const renameBatchSchema = z.object({
  items: z
    .array(z.object({ id: z.number().int(), filename: z.string().min(1) }))
    .min(1)
    .max(5000),
});

mediaRouter.post(
  '/api/media/rename-batch',
  wrap(async (req, res) => {
    const { items } = renameBatchSchema.parse(req.body);
    const failed: BulkFailure[] = [];

    // Phase 1: resolve every target path and reject anything unsafe, missing, or colliding —
    // including two items in this same batch aiming at one path.
    const planned: { id: number; from: string; to: string; filename: string }[] = [];
    const claimed = new Set<string>();
    const rows = mediaRowsByIds(items.map((item) => item.id));
    for (const item of items) {
      const row = rows.get(item.id);
      if (!row) {
        failed.push({ id: item.id, error: 'Not found' });
        continue;
      }
      const safeName = path.basename(item.filename.trim());
      if (!safeName || safeName === '.' || safeName === '..') {
        failed.push({ id: item.id, error: 'Invalid filename' });
        continue;
      }
      if (safeName === row.filename) continue; // no-op, not a failure
      if (!fs.existsSync(row.path)) {
        failed.push({ id: item.id, error: 'Source file missing' });
        continue;
      }
      const newPath = path.join(path.dirname(row.path), safeName);
      if (claimed.has(newPath)) {
        failed.push({ id: item.id, error: 'Two files would end up with the same name' });
        continue;
      }
      // A swap (a→b while b→a) also lands here: refusing is safer than a rename dance.
      if (fs.existsSync(newPath)) {
        failed.push({ id: item.id, error: 'A file with that name already exists' });
        continue;
      }
      claimed.add(newPath);
      planned.push({ id: item.id, from: row.path, to: newPath, filename: safeName });
    }

    // Phase 2: move on disk first; only rows whose file actually moved get their path updated.
    const renamed: typeof planned = [];
    for (const move of planned) {
      try {
        fs.renameSync(move.from, move.to);
        renamed.push(move);
      } catch (err) {
        failed.push({ id: move.id, error: err instanceof Error ? err.message : 'Rename failed' });
      }
    }
    const commit = sqlite.transaction(() => {
      for (const move of renamed) {
        db.update(schema.media)
          .set({ path: move.to, filename: move.filename })
          .where(eq(schema.media.id, move.id))
          .run();
      }
    });
    commit();

    const body: BulkResult = { ok: true, updated: renamed.length, failed };
    res.json(body);
  }),
);

mediaRouter.post(
  '/api/media/retag-batch',
  wrap(async (req, res) => {
    const { ids } = idsBody.parse(req.body);
    if (!modelReady()) return res.status(409).json({ error: 'Tagger model not downloaded' });
    const rows = mediaRowsByIds(ids);
    const existing = ids.filter((id) => rows.has(id));
    if (!existing.length) return res.status(404).json({ error: 'Not found' });
    const job = enqueueTagJob(existing, `AI tag: ${existing.length} selected`);
    res.json({ job });
  }),
);

mediaRouter.post(
  '/api/media/thumbnails-batch',
  wrap(async (req, res) => {
    const { ids } = idsBody.parse(req.body);
    const job = enqueueThumbnailRegenerate(ids);
    res.json({ job });
  }),
);

function getDetail(id: number): MediaDetail | null {
  const row = sqlite
    .query(
      `SELECT m.*, l.name AS library_name,
              (SELECT COUNT(*) FROM media_tags mt WHERE mt.media_id = m.id) AS tag_count
       FROM media m LEFT JOIN libraries l ON l.id = m.library_id WHERE m.id = ?`,
    )
    .get(id) as any;
  if (!row) return null;
  const tagRows = sqlite
    .query(
      `SELECT t.name, t.category, mt.confidence, mt.source
       FROM media_tags mt JOIN tags t ON t.id = mt.tag_id
       WHERE mt.media_id = ?
       ORDER BY CASE t.category WHEN 'rating' THEN 0 WHEN 'character' THEN 1 ELSE 2 END, mt.confidence DESC, t.name`,
    )
    .all(id) as any[];
  const boardRows = sqlite
    .query(
      `SELECT b.id, b.name, b.created_at AS createdAt
       FROM board_media bm JOIN boards b ON b.id = bm.board_id
       WHERE bm.media_id = ? ORDER BY b.name`,
    )
    .all(id) as any[];
  return { ...rowToMedia(row), tags: tagRows, boards: boardRows };
}

mediaRouter.get(
  '/api/media/:id',
  wrap(async (req, res) => {
    const detail = getDetail(intParam(req.params.id));
    if (!detail) return res.status(404).json({ error: 'Not found' });
    res.json(detail);
  }),
);

mediaRouter.get(
  '/api/media/:id/file',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row || !fs.existsSync(row.path)) return res.status(404).json({ error: 'Not found' });
    const servePath = row.type === 'video' ? playablePathFor(row.id, row.path) : row.path;
    // res.sendFile handles Range requests, ETag and conditional GETs.
    res.sendFile(servePath, { acceptRanges: true, cacheControl: true, maxAge: '1h' });
  }),
);

const renameSchema = z.object({ filename: z.string().min(1) });

mediaRouter.patch(
  '/api/media/:id/rename',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    const { filename } = renameSchema.parse(req.body);
    const safeName = path.basename(filename.trim());
    if (!safeName || safeName === '.' || safeName === '..') {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    if (safeName === row.filename) return res.json(getDetail(id));
    const newPath = path.join(path.dirname(row.path), safeName);
    if (fs.existsSync(newPath)) return res.status(409).json({ error: 'A file with that name already exists' });
    if (!fs.existsSync(row.path)) return res.status(404).json({ error: 'Source file missing' });
    fs.renameSync(row.path, newPath);
    db.update(schema.media).set({ path: newPath, filename: safeName }).where(eq(schema.media.id, id)).run();
    res.json(getDetail(id));
  }),
);

mediaRouter.delete(
  '/api/media/:id',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    db.delete(schema.mediaTags).where(eq(schema.mediaTags.mediaId, id)).run();
    db.delete(schema.media).where(eq(schema.media.id, id)).run();
    fs.unlink(row.path, () => {});
    fs.unlink(thumbPathFor(id), () => {});
    fs.unlink(transcodePathFor(id), () => {});
    res.json({ ok: true });
  }),
);

mediaRouter.post(
  '/api/media/:id/reveal',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row || !fs.existsSync(row.path)) return res.status(404).json({ error: 'Not found' });
    const proc =
      process.platform === 'win32'
        ? spawn('explorer.exe', [`/select,${row.path}`], { detached: true, stdio: 'ignore' })
        : process.platform === 'darwin'
          ? spawn('open', ['-R', row.path], { detached: true, stdio: 'ignore' })
          : spawn('xdg-open', [path.dirname(row.path)], { detached: true, stdio: 'ignore' });
    proc.on('error', () => {});
    proc.unref();
    res.json({ ok: true });
  }),
);

mediaRouter.get(
  '/api/media/:id/thumbnail',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    // When the thumbnail cache is disabled, serve the original image directly.
    // Videos always need a generated frame (a raw video is not a usable thumbnail).
    if (!thumbnailCacheEnabled() && row.type === 'image') {
      if (!fs.existsSync(row.path)) return res.status(404).json({ error: 'Source missing' });
      return res.sendFile(row.path, { cacheControl: true, maxAge: '1h' });
    }
    const thumb = thumbPathFor(id);
    if (!fs.existsSync(thumb)) {
      if (!fs.existsSync(row.path)) return res.status(404).json({ error: 'Source missing' });
      await generateThumbnail(row.path, id, row.type, row.durationSeconds);
      db.update(schema.media).set({ thumbnailPath: thumb }).where(eq(schema.media.id, id)).run();
    }
    res.sendFile(thumb, { cacheControl: true, maxAge: '7d', immutable: false });
  }),
);

mediaRouter.post(
  '/api/media/:id/thumbnail/regenerate',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!fs.existsSync(row.path)) return res.status(404).json({ error: 'Source missing' });
    const thumb = await generateThumbnail(row.path, id, row.type, row.durationSeconds);
    db.update(schema.media).set({ thumbnailPath: thumb }).where(eq(schema.media.id, id)).run();
    res.json({ ok: true });
  }),
);

const tagsPatchSchema = z.object({
  add: z.array(z.string().min(1)).default([]),
  remove: z.array(z.string().min(1)).default([]),
  category: z.enum(TAG_CATEGORIES).default('user'),
  // Change an existing tag's global category: { name -> category }.
  setCategory: z.record(z.enum(TAG_CATEGORIES)).optional(),
});

mediaRouter.patch(
  '/api/media/:id/tags',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    const body = tagsPatchSchema.parse(req.body);
    const touched: number[] = [];
    for (const raw of body.add) {
      const name = raw.trim().toLowerCase().replace(/\s+/g, '_');
      if (!name) continue;
      const tagId = upsertTag(name, body.category);
      db.insert(schema.mediaTags)
        .values({ mediaId: id, tagId, confidence: null, source: 'user' })
        .onConflictDoNothing()
        .run();
      touched.push(tagId);
    }
    for (const raw of body.remove) {
      const name = raw.trim().toLowerCase();
      const tag = db.select().from(schema.tags).where(eq(schema.tags.name, name)).get();
      if (!tag) continue;
      db.delete(schema.mediaTags)
        .where(and(eq(schema.mediaTags.mediaId, id), eq(schema.mediaTags.tagId, tag.id)))
        .run();
      touched.push(tag.id);
    }
    if (body.setCategory) {
      for (const [rawName, category] of Object.entries(body.setCategory)) {
        const name = rawName.trim().toLowerCase();
        db.update(schema.tags).set({ category }).where(eq(schema.tags.name, name)).run();
      }
    }
    refreshUsageCounts(touched);
    res.json(getDetail(id));
  }),
);

const likeSchema = z.object({ liked: z.boolean() });

mediaRouter.patch(
  '/api/media/:id/like',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    const { liked } = likeSchema.parse(req.body);
    db.update(schema.media)
      .set({ liked: liked ? 1 : 0, likedAt: liked ? Date.now() : null })
      .where(eq(schema.media.id, id))
      .run();
    res.json(getDetail(id));
  }),
);

mediaRouter.get(
  '/api/media/:id/similar',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });

    // Exact duplicates: same cheap content hash (size + first 4 MB).
    const duplicates = row.contentHash
      ? (sqlite
          .query(
            `SELECT m.*, l.name AS library_name,
                    (SELECT COUNT(*) FROM media_tags mt WHERE mt.media_id = m.id) AS tag_count
             FROM media m LEFT JOIN libraries l ON l.id = m.library_id
             WHERE m.content_hash = ? AND m.id != ? LIMIT 24`,
          )
          .all(row.contentHash, id) as any[]).map(rowToMedia)
      : [];

    // Visual similarity: perceptual-hash hamming distance (images only).
    const dupIds = new Set(duplicates.map((d) => d.id));
    const similar: SimilarResponse['similar'] = [];
    if (row.perceptualHash) {
      const candidates = sqlite
        .query(
          `SELECT m.*, l.name AS library_name,
                  (SELECT COUNT(*) FROM media_tags mt WHERE mt.media_id = m.id) AS tag_count
           FROM media m LEFT JOIN libraries l ON l.id = m.library_id
           WHERE m.type = 'image' AND m.perceptual_hash IS NOT NULL AND m.id != ?`,
        )
        .all(id) as any[];
      const scored: { media: any; dist: number }[] = [];
      for (const cand of candidates) {
        if (dupIds.has(cand.id)) continue;
        const dist = hammingDistance(row.perceptualHash, cand.perceptual_hash);
        if (dist <= 10) scored.push({ media: cand, dist });
      }
      scored.sort((a, b) => a.dist - b.dist);
      for (const s of scored.slice(0, 12)) similar.push(rowToMedia(s.media));
    }

    const body: SimilarResponse = { duplicates, similar };
    res.json(body);
  }),
);

mediaRouter.post(
  '/api/media/:id/retag',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!modelReady()) return res.status(409).json({ error: 'Tagger model not downloaded' });
    const job = enqueueTagJob([id], `AI tag: ${row.filename}`, row.libraryId);
    res.json({ job });
  }),
);

const progressSchema = z.object({
  progress: z.number().min(0).max(1),
  view: z.boolean().optional(),
  watchedDelta: z.number().min(0).max(60).optional(),
  // Dwell is flushed on close/tab-hide, so a single delta can be much longer than a video tick.
  dwellDelta: z.number().min(0).max(3600).optional(),
});

mediaRouter.patch(
  '/api/media/:id/progress',
  wrap(async (req, res) => {
    const id = intParam(req.params.id);
    const body = progressSchema.parse(req.body);
    const updates: Record<string, unknown> = { viewProgress: body.progress, lastViewedAt: Date.now() };
    if (body.view) updates.viewCount = sql`${schema.media.viewCount} + 1`;
    if (body.watchedDelta) updates.watchedSeconds = sql`${schema.media.watchedSeconds} + ${body.watchedDelta}`;
    if (body.dwellDelta) updates.dwellSeconds = sql`${schema.media.dwellSeconds} + ${body.dwellDelta}`;
    db.update(schema.media).set(updates).where(eq(schema.media.id, id)).run();
    res.json({ ok: true });
  }),
);
