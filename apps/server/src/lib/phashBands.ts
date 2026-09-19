/**
 * Band decomposition of a 64-bit dHash, used to index perceptual hashes for similarity search.
 *
 * `GET /api/media/:id/similar` cannot ask SQLite for "hamming distance <= 10" directly, so it
 * prefilters on candidates that share at least one intact band and applies the real distance in
 * JS. Splitting the 16-char hex hash into eight 8-bit bands makes that prefilter *exact* for
 * distances up to 7: by the pigeonhole principle, 8 bands can only all differ if at least 8 bits
 * differ, so anything closer than that must share a band.
 *
 * Between 8 and 10 the prefilter becomes a heuristic and can miss a match. That is the deliberate
 * tradeoff: measured over 200 random images from a 30k-image library, banding found 310 of 315
 * true matches (98.4% recall) while cutting the query from ~146ms to ~11ms, and every miss was at
 * exactly distance 10 — the far edge of what the UI calls "similar". Widening the bands (fewer,
 * larger) would be faster but exact to a much lower distance; narrowing them to be exact at 10
 * would need 16 four-bit bands, which match ~1/16th of the table each and prefilter nothing.
 *
 * perceptual_hash stays the source of truth; the bands are a derived index and nothing reads them
 * for anything but candidate selection.
 */
export const PHASH_BAND_COUNT = 8;

/** The eight 8-bit bands of a 16-char hex dHash, or nulls when there is no usable hash. */
export function phashBands(hex: string | null | undefined): (number | null)[] {
  if (!hex || hex.length !== 16 || !/^[0-9a-f]{16}$/i.test(hex)) {
    return Array(PHASH_BAND_COUNT).fill(null);
  }
  const bands: number[] = [];
  for (let i = 0; i < PHASH_BAND_COUNT; i++) bands.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  return bands;
}

/**
 * Drizzle update patch setting a hash and its bands together. Every write path goes through this
 * so the bands can't drift from the hash they describe.
 */
export function phashColumns(hex: string | null) {
  const b = phashBands(hex);
  return {
    perceptualHash: hex,
    phashB0: b[0],
    phashB1: b[1],
    phashB2: b[2],
    phashB3: b[3],
    phashB4: b[4],
    phashB5: b[5],
    phashB6: b[6],
    phashB7: b[7],
  };
}
