import { useState } from 'react';
import { JobsConfigureTab } from './JobsConfigureTab';
import { JobsHistoryTab } from './JobsHistoryTab';
import { TabHeader } from './index';

type Section = 'configure' | 'history';

export function JobsTab() {
  const [section, setSection] = useState<Section>('configure');

  return (
    <div>
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
      {section === 'configure' ? <JobsConfigureTab /> : <JobsHistoryTab />}
    </div>
  );
}
