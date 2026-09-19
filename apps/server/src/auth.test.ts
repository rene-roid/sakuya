import { describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SAKUYA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sakuya-auth-'));
process.env.AUTH_ENABLED = 'true';
process.env.AUTH_SECRET = 'correct horse battery staple';
process.env.PORT = '38778';
const BASE = 'http://localhost:38778';

const { issueToken, verifyToken } = await import('./lib/auth');
await import('./index');

const SECRET = process.env.AUTH_SECRET;
const DAY = 86_400_000;

describe('session tokens', () => {
  test('a freshly issued token verifies', () => {
    expect(verifyToken(issueToken())).toBe(true);
  });

  test('the token does not contain the password', () => {
    // The whole point of the change: the cookie used to be AUTH_SECRET verbatim.
    expect(issueToken()).not.toContain(SECRET);
  });

  test('an expired token is rejected', () => {
    const past = Date.now() - 40 * DAY;
    // Issued 40 days ago, so its 30-day expiry is behind us.
    expect(verifyToken(issueToken(past))).toBe(false);
  });

  test('a tampered expiry is rejected', () => {
    const token = issueToken();
    const signature = token.slice(token.indexOf('.') + 1);
    // Push the expiry far into the future but keep the old signature.
    expect(verifyToken(`${Date.now() + 999 * DAY}.${signature}`)).toBe(false);
  });

  test('a token signed with a different secret is rejected', () => {
    const expiry = Date.now() + DAY;
    const forged = crypto.createHmac('sha256', 'wrong secret').update(String(expiry)).digest('hex');
    expect(verifyToken(`${expiry}.${forged}`)).toBe(false);
  });

  test('malformed tokens are rejected rather than throwing', () => {
    for (const bad of ['', 'nonsense', '.', 'abc.def', `${Date.now() + DAY}.`, `.${'0'.repeat(64)}`, SECRET]) {
      expect(verifyToken(bad)).toBe(false);
    }
    expect(verifyToken(null)).toBe(false);
  });
});

describe('login flow', () => {
  const login = (secret: string) =>
    fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret }),
    });

  test('protected routes are closed until login', async () => {
    const res = await fetch(`${BASE}/api/media`);
    expect(res.status).toBe(401);
  });

  test('health stays reachable without auth, for the container probe', async () => {
    const res = await fetch(`${BASE}/api/health`);
    expect(res.status).toBe(200);
  });

  test('the wrong password is refused and sets no cookie', async () => {
    const res = await login('hunter2');
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  test('the right password issues a signed httpOnly cookie that unlocks the API', async () => {
    const res = await login(SECRET);
    expect(res.status).toBe(200);

    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toContain('HttpOnly');
    // The cookie carries a token, not the password.
    expect(setCookie).not.toContain(SECRET);

    const cookie = setCookie.split(';')[0];
    const authed = await fetch(`${BASE}/api/media`, { headers: { cookie } });
    expect(authed.status).toBe(200);
  });

  test('a forged cookie does not unlock the API', async () => {
    const expiry = Date.now() + DAY;
    const forged = crypto.createHmac('sha256', 'wrong secret').update(String(expiry)).digest('hex');
    const res = await fetch(`${BASE}/api/media`, { headers: { cookie: `sakuya_auth=${expiry}.${forged}` } });
    expect(res.status).toBe(401);
  });

  test('the old scheme (password as the cookie value) no longer authenticates', async () => {
    // Existing sessions are invalidated by this change; that is the intended migration.
    const res = await fetch(`${BASE}/api/media`, {
      headers: { cookie: `sakuya_auth=${encodeURIComponent(SECRET)}` },
    });
    expect(res.status).toBe(401);
  });
});
