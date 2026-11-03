import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { useTestConfig } from './testConfig';

// The scanner opens the database on import (the GIF setting lives there).
const dataDir = useTestConfig('mediatypes');

const { mediaTypeForExt, isTransportStream } = await import('./services/scanner');
const { setSetting } = await import('./lib/settings');

test('extensions map to a media type whatever their case, and unknown ones to none', () => {
  expect(mediaTypeForExt('.JPG')).toBe('image');
  expect(mediaTypeForExt('.webp')).toBe('image');
  expect(mediaTypeForExt('.MKV')).toBe('video');
  expect(mediaTypeForExt('.ts')).toBe('video');
  for (const ext of ['.txt', '.zip', '.svg', '.html', '']) expect(mediaTypeForExt(ext)).toBeNull();
});

test('GIFs are images unless the setting says to treat them as videos', () => {
  expect(mediaTypeForExt('.gif')).toBe('image');
  setSetting('gifs_as_videos', '1');
  expect(mediaTypeForExt('.GIF')).toBe('video');
  setSetting('gifs_as_videos', '0');
  expect(mediaTypeForExt('.gif')).toBe('image');
});

test('a .ts file counts as video only when it starts with two transport stream packets', async () => {
  const write = (name: string, bytes: Uint8Array | string) => {
    const file = path.join(dataDir, name);
    fs.writeFileSync(file, bytes);
    return file;
  };
  const packets = new Uint8Array(188 * 2);
  packets[0] = 0x47;
  packets[188] = 0x47;
  expect(await isTransportStream(write('clip.ts', packets))).toBe(true);

  const oneSync = packets.slice();
  oneSync[188] = 0;
  expect(await isTransportStream(write('one-sync.ts', oneSync))).toBe(false);
  expect(await isTransportStream(write('short.ts', packets.slice(0, 100)))).toBe(false);
  expect(await isTransportStream(write('main.ts', 'export const x = 1;\n'.repeat(20)))).toBe(false);
  expect(await isTransportStream(path.join(dataDir, 'missing.ts'))).toBe(false);
});
