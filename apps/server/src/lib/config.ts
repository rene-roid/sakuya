import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const serverRoot = path.resolve(import.meta.dir, '..', '..');

export const HOME_DATA_DIR = path.join(os.homedir(), '.sakuya');
export const LOCAL_DATA_DIR = path.join(serverRoot, 'data');

/**
 * Where the data lives is not a stored setting — it can't be, since the settings table lives in the
 * DB we're trying to find. The folder's existence *is* the state: setup.sh or the Settings > System
 * migrate button creates ~/.sakuya, and from then on every start finds it.
 */
export function resolveDataDir(): string {
  if (process.env.SAKUYA_DATA_DIR) return process.env.SAKUYA_DATA_DIR;
  return fs.existsSync(HOME_DATA_DIR) ? HOME_DATA_DIR : LOCAL_DATA_DIR;
}

export const DATA_DIR = resolveDataDir();
export const DB_PATH = path.join(DATA_DIR, 'tbge.db');
export const THUMBS_DIR = path.join(DATA_DIR, 'thumbnails');
export const TRANSCODES_DIR = path.join(DATA_DIR, 'transcodes');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const MODELS_DIR = path.join(DATA_DIR, 'models');
export const MODEL_PATH = path.join(MODELS_DIR, 'model.onnx');
export const MODEL_TAGS_PATH = path.join(MODELS_DIR, 'selected_tags.csv');
export const DOWNLOADER_DIR = path.join(DATA_DIR, 'downloader');
export const DOWNLOADER_BIN_DIR = path.join(DOWNLOADER_DIR, 'bin');
export const DOWNLOADER_COOKIES_DIR = path.join(DOWNLOADER_DIR, 'cookies');

export const PORT = Number(process.env.PORT ?? 3777);

/**
 * Interface to bind. Defaults to loopback: the server exposes the whole library and
 * POST /api/media/:id/reveal, which spawns a file manager on the host, and AUTH_ENABLED is off by
 * default — none of that should be reachable from the LAN because someone started the server.
 *
 * Containers must bind 0.0.0.0 or published ports never reach the process, so the Dockerfile and
 * docker-compose.yml both set SAKUYA_HOST=0.0.0.0. Set it yourself to serve other machines
 * directly, ideally with AUTH_ENABLED=true.
 */
export const HOST = process.env.SAKUYA_HOST ?? '127.0.0.1';

/**
 * Marks the auth cookie Secure. Off by default because serving plain HTTP over a LAN is a
 * supported setup, and a Secure cookie is silently dropped there, which would lock users out.
 */
export const AUTH_COOKIE_SECURE = process.env.SAKUYA_HTTPS === 'true';
/**
 * The root package.json is the one source of truth for the app version: Settings > System reads
 * this, and the bundled release notes in apps/web/src/releases drive the update toast. They used
 * to disagree three ways (0.1.0 / 1.0.0 / 1.4.0); version.test.ts now keeps them in step.
 *
 * Read at runtime rather than imported so the value survives outside the workspace layout. The
 * Docker image copies the root package.json into /app, one level above apps/server, so this
 * resolves there too.
 */
function readAppVersion(): string {
  try {
    const raw = fs.readFileSync(path.resolve(serverRoot, '..', '..', 'package.json'), 'utf8');
    const version = JSON.parse(raw).version;
    if (typeof version === 'string' && version) return version;
  } catch {
    // A stripped-down install shouldn't fail to boot just because it can't name itself.
  }
  return 'unknown';
}

export const APP_VERSION = readAppVersion();

export const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';
export const AUTH_SECRET = process.env.AUTH_SECRET ?? '';
if (AUTH_ENABLED && !AUTH_SECRET) {
  throw new Error('AUTH_SECRET is not set. Set it before enabling AUTH_ENABLED.');
}

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

if (!process.env.SAKUYA_DATA_DIR && DATA_DIR !== LOCAL_DATA_DIR && fs.existsSync(path.join(LOCAL_DATA_DIR, 'tbge.db'))) {
  console.warn(`[sakuya] using ${DATA_DIR} — the database still sitting in ${LOCAL_DATA_DIR} is ignored`);
}

for (const dir of [DATA_DIR, THUMBS_DIR, TRANSCODES_DIR, UPLOADS_DIR, MODELS_DIR, DOWNLOADER_BIN_DIR, DOWNLOADER_COOKIES_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}
