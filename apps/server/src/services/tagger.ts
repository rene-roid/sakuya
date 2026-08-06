import fs from 'node:fs';
import fsp from 'node:fs/promises';
import sharp from 'sharp';
import { eq, and, isNull } from 'drizzle-orm';
import { db, sqlite, schema } from '../db';
import { MODEL_PATH, MODEL_TAGS_PATH, modelRepoBase, DEFAULT_MODEL_ID, MODEL_REGISTRY } from '../lib/config';
import { confidenceThreshold, getSetting, setSetting } from '../lib/settings';
import { thumbPathFor } from './thumbnailer';
import { enqueueJob, type JobHandle } from './jobQueue';
import type { TaggerStatus, TagCategory } from '@sakuya/shared';

const INPUT_SIZE = 448;

interface LabelEntry {
  name: string;
  category: TagCategory;
}

let session: any = null;
let labels: LabelEntry[] | null = null;
let downloading = false;

export function modelReady(): boolean {
  return fs.existsSync(MODEL_PATH) && fs.existsSync(MODEL_TAGS_PATH);
}

export function untaggedMediaIds(): number[] {
  return db
    .select({ id: schema.media.id })
    .from(schema.media)
    .where(isNull(schema.media.taggedAt))
    .all()
    .map((r) => r.id);
}

export function selectedModelId(): string {
  return getSetting('tagger_model') || DEFAULT_MODEL_ID;
}

function unhashedImageCount(): number {
  const row = sqlite
    .query(`SELECT COUNT(*) AS c FROM media WHERE type = 'image' AND perceptual_hash IS NULL`)
    .get() as { c: number };
  return row.c;
}

export function taggerStatus(): TaggerStatus {
  const untaggedCount = untaggedMediaIds().length;
  const unhashedCount = unhashedImageCount();
  const model = selectedModelId();
  if (downloading) return { status: 'downloading', model, modelSizeBytes: null, tagCount: null, untaggedCount, unhashedCount };
  if (!modelReady()) return { status: 'absent', model, modelSizeBytes: null, tagCount: null, untaggedCount, unhashedCount };
  return {
    status: 'ready',
    model,
    modelSizeBytes: fs.statSync(MODEL_PATH).size,
    tagCount: loadLabels().length,
    untaggedCount,
    unhashedCount,
  };
}

/** Switch the active tagger model. Clears cached model files/session so the new one must be downloaded. */
export function selectModel(modelId: string): void {
  if (downloading) throw new Error('Cannot switch models while a download is in progress');
  if (!MODEL_REGISTRY.some((m) => m.id === modelId)) throw new Error(`Unknown model: ${modelId}`);
  if (selectedModelId() === modelId) return;
  setSetting('tagger_model', modelId);
  // Model files are shared paths; a switch invalidates the currently-downloaded model.
  session = null;
  labels = null;
  fs.rmSync(MODEL_PATH, { force: true });
  fs.rmSync(MODEL_TAGS_PATH, { force: true });
  setSetting('model_status', 'absent');
}

function loadLabels(): LabelEntry[] {
  if (labels) return labels;
  const csv = fs.readFileSync(MODEL_TAGS_PATH, 'utf8');
  const lines = csv.trim().split('\n');
  const out: LabelEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    // tag_id,name,category,count — names never contain commas in this dataset
    const parts = lines[i].split(',');
    const category = Number(parts[2]);
    out.push({
      name: parts[1],
      category: category === 9 ? 'rating' : category === 4 ? 'character' : 'general',
    });
  }
  labels = out;
  return out;
}

async function getSession(): Promise<any> {
  if (session) return session;
  const ort = await import('onnxruntime-node');
  session = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
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
  const sess = await getSession();
  const allLabels = loadLabels();
  const input = await preprocess(imagePath);
  const tensor = new ort.Tensor('float32', input, [1, INPUT_SIZE, INPUT_SIZE, 3]);
  const results = await sess.run({ [sess.inputNames[0]]: tensor });
  let probs = results[sess.outputNames[0]].data as Float32Array;

  // The exported model normally ends in a sigmoid; apply one ourselves if outputs are raw logits.
  let needsSigmoid = false;
  for (let i = 0; i < probs.length; i++) {
    if (probs[i] < -0.0001 || probs[i] > 1.0001) {
      needsSigmoid = true;
      break;
    }
  }
  if (needsSigmoid) probs = probs.map((v) => 1 / (1 + Math.exp(-v))) as Float32Array;

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
  const placeholders = tagIds.map(() => '?').join(',');
  sqlite
    .query(
      `UPDATE tags SET usage_count = (SELECT COUNT(*) FROM media_tags WHERE media_tags.tag_id = tags.id) WHERE id IN (${placeholders})`,
    )
    .run(...tagIds);
}

export async function tagOneMedia(mediaId: number): Promise<number> {
  const row = db.select().from(schema.media).where(eq(schema.media.id, mediaId)).get();
  if (!row) throw new Error(`media ${mediaId} not found`);
  // Videos are tagged from their extracted thumbnail frame.
  const imagePath = row.type === 'video' ? thumbPathFor(row.id) : row.path;
  if (!fs.existsSync(imagePath)) throw new Error(`no taggable image for media ${mediaId}`);
  const predicted = await predictTags(imagePath);

  const oldAi = db
    .select({ tagId: schema.mediaTags.tagId })
    .from(schema.mediaTags)
    .where(and(eq(schema.mediaTags.mediaId, mediaId), eq(schema.mediaTags.source, 'ai')))
    .all()
    .map((r) => r.tagId);
  db.delete(schema.mediaTags)
    .where(and(eq(schema.mediaTags.mediaId, mediaId), eq(schema.mediaTags.source, 'ai')))
    .run();

  const touched = new Set<number>(oldAi);
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
  return predicted.length;
}

export function enqueueTagJob(mediaIds: number[], label: string, libraryId: number | null = null) {
  return enqueueJob(
    'tag',
    label,
    async (job: JobHandle) => {
      job.update({ total: mediaIds.length, log: `Tagging ${mediaIds.length} files…` });
      let tagged = 0;
      let errors = 0;
      for (let i = 0; i < mediaIds.length; i++) {
        try {
          await tagOneMedia(mediaIds[i]);
          tagged++;
        } catch (err) {
          errors++;
          console.error(`tagging failed for media ${mediaIds[i]}:`, err);
        }
        job.update({ progress: i + 1, log: `Tagged ${i + 1}/${mediaIds.length} files…` });
      }
      return `Completed. ${tagged} files tagged${errors ? `, ${errors} errors` : ''}.`;
    },
    libraryId,
  );
}

export function unhashedImageIds(): number[] {
  return (
    sqlite
      .query(`SELECT id FROM media WHERE type = 'image' AND perceptual_hash IS NULL`)
      .all() as { id: number }[]
  ).map((r) => r.id);
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
      const { computeDHash } = await import('./perceptualHash');
      job.update({ total: mediaIds.length, log: `Hashing ${mediaIds.length} images…` });
      let hashed = 0;
      let errors = 0;
      for (let i = 0; i < mediaIds.length; i++) {
        try {
          const row = db.select().from(schema.media).where(eq(schema.media.id, mediaIds[i])).get();
          if (row && row.type === 'image' && fs.existsSync(row.path)) {
            const hash = await computeDHash(row.path);
            db.update(schema.media).set({ perceptualHash: hash }).where(eq(schema.media.id, mediaIds[i])).run();
            hashed++;
          }
        } catch (err) {
          errors++;
          console.error(`hashing failed for media ${mediaIds[i]}:`, err);
        }
        if (i % 5 === 0 || i === mediaIds.length - 1) {
          job.update({ progress: i + 1, log: `Hashed ${i + 1}/${mediaIds.length} images…` });
        }
      }
      return `Completed. ${hashed} hashed${errors ? `, ${errors} errors` : ''}.`;
    },
    libraryId,
  );
}

async function downloadFile(url: string, dest: string, onProgress: (received: number, total: number) => void) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const tmp = dest + '.part';
  const writer = fs.createWriteStream(tmp);
  let received = 0;
  try {
    for await (const chunk of res.body as any) {
      writer.write(chunk);
      received += chunk.length;
      onProgress(received, total);
    }
    await new Promise<void>((resolve, reject) => writer.end((err: any) => (err ? reject(err) : resolve())));
    await fsp.rename(tmp, dest);
  } catch (err) {
    writer.destroy();
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}

export function enqueueModelDownload() {
  if (downloading) throw new Error('Model download already in progress');
  downloading = true;
  setSetting('model_status', 'downloading');
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
      session = null;
      setSetting('model_status', 'ready');
      return 'Model downloaded and ready.';
    } catch (err) {
      setSetting('model_status', 'error');
      throw err;
    } finally {
      downloading = false;
    }
  });
}
