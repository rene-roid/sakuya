import { eq } from 'drizzle-orm';
import { db, schema } from '../db';

const DEFAULTS: Record<string, string> = {
  ai_tagging_enabled: '1',
  confidence_threshold: '35',
  accent_color: '#8b5cf6',
  model_status: 'absent',
  remember_mute_state: '0',
  remember_volume_level: '1',
  autosearch_first_tag: '1',
  continue_where_left: '1',
  thumbnail_cache_enabled: '1',
  board_remember_filters: '1',
  tagger_model: 'wd-swinv2-tagger-v3',
  downloader_concurrency: '2',
  gifs_as_videos: '0',
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

export function confidenceThreshold(): number {
  const pct = Number(getSetting('confidence_threshold'));
  return Number.isFinite(pct) ? Math.min(Math.max(pct, 0), 100) / 100 : 0.35;
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
