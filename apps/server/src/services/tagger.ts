import fs from 'node:fs';
import sharp from 'sharp';
import { eq, and, isNull } from 'drizzle-orm';
import { db, sqlite, schema } from '../db';
import { MODEL_PATH, MODEL_TAGS_PATH, modelRepoBase, MODEL_REGISTRY, LIMITS } from '../lib/config';
import { confidenceThreshold, getSetting, setSetting } from '../lib/settings';
import { thumbPathFor } from './thumbnailer';
import { enqueueJob, eachWithProgress, type JobHandle } from './jobQueue';
import { computeDHash } from './perceptualHash';
import { bumpTasteVersion } from '../lib/tasteVersion';
import { phashColumns } from '../lib/phashBands';
import { chunkIds, mediaIdsWhere } from '../lib/mediaByIds';
import { downloadFile } from '../lib/download';
import type { TaggerStatus, TagCategory } from '@sakuya/shared';

const INPUT_SIZE = 448;

interface LabelEntry {
  name: string;
  category: TagCategory;
}

let session: any = null;
let labels: LabelEntry[] | null = null;
let downloading = false;

// The loaded model holds ~800 MB of native memory. Tagging comes in bursts (after a scan, an upload),
// so free it once nothing has used it for a while; the next tag reloads it in a second or two.
const SESSION_IDLE_MS = 60_000;
let sessionIdleTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = 0;

/**
 * glibc keeps freed memory in its arenas instead of returning it to the OS: after release() the
 * process still held ~620 of the model's ~790 MB (measured). malloc_trim hands it back. No-op where
 * there is no glibc (macOS, Windows, musl).
 */
async function trimNativeHeap(): Promise<void> {
  if (process.platform !== 'linux') return;
  try {
    const { dlopen, FFIType } = await import('bun:ffi');
    const libc = dlopen('libc.so.6', { malloc_trim: { args: [FFIType.u64], returns: FFIType.i32 } });
    libc.symbols.malloc_trim(0);
    libc.close();
  } catch {
    // Not glibc.
  }
}

/** Free the model's native memory now. Dropping the reference alone leaves it to a GC finalizer. */
function releaseSession(): void {
  if (sessionIdleTimer) clearTimeout(sessionIdleTimer);
  sessionIdleTimer = null;
  const old = session;
  session = null;
  old
    ?.release()
    .then(trimNativeHeap)
    .catch((err: unknown) => console.error('tagger: failed to release model session:', err));
}

function scheduleSessionRelease(): void {
  if (sessionIdleTimer) clearTimeout(sessionIdleTimer);
  sessionIdleTimer = setTimeout(() => {
    if (inFlight === 0) releaseSession();
  }, SESSION_IDLE_MS);
  sessionIdleTimer.unref();
}

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
  if (!MODEL_REGISTRY.some((m) => m.id === modelId)) throw new Error(`Unknown model: ${modelId}`);
  if (selectedModelId() === modelId) return;
  setSetting('tagger_model', modelId);
  // Model files are shared paths; a switch invalidates the currently-downloaded model.
  releaseSession();
  labels = null;
  fs.rmSync(MODEL_PATH, { force: true });
  fs.rmSync(MODEL_TAGS_PATH, { force: true });
}

function loadLabels(): LabelEntry[] {
  labels ??= fs
    .readFileSync(MODEL_TAGS_PATH, 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      // tag_id,name,category,count — names never contain commas in this dataset
      const [, name, rawCategory] = line.split(',');
      const category = Number(rawCategory);
      return { name, category: category === 9 ? 'rating' : category === 4 ? 'character' : 'general' };
    });
  return labels;
}

async function getSession(): Promise<any> {
  if (session) return session;
  const ort = await import('onnxruntime-node');
  session = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    // Cap threads so bulk tagging can't monopolize every core and starve
    // request handling (thumbnail/video serving) or other host services.
    // Tunable via SAKUYA_MAX_CPUS / SAKUYA_ONNX_THREADS; the defaults are the 2/1 this used
    // to hardcode.
    intraOpNumThreads: LIMITS.onnxIntraOpThreads,
    interOpNumThreads: LIMITS.onnxInterOpThreads,
  });
  return session;
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
  let probs: Float32Array;
  inFlight++;
  try {
    const sess = await getSession();
    const input = await preprocess(imagePath);
    const tensor = new ort.Tensor('float32', input, [1, INPUT_SIZE, INPUT_SIZE, 3]);
    const results = await sess.run({ [sess.inputNames[0]]: tensor });
    probs = results[sess.outputNames[0]].data as Float32Array;
  } finally {
    inFlight--;
    scheduleSessionRelease();
  }
  const allLabels = loadLabels();

  // The exported model normally ends in a sigmoid; apply one ourselves if outputs are raw logits.
  if (probs.some((v) => v < -0.0001 || v > 1.0001)) probs = probs.map((v) => 1 / (1 + Math.exp(-v))) as Float32Array;

  const threshold = confidenceThreshold();
  const out: PredictedTag[] = [];
  let bestRating: PredictedTag | null = null;
  for (let i = 0; i < allLabels.length && i < probs.length; i++) {
    const label = allLabels[i];
    const confidence = probs[i];
    if (label.category === 'rating') {
      if (!bestRating || confidence > bestRating.confidence) {
        bestRating = { name: label.name, category: 'rating', confidence };
      }
    } else if (confidence >= threshold) {
      out.push({ name: label.name, category: label.category, confidence });
    }
  }
  if (bestRating) out.push(bestRating);
  out.sort((a, b) => b.confidence - a.confidence);
  return out;
}

export function upsertTag(name: string, category: TagCategory): number {
  const existing = db.select().from(schema.tags).where(eq(schema.tags.name, name)).get();
  if (existing) return existing.id;
  return db.insert(schema.tags).values({ name, category }).returning().get().id;
}

export function refreshUsageCounts(tagIds: number[]): void {
  if (!tagIds.length) return;
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
      const tagId = upsertTag(tag.name, tag.category);
      touched.add(tagId);
      db.insert(schema.mediaTags)
        .values({ mediaId, tagId, confidence: tag.confidence, source: 'ai' })
        .onConflictDoNothing()
        .run();
    }
    db.update(schema.media).set({ taggedAt: Date.now() }).where(eq(schema.media.id, mediaId)).run();
    refreshUsageCounts([...touched]);
  })();
  return predicted.length;
}

export function enqueueTagJob(mediaIds: number[], label: string, libraryId: number | null = null) {
  return enqueueJob(
    'tag',
    label,
    async (job: JobHandle) => {
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
    },
    libraryId,
  );
}

export function unhashedImageIds(libraryId?: number): number[] {
  return mediaIdsWhere(and(eq(schema.media.type, 'image'), isNull(schema.media.perceptualHash)), libraryId);
}

export function enqueueHashJob(mediaIds: number[], libraryId: number | null = null) {
  const lib = libraryId
    ? db.select().from(schema.libraries).where(eq(schema.libraries.id, libraryId)).get()
    : null;
  const label = lib
    ? `Compute image hashes: ${lib.name} (${mediaIds.length} files)`
    : `Compute image hashes (${mediaIds.length} files)`;
  return enqueueJob(
    'hash',
    label,
    async (job: JobHandle) => {
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
    },
    libraryId,
  );
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
      releaseSession();
      return 'Model downloaded and ready.';
    } finally {
      downloading = false;
    }
  });
}
