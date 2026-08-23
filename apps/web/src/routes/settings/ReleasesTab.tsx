import { Rocket } from 'lucide-react';
import { releases } from '../../lib/releases';
import { TabHeader } from './index';

export function ReleasesTab() {
  return (
    <div>
      <TabHeader title="Releases" subtitle="What's changed in Sakuya over time." />
      <div className="flex flex-col gap-4">
        {releases.map((r, i) => (
          <div key={r.version} className="rounded-xl border border-zinc-800 bg-[#111113] p-6">
            <div className="mb-4 flex items-center gap-2">
              <span className="rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-accent">
                v{r.version}
              </span>
              {i === 0 && (
                <span className="flex items-center gap-1 rounded-full bg-zinc-800 px-2.5 py-1 text-[11px] font-bold text-zinc-300">
                  <Rocket size={11} />
                  Latest
                </span>
              )}
            </div>
            <div className="release-notes release-notes-tab" dangerouslySetInnerHTML={{ __html: r.html }} />
          </div>
        ))}
      </div>
    </div>
  );
}
