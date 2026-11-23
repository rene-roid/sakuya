import { linkTag, recomputeImplied } from './tagRelations';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { sqlite } from '../db';
import { CHARACTER_CROPS_DIR } from '../lib/config';
import { normalize, packFloat16, unpackFloat16 } from '../lib/vectors';
import { clusterIncrementally, type ClusterParams } from '../lib/characterClusters';
import { MEDIA_SELECT, rowToMedia, type MediaSqlRow } from '../lib/rowToMedia';
import { normalizeTagName } from '@sakuya/shared';
import type {
  CharacterAssignment,
  CharacterDetection,
  CharacterDetectionsResponse,
  CharacterMediaResponse,
  CharacterModelStatus,
  CharactersResponse,
  CharacterSuggestion,
  CharacterSummary,
  TagCount,
} from '@sakuya/shared';
import { characterDetectionEnabled } from '../lib/settings';
import { thumbPathFor } from './thumbnailer';
import { refreshUsageCounts, upsertTag } from './tagger';
import { enqueueJob, eachWithProgress, type JobHandle } from './jobQueue';
import {
  characterModelBytes,
  characterModelsDownloading,
  characterModelsReady,
  detectCharacters,
  loadCcipParams,
  type CcipParams,
  type DetectedCharacter,
} from './characterModels';

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

/** Cluster this often during a job, so characters appear while a long run is still going. */
const CLUSTER_EVERY = 25;
/** A suggestion needs this many solo images agreeing, and at least half of the cluster's solo images. */
const SUGGEST_MIN_MEDIA = 2;
const SUGGEST_MIN_SHARE = 0.5;

/**
 * Measured on the Pepper&Carrot fixtures (shots/ML02 in the roadmap tools): the published DBSCAN eps
 * 0.129 chained Carrot into other cats, houses and birds and lumped the mentors with Shichimi;
 * eps 0.10 with a 0.13 mean check kept Pepper, Saffron and Coriander clean, leaving 14% of
 * detections unassigned. Over-splitting costs one merge to fix, a mixed cluster a reject per face.
 */
const EPS = 0.1;
const MERGE_LIMIT = 0.13;

export function clusterParams(p: CcipParams): ClusterParams {
  return {
    eps: EPS,
    assignThreshold: EPS,
    mergeLimit: MERGE_LIMIT,
    minSamples: p.minSamples,
    diff: (cosine) => Math.min(1, Math.max(0, p.diffA - p.diffB * cosine)),
  };
}

// --- Scanning -------------------------------------------------------------------------------

export function unscannedMediaIds(libraryId?: number): number[] {
  const rows = sqlite
    .query(
      `SELECT id FROM media m WHERE NOT EXISTS (SELECT 1 FROM character_scans s WHERE s.media_id = m.id)
       ${libraryId === undefined ? '' : 'AND m.library_id = ?'} ORDER BY id`,
    )
    .all(...(libraryId === undefined ? [] : [libraryId])) as { id: number }[];
  return rows.map((r) => r.id);
}

function unscannedCount(): number {
  return (
    sqlite
      .query(
        `SELECT COUNT(*) AS c FROM media m WHERE NOT EXISTS (SELECT 1 FROM character_scans s WHERE s.media_id = m.id)`,
      )
      .get() as { c: number }
  ).c;
}

export function characterStatus(): CharacterModelStatus {
  const downloading = characterModelsDownloading();
  const ready = !downloading && characterModelsReady();
  const count = (sql: string) => (sqlite.query(sql).get() as { c: number }).c;
  return {
    status: downloading ? 'downloading' : ready ? 'ready' : 'absent',
    enabled: characterDetectionEnabled(),
    modelSizeBytes: ready ? characterModelBytes() : null,
    pendingCount: unscannedCount(),
    detectionCount: count('SELECT COUNT(*) AS c FROM character_detections'),
    characterCount: count('SELECT COUNT(*) AS c FROM characters'),
  };
}

/**
 * Store what the detector found on one media item and mark it scanned, in one transaction. A
 * media item already scanned keeps its detections, so a repeated run adds nothing.
 */
export function saveDetections(mediaId: number, found: DetectedCharacter[]): number[] {
  return sqlite.transaction(() => {
    if (sqlite.query('SELECT 1 FROM character_scans WHERE media_id = ?').get(mediaId)) return [];
    const now = Date.now();
    const insert = sqlite.prepare(
      `INSERT INTO character_detections (media_id, x, y, w, h, score, embedding, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    );
    const ids = found.map(
      (d) =>
        (
          insert.get(mediaId, d.bbox.x, d.bbox.y, d.bbox.w, d.bbox.h, d.score, packFloat16(d.embedding), now) as {
            id: number;
          }
        ).id,
    );
    sqlite
      .query('INSERT INTO character_scans (media_id, scanned_at, detections) VALUES (?, ?, ?)')
      .run(mediaId, now, ids.length);
    return ids;
  })();
}

function mediaSource(mediaId: number): { image: string; thumb: string } {
  const row = sqlite.query('SELECT id, path, type FROM media WHERE id = ?').get(mediaId) as {
    id: number;
    path: string;
    type: string;
  } | null;
  if (!row) throw new Error(`media ${mediaId} not found`);
  const thumb = thumbPathFor(row.id);
  // Videos are read from their extracted thumbnail frame.
  return { image: row.type === 'video' ? thumb : row.path, thumb };
}

async function scanOne(mediaId: number, params: CcipParams): Promise<number[]> {
  const { image, thumb } = mediaSource(mediaId);
  if (!fs.existsSync(image)) throw new Error(`no image to scan for media ${mediaId}`);
  let found: DetectedCharacter[];
  try {
    found = await detectCharacters(image, params);
  } catch (err) {
    // An original sharp can't decode; the generated webp thumbnail always decodes.
    if (image === thumb || !fs.existsSync(thumb)) throw err;
    found = await detectCharacters(thumb, params);
  }
  return saveDetections(mediaId, found);
}

// --- Clustering -----------------------------------------------------------------------------

/**
 * Place new detections: each joins the character one of its close neighbours belongs to, and
 * linked groups of unplaced detections become new unnamed characters. Named characters' tags are
 * linked to the media their new detections are on.
 */
export function clusterDetections(newIds: number[], params: ClusterParams): { assigned: number; created: number } {
  if (!newIds.length) return { assigned: 0, created: 0 };
  const rows = sqlite
    .query(`SELECT id, embedding, character_id FROM character_detections WHERE assignment != 'rejected'`)
    .all() as { id: number; embedding: Uint8Array; character_id: number | null }[];
  const nodes = rows.map((r) => ({
    id: r.id,
    vec: normalize(unpackFloat16(r.embedding)),
    characterId: r.character_id,
  }));
  const result = clusterIncrementally(nodes, new Set(newIds), params);

  const touched = new Set<number>();
  sqlite.transaction(() => {
    const assign = sqlite.prepare(
      `UPDATE character_detections SET character_id = ?, assignment = 'auto' WHERE id = ? AND character_id IS NULL`,
    );
    for (const [detectionId, characterId] of result.assigned) {
      assign.run(characterId, detectionId);
      touched.add(characterId);
    }
    const create = sqlite.prepare('INSERT INTO characters (created_at) VALUES (?) RETURNING id');
    for (const group of result.created) {
      const { id } = create.get(Date.now()) as { id: number };
      for (const detectionId of group) assign.run(id, detectionId);
    }
  })();
  syncCharacterLinks([...touched]);
  return { assigned: result.assigned.size, created: result.created.length };
}

/** Unnamed characters left with no detections (their media were deleted) are dropped. */
function pruneEmptyCharacters(): void {
  sqlite.exec(
    `DELETE FROM characters WHERE tag_id IS NULL AND NOT EXISTS
       (SELECT 1 FROM character_detections d WHERE d.character_id = characters.id AND d.assignment != 'rejected')`,
  );
}

/**
 * Make a named character's tag sit on exactly the media its accepted detections are on, except
 * where the user took it off by hand. Links it writes carry source 'character', which retagging
 * leaves alone; an AI link for the same tag is taken over, so a retag that stops predicting it
 * can't remove it.
 */
function syncCharacterLinks(characterIds: number[]): void {
  const tags: number[] = [];
  const touchedMedia = new Set<number>();
  sqlite.transaction(() => {
    for (const id of characterIds) {
      const row = sqlite.query('SELECT tag_id FROM characters WHERE id = ?').get(id) as {
        tag_id: number | null;
      } | null;
      if (!row?.tag_id) continue;
      tags.push(row.tag_id);
      const members = `SELECT media_id FROM character_detections WHERE character_id = ? AND assignment != 'rejected'`;
      for (const r of sqlite
        .query(`SELECT media_id FROM media_tags WHERE tag_id = ? AND source = 'character'`)
        .all(row.tag_id) as { media_id: number }[])
        touchedMedia.add(r.media_id);
      for (const { media_id } of sqlite.query(members).all(id) as { media_id: number }[]) {
        touchedMedia.add(media_id);
        linkTag(media_id, row.tag_id, 'character');
      }
      sqlite
        .query(
          `DELETE FROM media_tags WHERE tag_id = ? AND source = 'character' AND media_id NOT IN
             (SELECT media_id FROM character_detections WHERE character_id = ? AND assignment != 'rejected')`,
        )
        .run(row.tag_id, id);
    }
  })();
  refreshUsageCounts([...tags, ...recomputeImplied(touchedMedia)]);
}

/** Drop the links a character wrote for a tag it no longer carries. */
function unlinkCharacterTag(tagId: number): void {
  const media = sqlite
    .query(`SELECT media_id FROM media_tags WHERE tag_id = ? AND source = 'character'`)
    .all(tagId) as { media_id: number }[];
  sqlite.query(`DELETE FROM media_tags WHERE tag_id = ? AND source = 'character'`).run(tagId);
  refreshUsageCounts([tagId, ...recomputeImplied(media.map((r) => r.media_id))]);
}

// --- The job --------------------------------------------------------------------------------

export function enqueueCharacterJob(mediaIds: number[], label: string, libraryId: number | null = null) {
  return enqueueJob('characters', label, (job) => runCharacterJob(job, mediaIds), libraryId);
}

export async function runCharacterJob(job: JobHandle, mediaIds: number[]): Promise<string> {
  if (!characterModelsReady()) {
    throw new Error('Character models are not downloaded. Download them in Settings > AI Tagging first.');
  }
  const params = await loadCcipParams();
  const cluster = clusterParams(params);
  job.update({ total: mediaIds.length, log: `Looking for characters in ${mediaIds.length} files…` });
  let pending: number[] = [];
  let found = 0;
  let empty = 0;
  const errors = await eachWithProgress(
    job,
    mediaIds,
    (done, total) => `Looked for characters in ${done}/${total} files…`,
    (id) => `character detection failed for media ${id}:`,
    async (id) => {
      const ids = await scanOne(id, params);
      found += ids.length;
      if (!ids.length) empty++;
      pending.push(...ids);
      if (pending.length >= CLUSTER_EVERY) {
        clusterDetections(pending, cluster);
        pending = [];
      }
    },
    1,
  );
  clusterDetections(pending, cluster);
  pruneEmptyCharacters();
  const scanned = mediaIds.length - errors;
  return `Completed. ${scanned} files scanned, ${found} characters found, ${empty} files with none${
    errors ? `, ${errors} errors` : ''
  }.`;
}

// --- Reading --------------------------------------------------------------------------------

const cropUrl = (detectionId: number) => `/api/characters/crops/${detectionId}`;

interface SummaryRow {
  id: number;
  tag_id: number | null;
  name: string | null;
  display_name: string | null;
  hidden: number;
  created_at: number;
  cover_detection_id: number | null;
  best_detection_id: number | null;
  detections: number;
  media: number;
}

const SUMMARY_SELECT = `
  SELECT c.id, c.tag_id, t.name, t.display_name, c.hidden, c.created_at, c.cover_detection_id,
         (SELECT d2.id FROM character_detections d2 WHERE d2.character_id = c.id AND d2.assignment != 'rejected'
          ORDER BY d2.score DESC, d2.id LIMIT 1) AS best_detection_id,
         COUNT(d.id) AS detections, COUNT(DISTINCT d.media_id) AS media
  FROM characters c
  LEFT JOIN tags t ON t.id = c.tag_id
  LEFT JOIN character_detections d ON d.character_id = c.id AND d.assignment != 'rejected'`;

function toSummary(row: SummaryRow, suggestion: CharacterSuggestion | null): CharacterSummary {
  const cover = row.cover_detection_id ?? row.best_detection_id;
  return {
    id: row.id,
    tagId: row.tag_id,
    name: row.tag_id ? row.name : null,
    displayName: row.tag_id ? row.display_name : null,
    hidden: row.hidden === 1,
    createdAt: row.created_at,
    mediaCount: row.media,
    detectionCount: row.detections,
    coverDetectionId: cover,
    coverUrl: cover === null ? null : cropUrl(cover),
    suggestion: row.tag_id ? null : suggestion,
  };
}

/**
 * For unnamed characters: the WD character tag most of the cluster's `solo` images carry. Only AI
 * links count, so a suggestion is the tagger's opinion rather than an echo of another character.
 */
export function characterSuggestions(characterIds?: number[]): Map<number, CharacterSuggestion> {
  const filter = characterIds ? `AND d.character_id IN (${characterIds.map(() => '?').join(',')})` : '';
  const rows = sqlite
    .query(
      `WITH cm AS (
         SELECT DISTINCT d.character_id, d.media_id FROM character_detections d
         JOIN characters c ON c.id = d.character_id AND c.tag_id IS NULL
         WHERE d.assignment != 'rejected' ${filter}
       ),
       solo AS (
         SELECT cm.character_id, cm.media_id FROM cm
         JOIN media_tags mt ON mt.media_id = cm.media_id
         JOIN tags st ON st.id = mt.tag_id AND st.name = 'solo'
       ),
       totals AS (SELECT character_id, COUNT(*) AS n FROM solo GROUP BY character_id)
       SELECT solo.character_id AS character_id, t.name AS tag, t.display_name AS display_name,
              COUNT(*) AS c, totals.n AS n
       FROM solo
       JOIN totals ON totals.character_id = solo.character_id
       JOIN characters ch ON ch.id = solo.character_id
       JOIN media_tags mt ON mt.media_id = solo.media_id AND mt.source = 'ai'
       JOIN tags t ON t.id = mt.tag_id AND t.category = 'character' AND t.name IS NOT ch.dismissed_suggestion
       GROUP BY solo.character_id, t.id
       ORDER BY c DESC, t.name`,
    )
    .all(...(characterIds ?? [])) as {
    character_id: number;
    tag: string;
    display_name: string | null;
    c: number;
    n: number;
  }[];
  const out = new Map<number, CharacterSuggestion>();
  for (const r of rows) {
    if (out.has(r.character_id)) continue;
    if (r.c >= SUGGEST_MIN_MEDIA && r.c / r.n >= SUGGEST_MIN_SHARE) {
      out.set(r.character_id, { tag: r.tag, displayName: r.display_name, mediaCount: r.c, soloCount: r.n });
    }
  }
  return out;
}

export function listCharacters(includeHidden = false): CharactersResponse {
  const rows = sqlite
    .query(`${SUMMARY_SELECT} ${includeHidden ? '' : 'WHERE c.hidden = 0'} GROUP BY c.id ORDER BY media DESC, c.id`)
    .all() as SummaryRow[];
  const suggestions = characterSuggestions();
  const out: CharactersResponse = { named: [], suggested: [], unnamed: [], unassignedCount: 0, tagOnly: [] };
  for (const row of rows) {
    const summary = toSummary(row, suggestions.get(row.id) ?? null);
    if (summary.name !== null) out.named.push(summary);
    else if (summary.detectionCount === 0) continue;
    else if (summary.suggestion) out.suggested.push(summary);
    else out.unnamed.push(summary);
  }
  out.unassignedCount = (
    sqlite.query('SELECT COUNT(*) AS c FROM character_detections WHERE character_id IS NULL').get() as { c: number }
  ).c;
  out.tagOnly = sqlite
    .query(
      `SELECT t.name, t.category, t.display_name AS displayName, t.usage_count AS count FROM tags t
       WHERE t.category = 'character' AND t.usage_count > 0
         AND NOT EXISTS (SELECT 1 FROM characters c WHERE c.tag_id = t.id)
       ORDER BY t.usage_count DESC, t.name`,
    )
    .all() as TagCount[];
  return out;
}

export function getCharacter(id: number): CharacterSummary {
  const row = sqlite.query(`${SUMMARY_SELECT} WHERE c.id = ? GROUP BY c.id`).get(id) as SummaryRow | null;
  if (!row) throw httpError(404, 'Character not found');
  return toSummary(row, characterSuggestions([id]).get(id) ?? null);
}

interface DetectionRow {
  id: number;
  media_id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  character_id: number | null;
  assignment: CharacterAssignment;
  name: string | null;
  display_name: string | null;
}

const DETECTION_SELECT = `
  SELECT d.id, d.media_id, d.x, d.y, d.w, d.h, d.score, d.character_id, d.assignment, t.name, t.display_name
  FROM character_detections d
  LEFT JOIN characters c ON c.id = d.character_id
  LEFT JOIN tags t ON t.id = c.tag_id`;

function toDetection(r: DetectionRow): CharacterDetection {
  return {
    id: r.id,
    mediaId: r.media_id,
    bbox: { x: r.x, y: r.y, w: r.w, h: r.h },
    score: r.score,
    characterId: r.character_id,
    characterName: r.assignment === 'rejected' ? null : r.name,
    characterDisplayName: r.assignment === 'rejected' ? null : r.display_name,
    assignment: r.assignment,
    cropUrl: cropUrl(r.id),
  };
}

export function mediaDetections(mediaId: number): CharacterDetection[] {
  const rows = sqlite
    .query(`${DETECTION_SELECT} WHERE d.media_id = ? ORDER BY d.x, d.id`)
    .all(mediaId) as DetectionRow[];
  return rows.map(toDetection);
}

export function characterMedia(id: number, offset: number, limit: number): CharacterMediaResponse {
  const character = getCharacter(id);
  const members = `m.id IN (SELECT media_id FROM character_detections WHERE character_id = ? AND assignment != 'rejected')`;
  const total = (sqlite.query(`SELECT COUNT(*) AS c FROM media m WHERE ${members}`).get(id) as { c: number }).c;
  const rows = sqlite
    .query(`${MEDIA_SELECT} WHERE ${members} ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`)
    .all(id, limit, offset) as MediaSqlRow[];
  const items = rows.map(rowToMedia);
  const ids = items.map((m) => m.id);
  const detections = ids.length
    ? (
        sqlite
          .query(
            `${DETECTION_SELECT} WHERE d.character_id = ? AND d.media_id IN (${ids.map(() => '?').join(',')})
             ORDER BY d.media_id, d.x`,
          )
          .all(id, ...ids) as DetectionRow[]
      ).map(toDetection)
    : [];
  return {
    character,
    items,
    detections,
    total,
    nextOffset: offset + items.length < total ? offset + items.length : null,
  };
}

/** Every face of one character, best first, for its page's grid. */
export function characterDetections(id: number, offset: number, limit: number): CharacterDetectionsResponse {
  characterRow(id);
  const where = `WHERE d.character_id = ? AND d.assignment != 'rejected'`;
  const total = (
    sqlite.query(`SELECT COUNT(*) AS c FROM character_detections d ${where}`).get(id) as { c: number }
  ).c;
  const items = (
    sqlite
      .query(`${DETECTION_SELECT} ${where} ORDER BY d.score DESC, d.id LIMIT ? OFFSET ?`)
      .all(id, limit, offset) as DetectionRow[]
  ).map(toDetection);
  return { items, total, nextOffset: offset + items.length < total ? offset + items.length : null };
}

// --- Editing --------------------------------------------------------------------------------

function characterRow(id: number) {
  const row = sqlite.query('SELECT id, tag_id, cover_detection_id FROM characters WHERE id = ?').get(id) as {
    id: number;
    tag_id: number | null;
    cover_detection_id: number | null;
  } | null;
  if (!row) throw httpError(404, 'Character not found');
  return row;
}

function detectionRow(id: number) {
  const row = sqlite.query('SELECT id, character_id, assignment FROM character_detections WHERE id = ?').get(id) as {
    id: number;
    character_id: number | null;
    assignment: CharacterAssignment;
  } | null;
  if (!row) throw httpError(404, 'Detection not found');
  return row;
}

/**
 * Name a character: its media gain a character-category tag. A tag of that name is reused, and a
 * user tag of that name becomes a character tag; a general or rating tag is refused rather than
 * recategorized (naming the cat "carrot" must not turn the vegetable into a character). Naming a
 * character after another character's tag merges the two.
 */
export function nameCharacter(id: number, rawName: string): CharacterSummary {
  const name = normalizeTagName(rawName);
  if (!name) throw httpError(400, 'Name is required');
  const character = characterRow(id);
  const existing = sqlite.query('SELECT id, category FROM tags WHERE name = ?').get(name) as {
    id: number;
    category: string;
  } | null;
  if (existing && existing.category !== 'character' && existing.category !== 'user') {
    throw httpError(
      409,
      `“${name}” is already a ${existing.category} tag. Pick another name, like ${name}_(character).`,
    );
  }
  const tagId = existing?.id ?? upsertTag(name, 'character');
  if (existing?.category === 'user') sqlite.query(`UPDATE tags SET category = 'character' WHERE id = ?`).run(tagId);
  const owner = sqlite.query('SELECT id FROM characters WHERE tag_id = ? AND id != ?').get(tagId, id) as {
    id: number;
  } | null;
  if (owner) return mergeCharacters(id, owner.id);
  if (character.tag_id !== tagId) {
    if (character.tag_id) unlinkCharacterTag(character.tag_id);
    sqlite.query('UPDATE characters SET tag_id = ? WHERE id = ?').run(tagId, id);
  }
  syncCharacterLinks([id]);
  return getCharacter(id);
}

export function acceptSuggestion(id: number): CharacterSummary {
  characterRow(id);
  const suggestion = characterSuggestions([id]).get(id);
  if (!suggestion) throw httpError(409, 'This character has no name suggestion');
  return nameCharacter(id, suggestion.tag);
}

/** Move every detection of `fromId` into `intoId` and delete `fromId`. Rejections stay rejected. */
export function mergeCharacters(fromId: number, intoId: number): CharacterSummary {
  if (fromId === intoId) throw httpError(400, 'Cannot merge a character into itself');
  const from = characterRow(fromId);
  const into = characterRow(intoId);
  sqlite.transaction(() => {
    sqlite.query('UPDATE character_detections SET character_id = ? WHERE character_id = ?').run(intoId, fromId);
    if (!into.cover_detection_id && from.cover_detection_id) {
      sqlite.query('UPDATE characters SET cover_detection_id = ? WHERE id = ?').run(from.cover_detection_id, intoId);
    }
    sqlite.query('DELETE FROM characters WHERE id = ?').run(fromId);
    if (from.tag_id && !into.tag_id) {
      sqlite.query('UPDATE characters SET tag_id = ? WHERE id = ?').run(from.tag_id, intoId);
    }
  })();
  if (from.tag_id && into.tag_id && from.tag_id !== into.tag_id) unlinkCharacterTag(from.tag_id);
  syncCharacterLinks([intoId]);
  return getCharacter(intoId);
}

/** "Not this character": the detection leaves its character for good, and a re-run won't put it back. */
export function rejectDetection(detectionId: number): CharacterDetection {
  const det = detectionRow(detectionId);
  if (det.character_id === null) throw httpError(409, 'Detection is not assigned to a character');
  sqlite.transaction(() => {
    sqlite.query(`UPDATE character_detections SET assignment = 'rejected' WHERE id = ?`).run(detectionId);
    sqlite
      .query('UPDATE characters SET cover_detection_id = NULL WHERE id = ? AND cover_detection_id = ?')
      .run(det.character_id, detectionId);
  })();
  syncCharacterLinks([det.character_id]);
  return mediaDetections(detectionMediaId(detectionId)).find((d) => d.id === detectionId)!;
}

/** Put a detection in a character by hand, as from the viewer's box overlay. */
export function assignDetection(detectionId: number, characterId: number): CharacterDetection {
  const det = detectionRow(detectionId);
  characterRow(characterId);
  sqlite
    .query(`UPDATE character_detections SET character_id = ?, assignment = 'user' WHERE id = ?`)
    .run(characterId, detectionId);
  syncCharacterLinks(
    det.character_id && det.character_id !== characterId ? [det.character_id, characterId] : [characterId],
  );
  return mediaDetections(detectionMediaId(detectionId)).find((d) => d.id === detectionId)!;
}

/**
 * Name one face, as from the viewer. A face in an unnamed cluster names the whole cluster, the
 * way naming a person works in Immich; any other face moves to the character with that name,
 * which is created for it when no character has the name yet.
 */
export function nameDetection(detectionId: number, rawName: string): CharacterDetection {
  const name = normalizeTagName(rawName);
  if (!name) throw httpError(400, 'Name is required');
  const det = detectionRow(detectionId);
  const current = det.character_id === null || det.assignment === 'rejected' ? null : characterRow(det.character_id);
  if (current && current.tag_id === null) {
    nameCharacter(current.id, name);
    return mediaDetections(detectionMediaId(detectionId)).find((d) => d.id === detectionId)!;
  }
  const owner = sqlite
    .query('SELECT c.id FROM characters c JOIN tags t ON t.id = c.tag_id WHERE t.name = ?')
    .get(name) as { id: number } | null;
  if (owner) return assignDetection(detectionId, owner.id);
  // One transaction, so a refused name (a general tag) leaves no empty character behind.
  return sqlite.transaction(() => {
    const { id } = sqlite.query('INSERT INTO characters (created_at) VALUES (?) RETURNING id').get(Date.now()) as {
      id: number;
    };
    assignDetection(detectionId, id);
    nameCharacter(id, name);
    return mediaDetections(detectionMediaId(detectionId)).find((d) => d.id === detectionId)!;
  })();
}

/** "Not X": the suggestion goes away and the character waits in Unnamed for a name. */
export function dismissSuggestion(id: number): CharacterSummary {
  characterRow(id);
  const suggestion = characterSuggestions([id]).get(id);
  if (!suggestion) throw httpError(409, 'This character has no name suggestion');
  sqlite.query('UPDATE characters SET dismissed_suggestion = ? WHERE id = ?').run(suggestion.tag, id);
  return getCharacter(id);
}

function detectionMediaId(detectionId: number): number {
  return (
    sqlite.query('SELECT media_id FROM character_detections WHERE id = ?').get(detectionId) as { media_id: number }
  ).media_id;
}

export function setCharacterHidden(id: number, hidden: boolean): CharacterSummary {
  characterRow(id);
  sqlite.query('UPDATE characters SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id);
  return getCharacter(id);
}

export function setCharacterCover(id: number, detectionId: number): CharacterSummary {
  characterRow(id);
  const det = detectionRow(detectionId);
  if (det.character_id !== id || det.assignment === 'rejected') {
    throw httpError(400, 'The cover must be one of this character’s detections');
  }
  sqlite.query('UPDATE characters SET cover_detection_id = ? WHERE id = ?').run(detectionId, id);
  return getCharacter(id);
}

// --- Crops ----------------------------------------------------------------------------------

const CROP_SIZE = 320;

/** Per media folder, so deleting a media item removes its crops in one rm. */
export const characterCropDirFor = (mediaId: number) => path.join(CHARACTER_CROPS_DIR, String(mediaId));

async function writeCrop(source: string, box: { x: number; y: number; w: number; h: number }, file: string) {
  const img = sharp(source, { animated: false, autoOrient: true });
  const meta = await img.metadata();
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = (rotated ? meta.height : meta.width) ?? 0;
  const height = (rotated ? meta.width : meta.height) ?? 0;
  const left = Math.min(Math.max(Math.round(box.x * width), 0), width - 1);
  const top = Math.min(Math.max(Math.round(box.y * height), 0), height - 1);
  const buf = await img
    .extract({
      left,
      top,
      width: Math.max(1, Math.min(Math.round(box.w * width), width - left)),
      height: Math.max(1, Math.min(Math.round(box.h * height), height - top)),
    })
    .resize(CROP_SIZE, CROP_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

/** The cached crop of one detection, made on first request. */
export async function detectionCropPath(detectionId: number): Promise<string> {
  const det = sqlite
    .query('SELECT id, media_id, x, y, w, h FROM character_detections WHERE id = ?')
    .get(detectionId) as {
    id: number;
    media_id: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null;
  if (!det) throw httpError(404, 'Detection not found');
  const file = path.join(characterCropDirFor(det.media_id), `${det.id}.webp`);
  if (fs.existsSync(file)) return file;
  const { image, thumb } = mediaSource(det.media_id);
  try {
    await writeCrop(image, det, file);
  } catch (err) {
    if (image === thumb || !fs.existsSync(thumb)) throw err;
    await writeCrop(thumb, det, file);
  }
  return file;
}
