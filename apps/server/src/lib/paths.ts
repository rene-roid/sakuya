import path from 'node:path';

/**
 * True when `child` is `root` or lives beneath it. Both are expected to be absolute.
 *
 * A bare `child.startsWith(root + path.sep)` never matches when root is a filesystem root ("/" or
 * "C:\\"), since that already ends in a separator; it also can't tell "/media/a" from "/media/ab".
 */
export function isUnder(child: string, root: string): boolean {
  if (child === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return child.startsWith(prefix);
}
