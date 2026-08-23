import { useEffect, useState } from 'react';
import { PartyPopper, X } from 'lucide-react';
import { releases, compareVersions, type Release } from '../lib/releases';
import { Confetti } from './Confetti';

const STORAGE_KEY = 'sakuya:last-seen-release';

/** Shows unseen release notes once, on the first load after an update. Dismissing marks them seen for good. */
export function ReleaseNotesDialog() {
  const [unseen, setUnseen] = useState<Release[] | null>(null);

  useEffect(() => {
    if (releases.length === 0) return;
    const lastSeen = localStorage.getItem(STORAGE_KEY);
    const pending = lastSeen ? releases.filter((r) => compareVersions(r.version, lastSeen) > 0) : releases;
    if (pending.length > 0) setUnseen(pending);
  }, []);

  if (!unseen || unseen.length === 0) return null;

  const close = () => {
    localStorage.setItem(STORAGE_KEY, releases[0].version);
    setUnseen(null);
  };

  return (
    <>
      <Confetti />
      <div
        className="fade-in fixed inset-0 z-[95] flex items-center justify-center bg-zinc-950/80 p-6 backdrop-blur"
        onClick={close}
      >
        <div
          className="flex max-h-[85vh] w-[760px] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#111113] shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3.5 border-b border-zinc-800 bg-gradient-to-b from-accent/10 to-transparent px-7 py-6">
            <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-accent/15">
              <PartyPopper size={22} className="text-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[18px] font-extrabold">What's new in Sakuya</div>
              <div className="text-[12.5px] text-zinc-500">Here's what's changed since your last visit</div>
            </div>
            <button
              onClick={close}
              className="cursor-pointer rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            >
              <X size={18} />
            </button>
          </div>
          <div className="scrollbar-hide flex-1 overflow-y-auto px-7 py-6">
            <div className="flex flex-col">
              {unseen.map((r, i) => (
                <div
                  key={r.version}
                  className={`release-notes ${i > 0 ? 'mt-6 border-t border-zinc-800 pt-6' : ''}`}
                  dangerouslySetInnerHTML={{ __html: r.html }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end border-t border-zinc-800 px-7 py-4">
            <button
              onClick={close}
              className="cursor-pointer rounded-lg bg-accent px-5 py-2 text-[13px] font-semibold text-white hover:opacity-90"
            >
              Got it, let's go
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
