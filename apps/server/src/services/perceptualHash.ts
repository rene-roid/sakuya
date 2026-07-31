import sharp from 'sharp';

/**
 * 64-bit difference hash (dHash). Downscale to 9x8 grayscale, compare each pixel
 * to its right neighbour, pack the 64 comparisons into a 16-char hex string.
 */
export async function computeDHash(imagePath: string): Promise<string> {
  const w = 9;
  const h = 8;
  const raw = await sharp(imagePath, { animated: false })
    .rotate()
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .grayscale()
    .resize(w, h, { fit: 'fill' })
    .raw()
    .toBuffer();
  // raw is w*h grayscale bytes (1 channel).
  let bits = '';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const left = raw[y * w + x];
      const right = raw[y * w + x + 1];
      bits += left > right ? '1' : '0';
    }
  }
  // bits is 64 chars → 16 hex chars.
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

const POPCOUNT = new Uint8Array(16);
for (let i = 0; i < 16; i++) POPCOUNT[i] = (i & 1) + ((i >> 1) & 1) + ((i >> 2) & 1) + ((i >> 3) & 1);

/** Hamming distance between two 16-char hex dHash strings (0..64). */
export function hammingDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    dist += POPCOUNT[xor];
  }
  return dist;
}
