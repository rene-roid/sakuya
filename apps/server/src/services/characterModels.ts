import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { CHARACTER_MODELS_DIR, CHARACTER_MODEL_FILES } from '../lib/config';
import { createModelSession } from '../lib/modelSession';
import { downloadFile } from '../lib/download';
import { enqueueJob, type JobHandle } from './jobQueue';

// Preprocessing reproduces dghs-imgutils (imgutils/generic/yolo.py, imgutils/metrics/ccip.py):
// the detector sees the whole image stretched to 640x640, RGB 0-1, CHW; CCIP sees each box crop
// stretched to 384x384 (bilinear), normalized with the CLIP mean/std, CHW.
const DETECT_SIZE = 640;
const DETECT_IOU = 0.5;
const CCIP_SIZE = 384;
const CCIP_MEAN = [0.48145466, 0.4578275, 0.40821073];
const CCIP_STD = [0.26862954, 0.26130258, 0.27577711];
// Comic pages run to 3500 px; the detector sees 640 and CCIP 384, so decoding past this only
// costs time. Crops keep enough pixels for a character a sixth of the page tall.
const MAX_DECODE = 2048;
// A box this small in the decoded image is a background figure CCIP can't identify.
const MIN_BOX_PX = 24;
const MAX_DETECTIONS = 16;
const CCIP_BATCH = 4;

export const modelPath = (file: string) => path.join(CHARACTER_MODELS_DIR, file);

const detector = createModelSession(() => modelPath('detector.onnx'), { label: 'character detector' });
const ccip = createModelSession(() => modelPath('ccip_feat.onnx'), { label: 'ccip' });

let downloading = false;

export function characterModelsDownloading(): boolean {
  return downloading;
}

export function characterModelsReady(): boolean {
  return CHARACTER_MODEL_FILES.every((f) => fs.existsSync(modelPath(f.file)));
}

export function characterModelBytes(): number {
  return CHARACTER_MODEL_FILES.reduce((sum, f) => {
    const p = modelPath(f.file);
    return sum + (fs.existsSync(p) ? fs.statSync(p).size : 0);
  }, 0);
}

export function characterModelsInFlight(): number {
  return detector.inFlight() + ccip.inFlight();
}

/** Free both sessions now, as after a fresh download. */
export function releaseCharacterModels(): void {
  detector.release();
  ccip.release();
}

export interface CcipParams {
  /** The detector's published confidence threshold (threshold.json). */
  detectThreshold: number;
  /** DBSCAN min_samples (cluster.json, dbscan_2). */
  minSamples: number;
  /**
   * The CCIP difference is computed by model_metrics.onnx. Its graph scales each feature to unit
   * length and maps the scaled cosine through an affine step and a clip, so difference =
   * clamp(a - b * cos). The job calibrates a and b by running the model, then applies the formula
   * to every pair instead of feeding an N x N batch through onnxruntime.
   */
  diffA: number;
  diffB: number;
}

/** Published defaults, which calibration reproduces exactly for ccip-caformer-24-randaug-pruned. */
export const DEFAULT_CCIP_PARAMS: CcipParams = {
  detectThreshold: 0.324,
  minSamples: 2,
  diffA: 0.5,
  diffB: 0.5,
};

const readJson = (file: string) => JSON.parse(fs.readFileSync(modelPath(file), 'utf8'));

async function calibrateMetric(): Promise<{ a: number; b: number }> {
  const ort = await import('onnxruntime-node');
  const session = await ort.InferenceSession.create(modelPath('ccip_metrics.onnx'));
  try {
    const dims = 768;
    // Three unit-length probes at cosines 1, 0.6 and -0.28 to the first.
    const probes = [
      [1, 0],
      [0.6, 0.8],
      [-0.28, 0.96],
    ];
    const data = new Float32Array(probes.length * dims);
    probes.forEach(([x, y], i) => {
      data[i * dims] = x * 3;
      data[i * dims + 1] = y * 3;
    });
    const out = await session.run({ input: new ort.Tensor('float32', data, [probes.length, dims]) });
    const diff = out[session.outputNames[0]].data as Float32Array;
    const a = diff[1] + (diff[1] - diff[0]) * (0.6 / 0.4);
    const b = (diff[1] - diff[0]) / 0.4;
    if (Math.abs(a - b * -0.28 - diff[2]) > 1e-4) throw new Error('CCIP metric model is not the expected form');
    return { a, b };
  } finally {
    await session.release();
  }
}

export async function loadCcipParams(): Promise<CcipParams> {
  const cluster = readJson('ccip_cluster.json').dbscan_2 as { min_samples: number };
  const { a, b } = await calibrateMetric();
  return {
    detectThreshold: readJson('detector_threshold.json').threshold,
    minSamples: cluster.min_samples,
    diffA: a,
    diffB: b,
  };
}

export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  score: number;
}

/** imgutils' _yolo_nms, including its +1 pixel area convention. */
export function nms(boxes: PixelBox[], iouThreshold: number): PixelBox[] {
  const order = [...boxes].sort((a, b) => b.score - a.score);
  const area = (b: PixelBox) => (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);
  const keep: PixelBox[] = [];
  while (order.length) {
    const best = order.shift()!;
    keep.push(best);
    for (let i = order.length - 1; i >= 0; i--) {
      const o = order[i];
      const w = Math.max(0, Math.min(best.x1, o.x1) - Math.max(best.x0, o.x0) + 1);
      const h = Math.max(0, Math.min(best.y1, o.y1) - Math.max(best.y0, o.y0) + 1);
      const inter = w * h;
      if (inter / (area(best) + area(o) - inter) > iouThreshold) order.splice(i, 1);
    }
  }
  return keep;
}

/**
 * Boxes from a YOLOv8 output laid out [4 + classes, anchors] (cx, cy, w, h, class scores), in
 * the coordinates of a `width` x `height` image the model saw stretched to DETECT_SIZE square.
 */
export function decodeYolo(
  output: Float32Array,
  rows: number,
  anchors: number,
  threshold: number,
  width: number,
  height: number,
): PixelBox[] {
  const found: PixelBox[] = [];
  for (let j = 0; j < anchors; j++) {
    let score = 0;
    for (let r = 4; r < rows; r++) score = Math.max(score, output[r * anchors + j]);
    if (score <= threshold) continue;
    const cx = output[j];
    const cy = output[anchors + j];
    const w = output[2 * anchors + j];
    const h = output[3 * anchors + j];
    found.push({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2, score });
  }
  const sx = width / DETECT_SIZE;
  const sy = height / DETECT_SIZE;
  const clip = (v: number, max: number) => Math.round(Math.min(Math.max(v, 0), max));
  return nms(found, DETECT_IOU).map((b) => ({
    x0: clip(b.x0 * sx, width),
    y0: clip(b.y0 * sy, height),
    x1: clip(b.x1 * sx, width),
    y1: clip(b.y1 * sy, height),
    score: b.score,
  }));
}

interface Decoded {
  data: Buffer;
  width: number;
  height: number;
}

async function decode(imagePath: string): Promise<Decoded> {
  const { data, info } = await sharp(imagePath, { animated: false })
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(MAX_DECODE, MAX_DECODE, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const rawInput = (img: Decoded) => sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } });

/** HWC uint8 to CHW float, per channel (v / 255 - mean) / std. */
function toChw(raw: Buffer, size: number, mean = [0, 0, 0], std = [1, 1, 1], out?: Float32Array, offset = 0) {
  const pixels = size * size;
  const data = out ?? new Float32Array(pixels * 3);
  for (let c = 0; c < 3; c++) {
    const base = offset + c * pixels;
    for (let i = 0; i < pixels; i++) data[base + i] = (raw[i * 3 + c] / 255 - mean[c]) / std[c];
  }
  return data;
}

export interface DetectedCharacter {
  /** Normalized to the image's displayed (EXIF-rotated) size, 0-1. */
  bbox: { x: number; y: number; w: number; h: number };
  score: number;
  /** The raw CCIP feature, 768 values. */
  embedding: Float32Array;
}

export async function detectCharacters(imagePath: string, params: CcipParams): Promise<DetectedCharacter[]> {
  const ort = await import('onnxruntime-node');
  const img = await decode(imagePath);
  const square = await rawInput(img)
    .resize(DETECT_SIZE, DETECT_SIZE, { fit: 'fill', kernel: 'cubic' })
    .raw()
    .toBuffer();
  const boxes = await detector.use(async (session) => {
    const input = new ort.Tensor('float32', toChw(square, DETECT_SIZE), [1, 3, DETECT_SIZE, DETECT_SIZE]);
    const out = (await session.run({ [session.inputNames[0]]: input }))[session.outputNames[0]];
    const [, rows, anchors] = out.dims as number[];
    return decodeYolo(out.data as Float32Array, rows, anchors, params.detectThreshold, img.width, img.height);
  });
  const kept = boxes.filter((b) => b.x1 - b.x0 >= MIN_BOX_PX && b.y1 - b.y0 >= MIN_BOX_PX).slice(0, MAX_DETECTIONS);
  if (!kept.length) return [];

  const crops = await Promise.all(
    kept.map((b) =>
      rawInput(img)
        .extract({ left: b.x0, top: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 })
        .resize(CCIP_SIZE, CCIP_SIZE, { fit: 'fill', kernel: 'linear' })
        .raw()
        .toBuffer(),
    ),
  );
  const embeddings: Float32Array[] = [];
  const per = CCIP_SIZE * CCIP_SIZE * 3;
  for (let start = 0; start < crops.length; start += CCIP_BATCH) {
    const batch = crops.slice(start, start + CCIP_BATCH);
    const input = new Float32Array(batch.length * per);
    batch.forEach((raw, i) => toChw(raw, CCIP_SIZE, CCIP_MEAN, CCIP_STD, input, i * per));
    const features = await ccip.use(async (session) => {
      const tensor = new ort.Tensor('float32', input, [batch.length, 3, CCIP_SIZE, CCIP_SIZE]);
      return (await session.run({ [session.inputNames[0]]: tensor }))[session.outputNames[0]].data as Float32Array;
    });
    const dims = features.length / batch.length;
    for (let i = 0; i < batch.length; i++) embeddings.push(features.slice(i * dims, (i + 1) * dims));
  }
  return kept.map((b, i) => ({
    bbox: {
      x: b.x0 / img.width,
      y: b.y0 / img.height,
      w: (b.x1 - b.x0) / img.width,
      h: (b.y1 - b.y0) / img.height,
    },
    score: b.score,
    embedding: embeddings[i],
  }));
}

export function enqueueCharacterModelDownload() {
  if (downloading) throw new Error('Character model download already in progress');
  downloading = true;
  return enqueueJob('model-download', 'Download character models', async (job: JobHandle) => {
    try {
      const total = CHARACTER_MODEL_FILES.reduce((sum, f) => sum + f.approxBytes, 0);
      let before = 0;
      job.update({ total: 100, progress: 0, log: 'Downloading character models…' });
      for (const f of CHARACTER_MODEL_FILES) {
        if (fs.existsSync(modelPath(f.file))) {
          before += f.approxBytes;
          continue;
        }
        let lastPct = -1;
        await downloadFile(f.url, modelPath(f.file), (received) => {
          const pct = Math.min(99, Math.round(((before + received) / total) * 100));
          if (pct === lastPct) return;
          lastPct = pct;
          job.update({ progress: pct, log: `Downloading ${f.file}: ${(received / 1e6).toFixed(0)} MB` });
        });
        before += f.approxBytes;
      }
      releaseCharacterModels();
      return 'Character models downloaded and ready.';
    } finally {
      downloading = false;
    }
  });
}
