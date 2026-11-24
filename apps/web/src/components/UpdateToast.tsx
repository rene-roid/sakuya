import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleArrowUp, CircleCheck, Download, LoaderCircle, X } from 'lucide-react';
import type { InstallKind } from '@sakuya/shared';
import { api } from '../lib/api';
import { desktopBridge, useDesktopUpdates, type DesktopUpdateState } from '../lib/desktop';
import { latestRelease, RELEASES_URL } from '../lib/latestRelease';
import { releases, compareVersions } from '../lib/releases';

const DISMISSED = 'sakuya:dismissed-update';
const DISMISSED_READY = 'sakuya:dismissed-ready';

const UPGRADE_HINT: Record<InstallKind, ReactNode> = {
  source: 'Run ./update.sh to upgrade',
  docker: (
    <>
      Run <code className="text-zinc-300">docker compose pull &amp;&amp; docker compose up -d</code>
    </>
  ),
  // A browser tab opened from the desktop app has no bridge; the app itself does the updating.
  desktop: 'The Sakuya desktop app downloads and installs it',
};

/**
 * In the desktop app: download progress, a Restart to update button once the update is ready, and
 * "updated to X" on the first start after it installed. Everywhere else: one nag per new GitHub
 * release with the upgrade step for how this copy was installed. Dismissing hides that version.
 */
export function UpdateToast() {
  const desktop = useDesktopUpdates();
  const { data: system } = useQuery({ queryKey: ['system'], queryFn: api.system });
  if (desktop) return <DesktopUpdateToast state={desktop} />;
  if (!system || desktopBridge()) return null;
  return <ReleaseToast installKind={system.installKind ?? 'source'} />;
}

function ReleaseToast({ installKind }: { installKind: InstallKind }) {
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    const current = releases[0]?.version ?? '0.0.0';
    latestRelease().then((v) => {
      if (v && compareVersions(v, current) > 0 && v !== localStorage.getItem(DISMISSED)) setLatest(v);
    });
  }, []);

  if (!latest) return null;
  const dismiss = () => {
    localStorage.setItem(DISMISSED, latest);
    setLatest(null);
  };

  return (
    <ToastFrame icon={<CircleArrowUp size={16} className="flex-none text-accent" />} onClose={dismiss}>
      Sakuya <span className="font-semibold">{latest}</span> is out — <WhatsNew />
      <div className="text-[11.5px] text-zinc-500">{UPGRADE_HINT[installKind]}</div>
    </ToastFrame>
  );
}

function DesktopUpdateToast({ state }: { state: DesktopUpdateState }) {
  const updates = desktopBridge()?.updates;
  const [hidden, setHidden] = useState<string | null>(() => sessionStorage.getItem(DISMISSED_READY));
  const hide = (key: string) => {
    sessionStorage.setItem(DISMISSED_READY, key);
    setHidden(key);
  };
  const version = <span className="font-semibold">{state.version}</span>;

  if (state.justUpdated) {
    return (
      <ToastFrame
        icon={<CircleCheck size={16} className="flex-none text-accent" />}
        onClose={() => updates?.dismissUpdated()}
      >
        Sakuya was updated to <span className="font-semibold">{state.justUpdated}</span> — <WhatsNew />
      </ToastFrame>
    );
  }

  const key = `${state.status}:${state.version}`;
  if (hidden === key) return null;

  if (state.status === 'downloading') {
    return (
      <ToastFrame icon={<Download size={16} className="flex-none text-accent" />} onClose={() => hide(key)}>
        Downloading Sakuya {version}…
        <Progress percent={state.percent} />
      </ToastFrame>
    );
  }
  if (state.status === 'installing') {
    return (
      <ToastFrame icon={<LoaderCircle size={16} className="flex-none animate-spin text-accent" />}>
        Installing Sakuya {version}…
        <div className="text-[11.5px] text-zinc-500">Backing up your library first. Sakuya restarts by itself.</div>
      </ToastFrame>
    );
  }
  if (state.status === 'ready') {
    return (
      <ToastFrame icon={<CircleArrowUp size={16} className="flex-none text-accent" />} onClose={() => hide(key)}>
        Sakuya {version} is ready
        <div className="text-[11.5px] text-zinc-500">
          {state.autoUpdate ? 'Restart now, or it installs when you quit Sakuya.' : 'Restart to install it.'}
        </div>
        <button
          onClick={() => updates?.install()}
          className="mt-2 cursor-pointer rounded-btn bg-accent px-3 py-1 text-[12px] font-semibold text-white hover:brightness-110"
        >
          Restart to update
        </button>
      </ToastFrame>
    );
  }
  return null;
}

function Progress({ percent }: { percent: number }) {
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="h-1 w-40 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-[11.5px] tabular-nums text-zinc-500">{percent}%</span>
    </div>
  );
}

function WhatsNew() {
  return (
    <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="text-accent hover:underline">
      what's new
    </a>
  );
}

function ToastFrame({ icon, onClose, children }: { icon: ReactNode; onClose?: () => void; children: ReactNode }) {
  return (
    <div className="toast-in fixed bottom-[calc(var(--dock-h)+24px)] left-6 z-[100] flex max-w-[calc(100vw-48px)] items-start gap-3 rounded-panel border border-line-hover bg-zinc-900 px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
      <span className="mt-0.5">{icon}</span>
      <div className="text-[13px] text-zinc-200">{children}</div>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Dismiss"
          className="cursor-pointer rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
