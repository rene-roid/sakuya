import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { sqlite } from '../db';
import { wrap } from '../lib/http';
import { getAllSettings, setSetting } from '../lib/settings';
import { THUMBS_DIR, DB_PATH, APP_VERSION } from '../lib/config';
import type { SystemInfo } from '@sakuya/shared';

export const settingsRouter = Router();

const EDITABLE_KEYS = new Set([
  'ai_tagging_enabled',
  'confidence_threshold',
  'accent_color',
  'remember_mute_state',
  'autosearch_first_tag',
  'continue_where_left',
  'thumbnail_cache_enabled',
  'board_remember_filters',
]);

settingsRouter.get(
  '/api/settings',
  wrap(async (_req, res) => {
    res.json(getAllSettings());
  }),
);

settingsRouter.patch(
  '/api/settings',
  wrap(async (req, res) => {
    const body = z.record(z.string()).parse(req.body);
    for (const [key, value] of Object.entries(body)) {
      if (!EDITABLE_KEYS.has(key)) return res.status(400).json({ error: `Setting not editable: ${key}` });
      setSetting(key, value);
    }
    res.json(getAllSettings());
  }),
);

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isFile()) total += fs.statSync(full).size;
      else if (entry.isDirectory()) total += dirSize(full);
    }
  } catch {}
  return total;
}

settingsRouter.get(
  '/api/system',
  wrap(async (_req, res) => {
    const media = sqlite.query('SELECT COUNT(*) AS c, COALESCE(SUM(size_bytes), 0) AS b FROM media').get() as {
      c: number;
      b: number;
    };
    const info: SystemInfo = {
      version: APP_VERSION,
      mediaCount: media.c,
      mediaBytes: media.b,
      dbBytes: fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0,
      thumbBytes: dirSize(THUMBS_DIR),
    };
    res.json(info);
  }),
);

settingsRouter.post(
  '/api/system/clear-thumbnails',
  wrap(async (_req, res) => {
    let removed = 0;
    for (const entry of fs.readdirSync(THUMBS_DIR)) {
      fs.rmSync(path.join(THUMBS_DIR, entry), { force: true });
      removed++;
    }
    res.json({ removed });
  }),
);
