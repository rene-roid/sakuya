/**
 * Opt-in comparison of video tagging from the thumbnail frame against several sampled frames,
 * with the real tagger model. Never run by `bun test`.
 *
 *   bun apps/server/src/scripts/videoTagEval.ts --videos <dir> --models <dir> --out <dir> [--frames 3,5,8] [--cpus 2]
 *
 * --models holds model.onnx and selected_tags.csv. For each video it tags the thumbnail frame the
 * scanner would make, then N sampled frames combined by max confidence, with and without requiring
 * a general tag to clear the threshold in at least two frames. Writes results.json and a copy of
 * every sampled frame (named after its time) under --out, and prints a summary table.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    videos: { type: 'string' },
    models: { type: 'string' },
    out: { type: 'string' },
    frames: { type: 'string', default: '3,5,8' },
    cpus: { type: 'string', default: '2' },
  },
});
if (!args.videos || !args.models || !args.out) {
  console.error('usage: --videos <dir> --models <dir> --out <dir> [--frames 3,5,8] [--cpus 2]');
  process.exit(1);
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-video-eval-'));
fs.mkdirSync(path.join(dataDir, 'models'), { recursive: true });
for (const f of ['model.onnx', 'selected_tags.csv']) {
  fs.symlinkSync(path.resolve(args.models, f), path.join(dataDir, 'models', f));
}
fs.writeFileSync(
  path.join(dataDir, 'sakuya.config.json'),
  JSON.stringify({ server: { dataDir }, limits: { cpus: Number(args.cpus), memory: null } }),
);
process.env.SAKUYA_CONFIG = path.join(dataDir, 'sakuya.config.json');

const { predictScores, selectTags, combineFrameScores, parseLabels } = await import('../services/tagger');
const { frameTimes, withVideoFrames } = await import('../services/videoFrames');
const { generateThumbnail } = await import('../services/thumbnailer');
const { probeVideo } = await import('../services/scanner');
const { confidenceThresholds } = await import('../lib/settings');

const labels = parseLabels(fs.readFileSync(path.join(args.models, 'selected_tags.csv'), 'utf8'));
const thresholds = confidenceThresholds();
const counts = args.frames.split(',').map(Number);
const outDir = path.resolve(args.out);
fs.mkdirSync(outDir, { recursive: true });

type Tag = { name: string; category: string; confidence: number };
const tagNames = (tags: Tag[]) => tags.filter((t) => t.category !== 'rating').map((t) => t.name);

/** Max-combine, but a general tag only counts if it clears the threshold in at least two frames. */
function selectWithTwoFrameRule(frames: Float32Array[]): Tag[] {
  const combined = combineFrameScores(frames);
  if (frames.length >= 2) {
    for (let i = 0; i < labels.length; i++) {
      if (labels[i].category !== 'general') continue;
      const hits = frames.filter((f) => f[i] >= thresholds.general).length;
      if (hits < 2) combined[i] = 0;
    }
  }
  return selectTags(combined, labels, thresholds);
}

const videos = fs.readdirSync(args.videos).filter((f) => /\.(mp4|webm|mkv|mov|gif)$/i.test(f));
const results: Record<string, unknown>[] = [];

// Load the model once so the first video's timing isn't the session start.
const sharp = (await import('sharp')).default;
const warm = path.join(dataDir, 'warm.png');
await sharp({ create: { width: 64, height: 64, channels: 3, background: '#888888' } })
  .png()
  .toFile(warm);
await predictScores(warm);

let fakeId = 900000;
for (const file of videos) {
  const src = path.join(args.videos, file);
  const probe = await probeVideo(src);
  const duration = probe.durationSeconds;
  const thumb = await generateThumbnail(src, ++fakeId, 'video', duration);
  let t0 = performance.now();
  const single = selectTags(await predictScores(thumb), labels, thresholds);
  const singleMs = performance.now() - t0;
  const row: Record<string, unknown> = { file, duration, single: { ms: singleMs, tags: single } };

  for (const n of counts) {
    const times = frameTimes(duration, n);
    const frameDir = path.join(outDir, file, `n${n}`);
    fs.mkdirSync(frameDir, { recursive: true });
    t0 = performance.now();
    const scores = await withVideoFrames(src, times, async (frames) => {
      const out: Float32Array[] = [];
      for (const f of frames) out.push(await predictScores(f));
      return out;
    });
    const ms = performance.now() - t0;
    // Frames are gone after withVideoFrames; re-extract copies for inspection outside the timing.
    await withVideoFrames(src, times, async (frames) => {
      frames.forEach((f, i) => fs.copyFileSync(f, path.join(frameDir, `${times[i].toFixed(2)}s.png`)));
    });
    row[`n${n}`] = {
      ms,
      times,
      perFrame: scores.map((s) => tagNames(selectTags(s, labels, thresholds))),
      max: selectTags(combineFrameScores(scores), labels, thresholds),
      twoFrame: selectWithTwoFrameRule(scores),
    };
  }
  results.push(row);

  const s = new Set(tagNames(single));
  const parts = [`${file} (${duration?.toFixed(1)}s) single ${s.size} tags ${singleMs.toFixed(0)}ms`];
  for (const n of counts) {
    const r = row[`n${n}`] as { ms: number; max: Tag[]; twoFrame: Tag[] };
    const max = tagNames(r.max);
    const two = tagNames(r.twoFrame);
    parts.push(
      `n${n}: max ${max.length} (+${max.filter((t) => !s.has(t)).length}/-${[...s].filter((t) => !max.includes(t)).length})` +
        ` 2f ${two.length} (+${two.filter((t) => !s.has(t)).length}/-${[...s].filter((t) => !two.includes(t)).length}) ${r.ms.toFixed(0)}ms`,
    );
  }
  console.log(parts.join(' | '));
}

fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(0);
