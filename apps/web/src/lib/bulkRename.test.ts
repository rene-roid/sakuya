import { expect, test } from 'bun:test';
import { buildRenamePlan, planStats, splitFilename, DEFAULT_RENAME_OPTIONS } from './bulkRename';
import type { RenameOptions, RenameTarget } from './bulkRename';

const AUG_1 = new Date(2024, 7, 1).getTime();

function target(id: number, filename: string, dir = '/lib'): RenameTarget {
  return { id, filename, path: `${dir}/${filename}`, createdAt: AUG_1 };
}

function plan(targets: RenameTarget[], opts: Partial<RenameOptions>) {
  return buildRenamePlan(targets, { ...DEFAULT_RENAME_OPTIONS, ...opts });
}

test('splitFilename keeps dotfiles whole and takes only the last extension', () => {
  expect(splitFilename('photo.jpg')).toEqual({ name: 'photo', ext: '.jpg' });
  expect(splitFilename('archive.tar.gz')).toEqual({ name: 'archive.tar', ext: '.gz' });
  expect(splitFilename('noext')).toEqual({ name: 'noext', ext: '' });
  expect(splitFilename('.hidden')).toEqual({ name: '.hidden', ext: '' });
});

test('pattern mode expands tokens and numbers rows from startAt', () => {
  const rows = plan([target(1, 'a.jpg'), target(2, 'b.png')], {
    pattern: 'trip_{n:3}{ext}',
    startAt: 5,
  });
  expect(rows.map((r) => r.to)).toEqual(['trip_005.jpg', 'trip_006.png']);
  expect(rows.every((r) => r.changed)).toBe(true);
});

test('{name} and {date} resolve per row', () => {
  const rows = plan([target(1, 'sunset.jpg')], { pattern: '{date}_{name}{ext}' });
  expect(rows[0].to).toBe('2024-08-01_sunset.jpg');
});

test('the default pattern is a no-op', () => {
  const rows = plan([target(1, 'a.jpg'), target(2, 'b.png')], {});
  expect(rows.every((r) => !r.changed)).toBe(true);
  expect(planStats(rows)).toEqual({ changed: 0, errors: 0 });
});

test('replace mode does plain-text replacement without regex interpretation', () => {
  const rows = plan([target(1, 'IMG_2024.a.jpg')], { mode: 'replace', find: '.', replace: '-' });
  // A literal "." must not behave as the regex any-char.
  expect(rows[0].to).toBe('IMG_2024-a-jpg');
});

test('replace mode honours regex mode and capture groups', () => {
  const rows = plan([target(1, 'IMG_0421.jpg')], {
    mode: 'replace',
    find: '^IMG_(\\d+)',
    replace: 'photo-$1',
    useRegex: true,
  });
  expect(rows[0].to).toBe('photo-0421.jpg');
});

test('an invalid regex flags every row instead of throwing', () => {
  const rows = plan([target(1, 'a.jpg'), target(2, 'b.jpg')], {
    mode: 'replace',
    find: '([',
    replace: 'x',
    useRegex: true,
  });
  expect(rows.map((r) => r.error)).toEqual(['Invalid regular expression', 'Invalid regular expression']);
});

test('a stateful /g regex does not skip matches on later rows', () => {
  const rows = plan([target(1, 'aaa.jpg'), target(2, 'aaa.jpg', '/other')], {
    mode: 'replace',
    find: 'a',
    replace: 'b',
  });
  expect(rows.map((r) => r.to)).toEqual(['bbb.jpg', 'bbb.jpg']);
});

test('two rows collapsing onto one name in the same folder are both flagged', () => {
  const rows = plan([target(1, 'a.jpg'), target(2, 'b.jpg')], { pattern: 'same.jpg' });
  expect(rows.map((r) => r.error)).toEqual([
    'Another selected file would get this name',
    'Another selected file would get this name',
  ]);
  expect(planStats(rows).errors).toBe(2);
});

test('a name colliding with an unchanged sibling is flagged', () => {
  // b.jpg keeps its name, so renaming a.jpg onto it is a real clobber.
  const rows = buildRenamePlan([target(1, 'a.jpg'), target(2, 'b.jpg')], {
    ...DEFAULT_RENAME_OPTIONS,
    mode: 'replace',
    find: 'a.jpg',
    replace: 'b.jpg',
  });
  expect(rows[0].error).toBe('Another selected file would get this name');
});

test('collisions are scoped per directory and judged case-insensitively', () => {
  const sameName = plan([target(1, 'a.jpg', '/one'), target(2, 'b.jpg', '/two')], { pattern: 'x.jpg' });
  expect(sameName.every((r) => !r.error)).toBe(true);

  const casing = plan([target(1, 'a.jpg'), target(2, 'b.jpg')], { mode: 'replace', find: 'b.jpg', replace: 'A.jpg' });
  expect(casing[1].error).toBe('Another selected file would get this name');
});

test('empty and path-bearing results are rejected', () => {
  expect(plan([target(1, 'a.jpg')], { pattern: '' })[0].error).toBe('Name would be empty');
  expect(plan([target(1, 'a.jpg')], { pattern: '../{name}{ext}' })[0].error).toBe(
    'Name cannot contain a path separator',
  );
});
