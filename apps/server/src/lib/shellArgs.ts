/** Minimal shell-style word splitter (quotes supported, no shell expansion). */
export function parseShellArgs(input: string): string[] {
  const args: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) {
    args.push(match[1] ?? match[2] ?? match[3]);
  }
  return args;
}
