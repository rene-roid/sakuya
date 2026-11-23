import { sqlite } from '../db';
import { chunkIds } from '../lib/mediaByIds';
import type { TagCategory, TagImplication, TagInfo, TagRelations, TagSibling, TagSource } from '@sakuya/shared';

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

const findTagStmt = sqlite.prepare('SELECT id FROM tags WHERE name = ?');
const insertTagStmt = sqlite.prepare('INSERT INTO tags (name, category) VALUES (?, ?) RETURNING id');
const siblingTargetStmt = sqlite.prepare('SELECT to_tag_id AS id FROM tag_siblings WHERE from_tag_id = ?');
const tagInfoStmt = sqlite.prepare('SELECT name, category, display_name AS displayName FROM tags WHERE id = ?');

/** The tag's id, creating it with `category` if it doesn't exist. Siblings are not followed. */
export function ensureTag(name: string, category: TagCategory): number {
  const existing = findTagStmt.get(name) as { id: number } | null;
  return existing?.id ?? (insertTagStmt.get(name, category) as { id: number }).id;
}

/**
 * The sources a new link of each source takes over when the item already has the tag. A sidecar
 * outranks the AI so a retag can't drop what the site itself said, and anything outranks an
 * implication so the tag survives the implication going away. A user add leaves an AI link alone,
 * as it always has.
 */
const OVERRIDES: Record<TagSource, TagSource[]> = { user: ['implied'], ai: ['implied'], meta: ['ai', 'implied'], implied: [] };
const linkStmts = Object.fromEntries(
  Object.entries(OVERRIDES).map(([source, over]) => [
    source,
    sqlite.prepare(
      `INSERT INTO media_tags (media_id, tag_id, confidence, source) VALUES (?, ?, ?, '${source}')
       ON CONFLICT (media_id, tag_id) DO ${
         over.length
           ? `UPDATE SET source = excluded.source, confidence = excluded.confidence
              WHERE media_tags.source IN (${over.map((o) => `'${o}'`).join(',')})`
           : 'NOTHING'
       }`,
    ),
  ]),
) as Record<TagSource, ReturnType<typeof sqlite.prepare>>;

/** Put a tag on an item, or take over an existing link of a lower-ranked source. */
export function linkTag(mediaId: number, tagId: number, source: TagSource, confidence: number | null = null): void {
  linkStmts[source].run(mediaId, tagId, confidence);
}

// Both tables are tiny and only change through this module, so whether either has any rows is
// kept here and every tag write skips the lookups while the user has no relations at all.
let siblingsExist = false;
let implicationsExist = false;

function refreshFlags(): void {
  siblingsExist = !!sqlite.query('SELECT 1 FROM tag_siblings LIMIT 1').get();
  implicationsExist = !!sqlite.query('SELECT 1 FROM tag_implications LIMIT 1').get();
}
refreshFlags();

/** The tag a write of `tagId` lands on: its sibling target if it is an alias, else itself. */
export function resolveSibling(tagId: number): number {
  if (!siblingsExist) return tagId;
  return (siblingTargetStmt.get(tagId) as { id: number } | null)?.id ?? tagId;
}

/** Tag names with every alias swapped for the tag it was merged into, deduped. */
export function canonicalTagNames(names: string[]): string[] {
  if (!siblingsExist || !names.length) return names;
  const rows = sqlite
    .query(
      `SELECT a.name AS alias, t.name AS target FROM tag_siblings s
       JOIN tags a ON a.id = s.from_tag_id JOIN tags t ON t.id = s.to_tag_id
       WHERE a.name IN (${names.map(() => '?').join(',')})`,
    )
    .all(...names) as { alias: string; target: string }[];
  const targets = new Map(rows.map((r) => [r.alias, r.target]));
  return [...new Set(names.map((n) => targets.get(n) ?? n))];
}

/** The canonical name an alias was merged into, or null when `name` is not an alias. */
export function siblingTargetName(name: string): string | null {
  if (!siblingsExist) return null;
  const row = sqlite
    .query(
      `SELECT t.name FROM tag_siblings s JOIN tags a ON a.id = s.from_tag_id JOIN tags t ON t.id = s.to_tag_id
       WHERE a.name = ?`,
    )
    .get(name) as { name: string } | null;
  return row?.name ?? null;
}

// One row per (media, tag) the implications reach, rebuilt per chunk of media being recomputed.
sqlite.exec(`CREATE TEMP TABLE IF NOT EXISTS implied_closure (
  media_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (media_id, tag_id)
) WITHOUT ROWID`);

function recomputeChunk(part: number[], touched: Set<number>): void {
  const placeholders = part.map(() => '?').join(',');
  sqlite.query('DELETE FROM implied_closure').run();
  // Seeded from the item's own tags only, so an implied tag can never keep itself alive. UNION
  // (not UNION ALL) also stops the walk on a cycle, though addImplication refuses those.
  sqlite
    .query(
      `WITH RECURSIVE closure(media_id, tag_id) AS (
         SELECT mt.media_id, i.implies_tag_id FROM media_tags mt JOIN tag_implications i ON i.tag_id = mt.tag_id
         WHERE mt.media_id IN (${placeholders}) AND mt.source != 'implied'
         UNION
         SELECT c.media_id, i.implies_tag_id FROM closure c JOIN tag_implications i ON i.tag_id = c.tag_id
       )
       INSERT INTO implied_closure (media_id, tag_id)
       SELECT media_id, tag_id FROM closure
       WHERE NOT EXISTS (SELECT 1 FROM media_tag_vetoes v WHERE v.media_id = closure.media_id AND v.tag_id = closure.tag_id)`,
    )
    .run(...part);
  const removed = sqlite
    .query(
      `DELETE FROM media_tags WHERE source = 'implied' AND media_id IN (${placeholders})
         AND NOT EXISTS (SELECT 1 FROM implied_closure c WHERE c.media_id = media_tags.media_id AND c.tag_id = media_tags.tag_id)
       RETURNING tag_id`,
    )
    .all(...part) as { tag_id: number }[];
  // `WHERE true` is SQLite's way to let an INSERT … SELECT carry an ON CONFLICT clause.
  const added = sqlite
    .query(
      `INSERT INTO media_tags (media_id, tag_id, confidence, source)
       SELECT media_id, tag_id, NULL, 'implied' FROM implied_closure WHERE true
       ON CONFLICT DO NOTHING RETURNING tag_id`,
    )
    .all() as { tag_id: number }[];
  for (const r of removed) touched.add(r.tag_id);
  for (const r of added) touched.add(r.tag_id);
}

/**
 * Bring the `implied` links of these media in line with the implications and their other tags:
 * add what their tags imply, drop what nothing implies any more. Returns the tag ids whose links
 * changed, for refreshUsageCounts. `force` runs it even with no implications left, which is how
 * removing the last one clears what it added.
 */
export function recomputeImplied(mediaIds: Iterable<number>, force = false): number[] {
  if (!implicationsExist && !force) return [];
  const ids = [...new Set(mediaIds)];
  const touched = new Set<number>();
  sqlite.transaction(() => {
    for (const part of chunkIds(ids)) recomputeChunk(part, touched);
  })();
  return [...touched];
}

/** `tagId` and every tag that implies it, directly or through a chain. */
function withAncestors(tagId: number): number[] {
  const rows = sqlite
    .query(
      `WITH RECURSIVE up(id) AS (
         SELECT ? UNION SELECT i.tag_id FROM tag_implications i JOIN up ON i.implies_tag_id = up.id
       ) SELECT id FROM up`,
    )
    .all(tagId) as { id: number }[];
  return rows.map((r) => r.id);
}

function implies(fromId: number, toId: number): boolean {
  return !!sqlite
    .query(
      `WITH RECURSIVE down(id) AS (
         SELECT ? UNION SELECT i.implies_tag_id FROM tag_implications i JOIN down ON i.tag_id = down.id
       ) SELECT 1 FROM down WHERE id = ? LIMIT 1`,
    )
    .get(fromId, toId);
}

/** Every media item whose implied tags can change when implications from `tagId` do. */
export function mediaAffectedBy(tagId: number): number[] {
  const tagIds = withAncestors(tagId);
  const out: number[] = [];
  for (const part of chunkIds(tagIds)) {
    const rows = sqlite
      .query(`SELECT DISTINCT media_id AS id FROM media_tags WHERE tag_id IN (${part.map(() => '?').join(',')})`)
      .all(...part) as { id: number }[];
    for (const r of rows) out.push(r.id);
  }
  return [...new Set(out)];
}

function hasImplicationCycle(): boolean {
  const edges = sqlite.query('SELECT tag_id AS a, implies_tag_id AS b FROM tag_implications').all() as {
    a: number;
    b: number;
  }[];
  const next = new Map<number, number[]>();
  for (const { a, b } of edges) next.set(a, [...(next.get(a) ?? []), b]);
  const state = new Map<number, 'open' | 'done'>();
  const visit = (node: number): boolean => {
    if (state.get(node) === 'open') return true;
    if (state.get(node) === 'done') return false;
    state.set(node, 'open');
    for (const n of next.get(node) ?? []) if (visit(n)) return true;
    state.set(node, 'done');
    return false;
  };
  return [...next.keys()].some(visit);
}

function tagName(id: number): string {
  return (tagInfoStmt.get(id) as TagInfo).name;
}

/** What a relation change touched: tags whose links moved, and media whose implied tags need a recompute. */
export interface RelationChange {
  touchedTags: number[];
  mediaIds: number[];
  /** Run the recompute even if no implication is left. */
  force: boolean;
}

/**
 * Make `fromName` an alias of `toName`. In one transaction every link, veto and implication on
 * the alias moves to the target, and aliases of the alias are re-pointed, so a chain never forms.
 */
export function addSibling(fromName: string, toName: string, category: TagCategory): RelationChange {
  if (fromName === toName) throw httpError(400, 'A tag cannot be merged into itself');
  let change: RelationChange | null = null;
  try {
    sqlite.transaction(() => {
      const from = ensureTag(fromName, category);
      const existing = siblingTargetStmt.get(from) as { id: number } | null;
      if (existing) throw httpError(409, `"${fromName}" is already merged into "${tagName(existing.id)}"`);
      const rawTo = ensureTag(toName, category);
      const to = (siblingTargetStmt.get(rawTo) as { id: number } | null)?.id ?? rawTo;
      if (to === from) throw httpError(400, `"${toName}" is already merged into "${fromName}"`);

      const moved = sqlite.query('SELECT media_id AS id FROM media_tags WHERE tag_id = ?').all(from) as {
        id: number;
      }[];
      // A direct link outranks an implied one already on the target, or the merged tag would
      // disappear again the moment its implication went away.
      sqlite
        .query(
          `INSERT INTO media_tags (media_id, tag_id, confidence, source)
           SELECT media_id, ?, confidence, source FROM media_tags WHERE tag_id = ? AND true
           ON CONFLICT (media_id, tag_id) DO UPDATE SET source = excluded.source, confidence = excluded.confidence
           WHERE media_tags.source = 'implied' AND excluded.source != 'implied'`,
        )
        .run(to, from);
      sqlite.query('DELETE FROM media_tags WHERE tag_id = ?').run(from);
      sqlite
        .query(
          `INSERT INTO media_tag_vetoes (media_id, tag_id, created_at)
           SELECT media_id, ?, created_at FROM media_tag_vetoes WHERE tag_id = ? AND true ON CONFLICT DO NOTHING`,
        )
        .run(to, from);
      sqlite.query('DELETE FROM media_tag_vetoes WHERE tag_id = ?').run(from);
      sqlite
        .query(
          `INSERT OR IGNORE INTO tag_implications (tag_id, implies_tag_id, created_at)
           SELECT ?, implies_tag_id, created_at FROM tag_implications WHERE tag_id = ? AND implies_tag_id != ?`,
        )
        .run(to, from, to);
      sqlite
        .query(
          `INSERT OR IGNORE INTO tag_implications (tag_id, implies_tag_id, created_at)
           SELECT tag_id, ?, created_at FROM tag_implications WHERE implies_tag_id = ? AND tag_id != ?`,
        )
        .run(to, from, to);
      sqlite.query('DELETE FROM tag_implications WHERE tag_id = ? OR implies_tag_id = ?').run(from, from);
      if (hasImplicationCycle()) {
        throw httpError(400, `Merging "${fromName}" into "${toName}" would make their implications loop`);
      }
      sqlite.query('UPDATE tag_siblings SET to_tag_id = ? WHERE to_tag_id = ?').run(to, from);
      sqlite
        .query('INSERT INTO tag_siblings (from_tag_id, to_tag_id, created_at) VALUES (?, ?, ?)')
        .run(from, to, Date.now());
      siblingsExist = true;
      change = {
        touchedTags: [from, to],
        mediaIds: [...new Set([...moved.map((r) => r.id), ...mediaAffectedBy(to)])],
        force: false,
      };
    })();
  } finally {
    refreshFlags();
  }
  return change!;
}

/** Stop treating `fromName` as an alias. Links already merged stay on the target. */
export function removeSibling(fromName: string): void {
  const from = findTagStmt.get(fromName) as { id: number } | null;
  const result = from ? sqlite.query('DELETE FROM tag_siblings WHERE from_tag_id = ?').run(from.id) : null;
  if (!result?.changes) throw httpError(404, `"${fromName}" is not merged into another tag`);
  refreshFlags();
}

/** Make `tagName` imply `impliesName`. Aliases on either side resolve to their targets first. */
export function addImplication(name: string, impliesName: string, category: TagCategory): RelationChange {
  let change: RelationChange | null = null;
  try {
    sqlite.transaction(() => {
      const from = resolveSiblingFresh(ensureTag(name, 'general'));
      const to = resolveSiblingFresh(ensureTag(impliesName, category));
      if (from === to) throw httpError(400, 'A tag cannot imply itself');
      if (implies(to, from)) {
        throw httpError(400, `"${tagName(to)}" already implies "${tagName(from)}", so this would loop`);
      }
      const inserted = sqlite
        .query('INSERT INTO tag_implications (tag_id, implies_tag_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
        .run(from, to, Date.now());
      if (!inserted.changes) throw httpError(409, `"${tagName(from)}" already implies "${tagName(to)}"`);
      implicationsExist = true;
      change = { touchedTags: [], mediaIds: mediaAffectedBy(from), force: false };
    })();
  } finally {
    refreshFlags();
  }
  return change!;
}

export function removeImplication(name: string, impliesName: string): RelationChange {
  const lookup = (n: string) => {
    const row = findTagStmt.get(n) as { id: number } | null;
    return row ? resolveSiblingFresh(row.id) : null;
  };
  const from = lookup(name);
  const to = lookup(impliesName);
  const result =
    from !== null && to !== null
      ? sqlite.query('DELETE FROM tag_implications WHERE tag_id = ? AND implies_tag_id = ?').run(from, to)
      : null;
  if (!result?.changes) throw httpError(404, `"${name}" does not imply "${impliesName}"`);
  refreshFlags();
  return { touchedTags: [], mediaIds: mediaAffectedBy(from!), force: true };
}

/** resolveSibling without the fast path, for use inside a transaction that may have just added one. */
function resolveSiblingFresh(tagId: number): number {
  return (siblingTargetStmt.get(tagId) as { id: number } | null)?.id ?? tagId;
}

export function listRelations(): TagRelations {
  const info = (prefix: string) =>
    `${prefix}.name AS ${prefix}_name, ${prefix}.category AS ${prefix}_category, ${prefix}.display_name AS ${prefix}_display`;
  type Row = Record<string, string | number | null>;
  const toInfo = (row: Row, prefix: string): TagInfo => ({
    name: row[`${prefix}_name`] as string,
    category: row[`${prefix}_category`] as TagCategory,
    displayName: row[`${prefix}_display`] as string | null,
  });
  const siblings = (
    sqlite
      .query(
        `SELECT ${info('a')}, ${info('b')}, s.created_at AS createdAt FROM tag_siblings s
         JOIN tags a ON a.id = s.from_tag_id JOIN tags b ON b.id = s.to_tag_id ORDER BY b.name, a.name`,
      )
      .all() as Row[]
  ).map((row): TagSibling => ({ from: toInfo(row, 'a'), to: toInfo(row, 'b'), createdAt: row.createdAt as number }));
  const implications = (
    sqlite
      .query(
        `SELECT ${info('a')}, ${info('b')}, i.created_at AS createdAt FROM tag_implications i
         JOIN tags a ON a.id = i.tag_id JOIN tags b ON b.id = i.implies_tag_id ORDER BY a.name, b.name`,
      )
      .all() as Row[]
  ).map(
    (row): TagImplication => ({ tag: toInfo(row, 'a'), implies: toInfo(row, 'b'), createdAt: row.createdAt as number }),
  );
  return { siblings, implications };
}

const impliedOnStmt = sqlite.prepare(
  `WITH RECURSIVE closure(tag_id) AS (
     SELECT i.implies_tag_id FROM media_tags mt JOIN tag_implications i ON i.tag_id = mt.tag_id
     WHERE mt.media_id = ? AND mt.source != 'implied'
     UNION
     SELECT i.implies_tag_id FROM closure c JOIN tag_implications i ON i.tag_id = c.tag_id
   ) SELECT 1 FROM closure WHERE tag_id = ? LIMIT 1`,
);

/** Whether the item's other tags imply `tagId`, so a recompute would put it straight back. */
export function impliedOn(mediaId: number, tagId: number): boolean {
  return implicationsExist && !!impliedOnStmt.get(mediaId, tagId);
}
