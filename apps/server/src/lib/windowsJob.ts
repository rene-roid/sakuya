/**
 * Hard resource limits on Windows, via a job object — the Windows counterpart to a cgroup. The
 * kernel enforces it: past JobMemoryLimit, commits fail; past the CPU rate, threads are descheduled.
 * Every process started from inside the job (the server, and the ffmpeg / gallery-dl it spawns)
 * lands in it automatically, which is why the launcher joins the job *itself* before spawning
 * anything: there is no window in which a child exists outside it.
 *
 * Struct layouts are for 64-bit Windows (x64 and arm64 share them); Bun ships no 32-bit build.
 */
import { dlopen, FFIType } from 'bun:ffi';

const JobObjectExtendedLimitInformation = 9;
const JobObjectCpuRateControlInformation = 15;

const JOB_OBJECT_LIMIT_JOB_MEMORY = 0x200;
// The launcher holds the only handle, so if it dies the server goes with it instead of lingering
// outside anyone's control.
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const JOB_OBJECT_CPU_RATE_CONTROL_ENABLE = 0x1;
const JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP = 0x4;

// JOBOBJECT_EXTENDED_LIMIT_INFORMATION: BasicLimitInformation (64 bytes, LimitFlags at 16),
// IoInfo (48), then ProcessMemoryLimit (112), JobMemoryLimit (120), and two peak counters.
const EXTENDED_LIMIT_SIZE = 144;
const LIMIT_FLAGS_OFFSET = 16;
const JOB_MEMORY_LIMIT_OFFSET = 120;

/** JOBOBJECT_EXTENDED_LIMIT_INFORMATION capping the whole job's committed memory. */
export function extendedLimitInfo(memoryBytes: number | null): Buffer {
  const buf = Buffer.alloc(EXTENDED_LIMIT_SIZE);
  let flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (memoryBytes !== null) {
    flags |= JOB_OBJECT_LIMIT_JOB_MEMORY;
    buf.writeBigUInt64LE(BigInt(memoryBytes), JOB_MEMORY_LIMIT_OFFSET);
  }
  buf.writeUInt32LE(flags, LIMIT_FLAGS_OFFSET);
  return buf;
}

/**
 * JOBOBJECT_CPU_RATE_CONTROL_INFORMATION with a hard cap, or null when the budget is the whole
 * machine anyway. CpuRate is a share of *all* cores in hundredths of a percent.
 */
export function cpuRateInfo(cpus: number, logicalCores: number): Buffer | null {
  if (cpus >= logicalCores) return null;
  const rate = Math.min(10_000, Math.max(1, Math.round((cpus / logicalCores) * 10_000)));
  const buf = Buffer.alloc(8);
  buf.writeUInt32LE(JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP, 0);
  buf.writeUInt32LE(rate, 4);
  return buf;
}

/** Read the job-wide memory limit back out of a JOBOBJECT_EXTENDED_LIMIT_INFORMATION. */
export function jobMemoryLimitFrom(buf: Buffer): number | null {
  if (!(buf.readUInt32LE(LIMIT_FLAGS_OFFSET) & JOB_OBJECT_LIMIT_JOB_MEMORY)) return null;
  return Number(buf.readBigUInt64LE(JOB_MEMORY_LIMIT_OFFSET));
}

function kernel32() {
  // Handles are pointer-sized; passed as 64-bit integers so the pseudo-handle -1 from
  // GetCurrentProcess survives the round trip (as a JS number it would lose precision).
  return dlopen('kernel32.dll', {
    CreateJobObjectW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u64 },
    SetInformationJobObject: { args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    QueryInformationJobObject: {
      args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr],
      returns: FFIType.i32,
    },
    AssignProcessToJobObject: { args: [FFIType.u64, FFIType.i64], returns: FFIType.i32 },
    GetCurrentProcess: { args: [], returns: FFIType.i64 },
  }).symbols;
}

export interface JobResult {
  memory: boolean;
  cpu: boolean;
  error?: string;
}

/**
 * Put the current process in a new job with the given limits. Memory and CPU are set separately so
 * one being refused (CPU rate control can be, inside some nested jobs) doesn't cost the other.
 */
export function joinLimitedJob(memoryBytes: number | null, cpus: number | null, logicalCores: number): JobResult {
  try {
    const k = kernel32();
    const job = k.CreateJobObjectW(null, null);
    if (!job) return { memory: false, cpu: false, error: 'CreateJobObject failed' };

    const limit = extendedLimitInfo(memoryBytes);
    const memory = k.SetInformationJobObject(job, JobObjectExtendedLimitInformation, limit, limit.length) !== 0;
    const rate = cpus === null ? null : cpuRateInfo(cpus, logicalCores);
    const cpu =
      rate !== null && k.SetInformationJobObject(job, JobObjectCpuRateControlInformation, rate, rate.length) !== 0;

    if (!k.AssignProcessToJobObject(job, k.GetCurrentProcess())) {
      return { memory: false, cpu: false, error: 'AssignProcessToJobObject failed' };
    }
    return { memory: memory && memoryBytes !== null, cpu };
  } catch (err) {
    return { memory: false, cpu: false, error: (err as Error).message };
  }
}

/** The memory limit of the job this process is in, if any. A null handle means "my own job". */
export function currentJobMemoryLimit(): number | null {
  try {
    const buf = Buffer.alloc(EXTENDED_LIMIT_SIZE);
    const ok = kernel32().QueryInformationJobObject(0n, JobObjectExtendedLimitInformation, buf, buf.length, null);
    return ok ? jobMemoryLimitFrom(buf) : null;
  } catch {
    return null;
  }
}
