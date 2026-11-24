import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { CONFIG } from '../lib/config';
import { timingSafeEqual, isAuthed, requireAuth, setAuthCookie, clearAuthCookie } from '../lib/auth';
import { MAX_PASSWORD_LENGTH, authSettings, saveAuth } from '../lib/authConfig';
import type { AuthStatus } from '@sakuya/shared';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
});

// Only wrong current passwords count: someone who changes it twice in a row isn't guessing.
const passwordLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
});

authRouter.get('/api/auth/status', (req, res) => {
  const payload: AuthStatus = { enabled: CONFIG.auth.enabled, unlocked: isAuthed(req) };
  res.json(payload);
});

authRouter.post('/api/auth/login', loginLimiter, (req, res) => {
  if (!CONFIG.auth.enabled) {
    res.json({ ok: true });
    return;
  }

  const secret = typeof req.body?.secret === 'string' ? req.body.secret : '';
  if (!secret || !timingSafeEqual(secret, CONFIG.auth.secret)) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  setAuthCookie(res);
  res.json({ ok: true });
});

authRouter.post('/api/auth/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

authRouter.get('/api/auth/settings', requireAuth, (_req, res) => {
  res.json(authSettings());
});

/**
 * Being signed in isn't enough to change the login: a session left open on a shared screen
 * shouldn't let whoever sits down lock the owner out. With login on, the current password is
 * required too. With it off there is nothing to check — anyone here can already use everything.
 */
function checkChange(req: Request, res: Response): boolean {
  const locked = authSettings().lockedReason;
  if (locked) {
    res.status(409).json({ error: locked });
    return false;
  }
  if (!CONFIG.auth.enabled) return true;
  const current = typeof req.body?.current === 'string' ? req.body.current : '';
  if (!current || !timingSafeEqual(current, CONFIG.auth.secret)) {
    res.status(403).json({ error: 'Current password is wrong' });
    return false;
  }
  return true;
}

function save(res: Response, auth: { enabled: boolean; secret: string }): boolean {
  try {
    saveAuth(auth);
    return true;
  } catch (err) {
    res.status(500).json({ error: `Could not save the config file: ${(err as Error).message}` });
    return false;
  }
}

/** Set a new password, turning login on if it was off. Signs every other session out. */
authRouter.post('/api/auth/password', requireAuth, passwordLimiter, (req, res) => {
  const next = typeof req.body?.next === 'string' ? req.body.next : '';
  if (!next.trim()) {
    res.status(400).json({ error: 'Enter a new password' });
    return;
  }
  if (next.length > MAX_PASSWORD_LENGTH) {
    res.status(400).json({ error: `Use at most ${MAX_PASSWORD_LENGTH} characters` });
    return;
  }
  if (!checkChange(req, res) || !save(res, { enabled: true, secret: next })) return;
  // The old cookie was signed with the old password; this one keeps the person who changed it in.
  setAuthCookie(res);
  res.json(authSettings());
});

authRouter.post('/api/auth/disable', requireAuth, passwordLimiter, (req, res) => {
  if (!CONFIG.auth.enabled) {
    res.json(authSettings());
    return;
  }
  // The password is cleared rather than kept: no reason to leave it in the file once it's unused.
  if (!checkChange(req, res) || !save(res, { enabled: false, secret: '' })) return;
  res.json(authSettings());
});
