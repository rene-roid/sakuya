import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { DOWNLOADER_DIR } from '../lib/config';
import { parseShellArgs } from '../lib/shellArgs';
import { detectGalleryDl } from './galleryDl';
import type { ConsoleSessionStatus } from '@sakuya/shared';

export const consoleEvents = new EventEmitter();
consoleEvents.setMaxListeners(50);

// Scrollback cap so a long-running interactive session can't grow memory unbounded.
const MAX_BUFFER = 200_000;

let child: ChildProcessWithoutNullStreams | null = null;
let command: string | null = null;
let startedAt: number | null = null;
let buffer = '';
// A real pty (used on Linux, see startConsoleSession) echoes typed input back through stdout on
// its own, so we must not also echo it into the buffer ourselves or every line would double up.
let usingPty = false;

function appendBuffer(chunk: string) {
  buffer = (buffer + chunk).slice(-MAX_BUFFER);
  consoleEvents.emit('data', chunk);
}

export function getConsoleStatus(): ConsoleSessionStatus {
  return { running: child !== null, pid: child?.pid ?? null, command, startedAt };
}

export function getConsoleBuffer(): string {
  return buffer;
}

function quoteShellArg(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export async function startConsoleSession(commandText: string): Promise<void> {
  if (child) throw new Error('A console session is already running');

  const galleryDl = await detectGalleryDl();
  if (!galleryDl.installed || !galleryDl.path) throw new Error('gallery-dl is not installed');

  const args = parseShellArgs(commandText);
  // gallery-dl refuses to prompt for input (oauth codes, 2FA, etc.) unless stdin is a real TTY,
  // and it exits immediately with "User input required" over a plain pipe. The standalone Linux
  // binary also crashes `xdg-open` (a shell script) when it tries to auto-launch a browser, because
  // its bundled LD_LIBRARY_PATH leaks into that child and breaks bash's readline linkage. On Linux
  // we wrap the run in `script` to allocate a pty (satisfies the TTY check) and force
  // browser=false (dodges the xdg-open crash; the URL is printed either way for the user to open
  // themselves) plus --no-colors since a pty otherwise makes it emit ANSI codes into the console log.
  const galleryDlArgs = ['--no-colors', '-o', 'browser=false', ...args];
  let proc: ChildProcessWithoutNullStreams;
  usingPty = process.platform === 'linux';
  if (usingPty) {
    const cmd = [galleryDl.path, ...galleryDlArgs].map(quoteShellArg).join(' ');
    proc = spawn('script', ['-qc', cmd, '/dev/null'], {
      cwd: DOWNLOADER_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
    });
  } else {
    proc = spawn(galleryDl.path, galleryDlArgs, {
      cwd: DOWNLOADER_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Force unbuffered stdout so interactive prompts (e.g. 2FA codes) show up immediately.
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
    });
  }

  child = proc;
  command = commandText;
  startedAt = Date.now();
  buffer = '';
  appendBuffer(`$ gallery-dl ${commandText}\n`);
  consoleEvents.emit('status', getConsoleStatus());

  proc.stdout.on('data', (d) => appendBuffer(d.toString()));
  proc.stderr.on('data', (d) => appendBuffer(d.toString()));
  proc.on('error', (err) => appendBuffer(`\n[error] ${err.message}\n`));
  proc.on('close', (code) => {
    appendBuffer(`\n[process exited with code ${code}]\n`);
    child = null;
    command = null;
    startedAt = null;
    consoleEvents.emit('status', getConsoleStatus());
  });
}

export function writeConsoleInput(text: string): void {
  if (!child || !child.stdin.writable) throw new Error('No console session is running');
  if (!usingPty) appendBuffer(`${text}\n`);
  child.stdin.write(`${text}\n`);
}

export function stopConsoleSession(): void {
  child?.kill();
}
