import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Download, Home, Images, LayoutGrid, Lock, Settings, Sparkles } from 'lucide-react';
import { useJobs } from '../hooks/useJobs';
import { useAuth } from '../hooks/useAuth';
import { useScanAllLibraries } from '../hooks/useScanAllLibraries';
import { TagSearchInput } from './TagSearchInput';
import { api } from '../lib/api';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: Home, tint: 'from-sky-400 to-blue-600' },
  { to: '/explore', label: 'Explore', icon: LayoutGrid, tint: 'from-violet-400 to-indigo-600' },
  { to: '/discover', label: 'Discover', icon: Sparkles, tint: 'from-amber-300 to-orange-500' },
  { to: '/boards', label: 'Boards', icon: Images, tint: 'from-pink-400 to-rose-600' },
  { to: '/downloader', label: 'Downloader', icon: Download, tint: 'from-emerald-300 to-teal-600' },
];

// Labels only show from xl up; below that the links collapse to icons so nothing gets pushed off
// the bar. Under md the links move to the bottom dock instead.
function navPill(active: boolean): string {
  const base =
    'flex cursor-pointer items-center gap-2 rounded-field px-2.5 py-2 text-[13.5px] font-semibold xl:px-3.5 xl:py-[7px] ' +
    'glass:h-10 glass:rounded-2xl glass:border glass:py-0 glass:pl-[7px] glass:pr-[7px] glass:font-display glass:text-[14px] glass:transition-colors xl:glass:pl-2 xl:glass:pr-3.5';
  return `${base} ${
    active
      ? 'bg-zinc-800 text-zinc-100 glass:border-accent/55 glass:bg-accent/20 glass:text-white glass:shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
      : 'text-zinc-400 hover:text-zinc-200 glass:border-white/[0.045] glass:bg-white/[0.02] glass:font-medium glass:hover:bg-white/5 glass:hover:text-white'
  }`;
}

function iconButton(active: boolean): string {
  return `relative flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-400 glass:h-[38px] glass:w-[38px] glass:rounded-full glass:border glass:text-zinc-300 glass:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] glass:transition-colors ${
    active
      ? 'bg-zinc-800 glass:border-white/15 glass:bg-white/12 glass:text-white'
      : 'hover:bg-zinc-900 glass:border-white/8 glass:bg-white/[0.03] glass:hover:bg-white/8 glass:hover:text-white'
  }`;
}

/** Colored rounded tile behind a nav icon; only visible in the Liquid Glass style. */
function IconTile({ tint, children, className = '' }: { tint: string; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`hidden place-items-center rounded-[9px] bg-gradient-to-br text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] glass:grid ${tint} ${className}`}
    >
      {children}
    </span>
  );
}

const STATUS_COLOR: Record<string, string> = {
  running: 'text-amber-500',
  queued: 'text-zinc-500',
};

function JobsButton() {
  const navigate = useNavigate();
  const jobs = useJobs();
  const activeJobs = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { data: libraries } = useQuery({ queryKey: ['libraries'], queryFn: api.libraries, enabled: open });

  const scanAllMutation = useScanAllLibraries(libraries);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button title="Jobs" onClick={() => setOpen((v) => !v)} className={iconButton(open)}>
        <Activity size={16} />
        {activeJobs.length > 0 && (
          <span className="absolute right-1 top-1 h-[7px] w-[7px] rounded-full bg-accent glass:right-0.5 glass:top-0.5 glass:h-2 glass:w-2 glass:ring-2 glass:ring-zinc-950" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-[42px] z-50 w-[280px] max-w-[calc(100vw-32px)] rounded-panel border border-line bg-surface p-3 shadow-xl glass:top-[46px] glass:w-[300px] glass:bg-surface/95 glass:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_34px_110px_rgba(0,0,0,0.42)] glass:backdrop-blur-xl">
          <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.3px] text-zinc-500">Running jobs</div>
          {activeJobs.length === 0 && (
            <div className="mb-3 flex flex-col gap-2">
              <div className="text-[12.5px] text-zinc-600">No running jobs</div>
              <button
                disabled={!libraries?.length || scanAllMutation.isPending}
                onClick={() => scanAllMutation.mutate()}
                className="w-full cursor-pointer rounded-lg border border-line py-[7px] text-[12.5px] font-semibold text-zinc-400 hover:text-zinc-200 disabled:opacity-40 glass:rounded-full"
              >
                Scan all now
              </button>
            </div>
          )}
          {activeJobs.length > 0 && (
            <div className="mb-3 flex flex-col gap-2">
              {activeJobs.map((job) => (
                <div
                  key={job.id}
                  className="rounded-lg border border-line bg-zinc-900 px-2.5 py-2 glass:rounded-xl glass:bg-white/[0.03] glass:px-3"
                >
                  <div className="mb-0.5 flex items-center justify-between gap-2">
                    <div className="truncate text-[12.5px] font-semibold">{job.label}</div>
                    <span className={`shrink-0 text-[10px] font-bold uppercase tracking-[0.3px] ${STATUS_COLOR[job.status]}`}>
                      {job.status}
                    </span>
                  </div>
                  {job.log && <div className="truncate font-mono text-[11px] text-zinc-500">{job.log}</div>}
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => {
              setOpen(false);
              navigate('/settings?tab=jobs');
            }}
            className="w-full cursor-pointer rounded-lg bg-zinc-800 py-[7px] text-[12.5px] font-semibold text-zinc-100 hover:bg-zinc-700 glass:rounded-full glass:bg-white/15 glass:py-2 glass:hover:bg-white/20"
          >
            View all jobs
          </button>
        </div>
      )}
    </div>
  );
}

function LockButton() {
  const queryClient = useQueryClient();
  const { enabled } = useAuth();
  if (!enabled) return null;
  return (
    <button
      title="Lock"
      onClick={async () => {
        await api.logout();
        queryClient.setQueryData(['auth-status'], { enabled: true, unlocked: false });
      }}
      className={iconButton(false)}
    >
      <Lock size={16} />
    </button>
  );
}

/** Bottom tab bar that carries the navigation on phones, where the top bar has no room for it. */
function MobileDock({ items }: { items: typeof NAV_ITEMS }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 grid h-(--dock-h) border-t border-line bg-zinc-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden glass:inset-x-3 glass:bottom-[calc(10px+env(safe-area-inset-bottom))] glass:h-[58px] glass:rounded-[22px] glass:border glass:border-white/10 glass:bg-[#18181b]/70 glass:pb-0 glass:shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_20px_50px_rgba(0,0,0,0.5)] glass:backdrop-blur-2xl"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map(({ to, label, icon: Icon, tint }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold glass:gap-0.5 ${
              isActive ? 'text-zinc-100 [&_.dock-icon]:text-accent glass:[&_.dock-tile]:ring-2 glass:[&_.dock-tile]:ring-white/40' : 'text-zinc-500'
            }`
          }
        >
          <Icon size={19} className="dock-icon glass:hidden" />
          <IconTile tint={tint} className="dock-tile h-7 w-7">
            <Icon size={15} strokeWidth={2.4} />
          </IconTile>
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const barRef = useRef<HTMLDivElement>(null);
  const [searchTags, setSearchTags] = useState<string[]>([]);
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  const discoverEnabled = settings?.discover_enabled === '1';
  const items = NAV_ITEMS.filter((item) => item.to !== '/discover' || discoverEnabled);

  // The bar wraps onto a second row on narrow screens, so sticky toolbars and full-height panes
  // read its real height from --nav-h instead of assuming 60px.
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--nav-h', `${el.offsetHeight}px`);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const goToExplore = (tags: string[]) => {
    navigate(tags.length ? `/explore?tags=${tags.map(encodeURIComponent).join(',')}` : '/explore');
  };

  return (
    <>
      <div
        ref={barRef}
        className="sticky top-0 z-40 flex flex-wrap items-center gap-x-2 gap-y-2.5 border-b border-line bg-zinc-950/75 px-4 py-2.5 backdrop-blur-xl md:h-[60px] md:flex-nowrap md:gap-x-4 md:px-5 md:py-0 glass:border-white/[0.06] glass:bg-[#0b0b0e]/70 glass:backdrop-blur-2xl lg:glass:gap-x-5 lg:glass:px-6"
      >
        <div className="flex shrink-0 cursor-pointer items-center gap-2 glass:gap-2.5" onClick={() => navigate('/')}>
          <img src="/icon.png" alt="Sakuya" className="h-7 w-7" />
          <div className="text-[15px] font-bold tracking-tight md:hidden lg:block glass:font-display glass:text-[16px] glass:font-semibold">
            Sakuya<span className="text-accent glass:hidden">.</span>
          </div>
        </div>
        <nav className="hidden items-center gap-1 md:flex glass:gap-1.5">
          {items.map(({ to, label, icon: Icon, tint }) => (
            <NavLink key={to} to={to} className={({ isActive }) => navPill(isActive)} title={label}>
              <Icon size={15} className="xl:hidden glass:hidden" />
              <IconTile tint={tint} className="h-[26px] w-[26px]">
                <Icon size={14} strokeWidth={2.4} />
              </IconTile>
              <span className="hidden xl:inline">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="order-last w-full md:order-none md:ml-2 md:w-auto md:min-w-0 md:max-w-[420px] md:flex-1 glass:md:ml-auto glass:md:max-w-[360px]">
          <TagSearchInput
            tags={searchTags}
            onAddTag={(tag) => {
              const next = [...searchTags, tag];
              setSearchTags(next);
              goToExplore(next);
            }}
            onRemoveTag={(tag) => {
              const next = searchTags.filter((t) => t !== tag);
              setSearchTags(next);
              goToExplore(next);
            }}
            onFreeText={(q) => navigate(`/explore?q=${encodeURIComponent(q)}`)}
            placeholder="Search tags, filenames, folders..."
          />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 glass:gap-2.5 glass:md:ml-0">
          <JobsButton />
          <LockButton />
          <button
            title="Settings"
            onClick={() => navigate('/settings')}
            className={iconButton(location.pathname.startsWith('/settings'))}
          >
            <Settings size={16} />
          </button>
        </div>
      </div>
      <MobileDock items={items} />
    </>
  );
}
