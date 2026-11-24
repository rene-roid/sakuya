import { useState } from 'react';
import type { Job } from '@sakuya/shared';
import { useJobs } from '../../hooks/useJobs';

const STATUS_COLOR: Record<string, string> = {
  running: 'text-amber-500',
  done: 'text-green-500',
  queued: 'text-zinc-500',
  error: 'text-red-500',
};

const COLLAPSED_COUNT = 8;

export function ProgressBar({ job, className }: { job: Job; className: string }) {
  const pct = job.total > 0 ? Math.round((job.progress / job.total) * 100) : job.status === 'done' ? 100 : 0;
  return (
    <div className={`h-[5px] overflow-hidden rounded-full bg-zinc-800 ${className}`}>
      <div
        className={`h-full transition-[width] duration-300 ${job.status === 'error' ? 'bg-red-500' : 'bg-accent'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function JobHistory() {
  const jobs = useJobs();
  const [showAll, setShowAll] = useState(false);

  if (jobs.length === 0) {
    return <div className="px-0.5 text-[12.5px] text-zinc-600">No jobs yet. Scan a library to get started.</div>;
  }
  const shown = showAll ? jobs : jobs.slice(0, COLLAPSED_COUNT);
  return (
    <div className="overflow-hidden rounded-panel border border-line bg-surface glass:bg-white/[0.03]">
      {shown.map((job) => (
        <div key={job.id} className="border-t border-line px-3.5 py-2.5 first:border-t-0">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <div className="truncate text-[13px] font-semibold">{job.label}</div>
            <span className={`flex-none text-[10.5px] font-bold uppercase tracking-[0.3px] ${STATUS_COLOR[job.status]}`}>
              {job.status}
            </span>
          </div>
          <ProgressBar job={job} className="mb-1.5" />
          <div className="truncate font-mono text-[11px] text-zinc-500">{job.log}</div>
        </div>
      ))}
      {jobs.length > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="w-full cursor-pointer border-t border-line py-2 text-[12px] font-semibold text-zinc-400 hover:text-zinc-200"
        >
          {showAll ? 'Show fewer' : `Show all ${jobs.length}`}
        </button>
      )}
    </div>
  );
}
