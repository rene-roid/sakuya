import { describe, expect, test } from 'bun:test';
import { useTestConfig } from './testConfig';

// lib/config (thread limits) reads sakuya.config.json on import.
useTestConfig('model-session');

const { createModelSession } = await import('./lib/modelSession');

function fakeLoader() {
  const events: string[] = [];
  let loads = 0;
  const load = async (path: string) => {
    const n = ++loads;
    events.push(`load ${path} #${n}`);
    await Bun.sleep(5);
    return {
      n,
      release: async () => {
        events.push(`release ${path} #${n}`);
      },
    };
  };
  return { events, load };
}

describe('createModelSession', () => {
  test('two sessions from one module load and release independently', async () => {
    const { events, load } = fakeLoader();
    const a = createModelSession('a.onnx', { label: 'a', idleMs: 20, load });
    const b = createModelSession('b.onnx', { label: 'b', idleMs: 80, load });

    expect(await a.use(async (s) => s.n)).toBe(1);
    expect(await b.use(async (s) => s.n)).toBe(2);
    expect([a.loaded(), b.loaded()]).toEqual([true, true]);

    await Bun.sleep(40);
    expect([a.loaded(), b.loaded()]).toEqual([false, true]);
    await Bun.sleep(60);
    expect([a.loaded(), b.loaded()]).toEqual([false, false]);
    expect(events).toEqual(['load a.onnx #1', 'load b.onnx #2', 'release a.onnx #1', 'release b.onnx #2']);
  });

  test('concurrent callers share one load', async () => {
    const { events, load } = fakeLoader();
    const m = createModelSession('m.onnx', { label: 'm', idleMs: 1000, load });
    const ns = await Promise.all([1, 2, 3].map(() => m.use(async (s) => s.n)));
    expect(ns).toEqual([1, 1, 1]);
    expect(events).toEqual(['load m.onnx #1']);
    m.release();
  });

  test('is not released while a call is still running, and counts it in flight', async () => {
    const { events, load } = fakeLoader();
    const m = createModelSession('m.onnx', { label: 'm', idleMs: 10, load });
    await m.use(async () => 0);
    const slow = m.use(async () => {
      await Bun.sleep(40);
      return m.inFlight();
    });
    await Bun.sleep(25);
    expect(m.loaded()).toBe(true);
    expect(await slow).toBe(1);
    expect(m.inFlight()).toBe(0);
    await Bun.sleep(30);
    expect(m.loaded()).toBe(false);
    expect(events).toEqual(['load m.onnx #1', 'release m.onnx #1']);
  });

  test('a failed load does not stick, and the path is read at load time', async () => {
    let path = 'broken.onnx';
    let attempt = 0;
    const m = createModelSession(() => path, {
      label: 'm',
      idleMs: 1000,
      load: async (p) => {
        attempt++;
        if (p === 'broken.onnx') throw new Error('bad model');
        return { p, release: async () => {} };
      },
    });
    await expect(m.use(async (s) => s.p)).rejects.toThrow('bad model');
    expect(m.loaded()).toBe(false);
    path = 'good.onnx';
    expect(await m.use(async (s) => s.p)).toBe('good.onnx');
    expect(attempt).toBe(2);
    m.release();
  });
});
