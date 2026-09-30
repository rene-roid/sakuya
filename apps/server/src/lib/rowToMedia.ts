import type { Media } from '@sakuya/shared';

/**
 * A media row joined with its library name and tag count — the shape rowToMedia expects. Append
 * WHERE/ORDER BY; the media table is aliased `m`.
 */
export const MEDIA_SELECT = `
  SELECT m.*, l.name AS library_name,
         (SELECT COUNT(*) FROM media_tags mt WHERE mt.media_id = m.id) AS tag_count
  FROM media m LEFT JOIN libraries l ON l.id = m.library_id`;

/** A raw sqlite media row: snake_case columns plus the joined ones some queries add. */
export interface MediaSqlRow {
  id: number;
  library_id: number;
  source: Media['source'];
  path: string;
  filename: string;
  type: Media['type'];
  width: number | null;
  height: number | null;
  size_bytes: number;
  duration_seconds: number | null;
  content_hash: string | null;
  created_at: number;
  indexed_at: number | null;
  tagged_at: number | null;
  last_viewed_at: number | null;
  view_progress: number;
  view_count: number;
  watched_seconds: number;
  dwell_seconds: number;
  liked: number;
  liked_at: number | null;
  perceptual_hash: string | null;
  tag_count?: number;
  library_name?: string | null;
  sort_key?: number | string;
  reason_tag?: string | null;
  reason_related?: number | null;
}

/** Maps a raw sqlite media row (snake_case, joined columns) to the shared Media shape. */
export function rowToMedia(row: MediaSqlRow): Media {
  return {
    id: row.id,
    libraryId: row.library_id,
    source: row.source,
    path: row.path,
    filename: row.filename,
    type: row.type,
    width: row.width,
    height: row.height,
    sizeBytes: row.size_bytes,
    durationSeconds: row.duration_seconds,
    createdAt: row.created_at,
    indexedAt: row.indexed_at,
    taggedAt: row.tagged_at,
    lastViewedAt: row.last_viewed_at,
    viewProgress: row.view_progress,
    viewCount: row.view_count ?? 0,
    watchedSeconds: row.watched_seconds ?? 0,
    dwellSeconds: row.dwell_seconds ?? 0,
    liked: !!row.liked,
    likedAt: row.liked_at ?? null,
    perceptualHash: row.perceptual_hash ?? null,
    tagCount: row.tag_count ?? 0,
    libraryName: row.library_name ?? undefined,
    reasonTag: row.reason_tag ?? undefined,
    reasonRelated: row.reason_related ? true : undefined,
  };
}
