import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { desktopBridge, useDesktopUpdates, type DesktopUpdateState } from '../lib/desktop';
import { formatBytes, timeAgo } from '../lib/format';
import { latestRelease } from '../lib/latestRelease';
import { compareVersions } from '../lib/releases';
import { useJobs } from '../hooks/useJobs';

const KIND_LABEL = { desktop: 'Desktop app', docker: 'Docker', source: 'From source' } as const;

/** Version, update check, the desktop auto-update switch, and the newest database backup. */
export function UpdatesPanel() {
  const { data: system } = useQuery({ queryKey: ['system'], queryFn: api.system });
  const desktop = useDesktopUpdates();

  return (
    <div className="rounded-xl border border-line bg-surface">
      <Row
        title="Version"
        desc={
          <>
            Sakuya {system?.version ?? '…'}
            {system && <> · {KIND_LABEL[system.installKind] ?? system.installKind}</>}
          </>
        }
      >
        {desktop ? <DesktopCheck state={desktop} /> : <ReleaseCheck current={system?.version} />}
      </Row>
      {desktop && (
        <Row
          title="Update automatically"
          desc="Download new versions in the background and install them when Sakuya restarts."
        >
          <Switch checked={desktop.autoUpdate} onChange={(on) => desktopBridge()?.updates.setAutoUpdate(on)} />
        </Row>
      )}
      <BackupRow />
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-[18px] py-3.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[13.5px] font-bold">{title}</div>
        <div className="mt-0.5 text-[12px] text-zinc-500">{desc}</div>
      </div>
      <div className="flex flex-none items-center gap-3">{children}</div>
    </div>
  );
}

function Button({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer rounded-btn border border-line px-3.5 py-1.5 text-[12.5px] font-semibold text-zinc-300 hover:text-zinc-100 disabled:cursor-default disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Status({ children }: { children: ReactNode }) {
  return <span className="text-[12px] text-zinc-500">{children}</span>;
}

function DesktopCheck({ state }: { state: DesktopUpdateState }) {
  const updates = desktopBridge()?.updates;
  if (state.status === 'ready') {
    return (
      <>
        <Status>{state.version} is ready</Status>
        <Button onClick={() => updates?.install()}>Restart to update</Button>
      </>
    );
  }
  const busy = state.status === 'checking' || state.status === 'downloading' || state.status === 'installing';
  const status =
    state.status === 'checking'
      ? 'Checking…'
      : state.status === 'downloading'
        ? `Downloading ${state.version} · ${state.percent}%`
        : state.status === 'installing'
          ? 'Installing…'
          : state.status === 'error'
            ? `Check failed: ${state.error}`
            : state.checkedAt
              ? 'Up to date'
              : null;
  return (
    <>
      {status && <Status>{status}</Status>}
      <Button onClick={() => updates?.check()} disabled={busy}>
        Check now
      </Button>
    </>
  );
}

function ReleaseCheck({ current }: { current: string | undefined }) {
  const [result, setResult] = useState<string | null>(null);
  const check = useMutation({
    mutationFn: () => latestRelease({ force: true }),
    onSuccess: (latest) =>
      setResult(
        !latest || !current
          ? 'Could not reach GitHub'
          : compareVersions(latest, current) > 0
            ? `${latest} is available`
            : 'Up to date',
      ),
  });
  return (
    <>
      {result && <Status>{result}</Status>}
      <Button onClick={() => check.mutate()} disabled={check.isPending}>
        {check.isPending ? 'Checking…' : 'Check now'}
      </Button>
    </>
  );
}

function BackupRow() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['backups'], queryFn: api.backups });
  const jobs = useJobs();
  const [jobId, setJobId] = useState<number | null>(null);
  const job = jobs.find((j) => j.id === jobId);
  const running = jobId !== null && (!job || job.status === 'queued' || job.status === 'running');

  useEffect(() => {
    if (job && (job.status === 'done' || job.status === 'error')) {
      queryClient.invalidateQueries({ queryKey: ['backups'] });
    }
  }, [job, queryClient]);

  const run = useMutation({ mutationFn: api.runBackup, onSuccess: (started) => setJobId(started.id) });
  const newest = data?.backups[0];
  const failed = job?.status === 'error' ? job.log : null;

  return (
    <Row
      title="Database backup"
      desc={
        failed ? (
          <span className="text-red-400">{failed}</span>
        ) : newest ? (
          <>
            Last backup {timeAgo(newest.createdAt)} · {formatBytes(newest.sizeBytes)} · keeps the newest {data.keep}
          </>
        ) : data ? (
          'No backup yet. One is made every day.'
        ) : (
          '…'
        )
      }
    >
      <Button onClick={() => run.mutate()} disabled={running || run.isPending}>
        {running ? 'Backing up…' : 'Back up now'}
      </Button>
    </Row>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 flex-none cursor-pointer rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-zinc-700'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0 h-5 w-5 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
