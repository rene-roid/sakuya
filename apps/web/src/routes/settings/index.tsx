import { useState } from 'react';
import { LibrariesTab } from './LibrariesTab';
import { JobsTab } from './JobsTab';
import { TaggingTab } from './TaggingTab';
import { UploadsTab } from './UploadsTab';
import { AppearanceTab, SystemTab } from './MiscTabs';

const TABS = [
  { key: 'libraries', label: 'Libraries' },
  { key: 'jobs', label: 'Import / Jobs' },
  { key: 'tagging', label: 'AI Tagging' },
  { key: 'uploads', label: 'Uploads' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'system', label: 'System' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function Settings() {
  const [tab, setTab] = useState<TabKey>('libraries');

  return (
    <div className="fade-in mx-auto flex max-w-[1200px] gap-8 px-8 pb-16 pt-7">
      <div className="flex w-[200px] flex-none flex-col gap-0.5">
        {TABS.map((t) => (
          <div
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`cursor-pointer rounded-lg border px-3 py-[9px] text-[13.5px] font-semibold ${
              tab === t.key
                ? 'border-zinc-800 bg-zinc-900 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t.label}
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        {tab === 'libraries' && <LibrariesTab />}
        {tab === 'jobs' && <JobsTab />}
        {tab === 'tagging' && <TaggingTab />}
        {tab === 'uploads' && <UploadsTab />}
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'system' && <SystemTab />}
      </div>
    </div>
  );
}

export function TabHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <h2 className="m-0 mb-1 text-[19px] font-bold">{title}</h2>
      <div className="mb-5 text-[13px] text-zinc-500">{subtitle}</div>
    </>
  );
}
