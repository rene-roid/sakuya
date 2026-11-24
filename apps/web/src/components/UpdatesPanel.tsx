import { useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { desktopBridge, useDesktopUpdates, type DesktopUpdateState } from '../lib/desktop';
import { latestRelease } from '../lib/latestRelease';
import { compareVersions } from '../lib/releases';

const KIND_LABEL = { desktop: 'Desktop app', docker: 'Docker', source: 'From source' } as const;

const UPGRADE_STEP = {
  source: (
    <>
      Update with <code className="text-zinc-400">./update.sh</code>
    </>
  ),
  docker: (
    <>
      Update with <code className="text-zinc-400">docker compose pull &amp;&amp; docker compose up -d</code>
    </>
  ),
  desktop: 'The desktop app downloads and installs updates',
} as const;

/** Version and update check; in the desktop app, also the auto-update switch. */
export function UpdatesPanel() {
  const { data: system } = useQuery({ queryKey: ['system'], queryFn: api.system });
  const desktop = useDesktopUpdates();

  return (
    <div className="overflow-hidden rounded-panel border border-line bg-surface glass:bg-white/[0.03]">
      <Row
        title="Version"
        desc={
          <>
            Sakuya {system?.version ?? '…'}
            {system && <> · {KIND_LABEL[system.installKind] ?? system.installKind}</>}
            {system && !desktop && <div className="mt-0.5">{UPGRADE_STEP[system.installKind]}</div>}
          </>
        }
      >
        {desktop ? <DesktopCheck state={desktop} /> : <ReleaseCheck current={system?.version} />}
      </Row>
      {desktop && (
        <Row
          title="Update automatically"
          desc="Download new versions in the background and install them when Sakuya restarts. The database is backed up first."
        >
          <Switch checked={desktop.autoUpdate} onChange={(on) => desktopBridge()?.updates.setAutoUpdate(on)} />
        </Row>
      )}
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-x-4 gap-y-2 border-t border-line px-3.5 py-3 first:border-t-0 max-sm:flex-wrap">
      <div className="min-w-[180px] flex-1">
        <div className="text-[13px] font-semibold text-zinc-100">{title}</div>
        <div className="mt-px text-[12px] leading-snug text-zinc-500">{desc}</div>
      </div>
      <div className="flex flex-none flex-wrap items-center justify-end gap-x-3 gap-y-1.5 max-sm:ml-auto">
        {children}
      </div>
    </div>
  );
}

function Button({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex-none cursor-pointer rounded-btn border border-line px-3 py-[5px] text-[12px] font-semibold text-zinc-300 hover:border-line-strong hover:text-zinc-100 disabled:cursor-default disabled:opacity-40"
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
