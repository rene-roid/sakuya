import fs from 'node:fs';
import fsp from 'node:fs/promises';

/** Stream `url` to `dest` via a `.part` temp file, so an interrupted download never leaves a truncated `dest`. */
export async function downloadFile(url: string, dest: string, onProgress: (received: number, total: number) => void) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const tmp = dest + '.part';
  const writer = fs.createWriteStream(tmp);
  let received = 0;
  try {
    for await (const chunk of res.body as any) {
      writer.write(chunk);
      received += chunk.length;
      onProgress(received, total);
    }
    await new Promise<void>((resolve, reject) => writer.end((err: any) => (err ? reject(err) : resolve())));
    await fsp.rename(tmp, dest);
  } catch (err) {
    writer.destroy();
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}
