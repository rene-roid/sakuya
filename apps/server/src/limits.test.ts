import { describe, expect, test } from 'bun:test';
import { describeLimits, effectiveCpus, resolveLimits } from './lib/limits';
import { cpuRateInfo, extendedLimitInfo, jobMemoryLimitFrom } from './lib/windowsJob';

/**
 * lib/limits is pure and takes its inputs as arguments precisely so this file doesn't need a
 * server, a data dir or a config file — nothing here has the side effects that force
 * `bun test --isolate` elsewhere.
 */
describe('resolveLimits', () => {
  test('with no budget, reproduces the values the services used to hardcode', () => {
    expect(resolveLimits(null)).toEqual({
      maxCpus: null,
      jobConcurrency: 2,
      ffmpegThreads: null,
      onnxIntraOpThreads: 2,
      onnxInterOpThreads: 1,
      sharpConcurrency: null,
    });
  });

  /**
   * The docker-compose deployment runs at cpus: "2.0", and the constants this replaced were
   * chosen for exactly that budget. If the derivation ever stops agreeing with them at 2 CPUs,
   * either the formula drifted or the old numbers were not what we thought.
   */
  test('at 2 CPUs the derived values match the old hardcoded constants', () => {
    const limits = resolveLimits(2);
    expect(limits.jobConcurrency).toBe(2);
    expect(limits.onnxIntraOpThreads).toBe(2);
    expect(limits.onnxInterOpThreads).toBe(1);
    // ...and it closes the two gaps that had no cap at all before.
    expect(limits.ffmpegThreads).toBe(1);
    expect(limits.sharpConcurrency).toBe(2);
  });

  test('scales with the budget', () => {
    const four = resolveLimits(4);
    expect(four.jobConcurrency).toBe(4);
    expect(four.onnxIntraOpThreads).toBe(4);
    expect(four.sharpConcurrency).toBe(4);
    // Budget split across the jobs that may run at once, so 4 jobs x 1 thread stays inside 4.
    expect(four.ffmpegThreads).toBe(1);
  });

  test('a fractional budget still runs one of everything', () => {
    const half = resolveLimits(0.5);
    expect(half.jobConcurrency).toBe(1);
    expect(half.ffmpegThreads).toBe(1);
    expect(half.onnxIntraOpThreads).toBe(1);
    expect(half.sharpConcurrency).toBe(1);
  });
});

describe('effectiveCpus', () => {
  test('nothing configured and no quota means no budget', () => {
    expect(effectiveCpus(null, null)).toBeNull();
  });

  /** Docker's `cpus` sizes the pools without being restated in sakuya.config.json. */
  test('a detected quota is used when the config has none', () => {
    expect(effectiveCpus(null, 2)).toEqual({ cpus: 2, source: 'quota' });
  });

  test('the tighter of the two wins', () => {
    expect(effectiveCpus(1.5, 4)).toEqual({ cpus: 1.5, source: 'config' });
    expect(effectiveCpus(8, 2)).toEqual({ cpus: 2, source: 'quota' });
    expect(effectiveCpus(3, null)).toEqual({ cpus: 3, source: 'config' });
  });
});

describe('describeLimits', () => {
  const GiB = 1024 ** 3;
  const report = (cpus: number | null, configuredMemory: number | null, enforcedMemory: number | null) => ({
    limits: resolveLimits(cpus),
    cpuSource: cpus === null ? null : ('config' as const),
    configuredMemory,
    enforcedMemory,
  });

  test('says nothing when nothing is configured or detected', () => {
    expect(describeLimits(report(null, null, null))).toBeNull();
  });

  test('reports the derived CPU knobs', () => {
    expect(describeLimits(report(2, null, null))).toBe(
      'Limits: 2 CPUs (config) -> 2 concurrent jobs, ffmpeg 1, onnx 2/1, libvips 2',
    );
  });

  /**
   * The failure mode this guards against is someone setting limits.memory, seeing the server boot
   * cleanly, and assuming they have a cap. Without the launcher applying it, they have not.
   */
  test('is explicit that a configured memory limit is not binding', () => {
    expect(describeLimits(report(null, 2 * GiB, null))).toContain('NOT enforced');
    // A looser ceiling elsewhere (say Docker's mem_limit) doesn't satisfy a tighter request either.
    const looser = describeLimits(report(null, 2 * GiB, 3 * GiB));
    expect(looser).toContain('NOT enforced');
    expect(looser).toContain('3.0 GiB');
  });

  test('confirms a memory limit the kernel enforces', () => {
    const line = describeLimits(report(null, 2 * GiB, 2 * GiB));
    expect(line).toBe('Limits: memory capped at 2.0 GiB');
  });

  test('a byte count the kernel rounded down to a page still counts as enforced', () => {
    expect(describeLimits(report(null, 1_000_000_000, 999_997_440))).not.toContain('NOT enforced');
  });

  test("reports a container's memory ceiling even with nothing configured", () => {
    expect(describeLimits(report(null, null, 3 * GiB))).toBe('Limits: memory capped at 3.0 GiB');
  });
});

/**
 * The job-object path only runs on Windows, so CI never calls into kernel32. What it can pin is
 * the struct layout — the part that silently does the wrong thing if an offset is off.
 */
describe('windows job object structs', () => {
  test('extended limit info carries the job memory limit at the documented offset', () => {
    const buf = extendedLimitInfo(2 * 1024 ** 3);
    expect(buf.length).toBe(144);
    expect(buf.readUInt32LE(16)).toBe(0x2000 | 0x200); // KILL_ON_JOB_CLOSE | JOB_MEMORY
    expect(buf.readBigUInt64LE(120)).toBe(2n * 1024n ** 3n);
    expect(jobMemoryLimitFrom(buf)).toBe(2 * 1024 ** 3);
  });

  test('no memory limit leaves the flag off', () => {
    const buf = extendedLimitInfo(null);
    expect(buf.readUInt32LE(16)).toBe(0x2000);
    expect(jobMemoryLimitFrom(buf)).toBeNull();
  });

  test('cpu rate is a hard-capped share of all cores in hundredths of a percent', () => {
    const buf = cpuRateInfo(2, 8)!;
    expect(buf.readUInt32LE(0)).toBe(0x1 | 0x4); // ENABLE | HARD_CAP
    expect(buf.readUInt32LE(4)).toBe(2500);
    expect(cpuRateInfo(8, 8)).toBeNull();
    expect(cpuRateInfo(0.01, 64)!.readUInt32LE(4)).toBe(2);
  });
});
