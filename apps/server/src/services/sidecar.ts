import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, sqlite, schema } from '../db';
import { normalizeTagName, type TagCategory } from '@sakuya/shared';
import { upsertTag } from './tagger';
import { linkTag, recomputeImplied } from './tagRelations';

export interface SidecarTag {
  name: string;
  category: TagCategory;
}

export interface SidecarMetadata {
  tags: SidecarTag[];
  sourceUrl: string | null;
}

const MAX_TAGS = 300;
const MAX_TAG_LENGTH = 120;

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Booru tag strings are space-separated; arrays are one tag per entry, or `{ name }` objects. */
function tagList(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/\s+/);
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => (typeof v === 'string' ? [v] : isObject(v) && typeof v.name === 'string' ? [v.name] : []));
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function httpUrl(value: unknown): string | null {
  const raw = str(value);
  if (!raw || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Post pages for extractors whose metadata carries an id but no page URL. */
const POST_URLS: Record<string, (data: Json) => string | null> = {
  danbooru: (d) => (d.id != null ? `https://danbooru.donmai.us/posts/${d.id}` : null),
  e621: (d) => (d.id != null ? `https://e621.net/posts/${d.id}` : null),
  gelbooru: (d) => (d.id != null ? `https://gelbooru.com/index.php?page=post&s=view&id=${d.id}` : null),
  safebooru: (d) => (d.id != null ? `https://safebooru.org/index.php?page=post&s=view&id=${d.id}` : null),
  yandere: (d) => (d.id != null ? `https://yande.re/post/show/${d.id}` : null),
  konachan: (d) => (d.id != null ? `https://konachan.com/post/show/${d.id}` : null),
  pixiv: (d) => (d.id != null ? `https://www.pixiv.net/artworks/${d.id}` : null),
  twitter: (d) => {
    const author = isObject(d.author) ? str(d.author.name) : null;
    return author && d.tweet_id != null ? `https://x.com/${author}/status/${d.tweet_id}` : null;
  },
};

function sourceUrlOf(data: Json): string | null {
  for (const key of ['post_url', 'page_url', 'descriptionurl', 'webpage_url']) {
    const url = httpUrl(data[key]);
    if (url) return url;
  }
  const category = str(data.category);
  const built = category && POST_URLS[category] ? httpUrl(POST_URLS[category](data)) : null;
  // A booru's own `source` is where the art was first posted, the next best place to go.
  return built ?? httpUrl(data.source);
}

/**
 * The tags and post URL in one gallery-dl `--write-metadata` sidecar. Fields differ per extractor;
 * the ones read are:
 *
 * - danbooru `tag_string_{artist,copyright,character,general}` and gelbooru/moebooru
 *   `tags_{artist,copyright,character,general}`, space-separated strings or arrays;
 * - e621 `tags: { artist: [], copyright: [], character: [], general: [], species: [] }`;
 * - an `artist` string or array, pixiv `user.name`, and twitter/deviantart `author.name|username`;
 * - a generic `tags` array or string, and danbooru's uncategorised `tag_string`, as general tags;
 * - `post_url`, `page_url`, `descriptionurl` (Wikimedia) or an extractor-specific post page,
 *   falling back to the booru `source` field, as the source URL.
 *
 * Ratings and booru meta tags (`highres`, `translated`…) are skipped: the tagger already rates every
 * image, and meta tags describe the upload rather than the picture. Returns null for anything that
 * isn't a JSON object.
 */
export function parseSidecar(data: unknown): SidecarMetadata | null {
  if (!isObject(data)) return null;
  const seen = new Map<string, TagCategory>();
  const add = (names: string[], category: TagCategory) => {
    for (const raw of names) {
      const name = normalizeTagName(raw);
      if (!name || name.length > MAX_TAG_LENGTH || /[\p{Cc},]/u.test(name) || seen.has(name)) continue;
      if (seen.size >= MAX_TAGS) return;
      seen.set(name, category);
    }
  };

  const e621 = isObject(data.tags) ? data.tags : null;
  const fields: [TagCategory, unknown[]][] = [
    ['artist', [data.tag_string_artist, data.tags_artist, e621?.artist, data.artist]],
    ['copyright', [data.tag_string_copyright, data.tags_copyright, e621?.copyright]],
    ['character', [data.tag_string_character, data.tags_character, e621?.character]],
    ['general', [data.tag_string_general, data.tags_general, e621?.general, e621?.species]],
  ];
  for (const [category, values] of fields) for (const value of values) add(tagList(value), category);

  if (![...seen.values()].includes('artist')) {
    // `author` first: on twitter `user` is whose timeline was downloaded, not who posted the tweet.
    const author = isObject(data.author) ? (str(data.author.name) ?? str(data.author.username)) : null;
    const user = isObject(data.user) ? str(data.user.name) : null;
    const artist = author ?? user;
    if (artist) add([artist], 'artist');
  }
  if (!e621) add(tagList(data.tags), 'general');
  if (!data.tag_string_general) add(tagList(data.tag_string), 'general');

  return { tags: [...seen].map(([name, category]) => ({ name, category })), sourceUrl: sourceUrlOf(data) };
}

/**
 * The sidecar gallery-dl wrote for `file`, if `jsonFiles` (the .json files next to it) has one.
 * Its default name is the file's full name plus `.json`; a converted ugoira's sidecar keeps the
 * `.zip` name, and `--write-metadata` with a custom extension format may drop the media extension.
 */
export function sidecarFor(file: string, jsonFiles: ReadonlySet<string>): string | null {
  const stem = file.slice(0, file.length - path.extname(file).length);
  const candidates = [`${file}.json`, `${stem}.zip.json`, `${stem}.json`];
  return candidates.find((c) => jsonFiles.has(c)) ?? null;
}

const vetoedStmt = sqlite.prepare('SELECT tag_id FROM media_tag_vetoes WHERE media_id = ?');
// Tags are global, so a name first seen in an uncategorised list (a pixiv tag, the tagger) stays
// 'general' until a site that does categorise it says otherwise.
const promoteStmt = sqlite.prepare(`UPDATE tags SET category = ? WHERE id = ? AND category = 'general'`);

/**
 * Replace an item's sidecar (`meta`) tags with `meta.tags`, minus vetoes, and record its source URL.
 * Tag ids whose links changed go into `touched`; the caller refreshes their usage counts once for a
 * whole scan, since recounting a common tag per item made a 5,000-file scan noticeably slower.
 */
export function applySidecar(mediaId: number, meta: SidecarMetadata, mtime: number, touched: Set<number>): void {
  const vetoed = new Set((vetoedStmt.all(mediaId) as { tag_id: number }[]).map((r) => r.tag_id));
  sqlite.transaction(() => {
    const old = sqlite
      .query(`DELETE FROM media_tags WHERE media_id = ? AND source = 'meta' RETURNING tag_id`)
      .all(mediaId) as { tag_id: number }[];
    for (const r of old) touched.add(r.tag_id);
    for (const tag of meta.tags) {
      const tagId = upsertTag(tag.name, tag.category);
      if (tag.category !== 'general') promoteStmt.run(tag.category, tagId);
      if (vetoed.has(tagId)) continue;
      linkTag(mediaId, tagId, 'meta');
      touched.add(tagId);
    }
    for (const tagId of recomputeImplied([mediaId])) touched.add(tagId);
    db.update(schema.media)
      .set({ sourceUrl: meta.sourceUrl, sidecarMtime: mtime })
      .where(eq(schema.media.id, mediaId))
      .run();
  })();
}

/**
 * Read and apply `sidecar` for the media row at `file`, unless it was already read at this mtime.
 * Returns false when the sidecar is unreadable or not JSON; that mtime is still recorded so an
 * unchanged broken file isn't re-read on every scan.
 */
export async function syncSidecar(file: string, sidecar: string, touched: Set<number>): Promise<boolean> {
  const row = db
    .select({ id: schema.media.id, sidecarMtime: schema.media.sidecarMtime })
    .from(schema.media)
    .where(eq(schema.media.path, file))
    .get();
  if (!row) return true;
  let stat;
  try {
    stat = await fs.stat(sidecar);
  } catch {
    return true;
  }
  const mtime = Math.round(stat.mtimeMs);
  if (row.sidecarMtime === mtime) return true;
  let meta: SidecarMetadata | null = null;
  try {
    meta = parseSidecar(JSON.parse(await fs.readFile(sidecar, 'utf8')));
  } catch (err) {
    console.error(`unreadable metadata sidecar ${sidecar}:`, (err as Error).message);
  }
  if (!meta) {
    db.update(schema.media).set({ sidecarMtime: mtime }).where(eq(schema.media.id, row.id)).run();
    return false;
  }
  applySidecar(row.id, meta, mtime, touched);
  return true;
}
