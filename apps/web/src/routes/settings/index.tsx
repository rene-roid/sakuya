import { useSearchParams } from 'react-router-dom';
import { LibrariesTab } from './LibrariesTab';
import { JobsTab } from './JobsTab';
import { TaggingTab } from './TaggingTab';
import { UploadsTab } from './UploadsTab';
import { DuplicatesTab } from './DuplicatesTab';
import { AppearanceTab, BehaviorTab, SystemTab } from './MiscTabs';
import { ReleasesTab } from './ReleasesTab';

const TABS = [
  { key: 'libraries', label: 'Libraries', Tab: LibrariesTab },
  { key: 'jobs', label: 'Jobs', Tab: JobsTab },
  { key: 'tagging', label: 'AI Tagging', Tab: TaggingTab },
  { key: 'duplicates', label: 'Duplicates', Tab: DuplicatesTab },
  { key: 'uploads', label: 'Uploads', Tab: UploadsTab },
  { key: 'appearance', label: 'Appearance', Tab: AppearanceTab },
  { key: 'behavior', label: 'Behaviour', Tab: BehaviorTab },
  { key: 'system', label: 'System', Tab: SystemTab },
  { key: 'releases', label: 'Releases', Tab: ReleasesTab },
];

export function Settings() {
  // The tab lives in ?tab= so links like /settings?tab=jobs work even while Settings is open.
  const [searchParams, setSearchParams] = useSearchParams();
  const current = TABS.find((t) => t.key === searchParams.get('tab')) ?? TABS[0];

  return (
    <div className="fade-in mx-auto flex h-[calc(100dvh-var(--nav-h)-var(--dock-h))] max-w-[1200px] flex-col gap-4 overflow-hidden px-4 py-5 sm:flex-row sm:gap-8 sm:px-8 sm:py-7">
      <div className="flex flex-none gap-1 overflow-x-auto pb-1 sm:w-[200px] sm:flex-col sm:gap-0.5 sm:overflow-visible sm:pb-0">
        {TABS.map((t) => (
          <div
            key={t.key}
            onClick={() => setSearchParams({ tab: t.key }, { replace: true })}
            className={`flex-none cursor-pointer whitespace-nowrap rounded-lg border px-3 py-[9px] text-[13.5px] font-semibold glass:rounded-full glass:px-4 glass:transition-colors ${
              current === t
                ? 'border-line bg-zinc-900 text-zinc-100 glass:border-white/10 glass:bg-white/10 glass:text-white glass:shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 glass:font-medium glass:hover:bg-white/5'
            }`}
          >
            {t.label}
          </div>
        ))}
      </div>
      <div className="scrollbar-hide min-w-0 flex-1 overflow-y-auto pb-16">
        <current.Tab />
      </div>
    </div>
  );
}

export function TabHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="m-0 mb-1 text-[19px] font-bold glass:text-[20px]">{title}</h2>
      <div className="mb-5 text-[13px] text-zinc-500">{subtitle}</div>
    </div>
  );
}
