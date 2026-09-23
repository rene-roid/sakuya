/**
 * In-app resource limits: how many jobs run at once, and how many threads each native library
 * underneath them may spawn.
 *
 * These are the *soft* half. The hard ceiling — the kernel refusing CPU time past a quota and
 * allocations past a memory bound — is applied from outside the process: by the launcher
 * (src/launch.ts, systemd scope on Linux, job object on Windows) or by Docker's cpus / mem_limit.
 * A ceiling alone isn't enough, though: libvips, libx264 and onnxruntime size their thread pools
 * from the core count they can see, and inside a quota they'd still spawn one per *host* core and
 * then fight over the share they actually get. So the budget drives both.
 *
 * With no budget, every value is what it was when these numbers were hardcoded across the services.
 * At 2 CPUs the derivation reproduces those constants exactly; see limits.test.ts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatBytes } from '@sakuya/shared/config';

export interface Limits {
  /** Effective CPU budget, or null when there is none (no derivation happens). */
  maxCpus: number | null;
  /** How many background jobs (scan/tag/thumbnail/transcode) may run at once. */
  jobConcurrency: number;
  /** `-threads` for transcoding, or null to let ffmpeg pick (one thread per core). */
  ffmpegThreads: number | null;
  /** onnxruntime threads within a single operator. The tagger's dominant cost. */
  onnxIntraOpThreads: number;
  /** onnxruntime threads across independent operators. */
  onnxInterOpThreads: number;
  /** libvips worker pool for sharp, or null for its default. */
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

/** Derive every knob from one CPU budget. Each floors at 1: a budget of 0.5 still has to run one job. */
export function resolveLimits(maxCpus: number | null): Limits {
  if (!maxCpus) return UNCONFIGURED;
  const jobConcurrency = Math.max(1, Math.floor(maxCpus));
  return {
    maxCpus,
    jobConcurrency,
    // Split across the jobs that may run concurrently, so N transcodes at N threads each can't add
    // up to more than the budget.
    ffmpegThreads: Math.max(1, Math.floor(maxCpus / jobConcurrency)),
    onnxIntraOpThreads: Math.max(1, Math.floor(maxCpus)),
    onnxInterOpThreads: 1,
    sharpConcurrency: Math.max(1, Math.floor(maxCpus)),
  };
}

export type CpuSource = 'config' | 'quota';

export const cpuLabel = (cpus: number): string => `${cpus} CPU${cpus === 1 ? '' : 's'}`;

/**
 * The tighter of the configured budget and the quota the process is already running under — a
 * Docker `cpus`, a systemd CPUQuota, an affinity mask. Taking the minimum means a container's quota
 * sizes the pools without being restated in the config file.
 */
export function effectiveCpus(
  configured: number | null,
  quota: number | null,
): { cpus: number; source: CpuSource } | null {
  if (configured !== null && (quota === null || configured <= quota)) return { cpus: configured, source: 'config' };
  if (quota !== null) return { cpus: quota, source: 'quota' };
  return null;
}

/**
 * Bun's availableParallelism() honours the cgroup CPU quota and affinity, while os.cpus() lists
 * every core on the host; a gap between them is a quota. (Measured: 1 inside a CPUQuota=100% scope
 * on a 4-core host.) Windows job-object CPU rates don't show up here, but on Windows the budget
 * comes from the config file anyway.
 */
export function detectCpuQuota(): number | null {
  const available = os.availableParallelism();
  return available < os.cpus().length ? available : null;
}

/**
 * The tightest cgroup v2 memory.max on the path from this process to the root — whatever actually
 * binds, whether set by Docker's mem_limit or by the launcher's systemd scope. Linux only; null
 * when nothing is set or the host is on cgroup v1.
 */
export function detectCgroupMemoryLimit(): number | null {
  if (process.platform !== 'linux') return null;
  let entry: string | undefined;
  try {
    entry = fs
      .readFileSync('/proc/self/cgroup', 'utf8')
      .split('\n')
      .find((line) => line.startsWith('0::'));
  } catch {
    return null;
  }
  if (!entry) return null;
  let tightest: number | null = null;
  for (let rel = entry.slice(3).trim() || '/'; ; rel = path.posix.dirname(rel)) {
    try {
      const value = fs.readFileSync(path.posix.join('/sys/fs/cgroup', rel, 'memory.max'), 'utf8').trim();
      const bytes = Number(value);
      if (value !== 'max' && Number.isFinite(bytes) && (tightest === null || bytes < tightest)) tightest = bytes;
    } catch {
      // Not every level has a memory controller file; keep walking up.
    }
    if (rel === '/') break;
  }
  return tightest;
}

export interface LimitsReport {
  limits: Limits;
  cpuSource: CpuSource | null;
  /** limits.memory from the config file. */
  configuredMemory: number | null;
  /** The ceiling the kernel actually enforces on this process, if one could be found. */
  enforcedMemory: number | null;
}

/**
 * One line for the boot log, or null when nothing is configured or detected. It reports what is
 * *enforced*, not what was asked for, so a memory limit that isn't binding says so out loud rather
 * than being implied by a clean boot.
 */
export function describeLimits({ limits, cpuSource, configuredMemory, enforcedMemory }: LimitsReport): string | null {
  if (limits.maxCpus === null && configuredMemory === null && enforcedMemory === null) return null;

  const parts: string[] = [];
  if (limits.maxCpus !== null) {
    const knobs = [
      `${limits.jobConcurrency} concurrent job${limits.jobConcurrency === 1 ? '' : 's'}`,
      `ffmpeg ${limits.ffmpegThreads ?? 'auto'}`,
      `onnx ${limits.onnxIntraOpThreads}/${limits.onnxInterOpThreads}`,
      `libvips ${limits.sharpConcurrency ?? 'auto'}`,
    ];
    const from = cpuSource === 'quota' ? 'detected quota' : 'config';
    parts.push(`${cpuLabel(limits.maxCpus)} (${from}) -> ${knobs.join(', ')}`);
  }

  // The kernel rounds a ceiling *down* to a page, so an enforced limit never reads as larger than asked.
  if (configuredMemory !== null && (enforcedMemory === null || enforcedMemory > configuredMemory)) {
    const note = enforcedMemory === null ? '' : `; the actual ceiling is ${formatBytes(enforcedMemory)}`;
    parts.push(
      `memory ${formatBytes(configuredMemory)} is NOT enforced${note}. The launcher applies it (bun dev, ` +
        'run.sh / run.bat, bun run start) on Linux with systemd and on Windows; in Docker, set mem_limit',
    );
  } else if (enforcedMemory !== null) {
    parts.push(`memory capped at ${formatBytes(enforcedMemory)}`);
  }

  return `Limits: ${parts.join('; ')}`;
}
