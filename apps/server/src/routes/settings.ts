import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { sqlite, db, schema } from '../db';
import { wrap } from '../lib/http';
import { DEFAULTS, getAllSettings, getSetting, setSetting, gifsAsVideos } from '../lib/settings';
import { THUMBS_DIR, DB_PATH, APP_VERSION, DATA_DIR, DATA_DIR_PINNED, HOME_DATA_DIR, LOCAL_DATA_DIR } from '../lib/config';
import { migrateDataDir } from '../lib/storage';
import { enqueueBulkThumbnailRegenerate } from '../services/thumbnailer';
import { enqueueBulkTranscodeCheck } from '../services/transcoder';
import { enqueueGifReclassifyJob } from '../services/scanner';
import { scheduleAll } from '../services/jobScheduler';
import { performCleanup } from '../services/cleanup';
import { SCHEDULE_JOB_TYPES, SCHEDULE_MODES, type SystemInfo, type StorageInfo, type JobSchedule, type JobSchedulesPayload } from '@sakuya/shared';

export const settingsRouter = Router();

// tagger_model is switched through /api/tagger/select, which also drops the downloaded model.
const EDITABLE_KEYS = new Set(Object.keys(DEFAULTS).filter((key) => key !== 'tagger_model'));

const UI_STYLES = new Set(['glass', 'classic']);

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
    // Checked up front so a rejected request changes nothing, rather than applying every key
    // ahead of the bad one and then reporting failure.
    const invalid = Object.keys(body).find((key) => !EDITABLE_KEYS.has(key));
    if (invalid) return res.status(400).json({ error: `Setting not editable: ${invalid}` });
    if (body.ui_style !== undefined && !UI_STYLES.has(body.ui_style)) {
      return res.status(400).json({ error: `Unknown ui_style: ${body.ui_style}` });
    }
    for (const [key, value] of Object.entries(body)) {
      if (key === 'gifs_as_videos' && value !== getSetting(key)) {
        enqueueGifReclassifyJob(value === '1');
      }
      setSetting(key, value);
    }
    res.json(getAllSettings());
  }),
);

/**
 * Async on purpose: the thumbnail folder holds one file per media item, and statting tens of
 * thousands of them synchronously stalled every other request while the settings page loaded.
 */
async function dirSize(dir: string): Promise<number> {
  // Flat: thumbnails are <id>.webp directly in the folder.
  const names = await fs.promises.readdir(dir).catch(() => []);
  const sizes = await Promise.all(names.map((name) => fs.promises.stat(path.join(dir, name)).then((s) => s.size, () => 0)));
  return sizes.reduce((a, b) => a + b, 0);
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
      thumbBytes: await dirSize(THUMBS_DIR),
    };
    res.json(info);
  }),
);

settingsRouter.get(
  '/api/system/storage',
  wrap(async (_req, res) => {
    const info: StorageInfo = {
      current: DATA_DIR,
      home: HOME_DATA_DIR,
      local: LOCAL_DATA_DIR,
      usingHome: DATA_DIR === HOME_DATA_DIR,
      locked: DATA_DIR_PINNED,
    };
    res.json(info);
  }),
);

settingsRouter.post(
  '/api/system/storage/migrate',
  wrap(async (req, res) => {
    const { target } = z.object({ target: z.enum(['home', 'local']) }).parse(req.body);
    if (DATA_DIR_PINNED) {
      return res.status(400).json({ error: 'server.dataDir is set in sakuya.config.json — change it there instead.' });
    }
    const to = target === 'home' ? HOME_DATA_DIR : LOCAL_DATA_DIR;
    if (to === DATA_DIR) return res.status(400).json({ error: 'Data is already stored there.' });

    // ponytail: no request draining — single-user local app, so any query still in flight after the
    // close below just errors out and the forced restart clears it. Add a drain if this ever goes multi-user.
    sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    sqlite.close();
    try {
      migrateDataDir(DATA_DIR, to);
    } catch (err) {
      // The DB handle is gone either way, so the process is unusable — restart picks up the
      // untouched original.
      setTimeout(() => process.exit(1), 200);
      throw err;
    }
    res.json({ movedTo: to });
    // DATA_DIR is resolved once at import; only a restart can pick up the new location.
    setTimeout(() => process.exit(0), 200);
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
  jobType: z.enum(SCHEDULE_JOB_TYPES),
  libraryId: z.number().int().positive().nullable().optional(),
  mode: z.enum(SCHEDULE_MODES).optional(),
  intervalMinutes: z.number().int().min(0).optional(),
  useGlobal: z.boolean().optional(),
});

settingsRouter.patch(
  '/api/job-schedules',
  wrap(async (req, res) => {
    const body = scheduleBody.parse(req.body);
    const libraryId = body.libraryId ?? null;

    // SQLite treats NULLs as distinct in unique indexes, so composite-PK upsert on (job_type, NULL)
    // can't be relied on. Read → decide → update-or-insert explicitly; `IS` matches NULL and values alike.
    const where = and(
      eq(schema.jobSchedules.jobType, body.jobType),
      sql`${schema.jobSchedules.libraryId} IS ${libraryId}`,
    );
    const existing = db.select().from(schema.jobSchedules).where(where).get();

    const merged = {
      jobType: body.jobType,
      libraryId,
      mode: body.mode ?? existing?.mode ?? 'off',
      intervalMinutes: body.intervalMinutes ?? existing?.intervalMinutes ?? 0,
      useGlobal: body.useGlobal !== undefined ? (body.useGlobal ? 1 : 0) : (existing?.useGlobal ?? 0),
    };

    if (existing) db.update(schema.jobSchedules).set(merged).where(where).run();
    else db.insert(schema.jobSchedules).values(merged).run();

    scheduleAll();
    res.json({ ok: true });
  }),
);

settingsRouter.post(
  '/api/system/reclassify-gifs',
  wrap(async (_req, res) => {
    const job = enqueueGifReclassifyJob(gifsAsVideos());
    res.json(job);
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
  '/api/system/transcode-videos',
  wrap(async (_req, res) => {
    enqueueBulkTranscodeCheck();
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
