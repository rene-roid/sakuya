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
