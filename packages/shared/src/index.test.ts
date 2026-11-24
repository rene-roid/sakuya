import { expect, test } from 'bun:test';
import { normalizeTagName, prettifyTag, tagLabel, tagLabelText } from './index';

test('normalizeTagName lowercases and turns runs of whitespace into one underscore', () => {
  expect(normalizeTagName('  Blue   Hair ')).toBe('blue_hair');
  expect(normalizeTagName('Hakurei\tReimu')).toBe('hakurei_reimu');
  expect(normalizeTagName('already_normal')).toBe('already_normal');
  expect(normalizeTagName('   ')).toBe('');
});

test('prettifyTag title-cases character names and splits off a trailing qualifier', () => {
  expect(prettifyTag('uraraka_ochako', 'character')).toEqual({ label: 'Uraraka Ochako', qualifier: null });
  expect(prettifyTag('asuna_(sao)', 'character')).toEqual({ label: 'Asuna', qualifier: 'sao' });
  expect(prettifyTag('hatsune_miku_(append)', 'character')).toEqual({ label: 'Hatsune Miku', qualifier: 'append' });
  expect(prettifyTag('rem_(re:zero)', 'character')).toEqual({ label: 'Rem', qualifier: 're:zero' });
  expect(prettifyTag('artoria_pendragon_(fate)_(cosplay)', 'character')).toEqual({
    label: 'Artoria Pendragon (fate)',
    qualifier: 'cosplay',
  });
  expect(prettifyTag('saber_(fate/stay_night)', 'character')).toEqual({ label: 'Saber', qualifier: 'fate/stay night' });
});

test('prettifyTag title-cases artist and series names like characters', () => {
  expect(prettifyTag('david_revoy', 'artist')).toEqual({ label: 'David Revoy', qualifier: null });
  expect(prettifyTag('boku_no_hero_academia', 'copyright')).toEqual({ label: 'Boku No Hero Academia', qualifier: null });
});

test('prettifyTag keeps general and user tags lowercase and capitalises ratings', () => {
  expect(prettifyTag('1girl', 'general')).toEqual({ label: '1girl', qualifier: null });
  expect(prettifyTag('looking_at_viewer', 'general')).toEqual({ label: 'looking at viewer', qualifier: null });
  expect(prettifyTag('bow_(weapon)', 'general')).toEqual({ label: 'bow', qualifier: 'weapon' });
  expect(prettifyTag('my__own_tag_', 'user')).toEqual({ label: 'my own tag', qualifier: null });
  expect(prettifyTag('long_hair')).toEqual({ label: 'long hair', qualifier: null });
  expect(prettifyTag('sensitive', 'rating')).toEqual({ label: 'Sensitive', qualifier: null });
});

test('prettifyTag leaves emoticons and degenerate names alone', () => {
  expect(prettifyTag('^_^', 'general').label).toBe('^_^');
  expect(prettifyTag('o_o', 'general').label).toBe('o_o');
  expect(prettifyTag(':d', 'general').label).toBe(':d');
  expect(prettifyTag('_(foo)', 'general')).toEqual({ label: '(foo)', qualifier: null });
  expect(prettifyTag('____', 'general')).toEqual({ label: '____', qualifier: null });
});

test('tagLabel prefers a display name and tagLabelText folds the qualifier into one string', () => {
  expect(tagLabel({ name: 'uraraka_ochako', category: 'character', displayName: 'Uraraka' })).toEqual({
    label: 'Uraraka',
    qualifier: null,
  });
  expect(tagLabel({ name: 'uraraka_ochako', category: 'character', displayName: '  ' }).label).toBe('Uraraka Ochako');
  expect(tagLabelText({ name: 'asuna_(sao)', category: 'character', displayName: null })).toBe('Asuna (sao)');
  expect(tagLabelText({ name: 'solo', category: 'general' })).toBe('solo');
});
