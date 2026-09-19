import { inArray } from 'drizzle-orm';
import { db, schema } from '../db';

export type MediaRow = typeof schema.media.$inferSelect;

/**
 * SQLite's bound-parameter ceiling (SQLITE_MAX_VARIABLE_NUMBER) is 32766. The bulk routes cap a
 * selection at 5000 ids so a single IN list would fit today, but delete-batch has no cap at all
 * and the limit is the kind of thing that only bites in production. Chunking removes the ceiling
 * as a concern and keeps each statement small enough for SQLite to plan well.
 */
export const ID_CHUNK = 900;

export function chunkIds<T>(items: T[], size: number = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Load media rows for an id list with one query per chunk instead of one query per id.
 *
 * Ids with no row are simply absent from the map. Callers rely on that to report the per-item
 * `{ id, error: 'Not found' }` failures the bulk endpoints promise, so a missing id must stay a
 * per-item outcome rather than failing the whole call.
 */
export function mediaRowsByIds(ids: number[]): Map<number, MediaRow> {
  const byId = new Map<number, MediaRow>();
  for (const part of chunkIds(ids)) {
    for (const row of db.select().from(schema.media).where(inArray(schema.media.id, part)).all()) {
      byId.set(row.id, row);
    }
  }
  return byId;
}
