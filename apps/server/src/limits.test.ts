import { describe, expect, test } from 'bun:test';
import { describeLimits, parseMemory, resolveLimits } from './lib/limits';

/**
 * lib/limits is pure and env-injected precisely so this file doesn't need a server, a data dir or
 * a real .env — nothing here has the side effects that force `bun test --isolate` elsewhere.
 */
describe('resolveLimits', () => {
  test('unset, reproduces the values the services used to hardcode', () => {
    expect(resolveLimits({})).toEqual({
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
    const limits = resolveLimits({ SAKUYA_MAX_CPUS: '2' });
    expect(limits.jobConcurrency).toBe(2);
    expect(limits.onnxIntraOpThreads).toBe(2);
    expect(limits.onnxInterOpThreads).toBe(1);
    // ...and it closes the two gaps that had no cap at all before.
    expect(limits.ffmpegThreads).toBe(1);
    expect(limits.sharpConcurrency).toBe(2);
  });

  test('scales with the budget', () => {
    const four = resolveLimits({ SAKUYA_MAX_CPUS: '4' });
    expect(four.jobConcurrency).toBe(4);
    expect(four.onnxIntraOpThreads).toBe(4);
    expect(four.sharpConcurrency).toBe(4);
    // Budget split across the jobs that may run at once, so 4 jobs x 1 thread stays inside 4.
    expect(four.ffmpegThreads).toBe(1);
  });

  test('a fractional budget still runs one of everything', () => {
    const half = resolveLimits({ SAKUYA_MAX_CPUS: '0.5' });
    expect(half.jobConcurrency).toBe(1);
    expect(half.ffmpegThreads).toBe(1);
    expect(half.onnxIntraOpThreads).toBe(1);
    expect(half.sharpConcurrency).toBe(1);
  });

  test('granular overrides beat the derived value', () => {
    const limits = resolveLimits({ SAKUYA_MAX_CPUS: '4', SAKUYA_FFMPEG_THREADS: '3', SAKUYA_JOB_CONCURRENCY: '1' });
    expect(limits.jobConcurrency).toBe(1);
    expect(limits.ffmpegThreads).toBe(3);
    expect(limits.onnxIntraOpThreads).toBe(4); // untouched by the overrides
  });

  test('granular overrides work with no CPU budget at all', () => {
    const limits = resolveLimits({ SAKUYA_SHARP_CONCURRENCY: '1' });
    expect(limits.maxCpus).toBeNull();
    expect(limits.sharpConcurrency).toBe(1);
    expect(limits.jobConcurrency).toBe(2);
  });

  /** A typo in a limit should cost you the limit, not the server. */
  test('junk falls back instead of throwing', () => {
    expect(resolveLimits({ SAKUYA_MAX_CPUS: 'two' })).toEqual(resolveLimits({}));
    expect(resolveLimits({ SAKUYA_MAX_CPUS: '0' })).toEqual(resolveLimits({}));
    expect(resolveLimits({ SAKUYA_MAX_CPUS: '-4' })).toEqual(resolveLimits({}));
    expect(resolveLimits({ SAKUYA_JOB_CONCURRENCY: '2.5' }).jobConcurrency).toBe(2);
    expect(resolveLimits({ SAKUYA_JOB_CONCURRENCY: '' }).jobConcurrency).toBe(2);
  });
});

describe('parseMemory', () => {
  test('accepts the suffixes Docker accepts', () => {
    expect(parseMemory('2g')).toBe(2 * 1024 ** 3);
    expect(parseMemory('2G')).toBe(2 * 1024 ** 3);
    expect(parseMemory('2gb')).toBe(2 * 1024 ** 3);
    expect(parseMemory('512m')).toBe(512 * 1024 ** 2);
    expect(parseMemory('1.5G')).toBe(Math.floor(1.5 * 1024 ** 3));
    expect(parseMemory('1024')).toBe(1024);
  });

  test('rejects junk', () => {
    expect(parseMemory(undefined)).toBeNull();
    expect(parseMemory('')).toBeNull();
    expect(parseMemory('lots')).toBeNull();
    expect(parseMemory('2x')).toBeNull();
    expect(parseMemory('-2g')).toBeNull();
  });
});

describe('describeLimits', () => {
  test('says nothing when nothing is configured', () => {
    expect(describeLimits({}, resolveLimits({}))).toBeNull();
  });

  /**
   * The failure mode this guards against is someone setting SAKUYA_MAX_MEMORY, seeing the server
   * boot cleanly, and assuming they have a cap. Without the launcher they have not.
   */
  test('is explicit that a memory cap is unenforced without the launcher', () => {
    const env = { SAKUYA_MAX_MEMORY: '2g' };
    const line = describeLimits(env, resolveLimits(env));
    expect(line).toContain('NOT enforced');
  });

  test('confirms the cap once the launcher has applied it', () => {
    const env = { SAKUYA_MAX_MEMORY: '2g', SAKUYA_HARD_LIMIT_APPLIED: 'true' };
    const line = describeLimits(env, resolveLimits(env));
    expect(line).toContain('Memory capped at 2g');
    expect(line).not.toContain('NOT enforced');
  });

  test('reports the derived CPU knobs', () => {
    const env = { SAKUYA_MAX_CPUS: '2' };
    expect(describeLimits(env, resolveLimits(env))).toBe(
      'Limits: 2 CPUs -> 2 concurrent jobs, ffmpeg 1, onnx 2/1, libvips 2',
    );
  });
});
