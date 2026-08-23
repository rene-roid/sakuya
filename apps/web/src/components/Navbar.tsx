import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, Settings } from 'lucide-react';
import { useJobs } from '../hooks/useJobs';
import { useScanAllLibraries } from '../hooks/useScanAllLibraries';
import { TagSearchInput } from './TagSearchInput';
import { api } from '../lib/api';

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
        <button
            title="Jobs"
            onClick={() => setOpen((v) => !v)}
            className={`relative flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-400 ${
                open ? 'bg-zinc-800' : 'hover:bg-zinc-900'
            }`}
        >
            <Activity size={16} />
            {activeJobs.length > 0 && (
                <span className="absolute right-1 top-1 h-[7px] w-[7px] rounded-full bg-accent"/>
            )}
        </button>
        {open && (
            <div
                className="absolute right-0 top-[42px] z-50 w-[280px] rounded-[10px] border border-zinc-800 bg-[#111113] p-3 shadow-xl">
                <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.3px] text-zinc-500">Running jobs</div>
                {activeJobs.length === 0 && (
                  <div className="mb-3 flex flex-col gap-2">
                    <div className="text-[12.5px] text-zinc-600">No running jobs</div>
                    <button
                      disabled={!libraries?.length || scanAllMutation.isPending}
                      onClick={() => scanAllMutation.mutate()}
                      className="w-full cursor-pointer rounded-lg border border-zinc-800 py-[7px] text-[12.5px] font-semibold text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
                    >
                      Scan all now
                    </button>
                  </div>
                )}
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
        <div className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-extrabold text-white">
          <img src="/icon.png" alt="Sakuya" className="h-full w-full" />
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
        <NavLink to="/downloader" className={({ isActive }) => navPill(isActive)}>
          Downloader
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
          placeholder="Search tags, filenames, folders..."
        />
      </div>
      <div className="flex-1" />
      <JobsButton />
        <button
            title="Settings"
            onClick={() => navigate('/settings')}
            className={`flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-400 ${
                location.pathname.startsWith('/settings') ? 'bg-zinc-800' : 'hover:bg-zinc-900'
            }`}
        >
            <Settings size={16} />
        </button>
    </div>
  );
}
