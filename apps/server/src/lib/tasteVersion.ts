/**
 * Monotonic marker for "something the Discover taste profile is derived from has changed".
 *
 * The profile is an aggregate over engagement columns on `media` and the whole `media_tags`
 * table, so it is expensive to build and changes rarely. Discover caches it and rebuilds when
 * this counter moves, which lets a like, a tag edit or a progress write take effect immediately
 * instead of waiting out a TTL.
 *
 * It lives in its own module so both route handlers and services can bump it without importing
 * a route, and so the value stays per-process — the test harness boots one server per file.
 */
let version = 0;

export function bumpTasteVersion(): void {
  version++;
}

export function tasteVersion(): number {
  return version;
}
