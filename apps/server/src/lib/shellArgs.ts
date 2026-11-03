/**
 * Minimal shell-style word splitter: whitespace separates words, single or double quotes group
 * them, and quoted parts join the text around them (`--range="1-5"` is `--range=1-5`). No escapes
 * and no expansion. An unclosed quote runs to the end of the input.
 */
export function parseShellArgs(input: string): string[] {
  const args: string[] = [];
  let word: string | null = null;
  let quote: string | null = null;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else word += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      word ??= '';
    } else if (/\s/.test(ch)) {
      if (word !== null) args.push(word);
      word = null;
    } else {
      word = (word ?? '') + ch;
    }
  }
  if (word !== null) args.push(word);
  return args;
}
