/**
 * Discover evaluation lever. Three modes:
 *
 *   bun apps/server/scripts/discover-eval.ts metrics [--items 8000] [--seeds 3]
 *     Builds synthetic libraries with a known taste in a temp dir and reports ranking quality and
 *     feed variety for a grid of tuning values. Runs the real Discover code in-process.
 *
 *   bun apps/server/scripts/discover-eval.ts seed <dir> [--items 30000] [--port 38841]
 *     Writes a sakuya.config.json and a synthetic library into <dir>, for booting a server
 *     (any revision) against it: SAKUYA_CONFIG=<dir>/sakuya.config.json bun apps/server/src/index.ts
 *
 *   bun apps/server/scripts/discover-eval.ts perf <baseUrl> [<baseUrl> ...] [--requests 30]
 *     First-page latency, requests interleaved across the servers, with a forced profile rebuild
 *     (like + unlike) before every tenth request. Reports p50/p95 and the rebuild requests apart.
 *
 * Never point any of this at a real data dir: seed refuses a directory that already has a database.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const mode = args[0];
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};

function writeConfig(dir: string, port?: number) {
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(path.join(dir, 'tbge.db'))) throw new Error(`${dir} already has a database; refusing to touch it`);
  const file = path.join(dir, 'sakuya.config.json');
  fs.writeFileSync(file, JSON.stringify({ server: { dataDir: dir, ...(port ? { port, host: '127.0.0.1' } : {}) } }));
  process.env.SAKUYA_CONFIG = file;
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

async function seed() {
  const dir = path.resolve(args[1]);
  writeConfig(dir, flag('port', 38841));
  const { sqlite } = await import('../src/db');
  const { seedSyntheticLibrary } = await import('./discover-synth');
  const t0 = performance.now();
  const truth = seedSyntheticLibrary(sqlite, { items: flag('items', 30000), seed: flag('seed', 1) });
  sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const liked = sqlite.query(`SELECT id FROM media WHERE liked = 1 LIMIT 1`).get() as { id: number };
  console.log(
    JSON.stringify({
      dir,
      items: truth.theme.size,
      likedId: liked.id,
      seconds: +((performance.now() - t0) / 1000).toFixed(1),
    }),
  );
}

async function perf() {
  const bases = args.slice(1).filter((a) => a.startsWith('http'));
  const requests = flag('requests', 30);
  const likedId = flag('liked', 0);
  const samples = new Map<string, { normal: number[]; rebuild: number[] }>(
    bases.map((b) => [b, { normal: [], rebuild: [] }]),
  );
  const timed = async (url: string) => {
    const t0 = performance.now();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    await res.json();
    return performance.now() - t0;
  };
  const toggle = async (base: string, liked: boolean) => {
    await fetch(`${base}/api/media/${likedId}/like`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liked }),
    });
  };
  // Warm-up: the first request on a fresh process pays for JIT and page cache, not for ranking.
  for (const base of bases) await timed(`${base}/api/discover?limit=60`);
  for (let i = 0; i < requests; i++) {
    for (const base of bases) {
      const rebuild = i % 10 === 0;
      if (rebuild && likedId) {
        await toggle(base, false);
        await toggle(base, true);
      }
      const ms = await timed(`${base}/api/discover?limit=60&seed=${i + 1}`);
      samples.get(base)![rebuild ? 'rebuild' : 'normal'].push(ms);
    }
  }
  for (const [base, s] of samples) {
    const fmt = (xs: number[]) =>
      xs.length ? `p50 ${quantile(xs, 0.5).toFixed(1)}ms p95 ${quantile(xs, 0.95).toFixed(1)}ms` : '-';
    console.log(`${base}  cached: ${fmt(s.normal)}  rebuild: ${fmt(s.rebuild)} (n=${s.rebuild.length})`);
  }
}

async function metrics() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-discover-eval-'));
  writeConfig(root);
  const { sqlite } = await import('../src/db');
  const { seedSyntheticLibrary } = await import('./discover-synth');
  const discover = await import('../src/routes/discover');
  const { hammingDistance } = await import('../src/services/perceptualHash');
  const items = flag('items', 8000);
  const seeds = flag('seeds', 3);
  const defaults = { ...discover.discoverTuning };

  type Row = Record<string, number>;
  const libraries: { truth: Awaited<ReturnType<typeof seedSyntheticLibrary>>; hashes: Map<number, string> }[] = [];
  // A throwaway database: the search index isn't read here, and its per-row triggers make the
  // bulk deletes and copies below quadratic.
  sqlite.exec(`DROP TRIGGER IF EXISTS media_tags_fts_ai; DROP TRIGGER IF EXISTS media_tags_fts_ad;`);
  for (let s = 1; s <= seeds; s++) {
    sqlite.exec(`DELETE FROM media; DELETE FROM media_tags; DELETE FROM tags; DELETE FROM libraries;`);
    const truth = seedSyntheticLibrary(sqlite, { items, seed: s * 7919 });
    const hashes = new Map(
      (
        sqlite.query(`SELECT id, perceptual_hash AS h FROM media WHERE perceptual_hash IS NOT NULL`).all() as {
          id: number;
          h: string;
        }[]
      ).map((r) => [r.id, r.h]),
    );
    // Libraries are evaluated one at a time below, so keep a copy of each database to swap back in.
    sqlite.exec(`VACUUM INTO '${path.join(root, `lib${s}.db`)}'`);
    libraries.push({ truth, hashes });
  }

  const load = (s: number) => {
    sqlite.exec(`ATTACH '${path.join(root, `lib${s + 1}.db`)}' AS src`);
    sqlite.exec(`DELETE FROM main.media; DELETE FROM main.media_tags; DELETE FROM main.tags;
                 INSERT INTO main.media SELECT * FROM src.media;
                 INSERT INTO main.media_tags SELECT * FROM src.media_tags;
                 INSERT INTO main.tags SELECT * FROM src.tags;`);
    sqlite.exec(`DETACH src`);
  };

  function measure(tuning: Partial<typeof defaults>, surprise: number): Row {
    const sum: Row = {};
    libraries.forEach(({ truth, hashes }, s) => {
      load(s);
      Object.assign(discover.discoverTuning, defaults, tuning);
      discover.resetDiscoverCache();
      const feed = discover.discoverFeed({ surprise, seed: 1, limit: 60 });
      const ids = feed.items.map((m) => m.id);
      const top20 = ids.slice(0, 20);
      const batchSeen = new Set<number>();
      let novel = 0;
      for (const id of top20) {
        if (!truth.relevant.has(id)) continue;
        const g = truth.batch.get(id);
        if (g !== undefined) {
          if (batchSeen.has(g)) continue;
          batchSeen.add(g);
        }
        novel++;
      }
      const folderCount = new Map<string, number>();
      for (const id of ids) folderCount.set(truth.folder.get(id)!, (folderCount.get(truth.folder.get(id)!) ?? 0) + 1);
      let worstWindow = 0;
      for (let i = 0; i + 20 <= ids.length; i++) {
        const c = new Map<string, number>();
        for (const id of ids.slice(i, i + 20)) c.set(truth.folder.get(id)!, (c.get(truth.folder.get(id)!) ?? 0) + 1);
        worstWindow = Math.max(worstWindow, ...c.values());
      }
      let dupes = 0;
      ids.forEach((id, i) => {
        const h = hashes.get(id);
        if (h && ids.slice(0, i).some((o) => hashes.has(o) && hammingDistance(h, hashes.get(o)!) <= 6)) dupes++;
      });
      const row: Row = {
        'p@20': top20.filter((id) => truth.relevant.has(id)).length / 20,
        'novel p@20': novel / 20,
        'p@60': ids.filter((id) => truth.relevant.has(id)).length / 60,
        'past@60': ids.filter((id) => truth.pastThemes.includes(truth.theme.get(id)!)).length / 60,
        'top folder /60': Math.max(...folderCount.values()) / 60,
        'max folder /20': worstWindow,
        'reasons@60': new Set(feed.items.map((m) => m.reasonTag).filter(Boolean)).size,
        'dupes@60': dupes,
      };
      for (const [k, v] of Object.entries(row)) sum[k] = (sum[k] ?? 0) + v / libraries.length;
    });
    return sum;
  }

  const print = (title: string, rows: [string, Row][]) => {
    console.log(`\n${title}`);
    const cols = Object.keys(rows[0][1]);
    console.log(['config'.padEnd(26), ...cols.map((c) => c.padStart(14))].join(''));
    for (const [label, r] of rows) {
      console.log([label.padEnd(26), ...cols.map((c) => r[c].toFixed(c.includes('p@') ? 3 : 2).padStart(14))].join(''));
    }
  };

  const off = { folderCap: 0, reasonCap: 0, dupDistance: -1 };
  const scoring: [string, Row][] = [];
  for (const topK of [3, 5, 8, 0]) {
    for (const halfLifeDays of [30, 60, 120, 0]) {
      scoring.push([
        `topK ${topK || 'all'} half-life ${halfLifeDays || 'none'}`,
        measure({ topK, halfLifeDays, ...off }, 0),
      ]);
    }
  }
  print(`R01 scoring, surprise 0, variety off (${seeds} libraries x ${items} items)`, scoring);

  const variety: [string, Row][] = [[`off`, measure(off, 0.25)]];
  for (const folderCap of [3, 4, 6]) {
    for (const reasonCap of [4, 5, 8]) {
      for (const dupDistance of [4, 6, 8]) {
        variety.push([
          `folder ${folderCap} reason ${reasonCap} dhash ${dupDistance}`,
          measure({ folderCap, reasonCap, dupDistance }, 0.25),
        ]);
      }
    }
  }
  print(
    `R02 variety, surprise 0.25, scoring at defaults (topK ${defaults.topK}, half-life ${defaults.halfLifeDays})`,
    variety,
  );
  fs.rmSync(root, { recursive: true, force: true });
}

if (mode === 'seed') await seed();
else if (mode === 'perf') await perf();
else if (mode === 'metrics') await metrics();
else {
  console.error('usage: discover-eval.ts metrics | seed <dir> | perf <baseUrl...>');
  process.exit(1);
}
process.exit(0);
