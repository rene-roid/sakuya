import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

/**
 * Stream `url` to `dest` via a `.part` temp file, so an interrupted download never leaves a truncated `dest`.
 *
 * pipeline() is what makes a write error (disk full, a missing folder) reject this call: a bare
 * WriteStream reports it as an 'error' event, which with no listener crashes the process. It also
 * waits on the disk, rather than buffering a 400 MB model in memory when the network is faster.
 */
export async function downloadFile(url: string, dest: string, onProgress: (received: number, total: number) => void) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const tmp = dest + '.part';
  let received = 0;
  try {
    await pipeline(
      Readable.fromWeb(res.body as NodeReadableStream<Uint8Array>),
      async function* (source: AsyncIterable<Uint8Array>) {
        for await (const chunk of source) {
          received += chunk.length;
          onProgress(received, total);
          yield chunk;
        }
      },
      fs.createWriteStream(tmp),
    );
    await fsp.rename(tmp, dest);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}
