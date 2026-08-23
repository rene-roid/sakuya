import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import ffprobeStatic from 'ffprobe-static';
import { eq, and, inArray } from 'drizzle-orm';
import { db, schema } from '../db';
import { IMAGE_EXTS, VIDEO_EXTS } from '../lib/config';
import { gifsAsVideos } from '../lib/settings';
import { generateThumbnail, thumbPathFor } from './thumbnailer';
import { enqueueJob, type JobHandle } from './jobQueue';
import { dispatchAfterScan } from './jobScheduler';
import { tryConvertUgoiraZip } from './ugoira';

const ffprobePath: string = ffprobeStatic.path;

interface ProbeResult {
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

export async function probeVideo(filePath: string): Promise<ProbeResult> {
  const json = await new Promise<string>((resolve, reject) => {
    const proc = spawn(
      ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`ffprobe: ${err.slice(-300)}`))));
  });
  const data = JSON.parse(json);
  const video = (data.streams ?? []).find((s: any) => s.codec_type === 'video');
  const duration = Number(data.format?.duration ?? video?.duration);
  return {
    width: video?.width ?? null,
    height: video?.height ?? null,
    durationSeconds: Number.isFinite(duration) ? duration : null,
  };
}

async function probeImage(filePath: string): Promise<ProbeResult> {
  const meta = await sharp(filePath).metadata();
  const swap = (meta.orientation ?? 1) >= 5;
  return {
    width: (swap ? meta.height : meta.width) ?? null,
    height: (swap ? meta.width : meta.height) ?? null,
    durationSeconds: null,
  };
}

/** Cheap content fingerprint: size + first 4 MB. Enough to detect changed files on re-scan. */
async function hashFile(filePath: string, size: number): Promise<string> {
  const hash = createHash('sha1');
  hash.update(String(size));
  const handle = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(Math.min(size, 4 * 1024 * 1024));
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    hash.update(buf.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

export function mediaTypeForExt(ext: string): 'image' | 'video' | null {
  const lower = ext.toLowerCase();
  if (lower === '.gif' && gifsAsVideos()) return 'video';
  if (IMAGE_EXTS.has(lower)) return 'image';
  if (VIDEO_EXTS.has(lower)) return 'video';
  return null;
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (ext.toLowerCase() === '.zip') {
      const gif = await tryConvertUgoiraZip(full);
      if (gif) out.push(gif);
      continue;
    }
    if (mediaTypeForExt(ext)) out.push(full);
  }
}

/**
 * Index a single file into `media` (used by both folder scans and uploads).
 * Returns the media id, or null if the file is unchanged since last index.
 */
export async function indexFile(
  filePath: string,
  libraryId: number,
  source: 'folder' | 'upload',
): Promise<number | null> {
  const type = mediaTypeForExt(path.extname(filePath));
  if (!type) return null;
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (err: any) {
    // Benign race: the file was present when the scan listed the folder but has since been
    // removed/renamed — most commonly by an in-progress download writing into the same
    // folder. Treat it as "nothing to index" instead of a scan error.
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
  const existing = db.select().from(schema.media).where(eq(schema.media.path, filePath)).get();
  if (existing && existing.mtime === Math.round(stat.mtimeMs) && existing.sizeBytes === stat.size) {
    return null; // unchanged
  }
  const contentHash = await hashFile(filePath, stat.size);
  if (existing && existing.contentHash === contentHash && existing.thumbnailPath) {
    db.update(schema.media)
      .set({ mtime: Math.round(stat.mtimeMs), sizeBytes: stat.size })
      .where(eq(schema.media.id, existing.id))
      .run();
    return null;
  }

  const probe = type === 'video' ? await probeVideo(filePath) : await probeImage(filePath);
  const now = Date.now();
  const values = {
    libraryId,
    source,
    path: filePath,
    filename: path.basename(filePath),
    type,
    width: probe.width,
    height: probe.height,
    sizeBytes: stat.size,
    durationSeconds: probe.durationSeconds,
    contentHash,
    mtime: Math.round(stat.mtimeMs),
    indexedAt: now,
  };

  let mediaId: number;
  if (existing) {
    db.update(schema.media).set(values).where(eq(schema.media.id, existing.id)).run();
    mediaId = existing.id;
  } else {
    const row = db.insert(schema.media).values({ ...values, createdAt: now }).returning().get();
    mediaId = row.id;
  }

  try {
    const thumb = await generateThumbnail(filePath, mediaId, type, probe.durationSeconds);
    db.update(schema.media).set({ thumbnailPath: thumb }).where(eq(schema.media.id, mediaId)).run();
  } catch (err) {
    console.error(`thumbnail failed for ${filePath}:`, err);
  }
  if (type === 'image') {
    try {
      const { computeDHash } = await import('./perceptualHash');
      const phash = await computeDHash(filePath);
      db.update(schema.media).set({ perceptualHash: phash }).where(eq(schema.media.id, mediaId)).run();
    } catch (err) {
      console.error(`perceptual hash failed for ${filePath}:`, err);
    }
  }
  return mediaId;
}

async function pruneMissing(libraryId: number, rootPath: string): Promise<number> {
  const rows = db
    .select({ id: schema.media.id, path: schema.media.path })
    .from(schema.media)
    .where(and(eq(schema.media.libraryId, libraryId), eq(schema.media.source, 'folder')))
    .all();
  const gone: number[] = [];
  for (const row of rows) {
    if (!row.path.startsWith(rootPath + path.sep)) continue;
    try {
      await fs.access(row.path);
    } catch {
      gone.push(row.id);
    }
  }
  if (gone.length) {
    db.delete(schema.media).where(inArray(schema.media.id, gone)).run();
    db.delete(schema.mediaTags).where(inArray(schema.mediaTags.mediaId, gone)).run();
    for (const id of gone) {
      fs.unlink(thumbPathFor(id)).catch(() => {});
    }
  }
  return gone.length;
}

/**
 * Existing media rows keep whatever type they were indexed with; flipping the "GIFs as
 * videos" setting only changes classification for files indexed afterwards. This job
 * retroactively reclassifies already-indexed .gif files to match the new setting.
 */
export function enqueueGifReclassifyJob(toVideo: boolean) {
  return enqueueJob(
    'reclassify-gifs',
    toVideo ? 'Reclassify GIFs as videos' : 'Reclassify GIFs as images',
    async (job: JobHandle) => {
      const fromType = toVideo ? 'image' : 'video';
      const rows = db
        .select()
        .from(schema.media)
        .where(eq(schema.media.type, fromType))
        .all()
        .filter((r) => r.path.toLowerCase().endsWith('.gif'));

      job.update({ total: rows.length, log: `Reclassifying ${rows.length} GIFs…` });
      let done = 0;
      let errors = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          if (toVideo) {
            const probe = await probeVideo(row.path);
            db.update(schema.media)
              .set({ type: 'video', durationSeconds: probe.durationSeconds, perceptualHash: null })
              .where(eq(schema.media.id, row.id))
              .run();
          } else {
            const { computeDHash } = await import('./perceptualHash');
            const phash = await computeDHash(row.path).catch(() => null);
            db.update(schema.media)
              .set({ type: 'image', durationSeconds: null, perceptualHash: phash })
              .where(eq(schema.media.id, row.id))
              .run();
          }
          done++;
        } catch (err) {
          errors++;
          console.error(`gif reclassify failed for ${row.path}:`, err);
        }
        if (i % 5 === 0 || i === rows.length - 1) {
          job.update({ progress: i + 1, log: `Reclassified ${i + 1}/${rows.length}…` });
        }
      }

      return `Completed. ${done} reclassified${errors ? `, ${errors} errors` : ''}.`;
    },
  );
}

export function enqueueScanJob(libraryId: number) {
  const lib = db.select().from(schema.libraries).where(eq(schema.libraries.id, libraryId)).get();
  if (!lib) throw new Error('Library not found');
  return enqueueJob(
    'scan',
    `Scan: ${lib.name}`,
    async (job: JobHandle) => {
      const libFolders = db.select().from(schema.folders).where(eq(schema.folders.libraryId, libraryId)).all();
      let indexed = 0;
      let skipped = 0;
      let errors = 0;
      let pruned = 0;

      for (const folder of libFolders) {
        db.update(schema.folders).set({ status: 'scanning' }).where(eq(schema.folders.id, folder.id)).run();
      }

      const files: string[] = [];
      for (const folder of libFolders) await walk(folder.path, files);
      job.update({ total: files.length, log: `Found ${files.length} files, indexing…` });

      for (let i = 0; i < files.length; i++) {
        try {
          const id = await indexFile(files[i], libraryId, 'folder');
          if (id !== null) indexed++;
          else skipped++;
        } catch (err) {
          errors++;
          console.error(`index failed for ${files[i]}:`, err);
        }
        if (i % 5 === 0 || i === files.length - 1) {
          job.update({ progress: i + 1, log: `Indexing ${i + 1}/${files.length} files…` });
        }
      }

      for (const folder of libFolders) {
        pruned += await pruneMissing(libraryId, folder.path);
        db.update(schema.folders)
          .set({ status: errors > 0 ? 'error' : 'indexed' })
          .where(eq(schema.folders.id, folder.id))
          .run();
      }

      dispatchAfterScan(libraryId);

      return `Completed. ${indexed} indexed, ${skipped} unchanged, ${pruned} removed${errors ? `, ${errors} errors` : ''}.`;
    },
    libraryId,
  );
}
