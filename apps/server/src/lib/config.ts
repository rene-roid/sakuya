import path from 'node:path';
import fs from 'node:fs';

const serverRoot = path.resolve(import.meta.dir, '..', '..');

export const DATA_DIR = process.env.SAKUYA_DATA_DIR ?? path.join(serverRoot, 'data');
export const DB_PATH = path.join(DATA_DIR, 'tbge.db');
export const THUMBS_DIR = path.join(DATA_DIR, 'thumbnails');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const MODELS_DIR = path.join(DATA_DIR, 'models');
export const MODEL_PATH = path.join(MODELS_DIR, 'model.onnx');
export const MODEL_TAGS_PATH = path.join(MODELS_DIR, 'selected_tags.csv');
export const DOWNLOADER_DIR = path.join(DATA_DIR, 'downloader');
export const DOWNLOADER_BIN_DIR = path.join(DOWNLOADER_DIR, 'bin');
export const DOWNLOADER_COOKIES_DIR = path.join(DOWNLOADER_DIR, 'cookies');

export const PORT = Number(process.env.PORT ?? 3777);
export const APP_VERSION = '0.1.0';

// Curated WD v3 taggers — all share 448px input + the same selected_tags.csv format,
// so they are drop-in compatible with the existing preprocessing/inference code.
export interface TaggerModelDef {
  id: string;
  label: string;
  repo: string;
}

export const MODEL_REGISTRY: TaggerModelDef[] = [
  { id: 'wd-swinv2-tagger-v3', label: 'WD SwinV2 v3 (default)', repo: 'SmilingWolf/wd-swinv2-tagger-v3' },
  { id: 'wd-convnext-tagger-v3', label: 'WD ConvNeXT v3', repo: 'SmilingWolf/wd-convnext-tagger-v3' },
  { id: 'wd-vit-tagger-v3', label: 'WD ViT v3', repo: 'SmilingWolf/wd-vit-tagger-v3' },
  { id: 'wd-vit-large-tagger-v3', label: 'WD ViT Large v3', repo: 'SmilingWolf/wd-vit-large-tagger-v3' },
  { id: 'wd-eva02-large-tagger-v3', label: 'WD EVA02 Large v3', repo: 'SmilingWolf/wd-eva02-large-tagger-v3' },
];

export const DEFAULT_MODEL_ID = 'wd-swinv2-tagger-v3';

export function modelRepoBase(id: string): string {
  const def = MODEL_REGISTRY.find((m) => m.id === id) ?? MODEL_REGISTRY[0];
  return `https://huggingface.co/${def.repo}/resolve/main`;
}

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp', '.tiff']);
export const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v', '.ts', '.wmv']);

for (const dir of [DATA_DIR, THUMBS_DIR, UPLOADS_DIR, MODELS_DIR, DOWNLOADER_BIN_DIR, DOWNLOADER_COOKIES_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}
