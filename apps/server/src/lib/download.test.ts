import { afterAll, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadFile } from './download';

const payload = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
const server = Bun.serve({
  port: 0,
  fetch: (req) =>
    new URL(req.url).pathname === '/file' ? new Response(payload) : new Response('missing', { status: 404 }),
});
const url = (p: string) => `http://localhost:${server.port}${p}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-download-'));

afterAll(() => server.stop(true));

test('streams the body to the destination and reports progress up to the total', async () => {
  const dest = path.join(dir, 'model.onnx');
  const progress: [number, number][] = [];
  await downloadFile(url('/file'), dest, (received, total) => progress.push([received, total]));
  expect(new Uint8Array(fs.readFileSync(dest))).toEqual(payload);
  expect(progress.at(-1)).toEqual([payload.length, payload.length]);
  expect(fs.existsSync(`${dest}.part`)).toBe(false);
});

test('an error status rejects and writes nothing', async () => {
  const dest = path.join(dir, 'gone.bin');
  await expect(downloadFile(url('/nope'), dest, () => {})).rejects.toThrow('Download failed (404)');
  expect(fs.readdirSync(dir).filter((f) => f.startsWith('gone'))).toEqual([]);
});

test('a destination that cannot be written rejects instead of crashing the process', async () => {
  const dest = path.join(dir, 'no-such-dir', 'model.onnx');
  await expect(downloadFile(url('/file'), dest, () => {})).rejects.toThrow();
  expect(fs.existsSync(dest)).toBe(false);
});
