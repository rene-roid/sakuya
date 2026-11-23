import { expect, test } from 'bun:test';
import { Diversifier, diversify, folderOf, type Candidate } from './diversify';

const opts = { window: 20, folderCap: 4, reasonCap: 5, dupDistance: 6, dupWindow: 60, lookahead: 200 };
const item = (id: number, folder: string, reason: string | null = null, hash: string | null = null): Candidate => ({
  id,
  folder,
  reason,
  hash,
});
const ids = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

test('one folder never fills a window: a batch is spread four per twenty', () => {
  // Ranked: ten items from one folder, then ten from ten different folders.
  const ranked = [...ids(1, 10).map((id) => item(id, '/batch')), ...ids(11, 20).map((id) => item(id, `/other${id}`))];
  expect(diversify(ranked, opts)).toEqual([1, 2, 3, 4, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 5, 6, 7, 8, 9, 10]);
});

test('the window slides: a folder gets its fifth slot once its first item is twenty back', () => {
  const ranked = [...ids(1, 6).map((id) => item(id, '/batch')), ...ids(7, 30).map((id) => item(id, `/f${id}`))];
  const out = diversify(ranked, opts);
  expect(out.slice(0, 5)).toEqual([1, 2, 3, 4, 7]);
  // Item 1 sits at position 0, so position 20 is the first whose twenty-item window has room.
  expect(out.indexOf(5)).toBe(20);
  expect(out.indexOf(6)).toBe(21);
});

test('no more than five cards credit the same reason tag in any twenty', () => {
  const ranked = [
    ...ids(1, 8).map((id) => item(id, `/a${id}`, 'sunset')),
    ...ids(9, 12).map((id) => item(id, `/b${id}`, `t${id}`)),
  ];
  expect(diversify(ranked, opts)).toEqual([1, 2, 3, 4, 5, 9, 10, 11, 12, 6, 7, 8]);
});

test('an item can carry its own reason cap, so a boosted tag gets more of the window', () => {
  const ranked = [
    ...ids(1, 8).map((id) => ({ ...item(id, `/a${id}`, 'sunset'), reasonCap: 7 })),
    ...ids(9, 12).map((id) => item(id, `/b${id}`, `t${id}`)),
  ];
  expect(diversify(ranked, opts)).toEqual([1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 8]);
});

test('near-duplicates collapse to one per sixty, wherever they were saved', () => {
  const base = 'ffff0000ffff0000';
  const near = ['ffff0000ffff0001', 'ffff0000ffff0003', 'fffe0000ffff0007'];
  const far = 'ffff0000ffffffff'; // 16 bits from base
  const ranked = [
    item(1, '/x1', null, base),
    item(2, '/x2', null, near[0]),
    item(3, '/x3', null, near[1]),
    item(4, '/x4', null, near[2]),
    item(5, '/x5', null, far),
    item(6, '/x6'),
  ];
  // Nothing else to show, so the duplicates still come, after everything that isn't one.
  expect(diversify(ranked, opts)).toEqual([1, 5, 6, 2, 3, 4]);
  // Among 70 distinct items, the second copy waits until the first has left the sixty-item window.
  const filler = ids(100, 169).map((id) => item(id, `/f${id}`));
  const out = diversify([item(1, '/x1', null, base), item(2, '/x2', null, near[0]), ...filler], opts);
  expect(out.indexOf(2)).toBe(60);
  expect(out.slice(0, 3)).toEqual([1, 100, 101]);
});

test('when nothing fits, the reason cap gives way before the folder cap', () => {
  const ranked = [
    ...ids(1, 4).map((id) => item(id, '/b', `r${id}`)),
    ...ids(5, 9).map((id) => item(id, `/x${id}`, 'sunset')),
    item(10, '/b', 'night'), // a fifth from /b
    item(11, '/y', 'sunset'), // a sixth "sunset"
  ];
  expect(diversify(ranked, opts)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 10]);
});

test('a near-duplicate waits longer than a fifth item from one folder', () => {
  const base = 'ffff0000ffff0000';
  const ranked = [
    ...ids(1, 4).map((id) => item(id, '/b')),
    item(5, '/x', null, base),
    item(6, '/y', null, 'ffff0000ffff0001'), // a copy of 5
    item(7, '/b'), // a fifth from /b
  ];
  expect(diversify(ranked, opts)).toEqual([1, 2, 3, 4, 5, 7, 6]);
});

test('a library that is one folder still fills the feed in rank order', () => {
  const ranked = ids(1, 50).map((id) => item(id, '/only', 'solo'));
  expect(diversify(ranked, opts)).toEqual(ids(1, 50));
});

test('items without a hash or a reason are never held back by those rules', () => {
  const ranked = ids(1, 10).map((id) => item(id, `/f${id}`, null, null));
  expect(diversify(ranked, opts)).toEqual(ids(1, 10));
});

test('fed in chunks that keep the lookahead full, the order matches feeding it all at once', () => {
  const small = { ...opts, lookahead: 10 };
  const ranked = ids(1, 300).map((id) => item(id, `/f${id % 7}`, `r${id % 5}`, null));
  const whole = diversify(ranked, small);
  const d = new Diversifier(small);
  const out: number[] = [];
  let fed = 0;
  while (out.length < ranked.length) {
    if (d.pending < small.lookahead && fed < ranked.length) {
      d.push(ranked.slice(fed, fed + 7));
      fed += 7;
      continue;
    }
    out.push(d.next()!.id);
  }
  expect(new Set(whole).size).toBe(300);
  expect(out).toEqual(whole);
  // Seven folders can't fill twenty slots at four each, so this also exercises the fallback.
  expect(whole.slice(0, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
});

test('folderOf takes the directory for both separators', () => {
  expect(folderOf('/media/a/b.png')).toBe('/media/a');
  expect(folderOf('C:\\media\\a\\b.png')).toBe('C:\\media\\a');
  expect(folderOf('b.png')).toBe('');
});
