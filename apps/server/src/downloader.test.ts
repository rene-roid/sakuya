import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { eq, desc } from 'drizzle-orm';
import { useTestConfig, waitForJob } from './testConfig';

const dataDir = useTestConfig('downloader');

const { db, sqlite, schema } = await import('./db');
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

test('downloads write a metadata sidecar, and the scan after the batch reads its artist and post URL', async () => {
  const folder = path.join(dataDir, 'with-metadata');
  fs.mkdirSync(folder);
  const lib = db.insert(schema.libraries).values({ name: 'metadata', createdAt: Date.now() }).returning().get();
  db.insert(schema.folders).values({ libraryId: lib.id, path: folder, createdAt: Date.now() }).run();
  const source = path.join(dataDir, 'post.png');
  await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } }).png().toFile(source);
  // Like the real binary: --write-metadata puts <file>.json next to each file, and only the media
  // path is printed.
  const bin = path.join(dataDir, 'gallery-dl-metadata');
  fs.writeFileSync(
    bin,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo 1.0.0; exit 0; fi
out='${folder}/danbooru_4242.png'
cp '${source}' "$out"
for arg in "$@"; do
  if [ "$arg" = "--write-metadata" ]; then
    printf '%s' '{"category":"danbooru","id":4242,"tag_string_artist":"david_revoy","tag_string_copyright":"pepper&carrot"}' > "$out.json"
  fi
done
echo "$out"
`,
    { mode: 0o755 },
  );
  setSetting('gallery_dl_path', bin);
  const [item] = enqueueBatch({ libraryId: lib.id, folderPath: folder, urls: ['https://example.com/post/4242'] }).items;

  while (statusOf(item.id) !== 'done') await Bun.sleep(20);
  const scanJob = db.select().from(schema.jobs).where(eq(schema.jobs.type, 'scan')).orderBy(desc(schema.jobs.id)).get()!;
  expect((await waitForJob(scanJob.id)).status).toBe('done');

  expect(fs.readdirSync(folder).sort()).toEqual(['danbooru_4242.png', 'danbooru_4242.png.json']);
  const media = db.select().from(schema.media).where(eq(schema.media.libraryId, lib.id)).all();
  expect(media.map((m) => [m.filename, m.sourceUrl])).toEqual([
    ['danbooru_4242.png', 'https://danbooru.donmai.us/posts/4242'],
  ]);
  const tags = sqlite
    .query(
      `SELECT t.name, t.category, mt.source FROM media_tags mt JOIN tags t ON t.id = mt.tag_id
       WHERE mt.media_id = ? ORDER BY t.name`,
    )
    .all(media[0].id);
  expect(tags).toEqual([
    { name: 'david_revoy', category: 'artist', source: 'meta' },
    { name: 'pepper&carrot', category: 'copyright', source: 'meta' },
  ]);
});
