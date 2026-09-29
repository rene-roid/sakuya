/**
 * Oldest Bun Sakuya runs on. Bun 1.3.x on Windows has two bugs that take Sakuya down:
 *
 *   - sharp (thumbnails, perceptual hashes) crashes the process after a few dozen to a few hundred
 *     images, silently, mid-scan.
 *   - Vite's dev proxy, when it runs under Bun, buffers video without bound while the viewer seeks:
 *     tens of GB within seconds, and it sits outside the server's memory limit.
 *
 * Both reproduce on 1.3.6 and are gone on 1.4.2. Checked by the server launcher and by the Vite
 * config (the proxy only leaks under Bun, so Node-hosted Vite skips the check).
 */
export const MIN_BUN_VERSION = '1.4.2';

function parts(version: string): number[] {
  return version
    .split('-')[0]
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
}

/** True when `version` is older than `min`. Pre-release tags are ignored. */
export function isOlderVersion(version: string, min: string): boolean {
  const [a, b] = [parts(version), parts(min)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff < 0;
  }
  return false;
}

/** Why this Bun can't run Sakuya, or null when it can (or when this isn't Bun at all). */
export function unsupportedBunMessage(bunVersion: string | undefined = process.versions.bun): string | null {
  if (!bunVersion || !isOlderVersion(bunVersion, MIN_BUN_VERSION)) return null;
  return (
    `Sakuya needs Bun ${MIN_BUN_VERSION} or newer, but this is Bun ${bunVersion}. Older versions crash while ` +
    'generating thumbnails and can run away with memory while playing video. Run `bun upgrade`, then start again.'
  );
}
