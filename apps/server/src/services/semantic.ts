import fs from 'node:fs';
import type { SQLQueryBindings } from 'bun:sqlite';
import type { SemanticSearchInfo, SemanticStatus } from '@sakuya/shared';
import { sqlite } from '../db';
import { CLIP_MODEL_ID } from '../lib/config';
import { semanticSearchEnabled } from '../lib/settings';
import { float16Table, packFloat16, unpackFloat16 } from '../lib/vectors';
import { thumbPathFor } from './thumbnailer';
import { enqueueJob, eachWithProgress, type JobHandle } from './jobQueue';
import { clipEncoder, clipModelBytes, clipModelsDownloading, clipModelsReady } from './semanticModels';

// --- Embedding ------------------------------------------------------------------------------

const PENDING = `NOT EXISTS (SELECT 1 FROM media_embeddings e WHERE e.media_id = m.id AND e.model = ?)`;

export function unembeddedMediaIds(libraryId?: number): number[] {
  const rows = sqlite
    .query(
      `SELECT id FROM media m WHERE ${PENDING} ${libraryId === undefined ? '' : 'AND m.library_id = ?'} ORDER BY id`,
    )
    .all(CLIP_MODEL_ID, ...(libraryId === undefined ? [] : [libraryId])) as { id: number }[];
  return rows.map((r) => r.id);
}

function count(sql: string, ...params: SQLQueryBindings[]): number {
  return (sqlite.query(sql).get(...params) as { c: number }).c;
}

const embeddedCount = () => count('SELECT COUNT(*) AS c FROM media_embeddings WHERE model = ?', CLIP_MODEL_ID);
const pendingCount = () => count(`SELECT COUNT(*) AS c FROM media m WHERE ${PENDING}`, CLIP_MODEL_ID);

export function semanticStatus(): SemanticStatus {
  const downloading = clipModelsDownloading();
  const ready = !downloading && clipModelsReady();
  return {
    status: downloading ? 'downloading' : ready ? 'ready' : 'absent',
    enabled: semanticSearchEnabled(),
    modelSizeBytes: ready ? clipModelBytes() : null,
    embeddedCount: embeddedCount(),
    pendingCount: pendingCount(),
  };
}

export function saveEmbedding(mediaId: number, embedding: Float32Array): void {
  sqlite
    .query(
      `INSERT INTO media_embeddings (media_id, model, embedding, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (media_id) DO UPDATE SET model = excluded.model, embedding = excluded.embedding,
         created_at = excluded.created_at`,
    )
    .run(mediaId, CLIP_MODEL_ID, packFloat16(embedding), Date.now());
}

async function embedOne(mediaId: number): Promise<void> {
  const row = sqlite.query('SELECT id, path, type FROM media WHERE id = ?').get(mediaId) as {
    id: number;
    path: string;
    type: string;
  } | null;
  if (!row) return;
  const thumb = thumbPathFor(row.id);
  const image = row.type === 'video' ? thumb : row.path;
  if (!fs.existsSync(image)) throw new Error(`no image to embed for media ${mediaId}`);
  let vec: Float32Array;
  try {
    vec = await clipEncoder().image(image);
  } catch (err) {
    // An original sharp can't decode; the generated webp thumbnail always decodes.
    if (image === thumb || !fs.existsSync(thumb)) throw err;
    vec = await clipEncoder().image(thumb);
  }
  // The media may have been deleted while the model ran; the FK would reject the row.
  if (sqlite.query('SELECT 1 FROM media WHERE id = ?').get(mediaId)) saveEmbedding(mediaId, vec);
}

export function enqueueEmbeddingJob(mediaIds: number[], label: string, libraryId: number | null = null) {
  return enqueueJob('embeddings', label, (job) => runEmbeddingJob(job, mediaIds), libraryId);
}

export async function runEmbeddingJob(job: JobHandle, mediaIds: number[]): Promise<string> {
  if (!clipModelsReady()) {
    throw new Error('The search model is not downloaded. Download it in Settings > AI Tagging first.');
  }
  job.update({ total: mediaIds.length, log: `Indexing ${mediaIds.length} files for search by description…` });
  const errors = await eachWithProgress(
    job,
    mediaIds,
    (done, total) => `Indexed ${done}/${total} files…`,
    (id) => `embedding failed for media ${id}:`,
    embedOne,
    1,
  );
  return `Completed. ${mediaIds.length - errors} files indexed${errors ? `, ${errors} errors` : ''}.`;
}

// --- The in-memory index --------------------------------------------------------------------

interface VectorIndex {
  key: string;
  ids: Int32Array;
  /** Row-major float16 bits, `dims` per id. Kept half size: decoding costs less than the RAM. */
  halves: Uint16Array;
  dims: number;
}

let index: VectorIndex | null = null;
let indexTimer: ReturnType<typeof setTimeout> | null = null;
/** Searches come in bursts while someone types; the index is dropped between them like a model. */
const INDEX_IDLE_MS = 5 * 60_000;

/** Changes whenever a row is added, replaced or deleted (a cascade from media included). */
function indexKey(): string {
  const r = sqlite
    .query('SELECT COUNT(*) AS c, MAX(media_id) AS maxId, MAX(created_at) AS at FROM media_embeddings WHERE model = ?')
    .get(CLIP_MODEL_ID) as { c: number; maxId: number | null; at: number | null };
  return `${r.c}:${r.maxId}:${r.at}`;
}

export function loadIndex(): VectorIndex {
  const key = indexKey();
  if (!index || index.key !== key) {
    const rows = sqlite
      .query('SELECT media_id AS id, embedding FROM media_embeddings WHERE model = ? ORDER BY media_id')
      .all(CLIP_MODEL_ID) as { id: number; embedding: Uint8Array }[];
    const dims = rows.length ? rows[0].embedding.byteLength / 2 : 0;
    const ids = new Int32Array(rows.length);
    const halves = new Uint16Array(rows.length * dims);
    rows.forEach((r, i) => {
      ids[i] = r.id;
      // Byte copy: a blob's offset in its buffer need not be 2-aligned. Little-endian, like packFloat16.
      new Uint8Array(halves.buffer, i * dims * 2, dims * 2).set(r.embedding.subarray(0, dims * 2));
    });
    index = { key, ids, halves, dims };
  }
  if (indexTimer) clearTimeout(indexTimer);
  indexTimer = setTimeout(() => (index = null), INDEX_IDLE_MS);
  indexTimer.unref();
  return index;
}

export function dropIndex(): void {
  index = null;
}

export interface Scored {
  id: number;
  score: number;
}

/** Cosines of the embedded media (or those in `allowed`) to a query, in index order. */
export interface Scores {
  ids: Int32Array;
  scores: Float64Array;
}

export function scoreAll(query: Float32Array, allowed: Set<number> | null = null): Scores {
  const { ids, halves, dims } = loadIndex();
  if (dims && query.length !== dims) throw new Error(`query has ${query.length} dims, index ${dims}`);
  const table = float16Table();
  const outIds = new Int32Array(allowed ? Math.min(allowed.size, ids.length) : ids.length);
  const scores = new Float64Array(outIds.length);
  let n = 0;
  for (let i = 0; i < ids.length; i++) {
    if (allowed && !allowed.has(ids[i])) continue;
    const base = i * dims;
    // Four accumulators: about a third faster than one on 30k x 512 (measured).
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    let d = 0;
    for (; d + 3 < dims; d += 4) {
      s0 += table[halves[base + d]] * query[d];
      s1 += table[halves[base + d + 1]] * query[d + 1];
      s2 += table[halves[base + d + 2]] * query[d + 2];
      s3 += table[halves[base + d + 3]] * query[d + 3];
    }
    for (; d < dims; d++) s0 += table[halves[base + d]] * query[d];
    outIds[n] = ids[i];
    scores[n++] = s0 + s1 + s2 + s3;
  }
  return { ids: outIds.subarray(0, n), scores: scores.subarray(0, n) };
}

/** Best first, ties by newer id: the order every describe page and cursor follows. */
const before = (sa: number, ia: number, sb: number, ib: number) => sa > sb || (sa === sb && ia > ib);

/**
 * The best `limit` of `ranking` that come after `after` in rank order, sorted. A bounded insertion
 * instead of sorting everything: a page of 60 out of 30k costs one pass.
 */
export function topAfter(ranking: Scores, limit: number, after?: Scored, skip?: Set<number>): Scored[] {
  const top: Scored[] = [];
  const { ids, scores } = ranking;
  for (let i = 0; i < ids.length; i++) {
    const score = scores[i];
    const id = ids[i];
    if (after && !before(after.score, after.id, score, id)) continue;
    if (skip?.has(id)) continue;
    if (top.length === limit) {
      const worst = top[limit - 1];
      if (!before(score, id, worst.score, worst.id)) continue;
      top.pop();
    }
    let at = top.length;
    while (at > 0 && before(score, id, top[at - 1].score, top[at - 1].id)) at--;
    top.splice(at, 0, { id, score });
  }
  return top;
}

/** All of `ranking`, best first. */
export function sortScores({ ids, scores }: Scores): Scored[] {
  return Array.from(ids, (id, i) => ({ id, score: scores[i] })).sort((a, b) => b.score - a.score || b.id - a.id);
}

/** Every embedded media item (or only those in `allowed`) by cosine to `query`, best first. */
export function rankByVector(query: Float32Array, allowed: Set<number> | null = null): Scored[] {
  return sortScores(scoreAll(query, allowed));
}

/** The stored embedding of one media item, decoded, or null. */
export function mediaEmbedding(mediaId: number): Float32Array | null {
  const row = sqlite
    .query('SELECT embedding FROM media_embeddings WHERE media_id = ? AND model = ?')
    .get(mediaId, CLIP_MODEL_ID) as { embedding: Uint8Array } | null;
  return row ? unpackFloat16(row.embedding) : null;
}

// --- Text queries ---------------------------------------------------------------------------

const textCache = new Map<string, Float32Array>();
const TEXT_CACHE_SIZE = 64;

/** Infinite scroll asks for the same description page after page; encode it once. */
export async function embedDescription(text: string): Promise<Float32Array> {
  const key = text.trim().toLowerCase();
  const hit = textCache.get(key);
  if (hit) {
    textCache.delete(key);
    textCache.set(key, hit);
    return hit;
  }
  const vec = await clipEncoder().text(key);
  textCache.set(key, vec);
  if (textCache.size > TEXT_CACHE_SIZE) textCache.delete(textCache.keys().next().value!);
  return vec;
}

export function clearDescriptionCache(): void {
  textCache.clear();
  rankingCache.clear();
}

export interface DescribeResult {
  /** Only computed for a first page; later pages of the same search reuse the first's. */
  info?: SemanticSearchInfo;
  ranking: Scores;
}

const EMPTY: Scores = { ids: new Int32Array(0), scores: new Float64Array(0) };
const rankingCache = new Map<string, Scores>();
const RANKING_CACHE_SIZE = 4;

/**
 * Score media matching `where` (the grid's other filters, as SQL over `media m`) by how well they
 * fit `text`. Nothing is scored when the feature is off, the model is missing or nothing is
 * embedded yet; `info` says which, so the page can offer the fix. Infinite scroll reads the same
 * search page after page, so its scores are kept until the index changes.
 */
export async function describeSearch(
  text: string,
  where: { conds: string[]; params: SQLQueryBindings[] },
  firstPage = true,
): Promise<DescribeResult> {
  const info = (status: SemanticSearchInfo['status']) =>
    firstPage ? { status, embeddedCount: embeddedCount(), pendingCount: pendingCount() } : undefined;
  if (!semanticSearchEnabled()) return { info: info('disabled'), ranking: EMPTY };
  if (!clipModelsReady()) return { info: info('no-model'), ranking: EMPTY };
  const { key: indexVersion, ids } = loadIndex();
  if (!ids.length) return { info: info('empty'), ranking: EMPTY };

  const key = JSON.stringify([text.trim().toLowerCase(), where.conds, where.params, indexVersion]);
  let ranking = rankingCache.get(key);
  if (ranking) {
    rankingCache.delete(key);
  } else {
    const allowed = where.conds.length
      ? new Set(
          (
            sqlite.query(`SELECT m.id FROM media m WHERE ${where.conds.join(' AND ')}`).all(...where.params) as {
              id: number;
            }[]
          ).map((r) => r.id),
        )
      : null;
    ranking = scoreAll(await embedDescription(text), allowed);
  }
  rankingCache.set(key, ranking);
  if (rankingCache.size > RANKING_CACHE_SIZE) rankingCache.delete(rankingCache.keys().next().value!);
  return { info: info('ready'), ranking };
}
