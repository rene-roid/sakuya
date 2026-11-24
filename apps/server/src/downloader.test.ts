import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { eq, desc } from 'drizzle-orm';
import { useTestConfig, waitForJob } from './testConfig';

const dataDir = useTestConfig('downloader');

const { db, sqlite, schema } = await import('./db');
const { setSetting } = await import('./lib/settings');
const { enqueueBatch, pauseItem, removeItem } = await import('./services/downloader');
const { restoreFromTrash } = await import('./services/trash');
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

test('removing a download with its files trashes each sidecar with its file, and reports a file it could not move', async () => {
  const folder = path.join(dataDir, 'remove-files');
  fs.mkdirSync(folder);
  const lib = db.insert(schema.libraries).values({ name: 'remove', createdAt: Date.now() }).returning().get();
  db.insert(schema.folders).values({ libraryId: lib.id, path: folder, createdAt: Date.now() }).run();
  const source = path.join(dataDir, 'remove-source.png');
  await sharp({ create: { width: 8, height: 8, channels: 3, background: '#996633' } }).png().toFile(source);
  // https://example.com/<sub>/<name> lands at <folder>/<sub>/<name>.png with its sidecar.
  const bin = path.join(dataDir, 'gallery-dl-remove');
  fs.writeFileSync(
    bin,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo 1.0.0; exit 0; fi
out="$3/\${1#https://example.com/}.png"
mkdir -p "$(dirname "$out")"
cp '${source}' "$out"
printf '%s' '{"category":"danbooru","id":1,"tag_string_artist":"david_revoy"}' > "$out.json"
echo "$out"
`,
    { mode: 0o755 },
  );
  setSetting('gallery_dl_path', bin);
  const { items } = enqueueBatch({
    libraryId: lib.id,
    folderPath: folder,
    urls: ['https://example.com/kept/a', 'https://example.com/locked/b'],
  });
  while (items.some((item) => statusOf(item.id) !== 'done')) await Bun.sleep(20);
  const scanJob = db.select().from(schema.jobs).where(eq(schema.jobs.type, 'scan')).orderBy(desc(schema.jobs.id)).get()!;
  expect((await waitForJob(scanJob.id)).status).toBe('done');
  const [a, b] = items.map((item) => item.id).sort((x, y) => x - y);

  expect(await removeItem(a, { deleteFiles: true })).toEqual({ deleted: 1, failed: [] });
  // The folder stays, empty, so the trashed file can still be restored into it.
  expect(fs.readdirSync(path.join(folder, 'kept'))).toEqual([]);
  const trashed = sqlite.query('SELECT id FROM trash').get() as { id: number };
  await restoreFromTrash(trashed.id);
  expect(fs.readdirSync(path.join(folder, 'kept')).sort()).toEqual(['a.png', 'a.png.json']);

  if (process.getuid?.() === 0) return; // root ignores the read-only bit
  const locked = path.join(folder, 'locked');
  fs.chmodSync(locked, 0o555);
  try {
    const result = await removeItem(b, { deleteFiles: true });
    expect(result.deleted).toBe(0);
    expect(result.failed.map((f) => f.error.split(':')[0])).toEqual(['Could not move to trash']);
  } finally {
    fs.chmodSync(locked, 0o755);
  }
  expect(fs.readdirSync(locked).sort()).toEqual(['b.png', 'b.png.json']);
});
