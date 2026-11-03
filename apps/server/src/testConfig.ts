import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Point this test process at a throwaway sakuya.config.json whose data dir is a fresh temp folder,
 * so a test never reads, creates or boots against the real one. Must run before anything imports
 * lib/config — hence every server test dynamic-imports the app after calling this.
 *
 * Returns the data dir.
 */
export function useTestConfig(
  name: string,
  { port, auth }: { port?: number; auth?: { enabled: boolean; secret: string } } = {},
): string {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `sakuya-${name}-`));
  const file = path.join(dataDir, 'sakuya.config.json');
  fs.writeFileSync(file, JSON.stringify({ server: { dataDir, ...(port ? { port } : {}) }, ...(auth ? { auth } : {}) }));
  process.env.SAKUYA_CONFIG = file;
  return dataDir;
}

/**
 * Poll a job row until it is done or errored, and return it. Imports the database lazily: this
 * module is loaded before useTestConfig runs, so it must not open the database itself.
 */
export async function waitForJob(id: number, timeoutMs = 30_000) {
  const { db, schema } = await import('./db');
  const { eq } = await import('drizzle-orm');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get()!;
    if (row.status === 'done' || row.status === 'error') return row;
    if (Date.now() > deadline) throw new Error(`job ${id} still ${row.status} after ${timeoutMs}ms`);
    await Bun.sleep(10);
  }
}
