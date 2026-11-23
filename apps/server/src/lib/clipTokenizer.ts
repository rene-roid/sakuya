/**
 * OpenAI CLIP's byte-level BPE tokenizer (clip/simple_tokenizer.py), as the Hugging Face fast
 * tokenizer for openai/clip-vit-base-patch32 runs it: NFC, whitespace collapsed, lowercased,
 * split by CLIP's pattern, each piece byte-encoded and merged with `</w>` marking a word's end.
 */
export const START_TOKEN = 49406;
export const END_TOKEN = 49407;
export const CONTEXT_LENGTH = 77;

const PIECE = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|\p{L}+|\p{N}|[^\s\p{L}\p{N}]+/gu;

/** GPT-2's reversible map from bytes to printable characters, so BPE never sees whitespace or controls. */
function byteEncoder(): string[] {
  const printable: number[] = [];
  for (let b = 33; b <= 126; b++) printable.push(b);
  for (let b = 161; b <= 172; b++) printable.push(b);
  for (let b = 174; b <= 255; b++) printable.push(b);
  const out: string[] = new Array(256);
  let extra = 0;
  for (let b = 0; b < 256; b++) {
    out[b] = String.fromCodePoint(printable.includes(b) ? b : 256 + extra++);
  }
  return out;
}

export class ClipTokenizer {
  private readonly bytes = byteEncoder();
  private readonly ranks: Map<string, number>;
  private readonly cache = new Map<string, number[]>();
  private readonly encoder = new TextEncoder();

  /**
   * @param vocab token string to id (vocab.json)
   * @param merges merges.txt's text: a version line, then one "a b" merge per line, best first
   */
  constructor(
    private readonly vocab: Record<string, number>,
    merges: string,
  ) {
    const lines = merges.split('\n').filter((l) => l && !l.startsWith('#version'));
    this.ranks = new Map(lines.map((line, i) => [line, i]));
  }

  private bpe(piece: string): number[] {
    const cached = this.cache.get(piece);
    if (cached) return cached;
    let symbols = [...piece];
    symbols[symbols.length - 1] += '</w>';
    while (symbols.length > 1) {
      let best = -1;
      let bestRank = Infinity;
      for (let i = 0; i < symbols.length - 1; i++) {
        const rank = this.ranks.get(`${symbols[i]} ${symbols[i + 1]}`);
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank;
          best = i;
        }
      }
      if (best < 0) break;
      const [first, second] = [symbols[best], symbols[best + 1]];
      // Every occurrence of the pair merges in the same pass, as in the reference.
      const next: string[] = [];
      for (let i = 0; i < symbols.length; i++) {
        if (symbols[i] === first && symbols[i + 1] === second) {
          next.push(first + second);
          i++;
        } else next.push(symbols[i]);
      }
      symbols = next;
    }
    const ids = symbols.map((s) => this.vocab[s] ?? END_TOKEN);
    if (this.cache.size < 10_000) this.cache.set(piece, ids);
    return ids;
  }

  /** Token ids without the start and end markers. */
  encodeText(text: string): number[] {
    const clean = text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
    const ids: number[] = [];
    for (const match of clean.matchAll(PIECE)) {
      const piece = Array.from(this.encoder.encode(match[0]), (b) => this.bytes[b]).join('');
      ids.push(...this.bpe(piece));
    }
    return ids;
  }

  /** The model's input: start, the text's tokens cut to fit, end. Unpadded. */
  encode(text: string): number[] {
    return [START_TOKEN, ...this.encodeText(text).slice(0, CONTEXT_LENGTH - 2), END_TOKEN];
  }
}
