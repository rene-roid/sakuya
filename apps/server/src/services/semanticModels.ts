import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { CLIP_MODELS_DIR, CLIP_MODEL_FILES } from '../lib/config';
import { ClipTokenizer } from '../lib/clipTokenizer';
import { createModelSession } from '../lib/modelSession';
import { normalize } from '../lib/vectors';
import { downloadFile } from '../lib/download';
import { enqueueJob, type JobHandle } from './jobQueue';

// CLIPImageProcessor for openai/clip-vit-base-patch32: shortest edge to 224 (bicubic), centre
// crop 224, RGB / 255, normalized with the CLIP mean/std, CHW.
const IMAGE_SIZE = 224;
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.26130258, 0.27577711];

export const clipModelPath = (file: string) => path.join(CLIP_MODELS_DIR, file);

const vision = createModelSession(() => clipModelPath('vision.onnx'), { label: 'clip vision' });
const text = createModelSession(() => clipModelPath('text.onnx'), { label: 'clip text' });

/** What turns an image or a description into a unit vector in the same space. */
export interface ClipEncoder {
  image(imagePath: string): Promise<Float32Array>;
  text(query: string): Promise<Float32Array>;
}

let tokenizer: ClipTokenizer | null = null;

function getTokenizer(): ClipTokenizer {
  tokenizer ??= new ClipTokenizer(
    JSON.parse(fs.readFileSync(clipModelPath('vocab.json'), 'utf8')),
    fs.readFileSync(clipModelPath('merges.txt'), 'utf8'),
  );
  return tokenizer;
}

export async function clipPixels(imagePath: string): Promise<Float32Array> {
  const raw = await sharp(imagePath, { animated: false })
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(IMAGE_SIZE, IMAGE_SIZE, { fit: 'cover', position: 'centre', kernel: 'cubic' })
    .removeAlpha()
    .raw()
    .toBuffer();
  const pixels = IMAGE_SIZE * IMAGE_SIZE;
  const out = new Float32Array(pixels * 3);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < pixels; i++) out[c * pixels + i] = (raw[i * 3 + c] / 255 - MEAN[c]) / STD[c];
  }
  return out;
}

export const onnxClipEncoder: ClipEncoder = {
  async image(imagePath) {
    const ort = await import('onnxruntime-node');
    const input = new ort.Tensor('float32', await clipPixels(imagePath), [1, 3, IMAGE_SIZE, IMAGE_SIZE]);
    return vision.use(async (session) => {
      const out = await session.run({ pixel_values: input });
      return normalize(out.image_embeds.data as Float32Array);
    });
  },
  async text(query) {
    const ort = await import('onnxruntime-node');
    const ids = getTokenizer().encode(query);
    const input = new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]);
    return text.use(async (session) => {
      const out = await session.run({ input_ids: input });
      return normalize(out.text_embeds.data as Float32Array);
    });
  },
};

let encoder: ClipEncoder = onnxClipEncoder;

export const clipEncoder = (): ClipEncoder => encoder;

/** Tests swap in a fake so they never need the real model. */
export function setClipEncoder(next: ClipEncoder | null): void {
  encoder = next ?? onnxClipEncoder;
}

let downloading = false;

export const clipModelsDownloading = () => downloading;

export function clipModelsReady(): boolean {
  return CLIP_MODEL_FILES.every((f) => fs.existsSync(clipModelPath(f.file)));
}

export function clipModelBytes(): number {
  return CLIP_MODEL_FILES.reduce((sum, f) => {
    const p = clipModelPath(f.file);
    return sum + (fs.existsSync(p) ? fs.statSync(p).size : 0);
  }, 0);
}

export const clipTextLoaded = () => text.loaded();
export const clipVisionLoaded = () => vision.loaded();

export function releaseClipModels(): void {
  vision.release();
  text.release();
  tokenizer = null;
}

export function enqueueClipModelDownload() {
  if (downloading) throw new Error('Search model download already in progress');
  downloading = true;
  return enqueueJob('model-download', 'Download search model', async (job: JobHandle) => {
    try {
      const total = CLIP_MODEL_FILES.reduce((sum, f) => sum + f.approxBytes, 0);
      let before = 0;
      job.update({ total: 100, progress: 0, log: 'Downloading the search model…' });
      for (const f of CLIP_MODEL_FILES) {
        if (fs.existsSync(clipModelPath(f.file))) {
          before += f.approxBytes;
          continue;
        }
        let lastPct = -1;
        await downloadFile(f.url, clipModelPath(f.file), (received) => {
          const pct = Math.min(99, Math.round(((before + received) / total) * 100));
          if (pct === lastPct) return;
          lastPct = pct;
          job.update({ progress: pct, log: `Downloading ${f.file}: ${(received / 1e6).toFixed(0)} MB` });
        });
        before += f.approxBytes;
      }
      releaseClipModels();
      return 'Search model downloaded and ready.';
    } finally {
      downloading = false;
    }
  });
}
