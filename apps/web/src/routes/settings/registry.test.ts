import { expect, mock, test } from 'bun:test';

// Release notes come from a Vite-only glob import; the registry only needs the component to exist.
mock.module('../../lib/releases', () => ({ releases: [], compareVersions: () => 0 }));

const { ALL_SETTINGS_KEYS, KEYS_SET_ELSEWHERE, SECTIONS, SETTINGS, entryKeys, resolveSection, settingHref } =
  await import('./registry');

test('every Settings key appears in exactly one registry entry, or is named as set elsewhere', () => {
  const owners = new Map<string, string[]>();
  for (const entry of SETTINGS) {
    for (const key of entryKeys(entry)) owners.set(key, [...(owners.get(key) ?? []), entry.id]);
  }
  for (const key of ALL_SETTINGS_KEYS) {
    const ids = owners.get(key) ?? [];
    const elsewhere = key in KEYS_SET_ELSEWHERE;
    expect({ key, count: ids.length + (elsewhere ? 1 : 0) }).toEqual({ key, count: 1 });
  }
  expect(ALL_SETTINGS_KEYS).toHaveLength(16);
  expect(owners.get('confidence_threshold')).toEqual(['confidence-threshold']);
  expect(owners.get('discover_enabled')).toEqual(['discover-enabled']);
  expect(Object.keys(KEYS_SET_ELSEWHERE).sort()).toEqual(['downloader_concurrency', 'ui_style_chosen']);
});

test('ids are unique kebab-case and every entry sits in a known section', () => {
  const ids = SETTINGS.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  const sectionIds = new Set(SECTIONS.map((s) => s.id));
  for (const entry of SETTINGS) expect(sectionIds.has(entry.section)).toBe(true);
});

test('there are eight sections in three sidebar groups, each with at least one setting', () => {
  expect(SECTIONS.map((s) => `${s.group}/${s.id}`)).toEqual([
    'Preferences/general',
    'Preferences/playback',
    'Library/libraries',
    'Library/tagging',
    'Library/processing',
    'Library/jobs',
    'System/storage',
    'System/about',
  ]);
  for (const section of SECTIONS) expect(SETTINGS.some((s) => s.section === section.id)).toBe(true);
});

test('a group is contiguous within its section, so it renders as one panel', () => {
  const seen = new Set<string>();
  let previous = '';
  for (const entry of SETTINGS) {
    const key = `${entry.section}|${entry.group}`;
    if (key !== previous) {
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    previous = key;
  }
});

test('old ?tab= keys open the section that now holds their settings', () => {
  expect(resolveSection('behavior').id).toBe('general');
  expect(resolveSection('appearance').id).toBe('general');
  expect(resolveSection('system').id).toBe('storage');
  expect(resolveSection('releases').id).toBe('about');
  expect(resolveSection('tagging').id).toBe('tagging');
  expect(resolveSection('jobs').id).toBe('jobs');
  expect(resolveSection('nonsense').id).toBe('general');
  expect(resolveSection(null).id).toBe('general');
});

test('settingHref links a setting by its section and id', () => {
  expect(settingHref('discover-enabled')).toBe('/settings?tab=general#discover-enabled');
  expect(settingHref('thumbnail-cache')).toBe('/settings?tab=processing#thumbnail-cache');
  expect(settingHref('remember-volume')).toBe('/settings?tab=playback#remember-volume');
  expect(() => settingHref('no-such-setting')).toThrow('Unknown setting: no-such-setting');
});
