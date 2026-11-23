import { LIMITS } from './config';
// Type-only: the native module itself is imported lazily, when a model actually runs.
import type { InferenceSession } from 'onnxruntime-node';

interface Releasable {
  release(): Promise<void>;
}

export interface ModelSessionOptions<S extends Releasable> {
  /** Names the model in log lines. */
  label: string;
  /** How long the session may sit unused before its native memory is freed. */
  idleMs?: number;
  /** Opens the model. Defaults to a CPU onnxruntime session sized from LIMITS. */
  load?: (path: string) => Promise<S>;
}

export interface ModelSession<S extends Releasable> {
  /**
   * Run `fn` against the loaded session, loading it first if needed. The session is not released
   * while any call is in flight, and the idle timer restarts when the last one ends.
   */
  use<T>(fn: (session: S) => Promise<T>): Promise<T>;
  /** Free the native memory now. A later `use` loads again. */
  release(): void;
  inFlight(): number;
  loaded(): boolean;
}

export const DEFAULT_IDLE_MS = 60_000;

/**
 * glibc keeps freed memory in its arenas instead of returning it to the OS: after release() the
 * process still held ~620 of the tagger's ~790 MB (measured). malloc_trim hands it back. No-op where
 * there is no glibc (macOS, Windows, musl).
 */
export async function trimNativeHeap(): Promise<void> {
  if (process.platform !== 'linux') return;
  try {
    const { dlopen, FFIType } = await import('bun:ffi');
    const libc = dlopen('libc.so.6', { malloc_trim: { args: [FFIType.u64], returns: FFIType.i32 } });
    libc.symbols.malloc_trim(0);
    libc.close();
  } catch {
    // Not glibc.
  }
}

export async function loadOnnxSession(path: string): Promise<InferenceSession> {
  const ort = await import('onnxruntime-node');
  return ort.InferenceSession.create(path, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    // Cap threads so bulk inference can't monopolize every core and starve request handling
    // (thumbnail/video serving) or other host services. Tunable via SAKUYA_MAX_CPUS /
    // SAKUYA_ONNX_THREADS.
    intraOpNumThreads: LIMITS.onnxIntraOpThreads,
    interOpNumThreads: LIMITS.onnxInterOpThreads,
  });
}

/**
 * A model loaded on first use and freed once nothing has used it for `idleMs`. Inference comes in
 * bursts (after a scan, an upload), and a loaded model holds hundreds of MB of native memory, so it
 * is released between bursts; the next use reloads it in a second or two.
 *
 * `path` is read at load time, so a model switch only needs `release()`.
 */
export function createModelSession<S extends Releasable = InferenceSession>(
  path: string | (() => string),
  options: ModelSessionOptions<S>,
): ModelSession<S> {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const load = options.load ?? (loadOnnxSession as unknown as (p: string) => Promise<S>);
  let session: Promise<S> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = 0;

  // Concurrent callers share one load; two tag jobs used to each create an ~800 MB session and leak one.
  function get(): Promise<S> {
    if (session) return session;
    const pending = load(typeof path === 'function' ? path() : path);
    session = pending;
    // A failed load must not stick, or every later call would get the same rejection.
    pending.catch(() => {
      if (session === pending) session = null;
    });
    return pending;
  }

  // Dropping the reference alone would leave the native memory to a GC finalizer.
  function release(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const old = session;
    session = null;
    old
      ?.then((loaded) => loaded.release())
      .then(trimNativeHeap)
      .catch((err: unknown) => console.error(`${options.label}: failed to release model session:`, err));
  }

  function scheduleRelease(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (inFlight === 0) release();
    }, idleMs);
    idleTimer.unref();
  }

  return {
    async use(fn) {
      inFlight++;
      try {
        return await fn(await get());
      } finally {
        inFlight--;
        scheduleRelease();
      }
    },
    release,
    inFlight: () => inFlight,
    loaded: () => session !== null,
  };
}
