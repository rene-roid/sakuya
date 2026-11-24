import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { useTestConfig } from './testConfig';

const FIRST = 'first password';
const dataDir = useTestConfig('auth-settings', { port: 38782, auth: { enabled: true, secret: FIRST } });
const CONFIG_PATH = path.join(dataDir, 'sakuya.config.json');
const BASE = 'http://localhost:38782';

const { CONFIG } = await import('./lib/config');
const { reloadAuthFromFile } = await import('./lib/authConfig');
await import('./index');

const readFile = () => JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

async function login(secret: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret }),
  });
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie')!.split(';')[0];
}

// The login limiter counts successful logins too, so the tests share one session where they can.
let cookie = '';

const post = (route: string, cookie: string, body: unknown) =>
  fetch(`${BASE}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  });

describe('changing the password from Settings', () => {
  test('the settings endpoint needs a session and reports the config file', async () => {
    expect((await fetch(`${BASE}/api/auth/settings`)).status).toBe(401);
    cookie = await login(FIRST);
    const res = await fetch(`${BASE}/api/auth/settings`, { headers: { cookie } });
    expect(await res.json()).toEqual({ enabled: true, configFile: CONFIG_PATH, docker: false, lockedReason: null });
  });

  test('a session alone is not enough: the current password must match', async () => {
    const missing = await post('/api/auth/password', cookie, { next: 'whatever' });
    expect(missing.status).toBe(403);
    const wrong = await post('/api/auth/password', cookie, { current: 'nope', next: 'whatever' });
    expect(wrong.status).toBe(403);
    expect(readFile().auth.secret).toBe(FIRST);
  });

  test('an empty new password is refused', async () => {
    const res = await post('/api/auth/password', cookie, { current: FIRST, next: '   ' });
    expect(res.status).toBe(400);
  });

  test('the right current password saves the new one to the file, keeps this session and drops the old ones', async () => {
    const oldCookie = cookie;
    const res = await post('/api/auth/password', oldCookie, { current: FIRST, next: 'second password' });
    expect(res.status).toBe(200);
    const newCookie = res.headers.get('set-cookie')!.split(';')[0];

    const file = readFile();
    expect(file.auth).toEqual({ enabled: true, secret: 'second password' });
    // The rest of the file is left alone.
    expect(file.server.port).toBe(38782);

    expect((await fetch(`${BASE}/api/media`, { headers: { cookie: newCookie } })).status).toBe(200);
    expect((await fetch(`${BASE}/api/media`, { headers: { cookie: oldCookie } })).status).toBe(401);
    cookie = newCookie;
  });

  test('turning login off needs the current password and clears it from the file', async () => {
    expect((await post('/api/auth/disable', cookie, { current: FIRST })).status).toBe(403);
    const res = await post('/api/auth/disable', cookie, { current: 'second password' });
    expect(res.status).toBe(200);
    expect(readFile().auth).toEqual({ enabled: false, secret: '' });
    expect((await fetch(`${BASE}/api/media`)).status).toBe(200);
  });

  test('with login off, a password can be set without one and turns login back on', async () => {
    const res = await post('/api/auth/password', '', { next: 'third password' });
    expect(res.status).toBe(200);
    expect(readFile().auth).toEqual({ enabled: true, secret: 'third password' });
    expect((await fetch(`${BASE}/api/media`)).status).toBe(401);
  });
});

describe('editing the config file by hand', () => {
  const writeAuth = (auth: unknown) => {
    const file = readFile();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...file, auth }, null, 2));
  };

  test('a new auth.secret applies without a restart', async () => {
    writeAuth({ enabled: true, secret: 'edited by hand' });
    reloadAuthFromFile();
    expect(CONFIG.auth).toEqual({ enabled: true, secret: 'edited by hand' });
    cookie = await login('edited by hand');
  });

  test('a half-edited file or an empty password keeps the current login', () => {
    fs.writeFileSync(CONFIG_PATH, '{ "auth": { "enabled": tr');
    reloadAuthFromFile();
    expect(CONFIG.auth.secret).toBe('edited by hand');

    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ server: { dataDir, port: 38782 }, auth: { enabled: true, secret: '' } }));
    reloadAuthFromFile();
    expect(CONFIG.auth).toEqual({ enabled: true, secret: 'edited by hand' });
  });

  test('the change is picked up by the file watcher on its own', async () => {
    writeAuth({ enabled: true, secret: 'watched' });
    const deadline = Date.now() + 8000;
    while (CONFIG.auth.secret !== 'watched' && Date.now() < deadline) await Bun.sleep(100);
    expect(CONFIG.auth.secret).toBe('watched');
  });

  test('the app refuses to save over a file that does not parse', async () => {
    // The secret changed under the session, so it no longer verifies; with login briefly off, no
    // session is needed and the file is the only thing in the way.
    writeAuth({ enabled: false, secret: '' });
    reloadAuthFromFile();
    fs.writeFileSync(CONFIG_PATH, '{ broken');
    const res = await post('/api/auth/password', cookie, { next: 'never saved' });
    expect(res.status).toBe(500);
    expect(fs.readFileSync(CONFIG_PATH, 'utf8')).toBe('{ broken');
  });
});
