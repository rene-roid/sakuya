import { useJobs } from '../../hooks/useJobs';

const STATUS_COLOR: Record<string, string> = {
  running: 'text-amber-500',
  done: 'text-green-500',
  queued: 'text-zinc-500',
  error: 'text-red-500',
};

export function JobsHistoryTab() {
  const jobs = useJobs();

  return (
    <div className="flex flex-col gap-2.5">
      {jobs.map((job) => {
        const pct = job.total > 0 ? Math.round((job.progress / job.total) * 100) : job.status === 'done' ? 100 : 0;
        return (
          <div key={job.id} className="rounded-[10px] border border-zinc-800 bg-[#111113] p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[13.5px] font-bold">{job.label}</div>
              <span className={`text-[11px] font-bold tracking-[0.3px] uppercase ${STATUS_COLOR[job.status]}`}>
                {job.status}
              </span>
            </div>
            <div className="mb-1.5 h-[5px] overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full transition-[width] duration-300 ${job.status === 'error' ? 'bg-red-500' : 'bg-accent'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="font-mono text-[11.5px] text-zinc-500">{job.log}</div>
          </div>
        );
      })}
      {jobs.length === 0 && (
        <div className="text-[12.5px] text-zinc-600">No jobs yet. Scan a library to get started.</div>
      )}
    </div>
  );
}
