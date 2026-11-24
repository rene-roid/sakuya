import type { SettingEntry } from './registry';

/** Splits entries into runs that share a section and group, keeping registry order. */
export function groupRuns(entries: readonly SettingEntry[]): { key: string; entries: SettingEntry[] }[] {
  const runs: { key: string; entries: SettingEntry[] }[] = [];
  for (const entry of entries) {
    const key = `${entry.section}|${entry.group}`;
    const last = runs[runs.length - 1];
    if (last?.key === key) last.entries.push(entry);
    else runs.push({ key, entries: [entry] });
  }
  return runs;
}
