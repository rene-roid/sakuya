import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import ffprobeStatic from 'ffprobe-static';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { db, schema } from '../db';
import { IMAGE_EXTS, VIDEO_EXTS } from '../lib/config';
import { aiTaggingEnabled } from '../lib/settings';
import { generateThumbnail, thumbPathFor } from './thumbnailer';
import { enqueueJob, type JobHandle } from './jobQueue';
import { enqueueTagJob, modelReady } from './tagger';

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
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.isFile() && mediaTypeForExt(path.extname(entry.name))) out.push(full);
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
  const stat = await fs.stat(filePath);
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

      if (aiTaggingEnabled() && modelReady()) {
        const untagged = db
          .select({ id: schema.media.id })
          .from(schema.media)
          .where(and(eq(schema.media.libraryId, libraryId), isNull(schema.media.taggedAt)))
          .all();
        if (untagged.length) {
          enqueueTagJob(untagged.map((r) => r.id), `AI tag: ${lib.name}`, libraryId);
        }
      }

      return `Completed. ${indexed} indexed, ${skipped} unchanged, ${pruned} removed${errors ? `, ${errors} errors` : ''}.`;
    },
    libraryId,
  );
}
