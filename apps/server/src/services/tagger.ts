import fs from 'node:fs';
import sharp from 'sharp';
import { eq, and, isNull } from 'drizzle-orm';
import { db, sqlite, schema } from '../db';
import { MODEL_PATH, MODEL_TAGS_PATH, modelRepoBase, MODEL_REGISTRY } from '../lib/config';
import { confidenceThresholds, getSetting, setSetting, type TagThresholds } from '../lib/settings';
import { thumbPathFor } from './thumbnailer';
import { enqueueJob, eachWithProgress, type JobHandle } from './jobQueue';
import { computeDHash } from './perceptualHash';
import { bumpTasteVersion } from '../lib/tasteVersion';
import { phashColumns } from '../lib/phashBands';
import { chunkIds, mediaIdsWhere } from '../lib/mediaByIds';
import { downloadFile } from '../lib/download';
import { createModelSession } from '../lib/modelSession';
import { ensureTag, impliedOn, linkTag, recomputeImplied, resolveSibling } from './tagRelations';
import type { TaggerStatus, TagCategory } from '@sakuya/shared';

const INPUT_SIZE = 448;

export interface LabelEntry {
  name: string;
  category: TagCategory;
}

let labels: LabelEntry[] | null = null;
let downloading = false;

// The loaded model holds ~800 MB of native memory, freed 60 s after the last tag.
const model = createModelSession(MODEL_PATH, { label: 'tagger' });

export function modelReady(): boolean {
  return fs.existsSync(MODEL_PATH) && fs.existsSync(MODEL_TAGS_PATH);
}

export function untaggedMediaIds(libraryId?: number): number[] {
  return mediaIdsWhere(isNull(schema.media.taggedAt), libraryId);
}

/**
 * Count untagged rows without materialising their ids. taggerStatus is polled by the Settings
 * UI, and pulling every untagged id into JS just to read .length made that poll scale with the
 * size of the backlog. Callers that genuinely need the ids still use untaggedMediaIds().
 */
export function untaggedCount(): number {
  const row = sqlite.query(`SELECT COUNT(*) AS c FROM media WHERE tagged_at IS NULL`).get() as { c: number };
  return row.c;
}

export function selectedModelId(): string {
  return getSetting('tagger_model');
}

function unhashedImageCount(): number {
  const row = sqlite
    .query(`SELECT COUNT(*) AS c FROM media WHERE type = 'image' AND perceptual_hash IS NULL`)
    .get() as { c: number };
  return row.c;
}

export function taggerStatus(): TaggerStatus {
  const ready = !downloading && modelReady();
  return {
    status: downloading ? 'downloading' : ready ? 'ready' : 'absent',
    model: selectedModelId(),
    modelSizeBytes: ready ? fs.statSync(MODEL_PATH).size : null,
    tagCount: ready ? loadLabels().length : null,
    untaggedCount: untaggedCount(),
    unhashedCount: unhashedImageCount(),
  };
}

/** Switch the active tagger model. Clears cached model files/session so the new one must be downloaded. */
export function selectModel(modelId: string): void {
  if (downloading) throw new Error('Cannot switch models while a download is in progress');
  if (model.inFlight() > 0) throw new Error('Cannot switch models while images are being tagged');
  if (!MODEL_REGISTRY.some((m) => m.id === modelId)) throw new Error(`Unknown model: ${modelId}`);
  if (selectedModelId() === modelId) return;
  setSetting('tagger_model', modelId);
  // Model files are shared paths; a switch invalidates the currently-downloaded model.
  model.release();
  labels = null;
  fs.rmSync(MODEL_PATH, { force: true });
  fs.rmSync(MODEL_TAGS_PATH, { force: true });
}

/** The model's selected_tags.csv: a header, then `tag_id,name,category,count` per output. */
export function parseLabels(csv: string): LabelEntry[] {
  return csv
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      // names never contain commas in this dataset
      const [, name, rawCategory] = line.split(',');
      const category = Number(rawCategory);
      return { name, category: category === 9 ? 'rating' : category === 4 ? 'character' : 'general' };
    });
}

function loadLabels(): LabelEntry[] {
  labels ??= parseLabels(fs.readFileSync(MODEL_TAGS_PATH, 'utf8'));
  return labels;
}

/** Pad to square (white), resize to 448x448, RGB→BGR, float32 0-255, NHWC. */
async function preprocess(imagePath: string): Promise<Float32Array> {
  const raw = await sharp(imagePath, { animated: false })
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
    .removeAlpha()
    .raw()
    .toBuffer();
  const pixels = INPUT_SIZE * INPUT_SIZE;
  const data = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    data[i * 3] = raw[i * 3 + 2];
    data[i * 3 + 1] = raw[i * 3 + 1];
    data[i * 3 + 2] = raw[i * 3];
  }
  return data;
}

export interface PredictedTag {
  name: string;
  category: TagCategory;
  confidence: number;
}

export async function predictTags(imagePath: string): Promise<PredictedTag[]> {
  if (!modelReady()) throw new Error('Tagger model not downloaded');
  const ort = await import('onnxruntime-node');
  const probs = await model.use(async (sess) => {
    const input = await preprocess(imagePath);
    const tensor = new ort.Tensor('float32', input, [1, INPUT_SIZE, INPUT_SIZE, 3]);
    const results = await sess.run({ [sess.inputNames[0]]: tensor });
    return results[sess.outputNames[0]].data as Float32Array;
  });
  return selectTags(probs, loadLabels(), confidenceThresholds());
}

/**
 * The tags a model output picks: every general and character tag scoring at least its category's
 * threshold, plus the single best rating whatever its score, highest confidence first.
 */
export function selectTags(scores: Float32Array, allLabels: LabelEntry[], thresholds: TagThresholds): PredictedTag[] {
  // The exported model normally ends in a sigmoid; apply one ourselves if outputs are raw logits.
  const probs = scores.some((v) => v < -0.0001 || v > 1.0001) ? scores.map((v) => 1 / (1 + Math.exp(-v))) : scores;

  const out: PredictedTag[] = [];
  let bestRating: PredictedTag | null = null;
  for (let i = 0; i < allLabels.length && i < probs.length; i++) {
    const label = allLabels[i];
    const confidence = probs[i];
    if (label.category === 'rating') {
      if (!bestRating || confidence > bestRating.confidence) {
        bestRating = { name: label.name, category: 'rating', confidence };
      }
    } else if (confidence >= (label.category === 'character' ? thresholds.character : thresholds.general)) {
      out.push({ name: label.name, category: label.category, confidence });
    }
  }
  if (bestRating) out.push(bestRating);
  out.sort((a, b) => b.confidence - a.confidence);
  return out;
}

/** The id a link to `name` is written under: the tag itself, or the tag it was merged into. */
export function upsertTag(name: string, category: TagCategory): number {
  return resolveSibling(ensureTag(name, category));
}

let tagLinksChanges = 0;

/**
 * Moves whenever a media gains or loses a tag. Every media_tags write reaches refreshUsageCounts,
 * so caches derived from media_tags compare this instead of re-reading the table.
 */
export function tagLinksVersion(): number {
  return tagLinksChanges;
}

export function refreshUsageCounts(tagIds: number[]): void {
  if (!tagIds.length) return;
  tagLinksChanges++;
  // Chunked: a library delete can touch most of the tag vocabulary at once.
  for (const part of chunkIds(tagIds)) {
    const placeholders = part.map(() => '?').join(',');
    sqlite
      .query(
        `UPDATE tags SET usage_count = (SELECT COUNT(*) FROM media_tags WHERE media_tags.tag_id = tags.id) WHERE id IN (${placeholders})`,
      )
      .run(...part);
  }
  // Every path that changes which tags are on which media lands here, including the AI tag job,
  // so this is the one place the Discover taste profile needs invalidating for tag writes.
  bumpTasteVersion();
}

const unlinkReturningSource = sqlite.prepare(
  'DELETE FROM media_tags WHERE media_id = ? AND tag_id = ? RETURNING source',
);
const insertVeto = sqlite.prepare(
  'INSERT INTO media_tag_vetoes (media_id, tag_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
);
const deleteVeto = sqlite.prepare('DELETE FROM media_tag_vetoes WHERE media_id = ? AND tag_id = ?');
const vetoedIds = sqlite.prepare('SELECT tag_id FROM media_tag_vetoes WHERE media_id = ?');

/**
 * Take a tag off one item by hand. Removing a tag something else put there (the AI, a sidecar, an
 * implication) records a veto so that source leaves it off from now on.
 */
export function unlinkTag(mediaId: number, tagId: number): void {
  const removed = unlinkReturningSource.get(mediaId, tagId) as { source: string } | null;
  if (removed && (removed.source !== 'user' || impliedOn(mediaId, tagId))) insertVeto.run(mediaId, tagId, Date.now());
}

/** Adding a tag by hand overrides any earlier rejection of it. */
export function clearVeto(mediaId: number, tagId: number): void {
  deleteVeto.run(mediaId, tagId);
}

export async function tagOneMedia(mediaId: number): Promise<number> {
  const row = db.select().from(schema.media).where(eq(schema.media.id, mediaId)).get();
  if (!row) throw new Error(`media ${mediaId} not found`);
  // Videos are tagged from their extracted thumbnail frame.
  const imagePath = row.type === 'video' ? thumbPathFor(row.id) : row.path;
  if (!fs.existsSync(imagePath)) throw new Error(`no taggable image for media ${mediaId}`);
  let predicted: PredictedTag[];
  try {
    predicted = await predictTags(imagePath);
  } catch (err) {
    // sharp couldn't decode the raw source — retry against the generated thumbnail, which is
    // always a valid webp regardless of how exotic the original format is.
    const thumb = thumbPathFor(row.id);
    if (imagePath === row.path && thumb !== imagePath && fs.existsSync(thumb)) {
      predicted = await predictTags(thumb);
    } else {
      throw err;
    }
  }
  return applyPredictedTags(mediaId, predicted);
}

/** Replace an item's AI tags with `predicted`, minus any the user vetoed on it. */
export function applyPredictedTags(mediaId: number, predicted: PredictedTag[]): number {
  const vetoed = new Set((vetoedIds.all(mediaId) as { tag_id: number }[]).map((r) => r.tag_id));
  let kept = 0;
  // One transaction for the swap: the old AI tags and the new ones commit together, so a reader
  // never sees the item momentarily untagged, and the ~30 inserts (each rewriting the item's
  // search-index row via trigger) share one commit instead of paying one each.
  const touched = new Set<number>();
  sqlite.transaction(() => {
    const oldAi = db
      .select({ tagId: schema.mediaTags.tagId })
      .from(schema.mediaTags)
      .where(and(eq(schema.mediaTags.mediaId, mediaId), eq(schema.mediaTags.source, 'ai')))
      .all();
    for (const r of oldAi) touched.add(r.tagId);
    db.delete(schema.mediaTags)
      .where(and(eq(schema.mediaTags.mediaId, mediaId), eq(schema.mediaTags.source, 'ai')))
      .run();

    for (const tag of predicted) {
      // Checked by id after the sibling lookup: a veto on a merged tag covers its aliases too.
      const tagId = upsertTag(tag.name, tag.category);
      if (vetoed.has(tagId)) continue;
      kept++;
      touched.add(tagId);
      linkTag(mediaId, tagId, 'ai', tag.confidence);
    }
    for (const tagId of recomputeImplied([mediaId])) touched.add(tagId);
    db.update(schema.media).set({ taggedAt: Date.now() }).where(eq(schema.media.id, mediaId)).run();
    refreshUsageCounts([...touched]);
  })();
  return kept;
}

export function enqueueTagJob(mediaIds: number[], label: string, libraryId: number | null = null) {
  return enqueueJob('tag', label, (job) => runTagJob(job, mediaIds), libraryId);
}

export async function runTagJob(job: JobHandle, mediaIds: number[]): Promise<string> {
  job.update({ total: mediaIds.length, log: `Tagging ${mediaIds.length} files…` });
  const errors = await eachWithProgress(
    job,
    mediaIds,
    (done, total) => `Tagged ${done}/${total} files…`,
    (id) => `tagging failed for media ${id}:`,
    tagOneMedia,
    1,
  );
  const tagged = mediaIds.length - errors;
  return `Completed. ${tagged} files tagged${errors ? `, ${errors} errors` : ''}.`;
}

export function unhashedImageIds(libraryId?: number): number[] {
  return mediaIdsWhere(and(eq(schema.media.type, 'image'), isNull(schema.media.perceptualHash)), libraryId);
}

export function enqueueHashJob(mediaIds: number[]) {
  return enqueueJob('hash', `Compute image hashes (${mediaIds.length} files)`, (job) => runHashJob(job, mediaIds));
}

export async function runHashJob(job: JobHandle, mediaIds: number[]): Promise<string> {
  job.update({ total: mediaIds.length, log: `Hashing ${mediaIds.length} images…` });
  let hashed = 0;
  const errors = await eachWithProgress(
    job,
    mediaIds,
    (done, total) => `Hashed ${done}/${total} images…`,
    (id) => `hashing failed for media ${id}:`,
    async (id) => {
      const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
      if (!row || row.type !== 'image' || !fs.existsSync(row.path)) return;
      const hash = await computeDHash(row.path);
      db.update(schema.media).set(phashColumns(hash)).where(eq(schema.media.id, id)).run();
      hashed++;
    },
  );
  return `Completed. ${hashed} hashed${errors ? `, ${errors} errors` : ''}.`;
}

export function enqueueModelDownload() {
  if (downloading) throw new Error('Model download already in progress');
  downloading = true;
  const modelId = selectedModelId();
  const repoBase = modelRepoBase(modelId);
  return enqueueJob('model-download', `Download tagger model (${modelId})`, async (job: JobHandle) => {
    try {
      job.update({ total: 100, log: 'Downloading selected_tags.csv…' });
      await downloadFile(`${repoBase}/selected_tags.csv`, MODEL_TAGS_PATH, () => {});
      job.update({ progress: 2, log: 'Downloading model.onnx (~430 MB)…' });
      let lastPct = 0;
      await downloadFile(`${repoBase}/model.onnx`, MODEL_PATH, (received, total) => {
        if (!total) return;
        const pct = 2 + Math.round((received / total) * 97);
        if (pct !== lastPct) {
          lastPct = pct;
          job.update({
            progress: pct,
            log: `Downloading model.onnx: ${(received / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`,
          });
        }
      });
      labels = null;
      model.release();
      return 'Model downloaded and ready.';
    } finally {
      downloading = false;
    }
  });
}
