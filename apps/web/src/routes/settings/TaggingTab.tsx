import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Job } from '@sakuya/shared';
import { api } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { toast } from '../../components/Toast';
import { useJobs } from '../../hooks/useJobs';
import { usePatchSettings, useSettings } from '../../hooks/useSettings';
import { TabHeader } from './index';
import { ToggleSwitch } from './MiscTabs';
import { ProgressBar } from './JobsHistoryTab';

export function TaggingTab() {
  const queryClient = useQueryClient();
  const jobs = useJobs();
  const settings = useSettings();
  const { data: tagger } = useQuery({
    queryKey: ['tagger'],
    queryFn: api.taggerStatus,
    refetchInterval: (query) => (query.state.data?.status === 'downloading' ? 2000 : false),
  });
  const { data: models } = useQuery({ queryKey: ['tagger-models'], queryFn: api.taggerModels, staleTime: Infinity });

  const activeTagJob = jobs.find((j) => j.type === 'tag' && (j.status === 'running' || j.status === 'queued'));
  const activeHashJob = jobs.find((j) => j.type === 'hash' && (j.status === 'running' || j.status === 'queued'));

  const enabled = settings?.ai_tagging_enabled === '1';
  const [threshold, setThreshold] = useState(35);
  useEffect(() => {
    if (settings) setThreshold(Number(settings.confidence_threshold) || 35);
  }, [settings]);

  const patchMutation = usePatchSettings();

  const downloadMutation = useMutation({
    mutationFn: api.taggerDownload,
    onSuccess: () => {
      toast('Model download started');
      queryClient.invalidateQueries({ queryKey: ['tagger'] });
    },
  });

  const tagAllMutation = useMutation({
    mutationFn: api.taggerTagAll,
    onSuccess: () => {
      toast('AI tagging started');
      queryClient.invalidateQueries({ queryKey: ['tagger'] });
    },
  });

  const selectModelMutation = useMutation({
    mutationFn: (modelId: string) => api.selectTaggerModel(modelId),
    onSuccess: (data) => {
      queryClient.setQueryData(['tagger'], data);
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast('Model switched — download the new model to use it');
    },
  });

  const hashAllMutation = useMutation({
    mutationFn: api.taggerHashAll,
    onSuccess: () => {
      toast('Hashing started');
      queryClient.invalidateQueries({ queryKey: ['tagger'] });
    },
  });

  return (
    <div>
      <TabHeader title="AI Tagging" subtitle="Auto-tag new imports with the anime tagger model." />

      <div className="mb-3.5 rounded-xl border border-line bg-surface p-[18px]">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13.5px] font-bold">Tagger model</div>
            <div className="mt-0.5 text-xs text-zinc-500">
              {tagger?.status === 'ready'
                ? `ready · ${formatBytes(tagger.modelSizeBytes ?? 0)} · ${tagger.tagCount} labels`
                : tagger?.status === 'downloading'
                  ? 'downloading… (see Import / Jobs)'
                  : 'not downloaded'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <select
              value={tagger?.model ?? ''}
              disabled={tagger?.status === 'downloading' || selectModelMutation.isPending}
              onChange={(e) => selectModelMutation.mutate(e.target.value)}
              className="rounded-field border border-line bg-zinc-900 px-2 py-2 text-[12.5px] text-zinc-100 outline-none disabled:opacity-40"
            >
              {(models ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            {tagger?.status !== 'ready' ? (
              <button
                disabled={tagger?.status === 'downloading' || downloadMutation.isPending}
                onClick={() => downloadMutation.mutate()}
                className="cursor-pointer rounded-btn bg-accent px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40"
              >
                {tagger?.status === 'downloading' ? 'Downloading…' : 'Download model'}
              </button>
            ) : (
              <span className="text-[11px] font-bold text-green-500">READY</span>
            )}
          </div>
        </div>
      </div>

      <JobRunCard
        job={activeTagJob}
        title="Bulk tag"
        activeTitle="Tagging in progress…"
        idle={
          (tagger?.untaggedCount ?? 0) > 0
            ? `${tagger?.untaggedCount} file${tagger?.untaggedCount === 1 ? '' : 's'} without AI tags.`
            : 'All files are tagged.'
        }
        label="Tag all"
        activeLabel="Tagging…"
        disabled={tagger?.status !== 'ready' || (tagger?.untaggedCount ?? 0) === 0 || tagAllMutation.isPending}
        onRun={() => tagAllMutation.mutate()}
      />
      <JobRunCard
        job={activeHashJob}
        title="Duplicate detection"
        activeTitle="Hashing images…"
        idle={
          (tagger?.unhashedCount ?? 0) > 0
            ? `${tagger?.unhashedCount} image${tagger?.unhashedCount === 1 ? '' : 's'} without a perceptual hash.`
            : 'All images are hashed for similarity search.'
        }
        label="Hash images"
        activeLabel="Hashing…"
        disabled={(tagger?.unhashedCount ?? 0) === 0 || hashAllMutation.isPending}
        onRun={() => hashAllMutation.mutate()}
      />

      <div className="mb-3.5 rounded-xl border border-line bg-surface p-[18px]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13.5px] font-bold">Auto-tag on import</div>
            <div className="mt-0.5 text-xs text-zinc-500">
              Runs the tagger automatically on newly scanned or uploaded files.
            </div>
          </div>
          <ToggleSwitch
            checked={enabled}
            onChange={(value) => patchMutation.mutate({ ai_tagging_enabled: value ? '1' : '0' })}
            pending={patchMutation.isPending}
          />
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface p-[18px]">
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

/** A card that starts a background job and shows its progress while it runs. */
function JobRunCard({
  job,
  title,
  activeTitle,
  idle,
  label,
  activeLabel,
  disabled,
  onRun,
}: {
  job: Job | undefined;
  title: string;
  activeTitle: string;
  idle: string;
  label: string;
  activeLabel: string;
  disabled: boolean;
  onRun: () => void;
}) {
  return (
    <div className="mb-3.5 rounded-xl border border-line bg-surface p-[18px]">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13.5px] font-bold">{job ? activeTitle : title}</div>
          <div className="mt-0.5 truncate text-xs text-zinc-500">
            {job ? job.log || `${job.progress}/${job.total}` : idle}
          </div>
          {job && <ProgressBar job={job} className="mt-2 w-full" />}
        </div>
        <button
          disabled={!!job || disabled}
          onClick={onRun}
          className="shrink-0 cursor-pointer rounded-btn bg-accent px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40"
        >
          {job ? activeLabel : label}
        </button>
      </div>
    </div>
  );
}
