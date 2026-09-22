/**
 * Resource limits for running outside Docker.
 *
 * `docker-compose.yml` caps this app with `cpus` and `mem_limit`, which are kernel cgroup limits:
 * the kernel itself refuses to schedule past the quota and OOM-kills past the memory bound. A
 * process cannot impose that on itself, so what this module does instead is cap the *parallelism
 * that drives* the consumption — how many jobs run at once, and how many threads each of the
 * native libraries underneath them is allowed to spawn.
 *
 * For CPU that lands very close to `cpus: "2.0"`. For memory it is an influence rather than a
 * ceiling: peak RSS is roughly concurrency x per-task peak, and most of it lives outside the JS
 * heap anyway (libvips buffers, onnxruntime arenas, ffmpeg children), which is exactly why
 * SAKUYA_MAX_MEMORY is *not* read here. It is consumed by run.sh, which can hand it to systemd as
 * a real MemoryMax. Enforcing it from inside the process would be theatre.
 *
 * Unset, every value below is what it was when these numbers were hardcoded across the services —
 * upgrading without a .env changes nothing. Note that at SAKUYA_MAX_CPUS=2 the derivations
 * reproduce those old constants exactly; see limits.test.ts.
 */
import os from 'node:os';

export interface Limits {
  /** Effective CPU budget, or null when unset (no derivation happens). */
  maxCpus: number | null;
  /** How many background jobs (scan/tag/thumbnail/transcode) may run at once. */
  jobConcurrency: number;
  /** `-threads` for transcoding, or null to let ffmpeg pick (one thread per core). */
  ffmpegThreads: number | null;
  /** onnxruntime threads within a single operator. The tagger's dominant cost. */
  onnxIntraOpThreads: number;
  /** onnxruntime threads across independent operators. */
  onnxInterOpThreads: number;
  /** libvips worker pool for sharp, or null for its default (one thread per core). */
  sharpConcurrency: number | null;
}

/** What the services used before any of this was configurable. */
const UNCONFIGURED: Limits = {
  maxCpus: null,
  jobConcurrency: 2,
  ffmpegThreads: null,
  onnxIntraOpThreads: 2,
  onnxInterOpThreads: 1,
  sharpConcurrency: null,
};

const MEMORY_UNITS: Record<string, number> = {
  b: 1,
  k: 1024,
  kb: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4,
};

/**
 * Accepts what Docker accepts — "2g", "512m", "1.5G" — plus a bare byte count. Returns null for
 * anything unparseable rather than throwing: a typo in a limit should not stop the server from
 * booting, it should fall back to being unlimited and say so.
 */
export function parseMemory(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(raw);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === '' ? 1 : MEMORY_UNITS[unit];
  if (!multiplier || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value * multiplier);
}

/** Positive, finite CPU count. Fractional is allowed ("1.5") to mirror Docker's `cpus`. */
function parseCpus(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** A granular override: positive integer, or null to fall through to the derived value. */
function parseCount(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

/**
 * Resolve the limits from an environment. Pure and env-injected so the derivation can be tested
 * without a server or a real .env.
 */
export function resolveLimits(env: NodeJS.ProcessEnv = process.env): Limits {
  const maxCpus = parseCpus(env.SAKUYA_MAX_CPUS);

  // Derive from the CPU budget, or keep the old hardcoded constants when there is no budget.
  // Every derived value floors at 1: a budget of "0.5" still has to be able to run one job.
  const derived: Limits = maxCpus
    ? (() => {
        const jobConcurrency = Math.max(1, Math.floor(maxCpus));
        return {
          maxCpus,
          jobConcurrency,
          // Split the budget across the jobs that may run concurrently, so N transcodes at
          // N threads each can't add up to more than the budget.
          ffmpegThreads: Math.max(1, Math.floor(maxCpus / jobConcurrency)),
          onnxIntraOpThreads: Math.max(1, Math.floor(maxCpus)),
          onnxInterOpThreads: 1,
          sharpConcurrency: Math.max(1, Math.floor(maxCpus)),
        };
      })()
    : UNCONFIGURED;

  // Granular overrides always win, so one noisy subsystem can be tuned without abandoning the dial.
  return {
    ...derived,
    jobConcurrency: parseCount(env.SAKUYA_JOB_CONCURRENCY) ?? derived.jobConcurrency,
    ffmpegThreads: parseCount(env.SAKUYA_FFMPEG_THREADS) ?? derived.ffmpegThreads,
    onnxIntraOpThreads: parseCount(env.SAKUYA_ONNX_THREADS) ?? derived.onnxIntraOpThreads,
    sharpConcurrency: parseCount(env.SAKUYA_SHARP_CONCURRENCY) ?? derived.sharpConcurrency,
  };
}

export const LIMITS: Limits = resolveLimits();

/**
 * One line for the boot log, or null when nothing is configured and there is nothing to say.
 *
 * Worth printing because the memory half of this is easy to misread: SAKUYA_MAX_MEMORY only binds
 * if the launcher put the process in a cgroup, so the log states which of the two is actually in
 * force rather than letting the variable's presence imply a cap that isn't there.
 */
export function describeLimits(env: NodeJS.ProcessEnv = process.env, limits: Limits = LIMITS): string | null {
  const configured =
    limits.maxCpus !== null ||
    Boolean(env.SAKUYA_JOB_CONCURRENCY || env.SAKUYA_FFMPEG_THREADS || env.SAKUYA_ONNX_THREADS || env.SAKUYA_SHARP_CONCURRENCY);
  const memory = parseMemory(env.SAKUYA_MAX_MEMORY);
  if (!configured && memory === null) return null;

  const parts = [
    `${limits.jobConcurrency} concurrent job${limits.jobConcurrency === 1 ? '' : 's'}`,
    `ffmpeg ${limits.ffmpegThreads ?? 'auto'}`,
    `onnx ${limits.onnxIntraOpThreads}/${limits.onnxInterOpThreads}`,
    `libvips ${limits.sharpConcurrency ?? 'auto'}`,
  ];
  const cpus = limits.maxCpus === null ? `${os.cpus().length} detected cores` : `${limits.maxCpus} CPUs`;
  let line = `Limits: ${cpus} -> ${parts.join(', ')}`;
  if (memory !== null) {
    // SAKUYA_HARD_LIMIT_APPLIED is exported by run.sh once it has re-exec'd under systemd.
    line +=
      env.SAKUYA_HARD_LIMIT_APPLIED === 'true'
        ? `. Memory capped at ${env.SAKUYA_MAX_MEMORY} by the launcher.`
        : `. SAKUYA_MAX_MEMORY=${env.SAKUYA_MAX_MEMORY} is NOT enforced: start via run.sh on a systemd host, or use Docker's mem_limit.`;
  }
  return line;
}
