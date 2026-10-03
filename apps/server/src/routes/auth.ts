import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { CONFIG } from '../lib/config';
import { timingSafeEqual, isAuthed, setAuthCookie, clearAuthCookie } from '../lib/auth';
import type { AuthStatus } from '@sakuya/shared';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
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
