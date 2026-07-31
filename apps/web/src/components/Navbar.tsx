import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useJobs } from '../hooks/useJobs';
import { TagSearchInput } from './TagSearchInput';

function navPill(active: boolean): string {
  return `cursor-pointer rounded-[7px] px-3.5 py-[7px] text-[13.5px] font-semibold ${
    active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
  }`;
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
        <div
            title="Jobs"
            onClick={() => setOpen((v) => !v)}
            className={`relative flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-lg text-base text-zinc-400 ${
                open ? 'bg-zinc-800' : 'hover:bg-zinc-900'
            }`}
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                 className="lucide lucide-activity-icon lucide-activity">
                <path
                    d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>
            </svg>
            {activeJobs.length > 0 && (
                <span className="absolute right-1 top-1 h-[7px] w-[7px] rounded-full bg-accent"/>
            )}
        </div>
        {open && (
            <div
                className="absolute right-0 top-[42px] z-50 w-[280px] rounded-[10px] border border-zinc-800 bg-[#111113] p-3 shadow-xl">
                <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.3px] text-zinc-500">Running jobs</div>
                {activeJobs.length === 0 && <div className="mb-3 text-[12.5px] text-zinc-600">None</div>}
                {activeJobs.length > 0 && (
            <div className="mb-3 flex flex-col gap-2">
              {activeJobs.map((job) => (
                <div key={job.id} className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2">
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
            className="w-full cursor-pointer rounded-lg bg-zinc-800 py-[7px] text-[12.5px] font-semibold text-zinc-100 hover:bg-zinc-700"
          >
            View all jobs
          </button>
        </div>
      )}
    </div>
  );
}

export function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchTags, setSearchTags] = useState<string[]>([]);

  const goToBoard = (tags: string[]) => {
    navigate(tags.length ? `/board?tags=${tags.map(encodeURIComponent).join(',')}` : '/board');
  };

  return (
    <div className="sticky top-0 z-40 flex h-[60px] items-center gap-6 border-b border-zinc-800 bg-zinc-950/75 px-5 backdrop-blur-xl">
      <div className="flex shrink-0 cursor-pointer items-center gap-2" onClick={() => navigate('/')}>
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-violet-800 text-sm font-extrabold text-white">
          柵
        </div>
        <div className="text-[15px] font-bold tracking-tight">
          Sakuya<span className="text-accent">.</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <NavLink to="/" className={({ isActive }) => navPill(isActive)}>
          Dashboard
        </NavLink>
        <NavLink to="/board" className={({ isActive }) => navPill(isActive)}>
          Board
        </NavLink>
      </div>
      <div className="ml-2 max-w-[420px] flex-1">
        <TagSearchInput
          tags={searchTags}
          onAddTag={(tag) => {
            const next = [...searchTags, tag];
            setSearchTags(next);
            goToBoard(next);
          }}
          onRemoveTag={(tag) => {
            const next = searchTags.filter((t) => t !== tag);
            setSearchTags(next);
            goToBoard(next);
          }}
          onFreeText={(q) => navigate(`/board?q=${encodeURIComponent(q)}`)}
          placeholder="Search tags, titles..."
        />
      </div>
      <div className="flex-1" />
      <JobsButton />
        <div
            title="Settings"
            onClick={() => navigate('/settings')}
            className={`flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-lg text-base text-zinc-400 ${
                location.pathname.startsWith('/settings') ? 'bg-zinc-800' : 'hover:bg-zinc-900'
            }`}
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                 className="lucide lucide-cog-icon lucide-cog">
                <path d="M11 10.27 7 3.34"/>
                <path d="m11 13.73-4 6.93"/>
                <path d="M12 22v-2"/>
                <path d="M12 2v2"/>
                <path d="M14 12h8"/>
                <path d="m17 20.66-1-1.73"/>
                <path d="m17 3.34-1 1.73"/>
                <path d="M2 12h2"/>
                <path d="m20.66 17-1.73-1"/>
                <path d="m20.66 7-1.73 1"/>
                <path d="m3.34 17 1.73-1"/>
                <path d="m3.34 7 1.73 1"/>
                <circle cx="12" cy="12" r="2"/>
                <circle cx="12" cy="12" r="8"/>
            </svg>
        </div>
    </div>
  );
}
