/**
 * Starts the server under the hard resource limits from sakuya.config.json.
 *
 *   bun src/launch.ts            production-style start
 *   bun src/launch.ts --watch    dev (what `bun dev` and run.sh / run.bat use)
 *   bun src/launch.ts --init     just create sakuya.config.json, then exit (setup scripts)
 *
 * lib/limits.ts keeps the app *asking* for no more than the budget; this makes the kernel hold it
 * to that, the way Docker's cpus / mem_limit do. A process can't cgroup itself, so the ceiling has
 * to be in place before the server starts — hence a launcher, wrapping only the server and not
 * the Vite dev server next to it:
 *
 *   Linux    a transient systemd scope (MemoryMax, CPUQuota) — the same kernel mechanism Docker uses
 *   Windows  a job object the launcher joins before spawning, so the server and everything it
 *            spawns inherits it (lib/windowsJob.ts)
 *   macOS    nothing equivalent; in-app limits only
 *   Docker   not used — the image runs src/index.ts directly under compose's cpus / mem_limit
 *
 * Everything fails soft to in-app limits: a limit that can't be applied should be reported, not be
 * the reason the server won't start. The server's own boot line then says what actually binds.
 */
import os from 'node:os';
import path from 'node:path';
import { ConfigError, formatBytes, loadConfig, type LoadedConfig } from '@sakuya/shared/config';
import { cpuLabel } from './lib/limits';
import { joinLimitedJob } from './lib/windowsJob';

const serverRoot = path.resolve(import.meta.dir, '..');

let loaded: LoadedConfig;
try {
  loaded = loadConfig({ create: true });
} catch (err) {
  // A typo in the file is the common case; the message names the file and the key, a stack doesn't help.
  if (!(err instanceof ConfigError)) throw err;
  console.error(`[sakuya] ${err.message}`);
  process.exit(1);
}
if (loaded.created) console.log(`[sakuya] ${loaded.created}`);
if (process.argv.includes('--init')) {
  if (!loaded.created) console.log(`[sakuya] Using ${loaded.file}`);
  process.exit(0);
}

const { cpus, memory } = loaded.config.limits;
const wanted = [memory !== null && `memory ${formatBytes(memory)}`, cpus !== null && cpuLabel(cpus)].filter(Boolean);

/**
 * Probe each property before committing to it. The cpu controller is commonly not delegated to user
 * slices even where memory is, and one refused property shouldn't cost the other — so try both,
 * then each alone. The probe is the only way to find out without masking the server's own exit code.
 */
function systemdScope(): { prefix: string[]; applied: string[] } | null {
  if (!Bun.which('systemd-run')) return null;
  const base = ['systemd-run', '--user', '--scope', '--collect', '--quiet'];
  const props: [string[], string][] = [];
  // MemorySwapMax=0: without it the scope pages out past MemoryMax instead of failing allocations,
  // which on a host with swap turns the ceiling into a slowdown rather than a limit.
  if (memory !== null) props.push([[`MemoryMax=${memory}`, 'MemorySwapMax=0'], `memory ${formatBytes(memory)}`]);
  // systemd counts a core as 100%, so 1.5 CPUs is CPUQuota=150%.
  if (cpus !== null) props.push([[`CPUQuota=${Math.round(cpus * 100)}%`], cpuLabel(cpus)]);
  const attempts = props.length > 1 ? [props, ...props.map((p) => [p])] : [props];
  for (const attempt of attempts) {
    const args = [...base, ...attempt.flatMap(([prop]) => prop.flatMap((p) => ['-p', p]))];
    if (Bun.spawnSync([...args, 'true'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0) {
      return { prefix: args, applied: attempt.map(([, label]) => label) };
    }
  }
  return null;
}

let prefix: string[] = [];
if (wanted.length && !loaded.docker) {
  if (process.platform === 'linux') {
    const scope = systemdScope();
    if (scope) {
      prefix = scope.prefix;
      const missed = wanted.filter((w) => !scope.applied.includes(w as string));
      console.log(
        `[sakuya] Hard limits via systemd: ${scope.applied.join(', ')}` +
          (missed.length ? ` (refused: ${missed.join(', ')} — that controller isn't delegated to your user)` : ''),
      );
    } else {
      console.log(
        `[sakuya] Could not apply ${wanted.join(', ')} as a hard limit (needs systemd-run with the controller ` +
          'delegated to your user). In-app limits still apply.',
      );
    }
  } else if (process.platform === 'win32') {
    const job = joinLimitedJob(memory, cpus, os.cpus().length);
    const applied = [job.memory && `memory ${formatBytes(memory!)}`, job.cpu && cpuLabel(cpus!)].filter(Boolean);
    console.log(
      applied.length
        ? `[sakuya] Hard limits via Windows job object: ${applied.join(', ')}`
        : `[sakuya] Could not apply ${wanted.join(', ')} as a hard limit${job.error ? ` (${job.error})` : ''}. In-app limits still apply.`,
    );
  } else {
    console.log(`[sakuya] ${wanted.join(', ')} can't be enforced on ${process.platform}; in-app limits still apply.`);
  }
}

const watch = process.argv.includes('--watch');
const child = Bun.spawn(
  [...prefix, process.execPath, ...(watch ? ['--watch'] : []), path.join(import.meta.dir, 'index.ts')],
  {
    cwd: serverRoot,
    stdio: ['inherit', 'inherit', 'inherit'],
  },
);

// A terminal's Ctrl+C reaches the child directly; this covers being stopped by a supervisor
// (bun --filter, systemd, a service manager) that only signals us.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}

process.exit(await child.exited);
