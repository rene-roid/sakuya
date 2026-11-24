import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { DEFAULT_MODEL_ID } from './config';

export const DEFAULTS: Record<string, string> = {
  ai_tagging_enabled: '1',
  // Percent. The original single threshold, now the general one; characters get their own, much
  // stricter one because a wrong character name is worse than a missing one.
  confidence_threshold: '35',
  confidence_threshold_character: '85',
  accent_color: '#8b5cf6',
  remember_mute_state: '0',
  remember_volume_level: '1',
  continue_where_left: '1',
  thumbnail_cache_enabled: '1',
  board_remember_filters: '1',
  tagger_model: DEFAULT_MODEL_ID,
  downloader_concurrency: '2',
  gifs_as_videos: '0',
  video_transcode_enabled: '0',
  // Off until switched on in Settings. Engagement tracking runs regardless, so the taste profile
  // is already warm the first time it's turned on.
  discover_enabled: '0',
  // 'classic' (the original look) or 'glass' (Liquid Glass). Classic by default, so an update
  // doesn't restyle anyone's install out from under them.
  ui_style: 'classic',
  // '1' once the one-time "pick your look" prompt has been answered. Server-wide, like ui_style.
  ui_style_chosen: '0',
  // The Liquid Glass dashboard banner; its close button turns this off.
  dashboard_hero: '1',
  // How many database backups <dataDir>/backups keeps; older ones are deleted after each backup.
  backup_keep: '7',
  // Off until switched on: the job downloads ~195 MB of models and is slow on small CPUs.
  character_detection_enabled: '0',
  // Off until switched on: search by description downloads ~155 MB and embeds every file.
  semantic_search_enabled: '0',
};

export function getSetting(key: string): string {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return row?.value ?? DEFAULTS[key] ?? '';
}

export function setSetting(key: string, value: string): void {
  db.insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .run();
}

export function getAllSettings(): Record<string, string> {
  const rows = db.select().from(schema.settings).all();
  const out: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export function aiTaggingEnabled(): boolean {
  return getSetting('ai_tagging_enabled') === '1';
}

function thresholdSetting(key: string): number {
  const raw = getSetting(key);
  const pct = raw.trim() === '' ? NaN : Number(raw);
  return (Number.isFinite(pct) ? Math.min(Math.max(pct, 0), 100) : Number(DEFAULTS[key])) / 100;
}

export interface TagThresholds {
  general: number;
  character: number;
}

/** Minimum model confidence, 0-1, per tag category. */
export function confidenceThresholds(): TagThresholds {
  return {
    general: thresholdSetting('confidence_threshold'),
    character: thresholdSetting('confidence_threshold_character'),
  };
}

export function thumbnailCacheEnabled(): boolean {
  return getSetting('thumbnail_cache_enabled') !== '0';
}

export function downloaderConcurrency(): number {
  const n = Number(getSetting('downloader_concurrency'));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 8) : 2;
}

export function gifsAsVideos(): boolean {
  return getSetting('gifs_as_videos') === '1';
}

export function videoTranscodeEnabled(): boolean {
  return getSetting('video_transcode_enabled') === '1';
}

export function backupKeep(): number {
  const n = Number(getSetting('backup_keep'));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 7;
}

export function characterDetectionEnabled(): boolean {
  return getSetting('character_detection_enabled') === '1';
}

export function semanticSearchEnabled(): boolean {
  return getSetting('semantic_search_enabled') === '1';
}
