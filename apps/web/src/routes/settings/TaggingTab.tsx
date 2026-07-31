import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { useJobs } from '../../hooks/useJobs';
import { TabHeader } from './index';

export function TaggingTab() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const jobs = useJobs();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const { data: tagger } = useQuery({
    queryKey: ['tagger'],
    queryFn: api.taggerStatus,
    refetchInterval: (query) => (query.state.data?.status === 'downloading' ? 2000 : false),
  });

  const activeTagJob = jobs.find((j) => j.type === 'tag' && (j.status === 'running' || j.status === 'queued'));

  const enabled = settings?.ai_tagging_enabled === '1';
  const [threshold, setThreshold] = useState(35);
  useEffect(() => {
    if (settings) setThreshold(Number(settings.confidence_threshold) || 35);
  }, [settings]);

  const patchMutation = useMutation({
    mutationFn: (body: Record<string, string>) => api.patchSettings(body),
    onSuccess: (data) => queryClient.setQueryData(['settings'], data),
    onError: (err: Error) => showToast(err.message),
  });

  const downloadMutation = useMutation({
    mutationFn: api.taggerDownload,
    onSuccess: () => {
      showToast('Model download started');
      queryClient.invalidateQueries({ queryKey: ['tagger'] });
    },
    onError: (err: Error) => showToast(err.message),
  });

  const tagAllMutation = useMutation({
    mutationFn: api.taggerTagAll,
    onSuccess: () => {
      showToast('AI tagging started');
      queryClient.invalidateQueries({ queryKey: ['tagger'] });
    },
    onError: (err: Error) => showToast(err.message),
  });

  return (
    <div>
      <TabHeader title="AI Tagging" subtitle="Auto-tag new imports with the anime tagger model." />

      <div className="mb-3.5 rounded-xl border border-zinc-800 bg-[#111113] p-[18px]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13.5px] font-bold">Tagger model</div>
            <div className="mt-0.5 text-xs text-zinc-500">
              SmilingWolf/wd-swinv2-tagger-v3 ·{' '}
              {tagger?.status === 'ready'
                ? `ready · ${formatBytes(tagger.modelSizeBytes ?? 0)} · ${tagger.tagCount} labels`
                : tagger?.status === 'downloading'
                  ? 'downloading… (see Import / Jobs)'
                  : 'not downloaded'}
            </div>
          </div>
          {tagger?.status !== 'ready' && (
            <button
              disabled={tagger?.status === 'downloading' || downloadMutation.isPending}
              onClick={() => downloadMutation.mutate()}
              className="cursor-pointer rounded-[7px] bg-accent px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40"
            >
              {tagger?.status === 'downloading' ? 'Downloading…' : 'Download model'}
            </button>
          )}
          {tagger?.status === 'ready' && <span className="text-[11px] font-bold text-green-500">READY</span>}
        </div>
      </div>

      <div className="mb-3.5 rounded-xl border border-zinc-800 bg-[#111113] p-[18px]">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13.5px] font-bold">
              {activeTagJob ? 'Tagging in progress…' : 'Bulk tag'}
            </div>
            <div className="mt-0.5 truncate text-xs text-zinc-500">
              {activeTagJob
                ? activeTagJob.log || `${activeTagJob.progress}/${activeTagJob.total}`
                : (tagger?.untaggedCount ?? 0) > 0
                  ? `${tagger?.untaggedCount} file${tagger?.untaggedCount === 1 ? '' : 's'} without AI tags.`
                  : 'All files are tagged.'}
            </div>
            {activeTagJob && (
              <div className="mt-2 h-[5px] w-full max-w-[280px] overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full bg-accent transition-[width] duration-300"
                  style={{
                    width: `${activeTagJob.total > 0 ? Math.round((activeTagJob.progress / activeTagJob.total) * 100) : 0}%`,
                  }}
                />
              </div>
            )}
          </div>
          <button
            disabled={
              !!activeTagJob ||
              tagger?.status !== 'ready' ||
              (tagger?.untaggedCount ?? 0) === 0 ||
              tagAllMutation.isPending
            }
            onClick={() => tagAllMutation.mutate()}
            className="shrink-0 cursor-pointer rounded-[7px] bg-accent px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40"
          >
            {activeTagJob ? 'Tagging…' : 'Tag all'}
          </button>
        </div>
      </div>

      <div className="mb-3.5 rounded-xl border border-zinc-800 bg-[#111113] p-[18px]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13.5px] font-bold">Auto-tag on import</div>
            <div className="mt-0.5 text-xs text-zinc-500">
              Runs the tagger automatically on newly scanned or uploaded files.
            </div>
          </div>
          <div
            className={`h-[22px] w-10 flex-none cursor-pointer rounded-full p-[3px] transition-colors ${enabled ? 'bg-accent' : 'bg-zinc-700'}`}
            onClick={() => patchMutation.mutate({ ai_tagging_enabled: enabled ? '0' : '1' })}
          >
            <div
              className={`h-4 w-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-[18px]' : ''}`}
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-[#111113] p-[18px]">
        <div className="mb-1 text-[13.5px] font-bold">Confidence threshold</div>
        <div className="mb-3 text-xs text-zinc-500">Tags below this confidence are discarded.</div>
        <input
          type="range"
          min={0}
          max={100}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          onMouseUp={() => patchMutation.mutate({ confidence_threshold: String(threshold) })}
          onTouchEnd={() => patchMutation.mutate({ confidence_threshold: String(threshold) })}
          className="w-full"
        />
        <div className="mt-1.5 text-[12.5px] font-semibold text-zinc-400">{threshold}%</div>
      </div>
    </div>
  );
}
