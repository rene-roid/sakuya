import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Job } from '@sakuya/shared';
import { useToast } from '../components/Toast';

const JobsContext = createContext<Job[]>([]);

export function useJobs() {
  return useContext(JobsContext);
}

export function JobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const queryClient = useQueryClient();
  const showToast = useToast();
  const knownStatus = useRef(new Map<number, string>());

  useEffect(() => {
    const source = new EventSource('/api/jobs/stream');
    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'snapshot') {
        setJobs(data.jobs);
        for (const job of data.jobs as Job[]) knownStatus.current.set(job.id, job.status);
        return;
      }
      const job: Job = data.job;
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === job.id);
        if (idx === -1) return [job, ...prev].slice(0, 50);
        const next = [...prev];
        next[idx] = job;
        return next;
      });
      const prevStatus = knownStatus.current.get(job.id);
      knownStatus.current.set(job.id, job.status);
      if (prevStatus !== 'done' && job.status === 'done') {
        showToast(`${job.label} — done`);
        queryClient.invalidateQueries({ queryKey: ['media'] });
        queryClient.invalidateQueries({ queryKey: ['media-detail'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['libraries'] });
        queryClient.invalidateQueries({ queryKey: ['tags'] });
        if (job.type === 'model-download' || job.type === 'tag') {
          queryClient.invalidateQueries({ queryKey: ['tagger'] });
        }
        if (job.type === 'model-download') {
          queryClient.invalidateQueries({ queryKey: ['settings'] });
        }
      }
      if (prevStatus !== 'error' && job.status === 'error') {
        showToast(`${job.label} — failed`);
      }
    };
    return () => source.close();
  }, [queryClient, showToast]);

  return <JobsContext.Provider value={jobs}>{children}</JobsContext.Provider>;
}
