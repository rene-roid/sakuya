/**
 * Opt-in check of search by description against the real CLIP model. Never run by `bun test`.
 *
 *   bun apps/server/src/scripts/semanticEval.ts --models <dir> --images <dir>[,<dir>...] [--queries "a cat;a dragon"] [--sheet <out.png>]
 *   bun apps/server/src/scripts/semanticEval.ts --bench 30000
 *
 * --models holds the four files the download job fetches (vision.onnx, text.onnx, vocab.json,
 * merges.txt). Every image is embedded, each query prints its top five, and --sheet writes one row
 * of thumbnails per query. --bench times describe ranking over that many synthetic vectors through
 * the same index the API uses, filtered and unfiltered.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp, { type OverlayOptions } from 'sharp';

const { values: args } = parseArgs({
  options: {
    models: { type: 'string' },
    images: { type: 'string' },
    queries: {
      type: 'string',
      default: 'a cat;a dragon;the sea;a forest path;a book;a city at night;a witch flying on a broom',
    },
    sheet: { type: 'string' },
    bench: { type: 'string' },
  },
});
if (!args.bench && !(args.models && args.images)) {
  console.error('usage: --models <dir> --images <dir>[,<dir>] [--queries "a;b"] [--sheet out.png] | --bench <n>');
  process.exit(1);
}

// lib/config reads sakuya.config.json on import: point it at a throwaway data dir first.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-semantic-eval-'));
fs.mkdirSync(path.join(dataDir, 'models'), { recursive: true });
if (args.models) fs.symlinkSync(path.resolve(args.models), path.join(dataDir, 'models', 'clip'));
fs.writeFileSync(path.join(dataDir, 'sakuya.config.json'), JSON.stringify({ server: { dataDir } }));
process.env.SAKUYA_CONFIG = path.join(dataDir, 'sakuya.config.json');

const { dot, normalize } = await import('../lib/vectors');

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function bench(n: number) {
  const { sqlite } = await import('../db');
  const { saveEmbedding, scoreAll, topAfter, dropIndex } = await import('../services/semantic');
  const dims = 512;
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5;
  const vec = () => normalize(Float32Array.from({ length: dims }, rand));
  sqlite.exec(`INSERT INTO libraries (name, created_at) VALUES ('bench', 0)`);
  const insert = sqlite.prepare(
    `INSERT INTO media (library_id, source, path, filename, type, created_at) VALUES (1, 'folder', ?, ?, ?, 0)`,
  );
  sqlite.transaction(() => {
    for (let i = 0; i < n; i++) {
      const { lastInsertRowid } = insert.run(`/bench/${i}.png`, `${i}.png`, i % 5 === 0 ? 'video' : 'image');
      saveEmbedding(Number(lastInsertRowid), vec());
    }
  })();

  let t0 = performance.now();
  dropIndex();
  topAfter(scoreAll(vec()), 60);
  console.log(`cold index load + first page over ${n}: ${(performance.now() - t0).toFixed(0)} ms`);
  for (const [label, allowed] of [
    ['all', null],
    [
      'videos only',
      () =>
        new Set(
          (sqlite.query(`SELECT id FROM media m WHERE m.type = 'video'`).all() as { id: number }[]).map((r) => r.id),
        ),
    ],
  ] as const) {
    const times: number[] = [];
    for (let q = 0; q < 50; q++) {
      t0 = performance.now();
      // A first page as the API serves it: the filter's ids, every cosine, the best 60.
      topAfter(scoreAll(vec(), allowed ? allowed() : null), 60);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    console.log(
      `warm first page, ${label}: p50 ${percentile(times, 50).toFixed(1)} ms, p95 ${percentile(times, 95).toFixed(1)} ms`,
    );
  }
  console.log(`rss ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`);
}

async function evaluate() {
  const { onnxClipEncoder } = await import('../services/semanticModels');
  const files = args
    .images!.split(',')
    .flatMap((dir) =>
      fs
        .readdirSync(dir)
        .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
        .map((f) => path.join(dir, f)),
    )
    .sort();
  let t0 = performance.now();
  const vectors: Float32Array[] = [];
  for (const file of files) vectors.push(await onnxClipEncoder.image(file));
  console.log(`${files.length} images embedded, ${((performance.now() - t0) / files.length).toFixed(0)} ms each`);

  const queries = args
    .queries!.split(';')
    .map((q) => q.trim())
    .filter(Boolean);
  const rows: string[][] = [];
  for (const query of queries) {
    t0 = performance.now();
    const q = await onnxClipEncoder.text(query);
    const ms = performance.now() - t0;
    const top = vectors
      .map((v, i) => ({ file: files[i], score: dot(v, q) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    rows.push(top.map((t) => t.file));
    console.log(
      `${query} (${ms.toFixed(0)} ms): ${top.map((t) => `${path.basename(t.file)} ${t.score.toFixed(3)}`).join(', ')}`,
    );
  }

  if (args.sheet) {
    const size = 200;
    const label = 230;
    const tiles: OverlayOptions[] = [];
    for (let r = 0; r < rows.length; r++) {
      const text = queries[r].replace(/&/g, '&amp;').replace(/</g, '&lt;');
      tiles.push({
        input: Buffer.from(
          `<svg width="${label}" height="${size}"><text x="8" y="${size / 2}" font-size="18" fill="#ddd" font-family="sans-serif">${text}</text></svg>`,
        ),
        left: 0,
        top: r * (size + 6),
      });
      for (let c = 0; c < rows[r].length; c++) {
        tiles.push({
          input: await sharp(rows[r][c]).resize(size, size, { fit: 'cover' }).toBuffer(),
          left: label + c * (size + 6),
          top: r * (size + 6),
        });
      }
    }
    await sharp({
      create: { width: label + 5 * (size + 6), height: rows.length * (size + 6), channels: 3, background: '#111' },
    })
      .composite(tiles)
      .png()
      .toFile(args.sheet);
    console.log(`sheet: ${args.sheet}`);
  }
}

if (args.bench) await bench(Number(args.bench));
else await evaluate();
fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(0);
