const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** IEEE 754 half precision, round to nearest even. */
function toHalf(value: number): number {
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  const e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - e;
    let half = mant >>> shift;
    const rem = mant & ((1 << shift) - 1);
    const mid = 1 << (shift - 1);
    if (rem > mid || (rem === mid && half & 1)) half++;
    return sign | half;
  }
  let half = sign | (e << 10) | (mant >>> 13);
  const rem = mant & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && half & 1)) half++;
  return half;
}

function fromHalf(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >>> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 0x1f) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

/** Pack a vector as little-endian float16: a 768-value embedding takes 1.5 KB. */
export function packFloat16(values: ArrayLike<number>): Buffer {
  const out = Buffer.alloc(values.length * 2);
  for (let i = 0; i < values.length; i++) out.writeUInt16LE(toHalf(values[i]), i * 2);
  return out;
}

let halfTable: Float32Array | null = null;

/** Every float16 bit pattern's value, for decoding by lookup. */
export function float16Table(): Float32Array {
  if (!halfTable) {
    halfTable = new Float32Array(65536);
    for (let h = 0; h < 65536; h++) halfTable[h] = fromHalf(h);
  }
  return halfTable;
}

export function unpackFloat16(buf: Uint8Array): Float32Array {
  // A lookup per value: clustering decodes every stored embedding on each run.
  const table = float16Table();
  const out = new Float32Array(buf.byteLength / 2);
  for (let i = 0; i < out.length; i++) out[i] = table[buf[i * 2] | (buf[i * 2 + 1] << 8)];
  return out;
}

export function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/** For unit vectors, their cosine similarity. */
export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
