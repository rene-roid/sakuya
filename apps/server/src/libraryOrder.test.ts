import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the server at a throwaway data dir before anything opens the real database.
process.env.SAKUYA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-liborder-'));
process.env.PORT = '38773';
const BASE = 'http://localhost:38773';

await import('./index'); // starts listening on PORT

const send = (method: string, url: string, body: unknown) =>
  fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const json = async (res: Response | Promise<Response>): Promise<any> => (await (await res).json()) as any;
const names = async () => (await json(fetch(`${BASE}/api/libraries`))).map((l: { name: string }) => l.name);

test('libraries can be renamed and reordered away from creation order', async () => {
  const a = await json(send('POST', '/api/libraries', { name: 'A' }));
  const b = await json(send('POST', '/api/libraries', { name: 'B' }));
  const c = await json(send('POST', '/api/libraries', { name: 'C' }));
  expect(await names()).toEqual(['A', 'B', 'C']);

  await send('PUT', '/api/libraries/order', { ids: [c.id, a.id, b.id] });
  expect(await names()).toEqual(['C', 'A', 'B']);

  await send('PATCH', `/api/libraries/${a.id}`, { name: 'Renamed' });
  expect(await names()).toEqual(['C', 'Renamed', 'B']);

  // A library created after a reorder lands at the bottom, not back in id order.
  await json(send('POST', '/api/libraries', { name: 'D' }));
  expect(await names()).toEqual(['C', 'Renamed', 'B', 'D']);
});
