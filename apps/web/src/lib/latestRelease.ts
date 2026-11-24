const REPO = 'rene-roid/sakuya';
const CACHE_V = 'sakuya:latest-release';
const CACHE_AT = 'sakuya:latest-release-at';
const DAY = 86_400_000;

export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The newest release tag on GitHub, cached for a day so the toast does not spend the API rate limit.
 * `force` skips the cache (Check now). Null when offline, rate limited or the tag is not X.Y.Z.
 */
export async function latestRelease({ force = false } = {}): Promise<string | null> {
  if (!force && Date.now() - Number(read(CACHE_AT)) < DAY) return read(CACHE_V);
  try {
    const { tag_name } = await (await fetch(`https://api.github.com/repos/${REPO}/releases/latest`)).json();
    const version = String(tag_name ?? '').replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
    try {
      localStorage.setItem(CACHE_V, version);
      localStorage.setItem(CACHE_AT, String(Date.now()));
    } catch {}
    return version;
  } catch {
    return null;
  }
}
