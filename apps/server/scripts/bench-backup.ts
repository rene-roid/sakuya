/**
 * Perf probe for P01: wall time of one backup on a synthetic 30k-item database, and p95 /api/media
 * latency with and without a backup running. Boots a throwaway server in a temp data dir; it never
 * touches a real database. On a build without /api/backups it reports the latency half only.
 *
 *   bun apps/server/scripts/bench-backup.ts [items=30000] [port=38949]
 */
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ITEMS = Number(process.argv[2] ?? 30_000);
const PORT = Number(process.argv[3] ?? 38949);
const BASE = `http://127.0.0.1:${PORT}`;
const serverEntry = path.resolve(import.meta.dir, '../src/index.ts');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-bench-backup-'));
const config = path.join(dataDir, 'sakuya.config.json');
fs.writeFileSync(config, JSON.stringify({ server: { dataDir, port: PORT, host: '127.0.0.1' } }));

const server = Bun.spawn(['bun', serverEntry], {
  env: { ...process.env, SAKUYA_CONFIG: config, NODE_ENV: 'production' },
  stdout: 'ignore',
  stderr: 'inherit',
});

async function waitForHealth() {
  for (let i = 0; i < 200; i++) {
    if (
      await fetch(`${BASE}/api/health`).then(
        (r) => r.ok,
        () => false,
      )
    )
      return;
    await Bun.sleep(50);
  }
  throw new Error('server did not come up');
}

function seed() {
  const db = new Database(path.join(dataDir, 'tbge.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  const now = Date.now();
  const lib = db.query("INSERT INTO libraries (name, created_at) VALUES ('bench', ?) RETURNING id").get(now) as {
    id: number;
  };
  const tags = Array.from({ length: 2000 }, (_, i) => `bench_tag_${i}`);
  const insertTag = db.prepare("INSERT INTO tags (name, category) VALUES (?, 'general')");
  const insertMedia = db.prepare(
    `INSERT INTO media (library_id, source, path, filename, type, size_bytes, width, height, created_at)
     VALUES (?, 'folder', ?, ?, 'image', ?, 1920, 1080, ?)`,
  );
  const insertMediaTag = db.prepare('INSERT INTO media_tags (media_id, tag_id, confidence) VALUES (?, ?, 0.9)');
  db.transaction(() => {
    for (const name of tags) insertTag.run(name);
    for (let i = 0; i < ITEMS; i++) {
      const { lastInsertRowid } = insertMedia.run(lib.id, `/bench/${i}.jpg`, `${i}.jpg`, 100_000 + i, now - i * 1000);
      for (let t = 0; t < 8; t++) insertMediaTag.run(Number(lastInsertRowid), 1 + ((i * 7 + t * 131) % tags.length));
    }
  })();
  db.close();
}

async function latencies(until: () => boolean, min = 40): Promise<number[]> {
  const out: number[] = [];
  while (out.length < min || !until()) {
    const start = performance.now();
    const res = await fetch(`${BASE}/api/media?limit=100&sort=newest`);
    await res.arrayBuffer();
    out.push(performance.now() - start);
  }
  return out;
}

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)];

try {
  await waitForHealth();
  seed();
  const dbBytes = fs.statSync(path.join(dataDir, 'tbge.db')).size;
  await latencies(() => true, 20); // warm up
  const idle = await latencies(() => true, 200);
  const report: Record<string, number | string> = { items: ITEMS, dbMB: +(dbBytes / 1e6).toFixed(1) };
  report.idleP95Ms = +p95(idle).toFixed(2);

  const started = await fetch(`${BASE}/api/backups`, { method: 'POST' });
  if (started.status === 202) {
    const { id } = (await started.json()) as { id: number };
    const t0 = performance.now();
    let done = false;
    let wall = 0;
    const poll = (async () => {
      for (;;) {
        const jobs = (await (await fetch(`${BASE}/api/jobs`)).json()) as { id: number; status: string; log: string }[];
        const job = jobs.find((j) => j.id === id);
        if (job?.status === 'done' || job?.status === 'error') {
          wall = performance.now() - t0;
          done = true;
          if (job.status === 'error') report.error = job.log;
          return;
        }
        await Bun.sleep(100);
      }
    })();
    const during = await latencies(() => done, 20);
    await poll;
    report.backupMs = Math.round(wall);
    report.duringP95Ms = +p95(during).toFixed(2);
    report.duringSamples = during.length;
  } else {
    report.backup = 'not available on this build';
  }
  console.log(JSON.stringify(report));
} finally {
  server.kill();
  await server.exited;
  fs.rmSync(dataDir, { recursive: true, force: true });
}
