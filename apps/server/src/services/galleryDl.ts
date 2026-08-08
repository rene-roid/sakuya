import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DOWNLOADER_BIN_DIR } from '../lib/config';
import { getSetting, setSetting } from '../lib/settings';
import { enqueueJob, type JobHandle } from './jobQueue';
import type { DownloaderStatus } from '@sakuya/shared';

const LOCAL_BIN_NAME = process.platform === 'win32' ? 'gallery-dl.exe' : 'gallery-dl';
const LOCAL_BIN_PATH = path.join(DOWNLOADER_BIN_DIR, LOCAL_BIN_NAME);

function runVersionCheck(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    let out = '';
    proc.stdout?.on('data', (d) => (out += d));
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => resolve(code === 0 ? out.trim() : null));
  });
}

/** Locate a working gallery-dl binary: cached setting -> bundled install -> PATH. */
export async function detectGalleryDl(): Promise<DownloaderStatus> {
  const cached = getSetting('gallery_dl_path');
  if (cached && fs.existsSync(cached)) {
    const version = await runVersionCheck(cached);
    if (version) return { installed: true, path: cached, version };
  }

  if (fs.existsSync(LOCAL_BIN_PATH)) {
    const version = await runVersionCheck(LOCAL_BIN_PATH);
    if (version) {
      setSetting('gallery_dl_path', LOCAL_BIN_PATH);
      return { installed: true, path: LOCAL_BIN_PATH, version };
    }
  }

  const version = await runVersionCheck('gallery-dl');
  if (version) {
    setSetting('gallery_dl_path', 'gallery-dl');
    return { installed: true, path: 'gallery-dl', version };
  }

  return { installed: false, path: null, version: null };
}

function releaseAssetName(): string {
  return process.platform === 'win32' ? 'gallery-dl.exe' : 'gallery-dl.bin';
}

export function installGalleryDl() {
  return enqueueJob('downloader-install', 'Install gallery-dl', async (job: JobHandle) => {
    const asset = releaseAssetName();
    const url = `https://github.com/mikf/gallery-dl/releases/latest/download/${asset}`;
    job.update({ total: 100, log: `Downloading ${asset}…` });

    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
    const total = Number(res.headers.get('content-length') ?? 0);
    const tmp = LOCAL_BIN_PATH + '.part';
    const writer = fs.createWriteStream(tmp);
    let received = 0;
    let lastPct = 0;
    try {
      for await (const chunk of res.body as any) {
        writer.write(chunk);
        received += chunk.length;
        if (total) {
          const pct = Math.round((received / total) * 100);
          if (pct !== lastPct) {
            lastPct = pct;
            job.update({ progress: pct, log: `Downloading: ${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB` });
          }
        }
      }
      await new Promise<void>((resolve, reject) => writer.end((err: any) => (err ? reject(err) : resolve())));
      await fsp.rename(tmp, LOCAL_BIN_PATH);
    } catch (err) {
      writer.destroy();
      await fsp.unlink(tmp).catch(() => {});
      throw err;
    }

    if (process.platform !== 'win32') {
      await fsp.chmod(LOCAL_BIN_PATH, 0o755);
    }

    const version = await runVersionCheck(LOCAL_BIN_PATH);
    if (!version) throw new Error('Downloaded binary failed to run (--version check failed)');
    setSetting('gallery_dl_path', LOCAL_BIN_PATH);
    return `Installed gallery-dl ${version}.`;
  });
}
