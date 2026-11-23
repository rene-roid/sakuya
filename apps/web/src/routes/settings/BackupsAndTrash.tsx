import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatBytes, timeAgo } from '../../lib/format';
import { toast, toastError } from '../../components/Toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useJobs } from '../../hooks/useJobs';
import { INTERVAL_OPTIONS } from './JobSchedules';
import { buttonClass } from './controls';
import { settingHref } from './registry';

function useBackups() {
  return useQuery({ queryKey: ['backups'], queryFn: api.backups }).data;
}

/** The backup job this page started, until it finishes. Shared so the meta line and the button agree. */
function useBackupJob() {
  const { data: jobId = null } = useQuery<number | null>({
    queryKey: ['backup-job'],
    queryFn: () => null,
    staleTime: Infinity,
  });
  const job = useJobs().find((j) => j.id === jobId);
  return { jobId, job, running: jobId !== null && (!job || job.status === 'queued' || job.status === 'running') };
}

export function BackupNowMeta() {
  const backups = useBackups();
  const { job } = useBackupJob();
  if (job?.status === 'error') return <span className="text-rose-400">{job.log}</span>;
  if (!backups) return null;
  const newest = backups.backups[0];
  return newest ? (
    <>
      Last backup {timeAgo(newest.createdAt)} · {formatBytes(newest.sizeBytes)}
    </>
  ) : (
    <>No backup yet</>
  );
}

export function BackupNowControl() {
  const queryClient = useQueryClient();
  const { job, running } = useBackupJob();
  const run = useMutation({
    mutationFn: api.runBackup,
    onSuccess: (started) => queryClient.setQueryData(['backup-job'], started.id),
    onError: toastError,
  });

  useEffect(() => {
    if (job?.status === 'done') toast('Backup written');
    if (job?.status === 'done' || job?.status === 'error') queryClient.invalidateQueries({ queryKey: ['backups'] });
  }, [job?.status, queryClient]);

  return (
    <button type="button" disabled={running || run.isPending} onClick={() => run.mutate()} className={buttonClass()}>
      {running ? 'Backing up…' : 'Back up now'}
    </button>
  );
}

export function BackupScheduleMeta() {
  const { data } = useQuery({ queryKey: ['job-schedules'], queryFn: api.jobSchedules });
  const schedule = data?.globals.backup;
  if (!schedule) return null;
  if (schedule.mode !== 'interval') return <>Off</>;
  const option = INTERVAL_OPTIONS.find((o) => o.minutes === schedule.intervalMinutes);
  return <>Every {option?.label ?? `${schedule.intervalMinutes} min`}</>;
}

export function BackupScheduleLink() {
  return (
    <Link to={settingHref('schedule-backup')} className={buttonClass()}>
      Change in Jobs
    </Link>
  );
}

export function BackupList() {
  const backups = useBackups();
  return (
    <div className="overflow-hidden rounded-panel border border-line bg-surface glass:bg-white/[0.03]">
      {!backups ? (
        <div className="px-3.5 py-3 text-[12px] text-zinc-500">Loading…</div>
      ) : backups.backups.length === 0 ? (
        <div className="px-3.5 py-3 text-[12px] text-zinc-500">
          No backups yet. The first one is written within a day.
        </div>
      ) : (
        backups.backups.map((b) => (
          <div
            key={b.name}
            className="flex items-center gap-3 border-t border-line px-3.5 py-2 text-[12px] first:border-t-0"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-zinc-300" title={b.name}>
              {b.name}
            </span>
            <span className="flex-none text-zinc-500 max-sm:hidden" title={new Date(b.createdAt).toLocaleString()}>
              {new Date(b.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
            <span className="flex-none text-zinc-500 sm:hidden">{timeAgo(b.createdAt)}</span>
            <span className="w-16 flex-none text-right font-semibold text-zinc-400">{formatBytes(b.sizeBytes)}</span>
          </div>
        ))
      )}
      {backups && (
        <div className="border-t border-line px-3.5 py-2 text-[11px] text-zinc-500">
          In <span className="break-all">{backups.dir}</span>. To restore one, stop Sakuya and copy it over{' '}
          <code>tbge.db</code> in the data folder.
        </div>
      )}
    </div>
  );
}

function useTrash() {
  return useQuery({ queryKey: ['trash'], queryFn: api.trash }).data;
}

export function TrashMeta() {
  const trash = useTrash();
  if (!trash) return null;
  return trash.count ? (
    <>
      {trash.count.toLocaleString()} item{trash.count === 1 ? '' : 's'} · {formatBytes(trash.totalBytes)}
    </>
  ) : (
    <>Empty</>
  );
}

export function TrashControl() {
  const queryClient = useQueryClient();
  const trash = useTrash();
  const [confirming, setConfirming] = useState(false);
  const empty = useMutation({
    mutationFn: api.emptyTrash,
    onSuccess: (res) => {
      toast(
        `Deleted ${res.removed} file${res.removed === 1 ? '' : 's'} for good · freed ${formatBytes(res.freedBytes)}`,
      );
      queryClient.invalidateQueries({ queryKey: ['trash'] });
    },
    onError: toastError,
  });
  return (
    <>
      <Link to="/trash" className={buttonClass()}>
        Open
      </Link>
      <button
        type="button"
        disabled={!trash?.count || empty.isPending}
        onClick={() => setConfirming(true)}
        className={buttonClass('danger')}
      >
        Empty trash
      </button>
      {confirming && trash && (
        <ConfirmDialog
          danger
          title="Empty the trash?"
          confirmLabel="Empty trash"
          body={`${trash.count} file${trash.count === 1 ? '' : 's'} (${formatBytes(trash.totalBytes)}) are deleted from disk. This cannot be undone.`}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            empty.mutate();
          }}
        />
      )}
    </>
  );
}
