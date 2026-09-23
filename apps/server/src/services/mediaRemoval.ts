import fs from 'node:fs';
import { sqlite } from '../db';
import { chunkIds } from '../lib/mediaByIds';
import { thumbPathFor } from './thumbnailer';
import { transcodePathFor } from './transcoder';
import { refreshUsageCounts } from './tagger';

/**
 * Remove media rows and everything derived from them: tag links, board memberships (FK cascade),
 * the search index row (trigger), a library cover pointing at them, and the cached thumbnail and
 * transcode on disk. The source file itself is the caller's call — a pruned file is already gone,
 * and a folder detach must leave it alone.
 *
 * Every delete path used to hand-roll a subset of this, so tag usage counts went stale after any
 * delete (the tag sidebar kept offering tags whose only media was gone) and a scan prune leaked
 * transcodes. The whole set commits as one transaction.
 *
 * media rows go before media_tags on purpose: the media_tags delete trigger rewrites the FTS row
 * of the affected media, and once that row is gone the rewrite matches nothing instead of
 * re-concatenating the remaining tags once per deleted link.
 */
export function removeMediaRows(ids: number[]): void {
  if (!ids.length) return;
  const touchedTags = new Set<number>();
  sqlite.transaction(() => {
    for (const part of chunkIds(ids)) {
      const placeholders = part.map(() => '?').join(',');
      const tagRows = sqlite
        .query(`SELECT DISTINCT tag_id FROM media_tags WHERE media_id IN (${placeholders})`)
        .all(...part) as { tag_id: number }[];
      for (const row of tagRows) touchedTags.add(row.tag_id);
      sqlite.query(`DELETE FROM media WHERE id IN (${placeholders})`).run(...part);
      sqlite.query(`DELETE FROM media_tags WHERE media_id IN (${placeholders})`).run(...part);
      sqlite
        .query(`UPDATE libraries SET thumbnail_media_id = NULL WHERE thumbnail_media_id IN (${placeholders})`)
        .run(...part);
    }
  })();
  refreshUsageCounts([...touchedTags]);
  for (const id of ids) {
    fs.rm(thumbPathFor(id), { force: true }, () => {});
    fs.rm(transcodePathFor(id), { force: true }, () => {});
  }
}
