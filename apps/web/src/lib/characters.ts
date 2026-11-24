import { normalizeTagName, tagLabelText, type CharacterSummary, type TagCount } from '@sakuya/shared';

interface NamedLike {
  name: string | null;
  displayName: string | null;
}

/** The character-category tag a character carries, for TagName and tagLabel. Null while unnamed. */
export function characterTag(c: NamedLike) {
  return c.name ? { name: c.name, category: 'character' as const, displayName: c.displayName } : null;
}

export function characterLabelText(c: NamedLike, unnamed = 'Unnamed'): string {
  const tag = characterTag(c);
  return tag ? tagLabelText(tag) : unnamed;
}

export type NameOption =
  | { kind: 'character'; label: string; character: CharacterSummary }
  | { kind: 'tag'; label: string; tag: TagCount }
  | { kind: 'new'; label: string; name: string };

/**
 * Autocomplete for naming a character: named characters and character tags no character carries
 * yet, matched on their on-screen label or canonical name, prefix matches first. A "new" option
 * is offered unless the text already names one of them exactly.
 */
export function nameOptions(
  query: string,
  characters: CharacterSummary[],
  tags: TagCount[],
  limit = 8,
): NameOption[] {
  const typed = query.trim().replace(/\s+/g, ' ');
  const q = typed.toLowerCase();
  const canonical = normalizeTagName(typed);
  const candidates: { option: NameOption; name: string; count: number }[] = [
    ...characters
      .filter((c) => c.name)
      .map((c) => ({
        option: { kind: 'character' as const, label: characterLabelText(c), character: c },
        name: c.name!,
        count: c.mediaCount,
      })),
    ...tags.map((t) => ({
      option: { kind: 'tag' as const, label: tagLabelText(t), tag: t },
      name: t.name,
      count: t.count,
    })),
  ];
  const rank = (c: (typeof candidates)[number]) => {
    const label = c.option.label.toLowerCase();
    if (!q) return 1;
    if (label.startsWith(q) || c.name.startsWith(canonical)) return 0;
    if (label.includes(q) || c.name.includes(canonical)) return 1;
    return -1;
  };
  const ranked = candidates
    .map((c) => ({ ...c, rank: rank(c) }))
    .filter((c) => c.rank >= 0)
    .sort((a, b) => a.rank - b.rank || b.count - a.count || a.option.label.localeCompare(b.option.label))
    .slice(0, limit);
  const matches: NameOption[] = ranked.map((c) => c.option);
  const exact = candidates.some((c) => c.name === canonical || c.option.label.toLowerCase() === q);
  if (!typed || exact) return matches;
  // Enter takes the first option: an existing name only when it starts with what was typed, so
  // "Pepper" creates Pepper rather than picking "Carrot (pepper&carrot)".
  const option = { kind: 'new' as const, label: typed, name: typed };
  return ranked[0]?.rank === 0 ? [...matches, option] : [option, ...matches];
}

/**
 * The display name to give a tag just created from what was typed, or null when the automatic
 * label already reads that way. Lowercase typing is taken as not caring about case, so "pepper"
 * stays "Pepper", while "McGregor" keeps the capital G the automatic label would drop.
 */
export function customDisplayName(typed: string, canonical: string): string | null {
  const text = typed.trim().replace(/\s+/g, ' ');
  if (!/[A-Z]/.test(text)) return null;
  return tagLabelText({ name: canonical, category: 'character' }) === text ? null : text;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the picture sits inside an `object-contain` element of the given size. */
export function containRect(boxWidth: number, boxHeight: number, naturalWidth: number, naturalHeight: number): Rect {
  if (!naturalWidth || !naturalHeight) return { left: 0, top: 0, width: boxWidth, height: boxHeight };
  const scale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return { left: (boxWidth - width) / 2, top: (boxHeight - height) / 2, width, height };
}

/** Left edge for a popover of `width` under an anchor, kept inside a container of `containerWidth`. */
export function clampLeft(anchorLeft: number, width: number, containerWidth: number, margin = 4): number {
  return Math.max(margin, Math.min(anchorLeft, containerWidth - width - margin));
}
