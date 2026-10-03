import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

export const FFMPEG_PATH: string = (ffmpegStatic as unknown as string) ?? 'ffmpeg';

/** Comfortably more than the 300 characters reported on failure, small enough to never matter. */
const STDERR_TAIL = 4_000;

/** Run a command to completion and resolve with its stdout; a non-zero exit rejects with the end of stderr. */
export function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    // Keep only the tail: ffmpeg emits a progress line every few hundred ms and transcoding a
    // large video runs for hours, so appending the whole stream grew a string for the life of
    // the job when all that is ever read back is the last few hundred characters.
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr = (stderr + d).slice(-STDERR_TAIL)));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${path.basename(cmd)} exited with ${code}: ${stderr.slice(-300)}`));
    });
  });
}
