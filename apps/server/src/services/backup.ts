import fs from 'node:fs';
import path from 'node:path';
import type { BackupFile, Job } from '@sakuya/shared';
import { DATA_DIR, DB_PATH } from '../lib/config';
import { backupKeep } from '../lib/settings';
import { enqueueJob } from './jobQueue';

export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const NAME = /^sakuya-[\dTZ-]+\.db$/;

export function listBackups(): BackupFile[] {
  const names = fs.existsSync(BACKUPS_DIR) ? fs.readdirSync(BACKUPS_DIR).filter((name) => NAME.test(name)) : [];
  return (
    names
      .map((name) => {
        const stat = fs.statSync(path.join(BACKUPS_DIR, name));
        return { name, sizeBytes: stat.size, createdAt: Math.round(stat.mtimeMs) };
      })
      // The name carries the UTC timestamp, so it orders correctly even after a copy resets mtime.
      .sort((a, b) => (a.name < b.name ? 1 : -1))
  );
}

/** Snapshot the database in a worker: VACUUM INTO on the request thread would stall every query while it ran. */
function vacuumInto(target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./backupWorker.ts', import.meta.url).href);
    worker.onmessage = (event: MessageEvent<{ error?: string }>) => {
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve();
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage({ source: DB_PATH, target });
  });
}

/**
 * Write a consistent copy of the database to `<dataDir>/backups/sakuya-<timestamp>.db`, then keep
 * only the newest `backup_keep`. The copy is written under a .part name and renamed when complete,
 * so a full disk or a crash never leaves a truncated file that looks like a backup.
 */
export async function runBackup(now: number = Date.now()): Promise<string> {
  const nameAt = (ms: number) =>
    path.join(BACKUPS_DIR, `sakuya-${new Date(ms).toISOString().replace(/[:.]/g, '-')}.db`);
  let file = nameAt(now);
  while (fs.existsSync(file)) file = nameAt(++now);
  const part = `${file}.part`;
  try {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    fs.rmSync(part, { force: true });
    await vacuumInto(part);
    fs.renameSync(part, file);
  } catch (err) {
    fs.rmSync(part, { force: true });
    throw new Error(`Backup to ${file} failed: ${(err as Error).message}`, { cause: err });
  }
  for (const old of listBackups().slice(backupKeep())) fs.rmSync(path.join(BACKUPS_DIR, old.name), { force: true });
  return file;
}

export function enqueueBackupJob(): Job {
  return enqueueJob(
    'backup',
    'Back up database',
    async () => `Completed. Backup written to ${await runBackup()}.`,
    null,
    'backup',
  );
}
