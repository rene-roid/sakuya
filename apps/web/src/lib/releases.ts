export interface Release {
  version: string;
  html: string;
}

// Rendered to HTML at build time by the markdown plugin in vite.config.ts.
const files = import.meta.glob('../releases/*.md', { eager: true, import: 'default' }) as Record<string, string>;

function parseVersion(path: string): string {
  return path.match(/([\d]+\.[\d]+\.[\d]+)\.md$/)?.[1] ?? '0.0.0';
}

/** Negative, zero or positive like a sort comparator; numeric, so 1.10.0 sorts after 1.9.0. */
export function compareVersions(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/** All releases, newest first. Add a new one by dropping a `X.Y.Z.md` file into `src/releases/`. */
export const releases: Release[] = Object.entries(files)
  .map(([path, html]) => ({ version: parseVersion(path), html }))
  .sort((a, b) => compareVersions(b.version, a.version));
