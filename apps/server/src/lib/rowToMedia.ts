import type { Media } from '@sakuya/shared';

/** Maps a raw sqlite media row (snake_case, joined columns) to the shared Media shape. */
export function rowToMedia(row: any): Media {
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
    liked: !!row.liked,
    likedAt: row.liked_at ?? null,
    perceptualHash: row.perceptual_hash ?? null,
    tagCount: row.tag_count ?? 0,
    libraryName: row.library_name ?? undefined,
  };
}
