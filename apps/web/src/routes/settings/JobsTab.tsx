import { useEffect, useRef, useState } from 'react';
import { JobsConfigureTab } from './JobsConfigureTab';
import { JobsHistoryTab } from './JobsHistoryTab';
import { TabHeader } from './index';

type Section = 'configure' | 'history';

export function JobsTab() {
  const [section, setSection] = useState<Section>('configure');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current?.closest('[class*="overflow-y-auto"]');
    if (el) el.scrollTop = 0;
  }, [section]);

  return (
    <div ref={wrapRef}>
      <div className="sticky top-0 z-10 -mt-1 bg-zinc-950 pb-2 pt-1">
        <div className="flex items-start justify-between">
          <TabHeader title="Jobs" subtitle="Configure scan, tagging, and duplicate-detection schedules." />
          <div className="flex overflow-hidden rounded-[7px] border border-zinc-800">
            {(['configure', 'history'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={`cursor-pointer px-3 py-1.5 text-[12px] font-semibold capitalize ${
                  section === s ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2">
        {section === 'configure' ? <JobsConfigureTab /> : <JobsHistoryTab />}
      </div>
    </div>
  );
}
