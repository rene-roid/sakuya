import { useEffect, useState } from 'react';
import { CircleArrowUp, X } from 'lucide-react';
import { releases, compareVersions } from '../lib/releases';

const REPO = 'rene-roid/sakuya';
const DISMISSED = 'sakuya:dismissed-update';
const CACHE_V = 'sakuya:latest-release';
const CACHE_AT = 'sakuya:latest-release-at';
const DAY = 86_400_000;

/** Nags once per new GitHub release. Dismissing hides that version for good. */
export function UpdateToast() {
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    const current = releases[0]?.version ?? '0.0.0';
    const show = (v: string) => {
      if (compareVersions(v, current) > 0 && v !== localStorage.getItem(DISMISSED)) setLatest(v);
    };

    if (Date.now() - Number(localStorage.getItem(CACHE_AT)) < DAY) {
      return show(localStorage.getItem(CACHE_V) ?? '0.0.0');
    }

    fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
      .then((r) => r.json())
      .then(({ tag_name }) => {
        const v = String(tag_name ?? '').replace(/^v/, '');
        if (!/^\d+\.\d+\.\d+$/.test(v)) return;
        localStorage.setItem(CACHE_V, v);
        localStorage.setItem(CACHE_AT, String(Date.now()));
        show(v);
      })
      .catch(() => {}); // offline or rate-limited: stay quiet
  }, []);

  if (!latest) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED, latest);
    setLatest(null);
  };

  return (
    <div className="toast-in fixed bottom-6 left-6 z-[100] flex items-center gap-3 rounded-[10px] border border-zinc-600 bg-zinc-900 px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
      <CircleArrowUp size={16} className="flex-none text-accent" />
      <div className="text-[13px] text-zinc-200">
        Sakuya <span className="font-semibold">{latest}</span> is out —{' '}
        <a
          href={`https://github.com/${REPO}/releases/latest`}
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline"
        >
          what's new
        </a>
        <div className="text-[11.5px] text-zinc-500">Run ./update.sh to upgrade</div>
      </div>
      <button
        onClick={dismiss}
        className="cursor-pointer rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
      >
        <X size={16} />
      </button>
    </div>
  );
}
