import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import AdmZip from 'adm-zip';

const ffmpegPath: string = (ffmpegStatic as unknown as string) ?? 'ffmpeg';

// gallery-dl's default pixiv ugoira output: "<illust_id>_p<n>.zip" containing
// zero-padded, sequentially numbered frame images and nothing else.
const PIXIV_UGOIRA_ZIP_NAME = /^\d+_p\d+\.zip$/i;
const UGOIRA_FRAME_NAME = /^\d+\.(jpe?g|png)$/i;

// Pixiv doesn't expose per-frame delays after the fact (they're only available during
// the live API fetch gallery-dl makes at download time), so already-downloaded zips get
// reassembled at a fixed frame rate instead of their real, now-unrecoverable timing.
const FALLBACK_FRAME_DELAY_SECONDS = 1 / 15;

function concatListEntry(framePath: string): string {
  // ffmpeg concat-demuxer quoting: wrap in single quotes, escape embedded single quotes.
  return `file '${framePath.replace(/'/g, "'\\''")}'`;
}

function looksLikeUgoiraZip(zip: AdmZip): boolean {
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (entries.length < 2) return false;
  return entries.every((e) => !e.entryName.includes('/') && UGOIRA_FRAME_NAME.test(e.entryName));
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${stderr.slice(-300)}`))));
  });
}

/**
 * Detects pixiv ugoira zips (frame dumps gallery-dl leaves behind without --ugoira) and
 * converts them to an animated gif in place. Returns the new gif path, or null if `zipPath`
 * doesn't look like one, a same-named gif already exists, or conversion failed.
 */
export async function tryConvertUgoiraZip(zipPath: string): Promise<string | null> {
  if (!PIXIV_UGOIRA_ZIP_NAME.test(path.basename(zipPath))) return null;

  const gifPath = zipPath.replace(/\.zip$/i, '.gif');
  if (fs.existsSync(gifPath)) return null;

  let zip: AdmZip;
  try {
    zip = new AdmZip(zipPath);
  } catch {
    return null;
  }
  if (!looksLikeUgoiraZip(zip)) return null;

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tbge-ugoira-'));
  try {
    zip.extractAllTo(tmpDir, true);
    const frames = (await fsp.readdir(tmpDir)).filter((f) => UGOIRA_FRAME_NAME.test(f)).sort();
    if (frames.length < 2) return null;

    // Explicit concat list rather than a "%06d" number pattern: pixiv ugoira zips can
    // have non-contiguous frame numbers (repeated frames get deduplicated on export), and
    // ffmpeg's image2 pattern demuxer silently stops at the first gap.
    const listLines = frames.map((f) => `${concatListEntry(path.join(tmpDir, f))}\nduration ${FALLBACK_FRAME_DELAY_SECONDS}`);
    listLines.push(concatListEntry(path.join(tmpDir, frames[frames.length - 1])));
    const listPath = path.join(tmpDir, 'frames.txt');
    await fsp.writeFile(listPath, listLines.join('\n'));

    const tmpGif = `${gifPath}.part`;
    await runFfmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-vf', 'split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
      '-f', 'gif',
      tmpGif,
    ]);
    if (!fs.existsSync(tmpGif)) throw new Error('ffmpeg did not produce an output file');

    await fsp.rename(tmpGif, gifPath);
    await fsp.unlink(zipPath);
    return gifPath;
  } catch (err) {
    console.error(`ugoira conversion failed for ${zipPath}:`, err);
    await fsp.unlink(`${gifPath}.part`).catch(() => {});
    return null;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}
