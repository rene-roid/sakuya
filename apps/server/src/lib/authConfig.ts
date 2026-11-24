import fs from 'node:fs';
import { authPinnedByEnv, loadConfig, writeAuthConfig } from '@sakuya/shared/config';
import type { AuthSettings } from '@sakuya/shared';
import { CONFIG, CONFIG_FILE, IN_DOCKER } from './config';

export const MAX_PASSWORD_LENGTH = 256;

/** Why the password can't be changed from the app here, or null when it can. */
function lockedReason(): string | null {
  const pinned = authPinnedByEnv();
  if (pinned.length) {
    return `Set by ${pinned.join(' and ')} in your Docker environment. Change it there and recreate the container.`;
  }
  try {
    fs.accessSync(CONFIG_FILE, fs.constants.W_OK);
    return null;
  } catch {
    return IN_DOCKER
      ? 'Docker mounts sakuya.config.json read-only. Drop read_only from its volume in docker-compose.yml, or edit the file on the host and restart the container.'
      : `${CONFIG_FILE} is read-only for the user running Sakuya.`;
  }
}

export function authSettings(): AuthSettings {
  return { enabled: CONFIG.auth.enabled, configFile: CONFIG_FILE, docker: IN_DOCKER, lockedReason: lockedReason() };
}

/** Persist the login to the config file and apply it at once. Throws if the file can't be written. */
export function saveAuth(auth: { enabled: boolean; secret: string }): void {
  writeAuthConfig(CONFIG_FILE, auth);
  CONFIG.auth = { ...auth };
}

/**
 * Pick up a hand edit of the auth section without a restart, so a forgotten password is fixed by
 * editing the file. Everything else in the file still needs a restart. A file that doesn't parse
 * (someone mid-edit) or turns login on with no password keeps the login as it was.
 */
export function reloadAuthFromFile(): void {
  let next: { enabled: boolean; secret: string };
  try {
    next = loadConfig().config.auth;
  } catch (err) {
    console.warn(`[sakuya] ${(err as Error).message} — keeping the current login`);
    return;
  }
  if (next.enabled === CONFIG.auth.enabled && next.secret === CONFIG.auth.secret) return;
  if (next.enabled && !next.secret) {
    console.warn(`[sakuya] auth.enabled is true but auth.secret is empty in ${CONFIG_FILE} — keeping the current login`);
    return;
  }
  CONFIG.auth = { ...next };
  console.log(`[sakuya] login ${next.enabled ? 'password updated' : 'turned off'} from ${CONFIG_FILE}`);
}

// Polling rather than fs.watch: editors save by replacing the file, which a native watch on the old
// inode misses. One stat every two seconds costs nothing.
export function watchConfigFile(): void {
  const watcher = fs.watchFile(CONFIG_FILE, { interval: 2000, persistent: false }, (curr, prev) => {
    if (curr.mtimeMs !== prev.mtimeMs || curr.ino !== prev.ino) reloadAuthFromFile();
  });
  (watcher as { unref?: () => void }).unref?.();
}
