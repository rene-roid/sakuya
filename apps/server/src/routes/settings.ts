import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { eq, isNotNull, isNull } from 'drizzle-orm';
import { sqlite, db, schema } from '../db';
import { wrap } from '../lib/http';
import { getAllSettings, setSetting } from '../lib/settings';
import { THUMBS_DIR, DB_PATH, APP_VERSION } from '../lib/config';
import { enqueueBulkThumbnailRegenerate, thumbPathFor } from '../services/thumbnailer';
import { scheduleAll } from '../services/jobScheduler';
import { performCleanup } from '../services/cleanup';
import type { SystemInfo, JobSchedule, JobSchedulesPayload } from '@sakuya/shared';

export const settingsRouter = Router();

const EDITABLE_KEYS = new Set([
  'ai_tagging_enabled',
  'confidence_threshold',
  'accent_color',
  'remember_mute_state',
  'remember_volume_level',
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

settingsRouter.get(
  '/api/job-schedules',
  wrap(async (_req, res) => {
    const globalRows = db
      .select()
      .from(schema.jobSchedules)
      .where(isNull(schema.jobSchedules.libraryId))
      .all();
    const perLibRows = db
      .select()
      .from(schema.jobSchedules)
      .where(isNotNull(schema.jobSchedules.libraryId))
      .all();

    const globals: Record<string, JobSchedule> = {};
    for (const r of globalRows) {
      globals[r.jobType] = { mode: r.mode, intervalMinutes: r.intervalMinutes };
    }
    const perLibrary: Record<number, Record<string, JobSchedule>> = {};
    for (const row of perLibRows) {
      if (row.libraryId === null) continue;
      if (!perLibrary[row.libraryId]) perLibrary[row.libraryId] = {};
      perLibrary[row.libraryId][row.jobType] = {
        mode: row.mode,
        intervalMinutes: row.intervalMinutes,
        useGlobal: row.useGlobal === 1,
      };
    }

    const payload: JobSchedulesPayload = { globals, perLibrary };
    res.json(payload);
  }),
);

const scheduleBody = z.object({
  jobType: z.enum(['scan', 'tag', 'hash', 'cleanup']),
  libraryId: z.number().int().positive().nullable().optional(),
  mode: z.enum(['off', 'interval', 'after-scan']).optional(),
  intervalMinutes: z.number().int().min(0).optional(),
  useGlobal: z.boolean().optional(),
});

settingsRouter.patch(
  '/api/job-schedules',
  wrap(async (req, res) => {
    const body = scheduleBody.parse(req.body);
    const libraryId = body.libraryId ?? null;

    // SQLite treats NULLs as distinct in unique indexes, so composite-PK upsert on (job_type, NULL)
    // can't be relied on. Read → decide → update-or-insert explicitly.
    const existing = db
      .select()
      .from(schema.jobSchedules)
      .where(
        libraryId === null
          ? isNull(schema.jobSchedules.libraryId)
          : eq(schema.jobSchedules.libraryId, libraryId),
      )
      .all()
      .find((r) => r.jobType === body.jobType);

    const merged = {
      jobType: body.jobType,
      libraryId,
      mode: (body.mode ?? existing?.mode ?? 'off') as 'off' | 'interval' | 'after-scan',
      intervalMinutes: body.intervalMinutes ?? existing?.intervalMinutes ?? 0,
      useGlobal: body.useGlobal !== undefined ? (body.useGlobal ? 1 : 0) : (existing?.useGlobal ?? 0),
    };

    if (existing) {
      sqlite
        .prepare(
          libraryId === null
            ? 'UPDATE job_schedules SET mode = ?, interval_minutes = ?, use_global = ? WHERE job_type = ? AND library_id IS NULL'
            : 'UPDATE job_schedules SET mode = ?, interval_minutes = ?, use_global = ? WHERE job_type = ? AND library_id = ?',
        )
        .run(
          merged.mode,
          merged.intervalMinutes,
          merged.useGlobal,
          merged.jobType,
          ...(libraryId === null ? [] : [libraryId]),
        );
    } else {
      db.insert(schema.jobSchedules).values(merged).run();
    }

    scheduleAll();
    res.json({ ok: true });
  }),
);

settingsRouter.post(
  '/api/system/regenerate-thumbnails',
  wrap(async (_req, res) => {
    enqueueBulkThumbnailRegenerate();
    res.json({ ok: true });
  }),
);

settingsRouter.post(
  '/api/system/cleanup',
  wrap(async (_req, res) => {
    const result = performCleanup();
    res.json(result);
  }),
);
