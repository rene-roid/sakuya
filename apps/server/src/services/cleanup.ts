import fs from 'node:fs';
import { sqlite, db, schema } from '../db';
import { THUMBS_DIR, TRANSCODES_DIR } from '../lib/config';
import { thumbPathFor } from './thumbnailer';
import { transcodePathFor } from './transcoder';
import { enqueueJob, type JobHandle } from './jobQueue';

/**
 * How long finished jobs and the logs of finished downloads are kept.
 *
 * Retention is by age rather than "everything that finished": /api/downloader/items/:id/logs
 * still serves the logs of completed items, so dropping them the moment an item finishes would
 * delete history the UI can display. Two weeks keeps recent runs inspectable while stopping
 * these two append-only tables from growing without limit.
 */
const RETENTION_DAYS = 14;
const RETENTION_MS = RETENTION_DAYS * 86_400_000;

export interface CleanupResult {
  removedThumbs: number;
  removedTranscodes: number;
  resetTagCounts: number;
  prunedJobs: number;
  prunedDownloadLogs: number;
}

export function performCleanup(now: number = Date.now()): CleanupResult {
  const cutoff = now - RETENTION_MS;

  // Every media id once, rather than a SELECT per file on disk. A thumbnail directory holds one
  // entry per media row, so the per-file query made this scale quadratically with library size.
  const liveIds = new Set(db.select({ id: schema.media.id }).from(schema.media).all().map((r) => r.id));

  let removedThumbs = 0;
  if (fs.existsSync(THUMBS_DIR)) {
    for (const entry of fs.readdirSync(THUMBS_DIR)) {
      const match = entry.match(/^(\d+)\.webp$/);
      if (!match) continue;
      const mediaId = Number(match[1]);
      if (liveIds.has(mediaId)) continue;
      fs.rmSync(thumbPathFor(mediaId), { force: true });
      removedThumbs++;
    }
  }

  // Transcodes are the same one-file-per-media-id layout, and far larger; an orphan here is often
  // hundreds of megabytes.
  let removedTranscodes = 0;
  if (fs.existsSync(TRANSCODES_DIR)) {
    for (const entry of fs.readdirSync(TRANSCODES_DIR)) {
      const match = entry.match(/^(\d+)\.mp4$/);
      if (!match) continue;
      const mediaId = Number(match[1]);
      if (liveIds.has(mediaId)) continue;
      fs.rmSync(transcodePathFor(mediaId), { force: true });
      removedTranscodes++;
    }
  }

  // Recompute every tag's usage_count. This used to bind one parameter per tag for an
  // `WHERE id IN (...)` listing every id in the table — equivalent to no WHERE at all, and on a
  // course to hit SQLite's 32766 parameter ceiling as the tag vocabulary grew.
  const resetTagCounts = sqlite
    .query(`UPDATE tags SET usage_count = (SELECT COUNT(*) FROM media_tags WHERE media_tags.tag_id = tags.id)`)
    .run().changes;

  const prunedJobs = sqlite
    .query(`DELETE FROM jobs WHERE status IN ('done', 'error') AND created_at < ?`)
    .run(cutoff).changes;

  // Logs are pruned by when their parent item finished, so a long-running download keeps its
  // whole log no matter how long it has been going.
  const prunedDownloadLogs = sqlite
    .query(
      `DELETE FROM download_logs WHERE item_id IN (
         SELECT id FROM download_items
         WHERE status IN ('done', 'error', 'skipped') AND updated_at < ?
       )`,
    )
    .run(cutoff).changes;

  return { removedThumbs, removedTranscodes, resetTagCounts, prunedJobs, prunedDownloadLogs };
}

export function enqueueCleanupJob() {
  return enqueueJob(
    'cleanup',
    'Cleanup orphan data',
    async (job: JobHandle) => {
      job.update({ log: 'Cleaning up orphan thumbnails, transcodes, tag counts and old history…' });
      const result = performCleanup();
      return (
        `Removed ${result.removedThumbs} orphan thumbnails and ${result.removedTranscodes} orphan transcodes, ` +
        `recomputed usage count for ${result.resetTagCounts} tags, ` +
        `pruned ${result.prunedJobs} finished jobs and ${result.prunedDownloadLogs} download log lines ` +
        `older than ${RETENTION_DAYS} days.`
      );
    },
    null,
  );
}
