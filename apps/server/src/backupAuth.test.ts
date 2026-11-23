import { expect, test } from 'bun:test';
import type { Job } from '@sakuya/shared';
import { useTestConfig } from './testConfig';

const PORT = 38948; // P01
useTestConfig('backup-auth', { port: PORT, auth: { enabled: true, secret: 'backup auth secret' } });
const BASE = `http://localhost:${PORT}`;
process.env.SAKUYA_DESKTOP_TOKEN = 'desktop-launch-token';

await import('./index');

test('starting a backup without a session is refused', async () => {
  const res = await fetch(`${BASE}/api/backups`, { method: 'POST' });
  expect(res.status).toBe(401);
  expect((await fetch(`${BASE}/api/backups`)).status).toBe(401);
});

test('a wrong desktop token is refused', async () => {
  const res = await fetch(`${BASE}/api/backups`, {
    method: 'POST',
    headers: { 'X-Sakuya-Desktop-Token': 'desktop-launch-tokeX' },
  });
  expect(res.status).toBe(401);
});

test('a logged-in session and the desktop token can both start one', async () => {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: 'backup auth secret' }),
  });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const withSession = await fetch(`${BASE}/api/backups`, { method: 'POST', headers: { cookie } });
  expect(withSession.status).toBe(202);
  expect(((await withSession.json()) as Job).type).toBe('backup');

  const withToken = await fetch(`${BASE}/api/backups`, {
    method: 'POST',
    headers: { 'X-Sakuya-Desktop-Token': 'desktop-launch-token' },
  });
  expect(withToken.status).toBe(202);
});
