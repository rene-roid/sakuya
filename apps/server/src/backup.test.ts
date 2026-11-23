import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { desc } from 'drizzle-orm';
import type { BackupsPayload, Job, JobSchedulesPayload } from '@sakuya/shared';
import { useTestConfig, waitForJob } from './testConfig';

const PORT = 38947; // P01
const dataDir = useTestConfig('backup', { port: PORT });
const BASE = `http://localhost:${PORT}`;
const backupsDir = path.join(dataDir, 'backups');

const { db, schema } = await import('./db');
await import('./index');
const { checkBackupSchedule } = await import('./services/jobScheduler');

const lib = db.insert(schema.libraries).values({ name: 'backup', createdAt: Date.now() }).returning().get();
db.insert(schema.media)
  .values(
    Array.from({ length: 25 }, (_, i) => ({
      libraryId: lib.id,
      source: 'upload' as const,
      path: `/nowhere/backup-${i}.png`,
      filename: `backup-${i}.png`,
      type: 'image' as const,
      createdAt: Date.now(),
    })),
  )
  .run();

const json = (method: string, body?: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function backupNow() {
  const res = await fetch(`${BASE}/api/backups`, { method: 'POST' });
  expect(res.status).toBe(202);
  const job = (await res.json()) as Job;
  expect(job.type).toBe('backup');
  return waitForJob(job.id);
}

const list = async () => (await (await fetch(`${BASE}/api/backups`)).json()) as BackupsPayload;
const filesOnDisk = () => fs.readdirSync(backupsDir).sort();

afterAll(() => fs.chmodSync(backupsDir, 0o755));

describe('database backups', () => {
  test('a backup opens as a database with the same media count', async () => {
    const job = await backupNow();
    expect(job.status).toBe('done');
    const file = /^Completed\. Backup written to (.+)\.$/.exec(job.log ?? '')?.[1];
    expect(path.dirname(file!)).toBe(backupsDir);
    expect(path.basename(file!)).toMatch(/^sakuya-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z\.db$/);

    const copy = new Database(file!, { readonly: true });
    expect(copy.query('SELECT COUNT(*) AS c FROM media').get()).toEqual({ c: 25 });
    copy.close();

    const { backups, keep, dir } = await list();
    expect(keep).toBe(7);
    expect(dir).toBe(backupsDir);
    expect(backups).toHaveLength(1);
    expect(backups[0].name).toBe(path.basename(file!));
    expect(backups[0].sizeBytes).toBe(fs.statSync(file!).size);
    expect(Math.abs(backups[0].createdAt - Date.now())).toBeLessThan(60_000);
  });

  test('pruning keeps the newest N', async () => {
    const res = await fetch(`${BASE}/api/settings`, json('PATCH', { backup_keep: '3' }));
    expect(res.status).toBe(200);
    const before = filesOnDisk();
    for (let i = 0; i < 4; i++) expect((await backupNow()).status).toBe('done');

    const after = filesOnDisk();
    expect(after).toHaveLength(3);
    expect(after).not.toContain(before[0]);
    const { backups } = await list();
    // Newest first, and the files on disk are exactly the three listed.
    expect(backups.map((b) => b.name)).toEqual([...after].reverse());

    await fetch(`${BASE}/api/settings`, json('PATCH', { backup_keep: '7' }));
  });

  test('eight backups with backup_keep 7 leave seven files', async () => {
    const oldest = filesOnDisk()[0];
    for (let i = 0; i < 8; i++) expect((await backupNow()).status).toBe('done');
    const after = filesOnDisk();
    expect(after).toHaveLength(7);
    expect(after).not.toContain(oldest);
  });

  test('a backup into a read-only folder fails with the path and leaves no partial file', async () => {
    const before = filesOnDisk();
    fs.chmodSync(backupsDir, 0o555);
    try {
      const job = await backupNow();
      expect(job.status).toBe('error');
      expect(job.log).toContain(`Backup to ${backupsDir}${path.sep}sakuya-`);
    } finally {
      fs.chmodSync(backupsDir, 0o755);
    }
    expect(filesOnDisk()).toEqual(before);
    expect(await (await fetch(`${BASE}/api/health`)).json()).toEqual({ ok: true });
  });

  test('the backup schedule is daily until someone changes it', async () => {
    const { globals } = (await (await fetch(`${BASE}/api/job-schedules`)).json()) as JobSchedulesPayload;
    expect(globals.backup).toEqual({ mode: 'interval', intervalMinutes: 1440 });
  });

  test('a scheduled backup runs once per interval measured from the newest file', async () => {
    const newest = (await list()).backups[0].createdAt;
    const HOUR = 3_600_000;
    // As if the server had restarted an hour after the last backup: not due yet.
    expect(checkBackupSchedule(newest + HOUR)).toBe(false);
    expect(checkBackupSchedule(newest + 24 * HOUR)).toBe(true);
    // The attempt counts, so the next check inside the same interval does not start another.
    expect(checkBackupSchedule(newest + 25 * HOUR)).toBe(false);

    const res = await fetch(
      `${BASE}/api/job-schedules`,
      json('PATCH', { jobType: 'backup', libraryId: null, mode: 'off', intervalMinutes: 0 }),
    );
    expect(res.status).toBe(200);
    expect(checkBackupSchedule(newest + 100 * HOUR)).toBe(false);
  });

  test('run-now starts a backup job by name', async () => {
    const res = await fetch(`${BASE}/api/jobs/run-now`, json('POST', { scope: 'global', jobType: 'backup' }));
    expect(res.status).toBe(200);
    const job = db
      .select()
      .from(schema.jobs)
      .orderBy(desc(schema.jobs.id))
      .all()
      .find((j) => j.type === 'backup')!;
    expect((await waitForJob(job.id)).status).toBe('done');
  });
});
