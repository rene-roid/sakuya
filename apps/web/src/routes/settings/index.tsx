import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LibrariesTab } from './LibrariesTab';
import { JobsTab } from './JobsTab';
import { TaggingTab } from './TaggingTab';
import { UploadsTab } from './UploadsTab';
import { DuplicatesTab } from './DuplicatesTab';
import { AppearanceTab, BehaviorTab, SystemTab } from './MiscTabs';

const TABS = [
  { key: 'libraries', label: 'Libraries' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'tagging', label: 'AI Tagging' },
  { key: 'duplicates', label: 'Duplicates' },
  { key: 'uploads', label: 'Uploads' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'behavior', label: 'Behaviour' },
  { key: 'system', label: 'System' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function isTabKey(value: string | null): value is TabKey {
  return TABS.some((t) => t.key === value);
}

export function Settings() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [tab, setTab] = useState<TabKey>(isTabKey(initialTab) ? initialTab : 'libraries');

  return (
    <div className="fade-in mx-auto flex h-[calc(100vh-60px)] max-w-[1200px] gap-8 overflow-hidden px-8 py-7">
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
      <div className="scrollbar-hide min-w-0 flex-1 overflow-y-auto pb-16">
        {tab === 'libraries' && <LibrariesTab />}
        {tab === 'jobs' && <JobsTab />}
        {tab === 'tagging' && <TaggingTab />}
        {tab === 'duplicates' && <DuplicatesTab />}
        {tab === 'uploads' && <UploadsTab />}
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'behavior' && <BehaviorTab />}
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
