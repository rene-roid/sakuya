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

export const PORT = Number(process.env.PORT ?? 3777);
export const APP_VERSION = '0.1.0';

export const MODEL_REPO_BASE =
  'https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3/resolve/main';

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp', '.tiff']);
export const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v', '.ts', '.wmv']);

for (const dir of [DATA_DIR, THUMBS_DIR, UPLOADS_DIR, MODELS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}
