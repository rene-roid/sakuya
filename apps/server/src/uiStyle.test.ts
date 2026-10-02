import { expect, test } from 'bun:test';
import { useTestConfig } from './testConfig';

// Point the server at a throwaway data dir before anything opens the real database.
useTestConfig('uistyle', { port: 38781 });
const BASE = 'http://localhost:38781';

await import('./index'); // starts listening on PORT

const patch = (body: unknown) =>
  fetch(`${BASE}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const settings = async () => (await (await fetch(`${BASE}/api/settings`)).json()) as Record<string, string>;

test('a fresh install starts on the original style and has not been asked yet', async () => {
  const s = await settings();
  expect(s.ui_style).toBe('classic');
  expect(s.ui_style_chosen).toBe('0');
});

test('answering the style prompt saves the style and marks it answered', async () => {
  const res = await patch({ ui_style: 'glass', ui_style_chosen: '1' });
  expect(res.status).toBe(200);
  const s = await settings();
  expect(s.ui_style).toBe('glass');
  expect(s.ui_style_chosen).toBe('1');
});

test('an unknown style is rejected and leaves the saved one alone', async () => {
  const res = await patch({ ui_style: 'neon' });
  expect(res.status).toBe(400);
  expect((await settings()).ui_style).toBe('glass');
});
