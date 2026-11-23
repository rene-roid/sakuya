import { expect, test } from 'bun:test';
import type { CharacterSummary, TagCount } from '@sakuya/shared';
import { characterLabelText, clampLeft, containRect, customDisplayName, nameOptions } from './characters';

function character(id: number, name: string | null, mediaCount: number, displayName: string | null = null) {
  return {
    id,
    tagId: name ? id : null,
    name,
    displayName,
    hidden: false,
    createdAt: 0,
    mediaCount,
    detectionCount: mediaCount,
    coverDetectionId: null,
    coverUrl: null,
    suggestion: null,
  } satisfies CharacterSummary;
}

const tag = (name: string, count: number): TagCount => ({ name, category: 'character', displayName: null, count });

test('characterLabelText uses the display name, the automatic label, or Unnamed', () => {
  expect(characterLabelText(character(1, 'pepper_(pepper&carrot)', 3))).toBe('Pepper (pepper&carrot)');
  expect(characterLabelText(character(1, 'mira', 3, 'Mira Lune'))).toBe('Mira Lune');
  expect(characterLabelText(character(1, null, 3))).toBe('Unnamed');
  expect(characterLabelText(character(1, null, 3), 'Unknown')).toBe('Unknown');
});

test('nameOptions puts prefix matches first, then busier ones, and offers a new name last', () => {
  const chars = [character(1, 'pepper_(pepper&carrot)', 30), character(2, 'carrot_(cat)', 12), character(3, null, 50)];
  const tags = [tag('saffron_(pepper&carrot)', 4), tag('shichimi', 2)];
  expect(nameOptions('', chars, tags).map((o) => o.label)).toEqual([
    'Pepper (pepper&carrot)',
    'Carrot (cat)',
    'Saffron (pepper&carrot)',
    'Shichimi',
  ]);
  expect(nameOptions('carrot', chars, tags).map((o) => [o.kind, o.label])).toEqual([
    ['character', 'Carrot (cat)'],
    ['character', 'Pepper (pepper&carrot)'],
    ['tag', 'Saffron (pepper&carrot)'],
    ['new', 'carrot'],
  ]);
  expect(nameOptions('  Mira   Lune ', chars, tags)).toEqual([{ kind: 'new', label: 'Mira Lune', name: 'Mira Lune' }]);
});

test('nameOptions drops the new option when the text is already a name', () => {
  const chars = [character(2, 'carrot_(cat)', 12)];
  expect(nameOptions('Carrot (cat)', chars, []).map((o) => o.kind)).toEqual(['character']);
  expect(nameOptions('shichimi', [], [tag('shichimi', 2)]).map((o) => o.kind)).toEqual(['tag']);
});

test('customDisplayName keeps typed capitals the automatic label would lose', () => {
  expect(customDisplayName('pepper', 'pepper')).toBeNull();
  expect(customDisplayName('Pepper', 'pepper')).toBeNull();
  expect(customDisplayName('Carrot (cat)', 'carrot_(cat)')).toBeNull();
  expect(customDisplayName(' McGregor ', 'mcgregor')).toBe('McGregor');
  expect(customDisplayName('MIRA', 'mira')).toBe('MIRA');
});

test('containRect letterboxes the picture inside the element', () => {
  expect(containRect(400, 400, 200, 100)).toEqual({ left: 0, top: 100, width: 400, height: 200 });
  expect(containRect(400, 300, 100, 300)).toEqual({ left: 150, top: 0, width: 100, height: 300 });
  expect(containRect(400, 300, 0, 0)).toEqual({ left: 0, top: 0, width: 400, height: 300 });
});

test('clampLeft keeps a popover inside its container', () => {
  expect(clampLeft(50, 240, 600)).toBe(50);
  expect(clampLeft(500, 240, 600)).toBe(356);
  expect(clampLeft(-20, 240, 600)).toBe(4);
});
