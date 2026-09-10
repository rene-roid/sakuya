import fs from 'node:fs';
import path from 'node:path';

/**
 * Copy a whole data dir to a new location, then delete the original. The caller must checkpoint and
 * close the SQLite handle first, otherwise the copied DB can land mid-transaction.
 *
 * Copy-then-delete rather than rename: home and the repo often sit on different filesystems, where
 * rename() fails outright.
 */
export function migrateDataDir(from: string, to: string): void {
  if (path.resolve(from) === path.resolve(to)) throw new Error('Source and target are the same folder');
  if (fs.existsSync(path.join(to, 'tbge.db'))) throw new Error(`${to} already holds a Sakuya database`);

  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true });

  const src = path.join(from, 'tbge.db');
  if (fs.existsSync(src)) {
    const dst = path.join(to, 'tbge.db');
    if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) {
      throw new Error('Copy verification failed — the original folder was left untouched');
    }
  }

  fs.rmSync(from, { recursive: true, force: true });
}
