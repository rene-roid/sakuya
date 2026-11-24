import { Router } from 'express';
import { z } from 'zod';
import { sqlite } from '../db';
import { wrap } from '../lib/http';
import { refreshUsageCounts, tagLinksVersion } from '../services/tagger';
import { enqueueJob } from '../services/jobQueue';
import { chunkIds } from '../lib/mediaByIds';
import {
  addImplication,
  addSibling,
  listRelations,
  recomputeImplied,
  removeImplication,
  removeSibling,
  type RelationChange,
} from '../services/tagRelations';
import {
  TAG_CATEGORIES,
  normalizeTagName,
  type Job,
  type TagCount,
  type TagInfo,
  type TagRelationResult,
} from '@sakuya/shared';

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
    // A tag also matches by the old names merged into it, so typing an alias suggests its target.
    const qFilter =
      "AND (t.name LIKE ? ESCAPE '\\' OR t.display_name LIKE ? ESCAPE '\\' OR t.id IN " +
      "(SELECT s.to_tag_id FROM tag_siblings s JOIN tags a ON a.id = s.from_tag_id WHERE a.name LIKE ? ESCAPE '\\'))";
    const filters = `${q ? qFilter : ''} ${categories ? `AND t.category IN (${categories.map(() => '?').join(',')})` : ''}`;
    const params = [...(q ? [likeContains(q), likeContains(q), likeContains(q)] : []), ...(categories ?? [])];

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

/** Above this many items a relation's backfill runs as a background job instead of in the request. */
const INLINE_BACKFILL_LIMIT = 5000;

/** Bring the implied tags of the media a relation change reaches up to date, inline or as a job. */
function backfill(change: RelationChange, label: string): Job | null {
  const finish = (touched: number[]) => refreshUsageCounts([...new Set([...change.touchedTags, ...touched])]);
  if (change.mediaIds.length <= INLINE_BACKFILL_LIMIT) {
    finish(recomputeImplied(change.mediaIds, change.force));
    return null;
  }
  // Counts for the moved links are right now; the job settles the implied ones.
  refreshUsageCounts(change.touchedTags);
  return enqueueJob('tag-relations', label, async (job) => {
    const parts = chunkIds(change.mediaIds, 1000);
    job.update({ total: change.mediaIds.length, log: `Updating ${change.mediaIds.length} items…` });
    const touched = new Set<number>();
    for (let i = 0; i < parts.length; i++) {
      for (const id of recomputeImplied(parts[i], change.force)) touched.add(id);
      job.update({ progress: Math.min((i + 1) * 1000, change.mediaIds.length) });
      // Yield between chunks so requests aren't starved by one long write.
      await Bun.sleep(0);
    }
    refreshUsageCounts([...touched]);
    return `Completed. ${change.mediaIds.length} items updated.`;
  });
}

function relationResult(job: Job | null): TagRelationResult {
  return { ...listRelations(), job };
}

const tagNameField = z
  .string()
  .min(1)
  .max(200)
  .transform(normalizeTagName)
  .refine((name) => name.length > 0, 'Tag name is empty');

const siblingSchema = z.object({
  from: tagNameField,
  to: tagNameField,
  /** Category for whichever side has to be created. */
  category: z.enum(TAG_CATEGORIES).default('general'),
});

const implicationSchema = z.object({
  tag: tagNameField,
  implies: tagNameField,
  category: z.enum(TAG_CATEGORIES).default('general'),
});

tagsRouter.get(
  '/api/tag-relations',
  wrap(async (_req, res) => {
    res.json(listRelations());
  }),
);

/** Merge `from` into `to`: every item tagged `from` is tagged `to` instead, and so is every later write. */
tagsRouter.post(
  '/api/tag-relations/siblings',
  wrap(async (req, res) => {
    const { from, to, category } = siblingSchema.parse(req.body);
    res.json(relationResult(backfill(addSibling(from, to, category), `Merge ${from} into ${to}`)));
  }),
);

tagsRouter.delete(
  '/api/tag-relations/siblings/:from',
  wrap(async (req, res) => {
    removeSibling(normalizeTagName(req.params.from));
    res.json(relationResult(null));
  }),
);

tagsRouter.post(
  '/api/tag-relations/implications',
  wrap(async (req, res) => {
    const { tag, implies, category } = implicationSchema.parse(req.body);
    res.json(relationResult(backfill(addImplication(tag, implies, category), `Apply ${tag} implies ${implies}`)));
  }),
);

tagsRouter.delete(
  '/api/tag-relations/implications/:tag/:implies',
  wrap(async (req, res) => {
    const tag = normalizeTagName(req.params.tag);
    const implies = normalizeTagName(req.params.implies);
    res.json(relationResult(backfill(removeImplication(tag, implies), `Remove ${tag} implies ${implies}`)));
  }),
);
