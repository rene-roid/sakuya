import { marked } from 'marked';

export interface Release {
  version: string;
  html: string;
}

const files = import.meta.glob('../releases/*.md', { eager: true, query: '?raw', import: 'default' }) as Record<
  string,
  string
>;

function parseVersion(path: string): string {
  return path.match(/([\d]+\.[\d]+\.[\d]+)\.md$/)?.[1] ?? '0.0.0';
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** All releases, newest first. Add a new one by dropping a `X.Y.Z.md` file into `src/releases/`. */
export const releases: Release[] = Object.entries(files)
  .map(([path, raw]) => ({ version: parseVersion(path), html: marked.parse(raw, { async: false }) as string }))
  .sort((a, b) => compareVersions(b.version, a.version));
