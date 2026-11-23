import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { useTestConfig, waitForJob } from './testConfig';

const dataDir = useTestConfig('video-tagging', { port: 38951 }); // V01
const BASE = 'http://localhost:38951';

// A stand-in tagger: the mean of each colour channel over 300, so a solid-colour frame scores ~0.85
// on its own colour (dividing by 255 lands a float32 mean just over 1, which reads as a logit). The
// tagger feeds the model BGR, so the labels are blue, green, red.
fs.mkdirSync(path.join(dataDir, 'models'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'models', 'model.onnx'), channelMeanModel());
fs.writeFileSync(
  path.join(dataDir, 'models', 'selected_tags.csv'),
  'tag_id,name,category,count\n1,blue_theme,0,10\n2,green_theme,0,10\n3,red_theme,0,10\n',
);

const { distinctFrames, frameSignature, frameTimes } = await import('./services/videoFrames');
const { combineFrameScores, selectTags, parseLabels } = await import('./services/tagger');
const { generateThumbnail } = await import('./services/thumbnailer');
const { probeVideo } = await import('./services/scanner');
const { FFMPEG_PATH, run } = await import('./lib/run');
const { db, schema } = await import('./db');
await import('./index');

describe('frameTimes', () => {
  test('spreads frames evenly between the first and last second', () => {
    expect(frameTimes(24, 5)).toEqual([3.2, 7.6, 12, 16.4, 20.8]);
    expect(frameTimes(5, 5)).toEqual([1.3, 1.9, 2.5, 3.1, 3.7]);
  });

  test('a video too short to spare its edges is sampled across its whole length, with fewer frames', () => {
    expect(frameTimes(2, 5)).toEqual([0.25, 0.75, 1.25, 1.75]);
    expect(frameTimes(0.4, 5)).toEqual([0.2]);
  });

  test('a long video costs the same five frames as a short one', () => {
    expect(frameTimes(7200, 5)).toEqual([720.8, 2160.4, 3600, 5039.6, 6479.2]);
  });

  test('an unknown or empty duration gives no frames', () => {
    expect(frameTimes(null, 5)).toEqual([]);
    expect(frameTimes(0, 5)).toEqual([]);
    expect(frameTimes(Number.NaN, 5)).toEqual([]);
  });
});

describe('distinctFrames', () => {
  const red = { hash: '0000000000000000', mean: [200, 10, 10] as [number, number, number] };

  test('a frame with the layout and colours of one already kept is not tagged again', () => {
    const nearRed = { hash: '000000000000000f', mean: [205, 12, 8] as [number, number, number] };
    const blue = { hash: '0000000000000000', mean: [10, 10, 200] as [number, number, number] };
    const otherLayout = { hash: 'ffffffff00000000', mean: [200, 10, 10] as [number, number, number] };
    expect(distinctFrames([red, nearRed, blue, red, otherLayout])).toEqual([0, 2, 4]);
  });

  test('five frames of a still video come down to one', () => {
    expect(distinctFrames([red, red, red, red, red])).toEqual([0]);
  });

  test('signatures of real frames tell colours apart even when the layout matches', async () => {
    const dir = path.join(dataDir, 'signatures');
    fs.mkdirSync(dir, { recursive: true });
    const solid = async (name: string, background: string) => {
      const file = path.join(dir, name);
      await sharp({ create: { width: 64, height: 36, channels: 3, background } })
        .png()
        .toFile(file);
      return frameSignature(file);
    };
    const frames = [await solid('a.png', '#c81010'), await solid('b.png', '#ca1412'), await solid('c.png', '#1010c8')];
    expect(frames[0].hash).toBe(frames[2].hash);
    expect(distinctFrames(frames)).toEqual([0, 2]);
  });
});

describe('combineFrameScores', () => {
  const labels = parseLabels('tag_id,name,category,count\n1,general,9,1\n2,1girl,0,1\n3,outdoors,0,1\n4,night,0,1\n');

  test('max confidence across frames wins', () => {
    const combined = combineFrameScores([
      new Float32Array([0.9, 0.8, 0.1, 0.2]),
      new Float32Array([0.7, 0.3, 0.6, 0.1]),
      new Float32Array([0.8, 0.5, 0.2, 0.3]),
    ]);
    expect([...combined].map((v) => +v.toFixed(2))).toEqual([0.9, 0.8, 0.6, 0.3]);
    const tags = selectTags(combined, labels, { general: 0.35, character: 0.85 });
    expect(tags.map((t) => `${t.name}:${t.confidence.toFixed(2)}`)).toEqual([
      'general:0.90',
      '1girl:0.80',
      'outdoors:0.60',
    ]);
  });

  test('raw logits are squashed per frame before they are compared', () => {
    const combined = combineFrameScores([new Float32Array([-5, 5, 0, -5]), new Float32Array([0.2, 0.1, 0.7, 0.1])]);
    expect([...combined].map((v) => +v.toFixed(3))).toEqual([0.2, 0.993, 0.7, 0.1]);
  });
});

describe('tagging a video', () => {
  const work = path.join(dataDir, 'videos');
  fs.mkdirSync(work, { recursive: true });
  const library = db.insert(schema.libraries).values({ name: 'videos', createdAt: Date.now() }).returning().get();

  async function makeVideo(name: string, scenes: [color: string, seconds: number][]): Promise<string> {
    const file = path.join(work, name);
    const inputs = scenes.flatMap(([c, d]) => ['-f', 'lavfi', '-i', `color=c=${c}:s=320x320:r=10:d=${d}`]);
    const concat = scenes.map((_, i) => `[${i}]`).join('') + `concat=n=${scenes.length}:v=1[v]`;
    await run(FFMPEG_PATH, [
      '-v',
      'error',
      '-y',
      ...inputs,
      '-filter_complex',
      concat,
      '-map',
      '[v]',
      '-pix_fmt',
      'yuv420p',
      file,
    ]);
    return file;
  }

  async function addVideo(file: string, { duration }: { duration?: number | null } = {}): Promise<number> {
    const probed = (await probeVideo(file)).durationSeconds;
    const row = db
      .insert(schema.media)
      .values({
        libraryId: library.id,
        source: 'folder',
        path: file,
        filename: path.basename(file),
        type: 'video',
        durationSeconds: duration === undefined ? probed : duration,
        createdAt: Date.now(),
      })
      .returning()
      .get();
    // The scanner's thumbnail: one frame at 30% of the way in.
    await generateThumbnail(file, row.id, 'video', probed);
    return row.id;
  }

  async function retag(id: number): Promise<string[]> {
    const res = await fetch(`${BASE}/api/media/${id}/retag`, { method: 'POST' });
    expect(res.status).toBe(200);
    const { job } = (await res.json()) as { job: { id: number } };
    expect((await waitForJob(job.id)).status).toBe('done');
    const detail = (await (await fetch(`${BASE}/api/media/${id}`)).json()) as { tags: { name: string }[] };
    return detail.tags.map((t) => t.name).sort();
  }

  const leftoverFrames = () => {
    const dir = path.join(dataDir, 'video-frames');
    return fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }) : [];
  };

  test('a video whose second half is another scene gains tags from both halves', async () => {
    const id = await addVideo(
      await makeVideo('two-scenes.mp4', [
        ['red', 3],
        ['blue', 3],
      ]),
    );
    expect(await retag(id)).toEqual(['blue_theme', 'red_theme']);
    expect(leftoverFrames()).toEqual([]);
  });

  test('a video with no known duration is tagged from its thumbnail frame alone', async () => {
    const id = await addVideo(
      await makeVideo('no-duration.mp4', [
        ['red', 3],
        ['blue', 3],
      ]),
      { duration: null },
    );
    expect(await retag(id)).toEqual(['red_theme']);
  });

  test('a video ffmpeg cannot decode falls back to its thumbnail frame', async () => {
    const good = await makeVideo('broken.mp4', [
      ['green', 3],
      ['blue', 3],
    ]);
    const id = await addVideo(good);
    fs.writeFileSync(good, Buffer.alloc(4096, 7));
    expect(await retag(id)).toEqual(['green_theme']);
    expect(leftoverFrames()).toEqual([]);
  });

  test('a video shorter than a second is still tagged', async () => {
    const id = await addVideo(await makeVideo('blip.mp4', [['green', 0.4]]));
    expect(await retag(id)).toEqual(['green_theme']);
  });

  test('a tag removed by hand stays off when the video is re-tagged', async () => {
    const id = await addVideo(
      await makeVideo('veto.mp4', [
        ['red', 3],
        ['blue', 3],
      ]),
    );
    expect(await retag(id)).toEqual(['blue_theme', 'red_theme']);
    const patch = await fetch(`${BASE}/api/media/${id}/tags`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remove: ['blue_theme'] }),
    });
    expect(patch.status).toBe(200);
    expect(await retag(id)).toEqual(['red_theme']);
  });

  test('images are still tagged from the original file', async () => {
    const file = path.join(work, 'still.png');
    await sharp({ create: { width: 64, height: 64, channels: 3, background: '#0000ff' } })
      .png()
      .toFile(file);
    const id = db
      .insert(schema.media)
      .values({
        libraryId: library.id,
        source: 'folder',
        path: file,
        filename: 'still.png',
        type: 'image',
        createdAt: Date.now(),
      })
      .returning()
      .get().id;
    expect(await retag(id)).toEqual(['blue_theme']);
  });
});

/** ONNX for `ReduceMean(input, axes=[1,2]) / 300`, NHWC [1,448,448,3] in, [1,3] out, hand-encoded as protobuf. */
function channelMeanModel(): Uint8Array {
  const varint = (n: number): number[] => {
    const out: number[] = [];
    for (; n > 127; n = Math.floor(n / 128)) out.push((n % 128) | 128);
    out.push(n);
    return out;
  };
  const int = (field: number, n: number) => [...varint(field << 3), ...varint(n)];
  const bytes = (field: number, b: number[] | Uint8Array) => [...varint((field << 3) | 2), ...varint(b.length), ...b];
  const str = (field: number, s: string) => bytes(field, new TextEncoder().encode(s));

  const valueInfo = (name: string, dims: number[]) => {
    const shape = dims.flatMap((d) => bytes(1, int(1, d)));
    return [...str(1, name), ...bytes(2, bytes(1, [...int(1, 1), ...bytes(2, shape)]))];
  };
  const reduceMean = [
    ...str(1, 'input'),
    ...str(2, 'mean'),
    ...str(4, 'ReduceMean'),
    ...bytes(5, [...str(1, 'axes'), ...int(8, 1), ...int(8, 2), ...int(20, 7)]),
    ...bytes(5, [...str(1, 'keepdims'), ...int(3, 0), ...int(20, 2)]),
  ];
  const divide = [...str(1, 'mean'), ...str(1, 'scale'), ...str(2, 'output'), ...str(4, 'Div')];
  const scale = [...int(2, 1), ...bytes(4, new Uint8Array(new Float32Array([300]).buffer)), ...str(8, 'scale')];
  const graph = [
    ...bytes(1, reduceMean),
    ...bytes(1, divide),
    ...str(2, 'channel-mean'),
    ...bytes(5, scale),
    ...bytes(11, valueInfo('input', [1, 448, 448, 3])),
    ...bytes(12, valueInfo('output', [1, 3])),
  ];
  return new Uint8Array([...int(1, 7), ...bytes(8, int(2, 13)), ...bytes(7, graph)]);
}
