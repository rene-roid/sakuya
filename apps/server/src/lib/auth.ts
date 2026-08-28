import crypto from 'node:crypto';
import type { Request, Response, RequestHandler } from 'express';
import { AUTH_ENABLED, AUTH_SECRET } from './config';

const COOKIE_NAME = 'sakuya_auth';

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Cookie, not a header: thumbnails/video/EventSource are plain browser requests
// that can't attach custom headers, but do send cookies automatically.
function readAuthCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === COOKIE_NAME) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function setAuthCookie(res: Response, secret: string): void {
  res.cookie(COOKIE_NAME, secret, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME);
}

export function isAuthed(req: Request): boolean {
  if (!AUTH_ENABLED) return true;
  const provided = readAuthCookie(req);
  return !!provided && timingSafeEqual(provided, AUTH_SECRET);
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Unauthorized' });
};
