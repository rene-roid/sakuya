import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DOWNLOADER_BIN_DIR } from '../lib/config';
import { run } from '../lib/run';
import { downloadFile } from '../lib/download';
import { getSetting, setSetting } from '../lib/settings';
import { enqueueJob, type JobHandle } from './jobQueue';
import type { DownloaderStatus } from '@sakuya/shared';

const LOCAL_BIN_NAME = process.platform === 'win32' ? 'gallery-dl.exe' : 'gallery-dl';
const LOCAL_BIN_PATH = path.join(DOWNLOADER_BIN_DIR, LOCAL_BIN_NAME);

function runVersionCheck(bin: string): Promise<string | null> {
  return run(bin, ['--version']).then(
    (out) => out.trim(),
    () => null,
  );
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
    const url = `https://codeberg.org/mikf/gallery-dl/releases/download/latest/${asset}`;
    job.update({ total: 100, log: `Downloading ${asset}…` });

    let lastPct = 0;
    await downloadFile(url, LOCAL_BIN_PATH, (received, total) => {
      if (!total) return;
      const pct = Math.round((received / total) * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        job.update({ progress: pct, log: `Downloading: ${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB` });
      }
    });

    if (process.platform !== 'win32') {
      await fsp.chmod(LOCAL_BIN_PATH, 0o755);
    }

    const version = await runVersionCheck(LOCAL_BIN_PATH);
    if (!version) throw new Error('Downloaded binary failed to run (--version check failed)');
    setSetting('gallery_dl_path', LOCAL_BIN_PATH);
    return `Installed gallery-dl ${version}.`;
  });
}
