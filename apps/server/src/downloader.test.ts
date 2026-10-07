import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { useTestConfig } from './testConfig';

const dataDir = useTestConfig('downloader');

const { db, schema } = await import('./db');
const { setSetting } = await import('./lib/settings');
const { enqueueBatch, pauseItem } = await import('./services/downloader');
const { startConsoleSession, stopConsoleSession, getConsoleStatus } = await import('./services/consoleSession');

/**
 * A stand-in gallery-dl whose `--version` takes 300ms, like a cold start of the real binary. Every
 * version check and every download it is asked for is appended to its own log.
 */
function fakeGalleryDl(name: string) {
  const bin = path.join(dataDir, name);
  const versionLog = `${bin}.versions`;
  const runLog = `${bin}.runs`;
  fs.writeFileSync(
    bin,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo x >> '${versionLog}'; sleep 0.3; echo 1.0.0; exit 0; fi
echo "$1" >> '${runLog}'
`,
    { mode: 0o755 },
  );
  const lines = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n') : []);
  return { bin, versionChecks: () => lines(versionLog).length, runs: () => lines(runLog) };
}

const library = db.insert(schema.libraries).values({ name: 'downloads', createdAt: Date.now() }).returning().get();
const target = path.join(dataDir, 'downloads');
fs.mkdirSync(target);

const statusOf = (id: number) => db.select().from(schema.downloadItems).where(eq(schema.downloadItems.id, id)).get()!.status;

test('an item paused while gallery-dl is being located stays paused and never runs', async () => {
  const fake = fakeGalleryDl('gallery-dl-pause');
  setSetting('gallery_dl_path', fake.bin);
  const [item] = enqueueBatch({ libraryId: library.id, folderPath: target, urls: ['https://example.com/a'] }).items;

  await Bun.sleep(50);
  pauseItem(item.id);
  await Bun.sleep(700);

  expect(statusOf(item.id)).toBe('paused');
  expect(fake.runs()).toEqual([]);
});

test('gallery-dl is located once, not once per downloaded item', async () => {
  const fake = fakeGalleryDl('gallery-dl-cached');
  setSetting('gallery_dl_path', fake.bin);
  const urls = ['https://example.com/1', 'https://example.com/2', 'https://example.com/3'];
  const { items } = enqueueBatch({ libraryId: library.id, folderPath: target, urls });

  while (items.some((item) => statusOf(item.id) !== 'done')) await Bun.sleep(20);

  expect(fake.runs().sort()).toEqual(urls);
  expect(fake.versionChecks()).toBe(1);
});

test('two console sessions started at once leave one running and refuse the other', async () => {
  setSetting('gallery_dl_path', fakeGalleryDl('gallery-dl-console').bin);

  const results = await Promise.allSettled([startConsoleSession('--help'), startConsoleSession('--help')]);
  expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  expect(refused.reason.status).toBe(409);

  stopConsoleSession();
  while (getConsoleStatus().running) await Bun.sleep(20);
});
