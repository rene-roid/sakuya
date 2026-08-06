import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { sqlite, db, schema } from '../db';
import { THUMBS_DIR } from '../lib/config';
import { thumbPathFor } from './thumbnailer';
import { enqueueJob, type JobHandle } from './jobQueue';

export function performCleanup(): { removedThumbs: number; resetTagCounts: number } {
  let removedThumbs = 0;
  if (fs.existsSync(THUMBS_DIR)) {
    for (const entry of fs.readdirSync(THUMBS_DIR)) {
      const match = entry.match(/^(\d+)\.webp$/);
      if (match) {
        const mediaId = Number(match[1]);
        const exists = db
          .select({ id: schema.media.id })
          .from(schema.media)
          .where(eq(schema.media.id, mediaId))
          .get();
        if (!exists) {
          fs.rmSync(thumbPathFor(mediaId), { force: true });
          removedThumbs++;
        }
      }
    }
  }

  const allTagIds = db.select({ id: schema.tags.id }).from(schema.tags).all().map((r) => r.id);
  let resetTagCounts = 0;
  if (allTagIds.length > 0) {
    const placeholders = allTagIds.map(() => '?').join(',');
    sqlite
      .query(
        `UPDATE tags SET usage_count = (SELECT COUNT(*) FROM media_tags WHERE media_tags.tag_id = tags.id) WHERE id IN (${placeholders})`,
      )
      .run(...allTagIds);
    resetTagCounts = allTagIds.length;
  }

  return { removedThumbs, resetTagCounts };
}

export function enqueueCleanupJob() {
  return enqueueJob(
    'cleanup',
    'Cleanup orphan data',
    async (job: JobHandle) => {
      job.update({ log: 'Cleaning up orphan thumbnails and tag counts…' });
      const result = performCleanup();
      return `Removed ${result.removedThumbs} orphan thumbnails, recomputed usage count for ${result.resetTagCounts} tags.`;
    },
    null,
  );
}
