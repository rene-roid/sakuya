import crypto from 'node:crypto';
import type { Request, Response, RequestHandler } from 'express';
import { CONFIG } from './config';

const COOKIE_NAME = 'sakuya_auth';
const SESSION_MS = 1000 * 60 * 60 * 24 * 30;

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Cookie, not a header: thumbnails/video/EventSource are plain browser requests
// that can't attach custom headers, but do send cookies automatically.
function readAuthCookie(req: Request): string | null {
  return new Bun.CookieMap(req.headers.cookie ?? '').get(COOKIE_NAME);
}

/**
 * Session token: `<expiry-ms>.<hmac-sha256(expiry, AUTH_SECRET)>`.
 *
 * The cookie used to be AUTH_SECRET verbatim — the password itself, sitting in a header on every
 * request and in the logs of anything that records cookies. It was httpOnly, so script couldn't
 * read it, but it could not be expired or revoked separately from the password either.
 *
 * A token proves the holder knew the password at some point without carrying it, and carries its
 * own expiry. Rotating AUTH_SECRET now invalidates every outstanding session, since the signature
 * no longer verifies.
 */
function sign(expiry: number): string {
  return crypto.createHmac('sha256', CONFIG.auth.secret).update(String(expiry)).digest('hex');
}

export function issueToken(now: number = Date.now()): string {
  const expiry = now + SESSION_MS;
  return `${expiry}.${sign(expiry)}`;
}

export function verifyToken(token: string | null, now: number = Date.now()): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot === -1) return false;
  const expiryPart = token.slice(0, dot);
  const expiry = Number(expiryPart);
  if (!Number.isSafeInteger(expiry)) return false;
  // Signature first: checking expiry first would let an attacker probe for valid expiry values
  // without ever producing a signature.
  if (!timingSafeEqual(token.slice(dot + 1), sign(expiry))) return false;
  return expiry > now;
}

export function setAuthCookie(res: Response): void {
  res.cookie(COOKIE_NAME, issueToken(), {
    httpOnly: true,
    sameSite: 'lax',
    // Off unless SAKUYA_HTTPS=true: a Secure cookie is dropped over plain HTTP, and serving a
    // LAN over HTTP is a supported setup — defaulting this on would lock those users out.
    secure: CONFIG.server.https,
    maxAge: SESSION_MS,
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME);
}

export function isAuthed(req: Request): boolean {
  if (!CONFIG.auth.enabled) return true;
  return verifyToken(readAuthCookie(req));
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Unauthorized' });
};
