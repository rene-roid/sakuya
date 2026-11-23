import type { Database } from 'bun:sqlite';
import { phashBands } from '../src/lib/phashBands';

/**
 * A synthetic library with a known taste, for measuring Discover. Shaped after what the WD tagger
 * produces on a real library: tag frequency follows a power law, a handful of tags sit on most
 * items, tag counts per item vary by an order of magnitude, and folders hold one theme each.
 * Some folders are batches of near-identical images (same tags, perceptual hashes a few bits
 * apart), the shape that floods a feed when one of them matches your taste.
 *
 * The user's taste moved during the year: old engagement sits on "past" themes, recent engagement
 * on "current" ones. Ground truth is the current themes, so a ranking that lets a year-old like
 * count as much as today's scores worse.
 */
export interface SynthOptions {
  items: number;
  seed: number;
  now?: number;
}

export interface SynthTruth {
  now: number;
  currentThemes: number[];
  pastThemes: number[];
  /** media id → theme */
  theme: Map<number, number>;
  /** media id → batch group, for items in a near-identical batch */
  batch: Map<number, number>;
  /** media id → folder */
  folder: Map<number, string>;
  /** Items the user engaged with (liked or viewed); excluded from the relevant set. */
  engaged: Set<number>;
  /** Unengaged items in a current theme: what a good feed should surface. */
  relevant: Set<number>;
  libraryId: number;
}

const DAY = 86_400_000;
const THEMES = 40;
/** Themes draw their motifs from one shared pool, so a motif you like turns up in other themes. */
const MOTIF_POOL = 120;
const MOTIFS_PER_THEME = 8;
const BACKGROUND_TAGS = 2000;
const UBIQUITOUS = [
  { name: 'solo', p: 0.7 },
  { name: 'looking_at_viewer', p: 0.45 },
  { name: 'simple_background', p: 0.3 },
  { name: 'outdoors', p: 0.25 },
  { name: 'smile', p: 0.4 },
];
const BATCH_SIZE = 40;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function zipfSampler(n: number, s: number, rand: () => number) {
  const cdf: number[] = [];
  let total = 0;
  for (let r = 1; r <= n; r++) {
    total += 1 / Math.pow(r, s);
    cdf.push(total);
  }
  return () => {
    const x = rand() * total;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}

const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, '0');

/**
 * Run a bulk media_tags write with the per-row search-index triggers suspended, then rebuild the
 * index in one pass. Each trigger firing rewrites the item's whole tag string, which turns a
 * 600k-row insert into hours.
 */
export function withoutTagTriggers(sqlite: Database, fn: () => void) {
  const triggers = sqlite
    .query(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'media_tags'`)
    .all() as { name: string; sql: string }[];
  for (const t of triggers) sqlite.exec(`DROP TRIGGER ${t.name}`);
  try {
    fn();
    sqlite.exec(`UPDATE media_fts SET tags = COALESCE(
      (SELECT group_concat(t.name, ' ') FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.media_id = media_fts.rowid),
      '')`);
  } finally {
    for (const t of triggers) sqlite.exec(t.sql);
  }
}

export function seedSyntheticLibrary(sqlite: Database, opts: SynthOptions): SynthTruth {
  const rand = mulberry32(opts.seed);
  const now = opts.now ?? Date.now();
  const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const normal = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());

  const themeOrder = Array.from({ length: THEMES }, (_, i) => i).sort(() => rand() - 0.5);
  const currentThemes = themeOrder.slice(0, 3);
  const pastThemes = themeOrder.slice(3, 5);

  const libraryId = Number(
    (
      sqlite.query(`INSERT INTO libraries (name, created_at) VALUES ('synthetic', ?) RETURNING id`).get(now) as {
        id: number;
      }
    ).id,
  );

  const tagIds = new Map<string, number>();
  const insertTag = sqlite.prepare(`INSERT INTO tags (name) VALUES (?) RETURNING id`);
  const tagId = (name: string) => {
    let id = tagIds.get(name);
    if (id === undefined) {
      id = (insertTag.get(name) as { id: number }).id;
      tagIds.set(name, id);
    }
    return id;
  };

  const background = zipfSampler(BACKGROUND_TAGS, 1.05, rand);
  const themeOf = zipfSampler(THEMES, 0.4, rand);

  const truth: SynthTruth = {
    now,
    currentThemes,
    pastThemes,
    theme: new Map(),
    batch: new Map(),
    folder: new Map(),
    engaged: new Set(),
    relevant: new Set(),
    libraryId,
  };

  const insertMedia = sqlite.prepare(
    `INSERT INTO media (library_id, source, path, filename, type, created_at, perceptual_hash,
                        phash_b0, phash_b1, phash_b2, phash_b3, phash_b4, phash_b5, phash_b6, phash_b7)
     VALUES (?, 'folder', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  );
  const insertMediaTag = sqlite.prepare(
    `INSERT OR IGNORE INTO media_tags (media_id, tag_id, source) VALUES (?, ?, 'ai')`,
  );

  // Each theme has a signature tag (a character or series, the strongest signal there is) and
  // motifs shared with other themes.
  const motifs = Array.from({ length: THEMES }, () =>
    Array.from({ length: MOTIFS_PER_THEME }, () => `motif${Math.floor(rand() * MOTIF_POOL)}`),
  );
  const tagSetFor = (t: number) => {
    const count = Math.max(4, Math.min(70, Math.round(Math.exp(Math.log(18) + 0.6 * normal()))));
    const set = new Set<string>();
    if (rand() < 0.4) set.add(`theme${t}`);
    for (const name of motifs[t]) if (rand() < 0.4) set.add(name);
    for (const u of UBIQUITOUS) if (rand() < u.p) set.add(u.name);
    let guard = 0;
    while (set.size < count && guard++ < count * 4) set.add(`bg${background()}`);
    return [...set];
  };

  // Batches: near-identical images in one folder, a third of them in a theme the user likes now.
  const batchCount = Math.max(2, Math.round(opts.items / 2000));
  const batches = Array.from({ length: batchCount }, (_, b) => ({
    theme: b % 3 === 0 ? currentThemes[b % currentThemes.length] : themeOf(),
    hi: Math.floor(rand() * 2 ** 32),
    lo: Math.floor(rand() * 2 ** 32),
  }));

  const folderCounter = new Map<number, { index: number; left: number }>();
  const nextFolder = (t: number) => {
    let f = folderCounter.get(t);
    if (!f || f.left <= 0) {
      f = { index: (f?.index ?? -1) + 1, left: 20 + Math.floor(rand() * 130) };
      folderCounter.set(t, f);
    }
    f.left--;
    return `/synthetic/theme${t}/set${f.index}`;
  };

  let seq = 0;
  const add = (folder: string, t: number, tags: string[], hash: string | null, type: 'image' | 'video') => {
    const filename = `${type === 'video' ? 'clip' : 'img'}${seq++}.${type === 'video' ? 'mp4' : 'png'}`;
    const createdAt = now - Math.floor(rand() * 365 * DAY);
    const row = insertMedia.get(
      libraryId,
      `${folder}/${filename}`,
      filename,
      type,
      createdAt,
      hash,
      ...phashBands(hash),
    ) as {
      id: number;
    };
    for (const name of tags) insertMediaTag.run(row.id, tagId(name));
    truth.theme.set(row.id, t);
    truth.folder.set(row.id, folder);
    return row.id;
  };

  withoutTagTriggers(sqlite, () =>
    sqlite.transaction(() => {
      const batchItems = batches.length * BATCH_SIZE;
      for (let i = 0; i < opts.items - batchItems; i++) {
        const t = themeOf();
        const video = rand() < 0.1;
        const hash = video ? null : hex8(rand() * 2 ** 32) + hex8(rand() * 2 ** 32);
        add(nextFolder(t), t, tagSetFor(t), hash, video ? 'video' : 'image');
      }
      batches.forEach((b, bi) => {
        const base = tagSetFor(b.theme);
        for (let i = 0; i < BATCH_SIZE; i++) {
          let hi = b.hi;
          let lo = b.lo;
          const flips = Math.floor(rand() * 4);
          for (let f = 0; f < flips; f++) {
            const bit = Math.floor(rand() * 64);
            if (bit < 32) hi ^= 1 << bit;
            else lo ^= 1 << (bit - 32);
          }
          const tags = base.filter(() => rand() > 0.05);
          // Most of a batch sits in its own folder; the rest was saved again elsewhere, which only
          // the perceptual hash can tell.
          const folder = rand() < 0.6 ? `/synthetic/batch${bi}` : nextFolder(b.theme);
          const id = add(folder, b.theme, tags, hex8(hi) + hex8(lo), 'image');
          truth.batch.set(id, bi);
        }
      });

      const byTheme = new Map<number, number[]>();
      for (const [id, t] of truth.theme) {
        if (truth.batch.has(id)) continue;
        if (!byTheme.has(t)) byTheme.set(t, []);
        byTheme.get(t)!.push(id);
      }
      const like = sqlite.prepare(
        `UPDATE media SET liked = 1, liked_at = ?, last_viewed_at = ?, view_count = view_count + 1 WHERE id = ?`,
      );
      const view = sqlite.prepare(
        `UPDATE media SET view_count = view_count + ?, dwell_seconds = dwell_seconds + ?, last_viewed_at = MAX(COALESCE(last_viewed_at, 0), ?) WHERE id = ?`,
      );
      const engage = (themes: number[], likes: number, views: number, minAge: number, maxAge: number) => {
        for (let i = 0; i < likes; i++) {
          const id = pick(byTheme.get(pick(themes)) ?? []);
          if (id === undefined) continue;
          const at = now - Math.floor((minAge + rand() * (maxAge - minAge)) * DAY);
          like.run(at, at, id);
          truth.engaged.add(id);
        }
        for (let i = 0; i < views; i++) {
          const id = pick(byTheme.get(pick(themes)) ?? []);
          if (id === undefined) continue;
          const at = now - Math.floor((minAge + rand() * (maxAge - minAge)) * DAY);
          view.run(1 + Math.floor(rand() * 4), Math.floor(rand() * 60), at, id);
          truth.engaged.add(id);
        }
      };
      // The old taste was the more engaged one: more likes, a longer stretch of time.
      engage(pastThemes, 45, 180, 150, 365);
      engage(currentThemes, 30, 120, 0, 60);
      const allThemes = Array.from({ length: THEMES }, (_, i) => i);
      engage(allThemes, 8, 80, 0, 365);
      // Two likes inside each current-theme batch: the "liked two shots from one shoot" case.
      batches.forEach((b, bi) => {
        if (!currentThemes.includes(b.theme)) return;
        const ids = [...truth.batch].filter(([, g]) => g === bi).map(([id]) => id);
        for (const id of ids.slice(0, 2)) {
          const at = now - Math.floor(rand() * 20 * DAY);
          like.run(at, at, id);
          truth.engaged.add(id);
        }
      });
    })(),
  );

  for (const [id, t] of truth.theme) if (currentThemes.includes(t) && !truth.engaged.has(id)) truth.relevant.add(id);
  sqlite.exec(`UPDATE tags SET usage_count = (SELECT COUNT(*) FROM media_tags mt WHERE mt.tag_id = tags.id)`);
  return truth;
}
