import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Job, Settings } from '@sakuya/shared';
import { api, type ScheduleJobType } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { toast } from '../../components/Toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Segmented } from '../../components/Segmented';
import { UI_STYLES } from '../../components/UiStylePreview';
import { useJobs } from '../../hooks/useJobs';
import { useSettings } from '../../hooks/useSettings';
import { useUiStyle } from '../../hooks/useUiStyle';
import { ToggleSwitch } from './ToggleSwitch';
import { ProgressBar } from './JobHistory';
import { ScheduleSelect, scheduleToValue, valueToPatch } from './JobSchedules';
import type {
  ActionEntry,
  ConfirmSpec,
  SettingEntry,
  SettingsKey,
  SliderEntry,
  ToggleEntry,
  SelectEntry,
} from './registry';

type SettingsPatch = Partial<Record<SettingsKey, string>>;

export function buttonClass(tone: 'default' | 'danger' | 'primary' = 'default'): string {
  const base =
    'flex-none cursor-pointer rounded-btn border px-3 py-[5px] text-[12px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40';
  if (tone === 'primary') return `${base} border-accent bg-accent text-white hover:opacity-90`;
  if (tone === 'danger') return `${base} border-line text-rose-400 hover:border-rose-800 hover:text-rose-300`;
  return `${base} border-line text-zinc-300 hover:border-line-strong hover:text-zinc-100`;
}

const selectClass =
  'max-w-[220px] flex-none rounded-field border border-line bg-zinc-900 px-2 py-[5px] text-[12px] text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40';

/**
 * Saves settings with the change shown at once. Only the keys this call sent are taken from the
 * server's answer, so two rows saved back to back can't overwrite each other with a stale copy.
 */
function useSaveSettings() {
  const queryClient = useQueryClient();
  const merge = (patch: Partial<Settings>) =>
    queryClient.setQueryData<Settings>(['settings'], (old) => (old ? { ...old, ...patch } : old));
  return useMutation({
    mutationFn: (body: SettingsPatch) => api.patchSettings(body),
    onMutate: (body) => merge(body as Partial<Settings>),
    onSuccess: (data, body) => {
      const keys = Object.keys(body) as SettingsKey[];
      merge(Object.fromEntries(keys.map((k) => [k, data[k]])) as Partial<Settings>);
    },
    onError: (err) => {
      toast(err.message);
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

export function EntryControl({ entry }: { entry: SettingEntry }) {
  switch (entry.kind) {
    case 'toggle':
      return <ToggleControl entry={entry} />;
    case 'select':
      return <SelectControl entry={entry} />;
    case 'slider':
      return <SliderControl entry={entry} />;
    case 'action':
      return <ActionControl entry={entry} />;
    case 'custom':
      return <entry.Control />;
  }
}

function Confirm({ spec, onConfirm, onCancel }: { spec: ConfirmSpec; onConfirm: () => void; onCancel: () => void }) {
  return (
    <ConfirmDialog
      {...spec}
      onCancel={onCancel}
      onConfirm={() => {
        onCancel();
        onConfirm();
      }}
    />
  );
}

function ToggleControl({ entry }: { entry: ToggleEntry }) {
  const settings = useSettings();
  const save = useSaveSettings();
  const [confirming, setConfirming] = useState(false);
  const raw = settings?.[entry.key];
  const checked = entry.defaultOn ? raw !== '0' : raw === '1';
  const set = (value: boolean) => save.mutate({ [entry.key]: value ? '1' : '0' });

  return (
    <>
      <ToggleSwitch
        label={entry.label}
        checked={checked}
        disabled={!settings}
        onChange={(value) => (!value && entry.confirmOff ? setConfirming(true) : set(value))}
      />
      {confirming && entry.confirmOff && (
        <Confirm spec={entry.confirmOff} onConfirm={() => set(false)} onCancel={() => setConfirming(false)} />
      )}
    </>
  );
}

function SelectControl({ entry }: { entry: SelectEntry }) {
  const settings = useSettings();
  const save = useSaveSettings();
  return (
    <select
      aria-label={entry.label}
      value={settings?.[entry.key] ?? entry.fallback}
      disabled={!settings}
      onChange={(e) => save.mutate({ [entry.key]: e.target.value })}
      className={selectClass}
    >
      {entry.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const SLIDER_SAVE_DELAY = 400;

function SliderControl({ entry }: { entry: SliderEntry }) {
  const settings = useSettings();
  const save = useSaveSettings();
  const saved = Number(settings?.[entry.key]);
  const [value, setValue] = useState<number | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout>>();

  // Whatever is still waiting goes out when the row unmounts, e.g. on switching section.
  const flush = useRef<() => void>(() => {});
  useEffect(() => () => flush.current(), []);

  const shown = value ?? (Number.isFinite(saved) && settings?.[entry.key] ? saved : entry.fallback);

  const change = (next: number) => {
    setValue(next);
    clearTimeout(pending.current);
    flush.current = () => {
      clearTimeout(pending.current);
      flush.current = () => {};
      save.mutate({ [entry.key]: String(next) });
    };
    pending.current = setTimeout(() => flush.current(), SLIDER_SAVE_DELAY);
  };

  return (
    <div className="flex flex-none items-center gap-2.5">
      <input
        type="range"
        aria-label={entry.label}
        min={entry.min}
        max={entry.max}
        step={entry.step ?? 1}
        value={shown}
        disabled={!settings}
        onChange={(e) => change(Number(e.target.value))}
        onBlur={() => flush.current()}
        className="w-[140px] accent-accent max-sm:w-[180px]"
      />
      <span className="w-9 text-right text-[12px] font-semibold text-zinc-300">
        {shown}
        {entry.unit}
      </span>
    </div>
  );
}

function ActionControl({ entry }: { entry: ActionEntry }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const run = useMutation({
    mutationFn: () => entry.run(queryClient),
    onSuccess: (message) => message && toast(message),
  });
  return (
    <>
      <button
        type="button"
        disabled={run.isPending}
        onClick={() => (entry.confirm ? setConfirming(true) : run.mutate())}
        className={buttonClass(entry.tone)}
      >
        {entry.button}
      </button>
      {confirming && entry.confirm && (
        <Confirm spec={entry.confirm} onConfirm={() => run.mutate()} onCancel={() => setConfirming(false)} />
      )}
    </>
  );
}

// Custom controls. Each renders on the right of its row unless its entry is a `block`.

export function InterfaceStyleControl() {
  const uiStyle = useUiStyle();
  const save = useSaveSettings();
  return (
    <Segmented
      options={UI_STYLES.map((s) => ({ key: s.key, label: s.label }))}
      value={uiStyle}
      onChange={(key) => key !== uiStyle && save.mutate({ ui_style: key })}
    />
  );
}

const ACCENTS = [
  { color: '#8b5cf6', name: 'Violet' },
  { color: '#14b8a6', name: 'Teal' },
  { color: '#f43f5e', name: 'Rose' },
];

export function AccentColorControl() {
  const settings = useSettings();
  const save = useSaveSettings();
  const current = settings?.accent_color ?? ACCENTS[0].color;
  return (
    <div className="flex gap-2">
      {ACCENTS.map(({ color, name }) => (
        <button
          key={color}
          type="button"
          aria-label={name}
          aria-pressed={current === color}
          onClick={() => save.mutate({ accent_color: color })}
          className="h-[22px] w-[22px] cursor-pointer rounded-md border-2 outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 glass:rounded-full"
          style={{ background: color, borderColor: current === color ? '#f4f4f5' : 'transparent' }}
        />
      ))}
    </div>
  );
}

function useTagger() {
  return useQuery({
    queryKey: ['tagger'],
    queryFn: api.taggerStatus,
    refetchInterval: (query) => (query.state.data?.status === 'downloading' ? 2000 : false),
  }).data;
}

export function TaggerModelMeta() {
  const tagger = useTagger();
  if (!tagger) return null;
  if (tagger.status === 'ready')
    return (
      <>
        <span className="font-semibold text-emerald-500">Ready</span> · {formatBytes(tagger.modelSizeBytes ?? 0)} ·{' '}
        {tagger.tagCount?.toLocaleString()} labels
      </>
    );
  return <>{tagger.status === 'downloading' ? 'Downloading… (see Jobs)' : 'Not downloaded'}</>;
}

export function TaggerModelControl() {
  const queryClient = useQueryClient();
  const tagger = useTagger();
  const { data: models } = useQuery({ queryKey: ['tagger-models'], queryFn: api.taggerModels, staleTime: Infinity });
  const download = useMutation({
    mutationFn: api.taggerDownload,
    onSuccess: () => {
      toast('Model download started');
      queryClient.invalidateQueries({ queryKey: ['tagger'] });
    },
  });
  const select = useMutation({
    mutationFn: (modelId: string) => api.selectTaggerModel(modelId),
    onSuccess: (data) => {
      queryClient.setQueryData(['tagger'], data);
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast('Model switched. Download it to use it.');
    },
  });
  const downloading = tagger?.status === 'downloading';
  return (
    <>
      <select
        aria-label="Tagger model"
        value={tagger?.model ?? ''}
        disabled={downloading || select.isPending}
        onChange={(e) => select.mutate(e.target.value)}
        className={selectClass}
      >
        {(models ?? []).map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      {tagger && tagger.status !== 'ready' && (
        <button
          type="button"
          disabled={downloading || download.isPending}
          onClick={() => download.mutate()}
          className={buttonClass('primary')}
        >
          {downloading ? 'Downloading…' : 'Download'}
        </button>
      )}
    </>
  );
}

function useActiveJob(type: Job['type']): Job | undefined {
  return useJobs().find((j) => j.type === type && (j.status === 'running' || j.status === 'queued'));
}

function JobMeta({ job, idle }: { job: Job | undefined; idle: string }) {
  if (!job) return <>{idle}</>;
  return (
    <div className="max-w-[440px]">
      <div className="truncate">{job.log || `${job.progress}/${job.total}`}</div>
      <ProgressBar job={job} className="mt-1.5 w-full" />
    </div>
  );
}

export function TagUntaggedMeta() {
  const tagger = useTagger();
  const job = useActiveJob('tag');
  const n = tagger?.untaggedCount ?? 0;
  return <JobMeta job={job} idle={n > 0 ? `${n} file${n === 1 ? '' : 's'} without AI tags` : 'Every file is tagged'} />;
}

export function TagUntaggedControl() {
  const queryClient = useQueryClient();
  const tagger = useTagger();
  const job = useActiveJob('tag');
  const run = useMutation({
    mutationFn: api.taggerTagAll,
    onSuccess: () => {
      toast('AI tagging started');
      queryClient.invalidateQueries({ queryKey: ['tagger'] });
    },
  });
  const n = tagger?.untaggedCount ?? 0;
  return (
    <button
      type="button"
      disabled={!!job || tagger?.status !== 'ready' || n === 0 || run.isPending}
      onClick={() => run.mutate()}
      title={tagger?.status !== 'ready' ? 'Download the tagger model first' : undefined}
      className={buttonClass('primary')}
    >
      {job ? 'Tagging…' : n > 0 ? `Tag ${n} file${n === 1 ? '' : 's'}` : 'Tag all'}
    </button>
  );
}

export function HashImagesMeta() {
  const tagger = useTagger();
  const job = useActiveJob('hash');
  const n = tagger?.unhashedCount ?? 0;
  return (
    <JobMeta job={job} idle={n > 0 ? `${n} image${n === 1 ? '' : 's'} without a hash` : 'Every image is hashed'} />
  );
}

export function HashImagesControl() {
  const queryClient = useQueryClient();
  const tagger = useTagger();
  const job = useActiveJob('hash');
  const run = useMutation({
    mutationFn: api.taggerHashAll,
    onSuccess: () => {
      toast('Hashing started');
      queryClient.invalidateQueries({ queryKey: ['tagger'] });
    },
  });
  const n = tagger?.unhashedCount ?? 0;
  return (
    <button
      type="button"
      disabled={!!job || n === 0 || run.isPending}
      onClick={() => run.mutate()}
      className={buttonClass()}
    >
      {job ? 'Hashing…' : n > 0 ? `Hash ${n} image${n === 1 ? '' : 's'}` : 'Hash images'}
    </button>
  );
}

function useSystemInfo() {
  return useQuery({ queryKey: ['system'], queryFn: api.system }).data;
}

export function ThumbnailSizeMeta() {
  const info = useSystemInfo();
  return info ? <>{formatBytes(info.thumbBytes)} on disk</> : null;
}

export function StatValue({ stat }: { stat: 'media' | 'db' | 'thumbs' | 'version' }) {
  const info = useSystemInfo();
  const text = !info
    ? '—'
    : stat === 'media'
      ? `${info.mediaCount.toLocaleString()} files · ${formatBytes(info.mediaBytes)}`
      : stat === 'db'
        ? formatBytes(info.dbBytes)
        : stat === 'thumbs'
          ? formatBytes(info.thumbBytes)
          : info.version;
  return <span className="flex-none text-[12.5px] font-semibold text-zinc-300">{text}</span>;
}

function useStorage() {
  return useQuery({ queryKey: ['storage'], queryFn: api.storage }).data;
}

export function HomeFolderMeta() {
  const storage = useStorage();
  return (
    <>
      Currently <span className="break-all text-zinc-300">{storage?.current ?? '—'}</span>
      {storage?.locked && (
        <div className="mt-1 text-amber-500">
          Pinned by <code>server.dataDir</code> in <code>sakuya.config.json</code> (Docker pins it to <code>/data</code>
          ). Change it there.
        </div>
      )}
    </>
  );
}

export function HomeFolderControl() {
  const storage = useStorage();
  const [confirm, setConfirm] = useState<'home' | 'local' | null>(null);
  const migrate = useMutation({
    mutationFn: (target: 'home' | 'local') => api.migrateStorage(target),
    onSuccess: (res) => toast(`Data moved to ${res.movedTo}. Restart Sakuya.`),
  });

  if (migrate.data) {
    return <span className="text-[12px] font-semibold text-emerald-500">Moved. Restart Sakuya.</span>;
  }
  return (
    <>
      <ToggleSwitch
        label="Store data in your home folder"
        checked={storage?.usingHome ?? false}
        pending={migrate.isPending}
        disabled={!storage || storage.locked || migrate.isPending}
        onChange={(value) => setConfirm(value ? 'home' : 'local')}
      />
      {confirm && (
        <Confirm
          spec={{
            title: confirm === 'home' ? 'Move data to ~/.sakuya?' : 'Move data back to the app folder?',
            confirmLabel: 'Move and shut down',
            body: (
              <>
                Everything in <span className="text-zinc-300">{storage?.current}</span> is copied to{' '}
                <span className="text-zinc-300">{confirm === 'home' ? storage?.home : storage?.local}</span> and the old
                folder is deleted. Large thumbnail and transcode caches can make this take a while, so don't close the
                browser. The server shuts down when it's done; start it again to keep using Sakuya.
              </>
            ),
          }}
          onConfirm={() => migrate.mutate(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}

export function ScheduleControl({ jobType }: { jobType: ScheduleJobType }) {
  const queryClient = useQueryClient();
  const { data: schedules } = useQuery({ queryKey: ['job-schedules'], queryFn: api.jobSchedules });
  const update = useMutation({
    mutationFn: api.updateJobSchedule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-schedules'] });
      queryClient.invalidateQueries({ queryKey: ['libraries'] });
    },
  });
  const runNow = useMutation({
    mutationFn: () => api.runJobsNow('global', jobType),
    onSuccess: () => toast('Jobs enqueued'),
  });
  return (
    <>
      <ScheduleSelect
        value={scheduleToValue(schedules?.globals[jobType], 'global')}
        disabled={!schedules || update.isPending}
        onChange={(next) => update.mutate(valueToPatch(next, jobType))}
        showInherit={false}
        showAfterScan={jobType !== 'scan' && jobType !== 'cleanup'}
      />
      <button type="button" disabled={runNow.isPending} onClick={() => runNow.mutate()} className={buttonClass()}>
        Run now
      </button>
    </>
  );
}

export function UploadsLink() {
  const { data: libraries } = useQuery({ queryKey: ['libraries'], queryFn: api.libraries });
  const first = libraries?.[0];
  if (!first) {
    return (
      <button type="button" disabled title="Create a library first" className={buttonClass()}>
        {libraries ? 'Create a library first' : 'Open library'}
      </button>
    );
  }
  return (
    <Link to={`/library/${first.id}`} className={buttonClass()}>
      Open {first.name}
    </Link>
  );
}

export function DuplicatesLink() {
  return (
    <Link to="/duplicates" className={buttonClass()}>
      Find duplicates
    </Link>
  );
}
