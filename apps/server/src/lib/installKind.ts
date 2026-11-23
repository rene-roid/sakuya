import fs from 'node:fs';
import type { InstallKind } from '@sakuya/shared';

/** desktop/main.js sets SAKUYA_DESKTOP=1 for the server it spawns; Docker puts /.dockerenv in every container. */
export function installKind(env: NodeJS.ProcessEnv = process.env, dockerEnvFile = '/.dockerenv'): InstallKind {
  if (env.SAKUYA_DESKTOP === '1') return 'desktop';
  if (fs.existsSync(dockerEnvFile)) return 'docker';
  return 'source';
}
