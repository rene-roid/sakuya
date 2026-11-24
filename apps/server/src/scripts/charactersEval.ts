/**
 * Opt-in check of character detection against the real models. Never run by `bun test`.
 *
 *   bun apps/server/src/scripts/charactersEval.ts --db <data>/tbge.db --out <dir> [--eps 0.129,0.1] [--assign 0.129] [--merge 0.178,1]
 *   bun apps/server/src/scripts/charactersEval.ts --images <dir> --models <dir> --out <dir> [...]
 *
 * --db reads the detections a Sakuya instance already stored (read-only). --images runs the
 * detector and CCIP on every image in a folder, with --models holding the six files the download
 * job fetches. Either way it replays the job's incremental clustering for each eps/assign/merge set,
 * prints cluster sizes, and writes a contact sheet per large cluster for the first pair.
 */
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const { values: args } = parseArgs({
  options: {
    db: { type: 'string' },
    images: { type: 'string' },
    models: { type: 'string' },
    out: { type: 'string' },
    eps: { type: 'string', default: '0.1' },
    assign: { type: 'string', default: '' },
    merge: { type: 'string', default: '0.13' },
    sheets: { type: 'string', default: '8' },
  },
});
if (!args.out || (!args.db && !(args.images && args.models))) {
  console.error('usage: --out <dir> and either --db <tbge.db> or --images <dir> --models <dir>');
  process.exit(1);
}

// lib/config reads sakuya.config.json on import: point it at a throwaway data dir first.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-chars-eval-'));
fs.mkdirSync(path.join(dataDir, 'models'), { recursive: true });
if (args.models) fs.symlinkSync(path.resolve(args.models), path.join(dataDir, 'models', 'characters'));
fs.writeFileSync(path.join(dataDir, 'sakuya.config.json'), JSON.stringify({ server: { dataDir } }));
process.env.SAKUYA_CONFIG = path.join(dataDir, 'sakuya.config.json');

const { normalize, unpackFloat16 } = await import('../lib/vectors');
const { clusterIncrementally } = await import('../lib/characterClusters');
const { DEFAULT_CCIP_PARAMS, detectCharacters, loadCcipParams } = await import('../services/characterModels');

interface Det {
  id: number;
  mediaId: number;
  image: string;
  bbox: { x: number; y: number; w: number; h: number };
  score: number;
  vec: Float32Array;
}

let peakRss = 0;
const sampler = setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 100);

async function fromImages(dir: string): Promise<Det[]> {
  const params = await loadCcipParams();
  console.log('calibrated CCIP params', params);
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .sort();
  const out: Det[] = [];
  const started = performance.now();
  for (const [i, f] of files.entries()) {
    const image = path.join(dir, f);
    for (const d of await detectCharacters(image, params)) {
      out.push({
        id: out.length + 1,
        mediaId: i + 1,
        image,
        bbox: d.bbox,
        score: d.score,
        vec: normalize(d.embedding),
      });
    }
  }
  const secs = (performance.now() - started) / 1000;
  console.log(
    `${files.length} images, ${out.length} detections in ${secs.toFixed(0)} s: ` +
      `${(files.length / secs).toFixed(2)} images/s, ${(out.length / secs).toFixed(2)} detections/s`,
  );
  return out;
}

function fromDb(file: string): Det[] {
  const db = new Database(file, { readonly: true });
  const thumbs = path.join(path.dirname(file), 'thumbnails');
  const rows = db
    .query(
      `SELECT d.id, d.media_id, d.x, d.y, d.w, d.h, d.score, d.embedding, m.path, m.type
       FROM character_detections d JOIN media m ON m.id = d.media_id ORDER BY d.media_id, d.id`,
    )
    .all() as {
    id: number;
    media_id: number;
    x: number;
    y: number;
    w: number;
    h: number;
    score: number;
    embedding: Uint8Array;
    path: string;
    type: string;
  }[];
  db.close();
  return rows.map((r) => ({
    id: r.id,
    mediaId: r.media_id,
    image: r.type === 'video' ? path.join(thumbs, `${r.media_id}.webp`) : r.path,
    bbox: { x: r.x, y: r.y, w: r.w, h: r.h },
    score: r.score,
    vec: normalize(unpackFloat16(r.embedding)),
  }));
}

/** The job's order: detections arrive media by media and are clustered every 25. */
function replay(dets: Det[], eps: number, assignThreshold: number, mergeLimit: number): Map<number, number | null> {
  const diff = (c: number) => Math.min(1, Math.max(0, DEFAULT_CCIP_PARAMS.diffA - DEFAULT_CCIP_PARAMS.diffB * c));
  const params = { eps, assignThreshold, mergeLimit, minSamples: DEFAULT_CCIP_PARAMS.minSamples, diff };
  const label = new Map<number, number | null>();
  let nextCharacter = 1;
  let pending: number[] = [];
  const flush = () => {
    if (!pending.length) return;
    const nodes = dets
      .filter((d) => label.has(d.id))
      .map((d) => ({ id: d.id, vec: d.vec, characterId: label.get(d.id)! }));
    const result = clusterIncrementally(nodes, new Set(pending), params);
    for (const [id, character] of result.assigned) label.set(id, character);
    for (const group of result.created) {
      const character = nextCharacter++;
      for (const id of group) label.set(id, character);
    }
    pending = [];
  };
  for (const d of dets) {
    label.set(d.id, null);
    pending.push(d.id);
    if (pending.length >= 25) flush();
  }
  flush();
  return label;
}

const TILE = 112;
const COLS = 10;

async function contactSheet(title: string, dets: Det[], file: string) {
  const shown = dets.slice(0, 60);
  const rows = Math.ceil(shown.length / COLS);
  const tiles = await Promise.all(
    shown.map(async (d) => {
      const img = sharp(d.image, { autoOrient: true });
      const meta = await img.metadata();
      const rotated = (meta.orientation ?? 1) >= 5;
      const w = (rotated ? meta.height : meta.width)!;
      const h = (rotated ? meta.width : meta.height)!;
      const left = Math.round(d.bbox.x * w);
      const top = Math.round(d.bbox.y * h);
      return img
        .extract({
          left,
          top,
          width: Math.max(1, Math.min(Math.round(d.bbox.w * w), w - left)),
          height: Math.max(1, Math.min(Math.round(d.bbox.h * h), h - top)),
        })
        .resize(TILE, TILE, { fit: 'contain', background: '#111' })
        .png()
        .toBuffer();
    }),
  );
  const header = 28;
  const svg = `<svg width="${COLS * TILE}" height="${header}"><text x="8" y="20" font-family="sans-serif" font-size="16" fill="#eee">${title}</text></svg>`;
  await sharp({ create: { width: COLS * TILE, height: header + rows * TILE, channels: 3, background: '#222' } })
    .composite([
      { input: Buffer.from(svg), left: 0, top: 0 },
      ...tiles.map((input, i) => ({ input, left: (i % COLS) * TILE, top: header + Math.floor(i / COLS) * TILE })),
    ])
    .jpeg({ quality: 80 })
    .toFile(file);
}

const dets = args.db ? fromDb(args.db) : await fromImages(args.images!);
fs.mkdirSync(args.out, { recursive: true });
const epsList = args.eps.split(',').map(Number);
const assignList = args.assign ? args.assign.split(',').map(Number) : [];
const mergeList = args.merge.split(',').map(Number);

let first = true;
for (const eps of epsList) {
  for (const [assign, merge] of (assignList.length ? assignList : [eps]).flatMap((a) => mergeList.map((m) => [a, m]))) {
    const label = replay(dets, eps, assign, merge);
    const clusters = new Map<number, Det[]>();
    let noise = 0;
    for (const d of dets) {
      const c = label.get(d.id);
      if (c === null || c === undefined) noise++;
      else clusters.set(c, [...(clusters.get(c) ?? []), d]);
    }
    const sorted = [...clusters.values()].sort((a, b) => b.length - a.length);
    console.log(
      `eps ${eps} assign ${assign} merge ${merge}: ${sorted.length} clusters, ${noise} unassigned of ${dets.length}; ` +
        `sizes ${sorted.map((c) => c.length).join(' ')}`,
    );
    if (!first) continue;
    first = false;
    const count = Number(args.sheets);
    for (const [i, members] of sorted.slice(0, count).entries()) {
      const media = new Set(members.map((d) => d.mediaId)).size;
      await contactSheet(
        `eps ${eps} assign ${assign} merge ${merge} - cluster ${i + 1}: ${members.length} detections on ${media} images`,
        members,
        path.join(args.out, `cluster-${String(i + 1).padStart(2, '0')}.jpg`),
      );
    }
    const unassigned = dets.filter((d) => label.get(d.id) === null);
    if (unassigned.length) {
      await contactSheet(`unassigned (${unassigned.length})`, unassigned, path.join(args.out, 'unassigned.jpg'));
    }
  }
}
clearInterval(sampler);
console.log(`peak RSS ${(peakRss / 1e6).toFixed(0)} MB`);
fs.rmSync(dataDir, { recursive: true, force: true });
