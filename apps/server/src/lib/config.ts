import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { loadConfig } from '@sakuya/shared/config';
import { detectCgroupMemoryLimit, detectCpuQuota, effectiveCpus, resolveLimits, type LimitsReport } from './limits';
import { currentJobMemoryLimit } from './windowsJob';
import type { TaggerModel } from '@sakuya/shared';
import pkg from '../../../../package.json' with { type: 'json' };

const serverRoot = path.resolve(import.meta.dir, '..', '..');

// Everything below comes from sakuya.config.json (see packages/shared/src/config.ts). Created with
// the defaults on first start, migrating any old .env, so a fresh checkout still needs no setup.
const loaded = loadConfig({ create: true });
if (loaded.created) console.log(`[sakuya] ${loaded.created}`);
for (const warning of loaded.warnings) console.warn(`[sakuya] ${warning}`);

export const CONFIG = loaded.config;
export const CONFIG_FILE = loaded.file;

export const HOME_DATA_DIR = path.join(os.homedir(), '.sakuya');
export const LOCAL_DATA_DIR = path.join(serverRoot, 'data');

/** server.dataDir is set (or Docker pinned it), so the in-app move is disabled. */
export const DATA_DIR_PINNED = CONFIG.server.dataDir !== null;

/**
 * Unless server.dataDir pins it, where the data lives is not a stored setting — it can't be, since
 * the settings table lives in the DB we're trying to find. The folder's existence *is* the state:
 * setup.sh or the Settings > System migrate button creates ~/.sakuya, and from then on every start
 * finds it.
 */
function resolveDataDir(): string {
  if (CONFIG.server.dataDir) return CONFIG.server.dataDir;
  return fs.existsSync(HOME_DATA_DIR) ? HOME_DATA_DIR : LOCAL_DATA_DIR;
}

export const DATA_DIR = resolveDataDir();
export const DB_PATH = path.join(DATA_DIR, 'tbge.db');
export const THUMBS_DIR = path.join(DATA_DIR, 'thumbnails');
export const TRANSCODES_DIR = path.join(DATA_DIR, 'transcodes');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const MODELS_DIR = path.join(DATA_DIR, 'models');
export const MODEL_PATH = path.join(MODELS_DIR, 'model.onnx');
export const MODEL_TAGS_PATH = path.join(MODELS_DIR, 'selected_tags.csv');
export const CHARACTER_MODELS_DIR = path.join(MODELS_DIR, 'characters');
export const CHARACTER_CROPS_DIR = path.join(DATA_DIR, 'character-crops');
export const CLIP_MODELS_DIR = path.join(MODELS_DIR, 'clip');
export const DOWNLOADER_DIR = path.join(DATA_DIR, 'downloader');
export const DOWNLOADER_BIN_DIR = path.join(DOWNLOADER_DIR, 'bin');
export const DOWNLOADER_COOKIES_DIR = path.join(DOWNLOADER_DIR, 'cookies');

/**
 * The root package.json is the one source of truth for the app version: Settings > System reads
 * this, and the bundled release notes in apps/web/src/releases drive the update toast. They used
 * to disagree three ways (0.1.0 / 1.0.0 / 1.4.0); version.test.ts now keeps them in step.
 *
 * The Docker image copies the root package.json into /app, one level above apps/server, so this
 * import resolves there too.
 */
export const APP_VERSION: string = pkg.version;

if (CONFIG.auth.enabled && !CONFIG.auth.secret) {
  throw new Error(`auth.enabled is true but auth.secret is empty in ${CONFIG_FILE}. Set a password there.`);
}

const cpu = effectiveCpus(CONFIG.limits.cpus, detectCpuQuota());

/** Job concurrency and native thread pools, sized from the CPU budget. See lib/limits.ts. */
export const LIMITS = resolveLimits(cpu?.cpus ?? null);

export const LIMITS_REPORT: LimitsReport = {
  limits: LIMITS,
  cpuSource: cpu?.source ?? null,
  configuredMemory: CONFIG.limits.memory,
  enforcedMemory: process.platform === 'win32' ? currentJobMemoryLimit() : detectCgroupMemoryLimit(),
};

// Curated WD v3 taggers — all share 448px input + the same selected_tags.csv format,
// so they are drop-in compatible with the existing preprocessing/inference code.
export const MODEL_REGISTRY: TaggerModel[] = [
  { id: 'wd-swinv2-tagger-v3', label: 'WD SwinV2 v3 (default)', repo: 'SmilingWolf/wd-swinv2-tagger-v3' },
  { id: 'wd-convnext-tagger-v3', label: 'WD ConvNeXT v3', repo: 'SmilingWolf/wd-convnext-tagger-v3' },
  { id: 'wd-vit-tagger-v3', label: 'WD ViT v3', repo: 'SmilingWolf/wd-vit-tagger-v3' },
  { id: 'wd-vit-large-tagger-v3', label: 'WD ViT Large v3', repo: 'SmilingWolf/wd-vit-large-tagger-v3' },
  { id: 'wd-eva02-large-tagger-v3', label: 'WD EVA02 Large v3', repo: 'SmilingWolf/wd-eva02-large-tagger-v3' },
];

export const DEFAULT_MODEL_ID = MODEL_REGISTRY[0].id;

export function modelRepoBase(id: string): string {
  const def = MODEL_REGISTRY.find((m) => m.id === id) ?? MODEL_REGISTRY[0];
  return `https://huggingface.co/${def.repo}/resolve/main`;
}

const PERSON_DETECT = 'https://huggingface.co/deepghs/anime_person_detection/resolve/main/person_detect_v1.3_s';
const CCIP = 'https://huggingface.co/deepghs/ccip_onnx/resolve/main/ccip-caformer-24-randaug-pruned';

/**
 * Character detection: a YOLOv8 anime person detector (MIT) finds each character, and CCIP
 * (OpenRAIL) embeds the crop so the same character can be recognised across images. Downloaded
 * on request into CHARACTER_MODELS_DIR, never bundled.
 */
export const CHARACTER_MODEL_FILES = [
  { file: 'detector.onnx', url: `${PERSON_DETECT}/model.onnx`, approxBytes: 44_583_231 },
  { file: 'detector_threshold.json', url: `${PERSON_DETECT}/threshold.json`, approxBytes: 48 },
  { file: 'ccip_feat.onnx', url: `${CCIP}/model_feat.onnx`, approxBytes: 150_248_245 },
  { file: 'ccip_metrics.onnx', url: `${CCIP}/model_metrics.onnx`, approxBytes: 1_649 },
  { file: 'ccip_cluster.json', url: `${CCIP}/cluster.json`, approxBytes: 370 },
] as const;

const CLIP = 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main';

/**
 * Search by description: OpenAI CLIP ViT-B/32 (MIT), the int8 ONNX export by Xenova (Transformers.js).
 * The smallest well-known CLIP with separate image and text encoders; downloaded on request into
 * CLIP_MODELS_DIR, never bundled.
 */
export const CLIP_MODEL_ID = 'clip-vit-b32-q8';
export const CLIP_MODEL_FILES = [
  { file: 'vision.onnx', url: `${CLIP}/onnx/vision_model_quantized.onnx`, approxBytes: 89_117_001 },
  { file: 'text.onnx', url: `${CLIP}/onnx/text_model_quantized.onnx`, approxBytes: 64_504_507 },
  { file: 'vocab.json', url: `${CLIP}/vocab.json`, approxBytes: 862_328 },
  { file: 'merges.txt', url: `${CLIP}/merges.txt`, approxBytes: 524_619 },
] as const;

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp', '.tiff']);
export const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v', '.ts', '.wmv']);

if (!DATA_DIR_PINNED && DATA_DIR !== LOCAL_DATA_DIR && fs.existsSync(path.join(LOCAL_DATA_DIR, 'tbge.db'))) {
  console.warn(`[sakuya] using ${DATA_DIR} — the database still sitting in ${LOCAL_DATA_DIR} is ignored`);
}

for (const dir of [DATA_DIR, THUMBS_DIR, TRANSCODES_DIR, UPLOADS_DIR, MODELS_DIR, CHARACTER_MODELS_DIR, CHARACTER_CROPS_DIR, CLIP_MODELS_DIR, DOWNLOADER_BIN_DIR, DOWNLOADER_COOKIES_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}
