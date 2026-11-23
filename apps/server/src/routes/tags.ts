import { Router } from 'express';
import { z } from 'zod';
import { sqlite } from '../db';
import { wrap } from '../lib/http';
import { tagLinksVersion } from '../services/tagger';
import { normalizeTagName, type TagCount, type TagInfo } from '@sakuya/shared';

export const tagsRouter = Router();

/**
 * LIKE pattern matching `q` as a literal substring. Unescaped, `_` is a single-character wildcard,
 * and it appears in most tag names: searching "long_h" also matched "longXh…".
 */
function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
}

/**
 * Per-library tag counts, ordered as autocomplete shows them, keyed by the tag-links version they
 * were counted at. Counting every link in a library costs a few hundred ms on a 34k-item library
 * and only changes when a media gains or loses a tag, so each keystroke reuses it. Tag names and
 * categories are not cached; they are filtered live against the tags table.
 */
const countsByLibrary = new Map<number, { id: number; count: number }[]>();
let countedAtVersion = -1;

function countsForLibrary(libraryId: number): { id: number; count: number }[] {
  if (countedAtVersion !== tagLinksVersion()) {
    countsByLibrary.clear();
    countedAtVersion = tagLinksVersion();
  }
  let counts = countsByLibrary.get(libraryId);
  if (!counts) {
    counts = sqlite
      .query(
        // Counted before joining tags: carrying the tag row through the GROUP BY cost ~30% more.
        `WITH counts AS (
           SELECT mt.tag_id AS id, COUNT(*) AS count
           FROM media m JOIN media_tags mt ON mt.media_id = m.id
           WHERE m.library_id = ?
           GROUP BY mt.tag_id
         )
         SELECT counts.id, counts.count FROM counts JOIN tags t ON t.id = counts.id
         ORDER BY counts.count DESC, t.name`,
      )
      .all(libraryId) as { id: number; count: number }[];
    countsByLibrary.set(libraryId, counts);
  }
  return counts;
}

const querySchema = z.object({
  q: z.string().optional(),
  libraryId: z.coerce.number().int().optional(),
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

tagsRouter.get(
  '/api/tags',
  wrap(async (req, res) => {
    const { q, libraryId, category, limit } = querySchema.parse(req.query);
    const categories = category ? category.split(',') : undefined;
    // Ratings are a small, fixed set — return all of them rather than truncating to `limit`.
    const applyLimit = categories?.length !== 1 || categories[0] !== 'rating';
    const filters = `${q ? "AND (t.name LIKE ? ESCAPE '\\' OR t.display_name LIKE ? ESCAPE '\\')" : ''} ${categories ? `AND t.category IN (${categories.map(() => '?').join(',')})` : ''}`;
    const params = [...(q ? [likeContains(q), likeContains(q)] : []), ...(categories ?? [])];

    let rows: TagCount[];
    if (libraryId !== undefined) {
      const tags = sqlite
        .query(`SELECT t.id, t.name, t.category, t.display_name AS displayName FROM tags t WHERE 1 ${filters}`)
        .all(...params) as (Omit<TagCount, 'count'> & { id: number })[];
      const matching = new Map(tags.map((t) => [t.id, t]));
      rows = [];
      for (const { id, count } of countsForLibrary(libraryId)) {
        const tag = matching.get(id);
        if (!tag) continue;
        rows.push({ name: tag.name, category: tag.category, displayName: tag.displayName, count });
        if (applyLimit && rows.length === limit) break;
      }
    } else {
      // Unscoped counts are the cached usage_count, which keeps autocomplete off a full media_tags
      // aggregate.
      rows = sqlite
        .query(
          `SELECT t.name, t.category, t.display_name AS displayName, t.usage_count AS count FROM tags t
           WHERE t.usage_count > 0 ${filters}
           ORDER BY t.usage_count DESC, t.name ${applyLimit ? 'LIMIT ?' : ''}`,
        )
        .all(...params, ...(applyLimit ? [limit] : [])) as TagCount[];
    }
    res.json(rows);
  }),
);

const TAG_INFO_SELECT = 'SELECT name, category, display_name AS displayName FROM tags';

const infoSchema = z.object({ names: z.string().default('') });

/** Category and display name for tags known only by name: filter chips, Discover reasons. */
tagsRouter.get(
  '/api/tags/info',
  wrap(async (req, res) => {
    const names = [...new Set(infoSchema.parse(req.query).names.split(',').map(normalizeTagName).filter(Boolean))];
    if (!names.length) return res.json([]);
    if (names.length > 200) return res.status(400).json({ error: 'At most 200 names per request' });
    const rows = sqlite
      .query(`${TAG_INFO_SELECT} WHERE name IN (${names.map(() => '?').join(',')})`)
      .all(...names) as TagInfo[];
    res.json(rows);
  }),
);

const displayNameSchema = z.object({ displayName: z.string().max(100).nullable() });

tagsRouter.patch(
  '/api/tags/:name',
  wrap(async (req, res) => {
    const name = normalizeTagName(req.params.name);
    const tag = sqlite.query('SELECT id FROM tags WHERE name = ?').get(name) as { id: number } | null;
    if (!tag) return res.status(404).json({ error: 'Tag not found' });
    const displayName = displayNameSchema.parse(req.body).displayName?.trim().replace(/\s+/g, ' ') || null;
    if (displayName) {
      // Two tags that read the same on screen could no longer be told apart in a list.
      const clash = sqlite
        .query(
          `SELECT name, display_name AS displayName FROM tags
           WHERE id != ? AND (display_name = ? COLLATE NOCASE OR name = ?) LIMIT 1`,
        )
        .get(tag.id, displayName, normalizeTagName(displayName)) as { name: string; displayName: string | null } | null;
      if (clash) {
        return res.status(409).json({
          error:
            clash.displayName?.toLowerCase() === displayName.toLowerCase()
              ? `"${clash.name}" is already shown as "${clash.displayName}"`
              : `"${displayName}" is the name of another tag`,
        });
      }
    }
    sqlite.query('UPDATE tags SET display_name = ? WHERE id = ?').run(displayName, tag.id);
    res.json(sqlite.query(`${TAG_INFO_SELECT} WHERE id = ?`).get(tag.id) as TagInfo);
  }),
);
