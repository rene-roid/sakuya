import { SECTIONS, SETTINGS, type SettingEntry, type SettingsSection } from './registry';

export function queryTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function haystack(entry: SettingEntry, sections: readonly SettingsSection[]): string {
  const section = sections.find((s) => s.id === entry.section)?.label ?? '';
  return `${entry.label} ${entry.description} ${entry.keywords} ${entry.group} ${section}`.toLowerCase();
}

/** Entries containing every word of the query, in registry order. An empty query matches nothing. */
export function searchSettings(
  query: string,
  entries: readonly SettingEntry[] = SETTINGS,
  sections: readonly SettingsSection[] = SECTIONS,
): SettingEntry[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  return entries.filter((entry) => {
    const text = haystack(entry, sections);
    return terms.every((term) => text.includes(term));
  });
}

/** Splits `text` into runs that do and don't match any of the (lowercase) terms. */
export function highlightSegments(text: string, terms: string[]): { text: string; match: boolean }[] {
  const lower = text.toLowerCase();
  const marked = new Array<boolean>(text.length).fill(false);
  for (const term of terms) {
    for (let at = lower.indexOf(term); term && at !== -1; at = lower.indexOf(term, at + term.length)) {
      marked.fill(true, at, at + term.length);
    }
  }
  const out: { text: string; match: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.match === marked[i]) last.text += text[i];
    else out.push({ text: text[i], match: marked[i] });
  }
  return out;
}
