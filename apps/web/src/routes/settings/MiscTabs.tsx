import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Settings } from '@sakuya/shared';
import { api } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { toast } from '../../components/Toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TabHeader } from './index';
import { useUiStyle } from '../../hooks/useUiStyle';
import { usePatchSettings, useSettings } from '../../hooks/useSettings';
import { UI_STYLES, UiStylePreview } from '../../components/UiStylePreview';

const ACCENTS = ['#8b5cf6', '#14b8a6', '#f43f5e'];

export function AppearanceTab() {
  const settings = useSettings();
  const current = settings?.accent_color ?? '#8b5cf6';
  const uiStyle = useUiStyle();

  // App applies the accent and style whenever the cached settings change.
  const patchMutation = usePatchSettings((_, body) =>
    toast(body.accent_color ? 'Accent updated' : 'Appearance updated'),
  );

  return (
    <div>
      <TabHeader title="Appearance" subtitle="Visual preferences for the board." />
      <div className="flex flex-col gap-2.5">
        <div className="rounded-xl border border-line bg-surface p-[18px]">
          <div className="text-[13.5px] font-bold">Interface style</div>
          <div className="mb-3 mt-0.5 text-[12px] text-zinc-500">Switch between the original look and the frosted Liquid Glass one.</div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {UI_STYLES.map((option) => {
              const active = uiStyle === option.key;
              return (
                <button
                  key={option.key}
                  disabled={patchMutation.isPending}
                  onClick={() => !active && patchMutation.mutate({ ui_style: option.key })}
                  className={`cursor-pointer rounded-panel border-2 p-2.5 text-left transition-colors disabled:cursor-wait ${
                    active ? 'border-accent' : 'border-line hover:border-line-hover'
                  }`}
                >
                  <UiStylePreview style={option.key} />
                  <div className="mt-2.5 flex items-center justify-between px-0.5">
                    <div className="text-[13px] font-semibold">{option.label}</div>
                    {active && <span className="text-[11px] font-bold uppercase tracking-[0.3px] text-accent">Active</span>}
                  </div>
                  <div className="mt-0.5 px-0.5 text-[11.5px] text-zinc-500">{option.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-[18px]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[13.5px] font-bold">Dashboard banner</div>
              <div className="mt-0.5 max-w-[420px] text-[12px] text-zinc-500">
                The welcome banner at the top of the dashboard. Only shown with the Liquid Glass style.
              </div>
            </div>
            <ToggleSwitch
              checked={settings?.dashboard_hero !== '0'}
              pending={patchMutation.isPending}
              onChange={(value) => patchMutation.mutate({ dashboard_hero: value ? '1' : '0' })}
            />
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-[18px]">
          <div className="mb-2.5 text-[13.5px] font-bold">Accent color</div>
          <div className="flex gap-2.5">
            {ACCENTS.map((color) => (
              <div
                key={color}
                onClick={() => patchMutation.mutate({ accent_color: color })}
                className="h-[34px] w-[34px] cursor-pointer rounded-lg border-2 glass:rounded-full"
                style={{ background: color, borderColor: current === color ? '#f4f4f5' : 'transparent' }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SystemTab() {
  const queryClient = useQueryClient();
  const { data: info } = useQuery({ queryKey: ['system'], queryFn: api.system });
  const settings = useSettings();
  const [confirm, setConfirm] = useState<'cache' | 'regenerate' | 'cleanup' | 'home' | 'local' | null>(null);
  const [movedTo, setMovedTo] = useState<string | null>(null);

  const cacheEnabled = settings?.thumbnail_cache_enabled !== '0';
  const transcodeEnabled = settings?.video_transcode_enabled === '1';

  const { data: storage } = useQuery({ queryKey: ['storage'], queryFn: api.storage });

  const migrateMutation = useMutation({
    mutationFn: (target: 'home' | 'local') => api.migrateStorage(target),
    onSuccess: (res) => {
      setMovedTo(res.movedTo);
      toast(`Data moved to ${res.movedTo} — restart Sakuya`);
    },
  });

  const clearMutation = useMutation({
    mutationFn: api.clearThumbnails,
    onSuccess: (res) => {
      toast(`Cleared ${res.removed} thumbnails`);
      queryClient.invalidateQueries({ queryKey: ['system'] });
    },
  });

  const cacheMutation = usePatchSettings(() => toast('Thumbnail cache setting updated'));

  const regenerateMutation = useMutation({
    mutationFn: api.regenerateAllThumbnails,
    onSuccess: () => toast('Thumbnail regeneration started'),
  });

  const transcodeToggleMutation = usePatchSettings(() => toast('Video transcoding setting updated'));

  const transcodeRunMutation = useMutation({
    mutationFn: api.transcodeVideos,
    onSuccess: () => toast('Checking videos for playback compatibility…'),
  });

  const cleanupMutation = useMutation({
    mutationFn: api.cleanupData,
    onSuccess: (res) => {
      toast(
        `Removed ${res.removedThumbs} orphan thumbnails and ${res.removedTranscodes} transcodes · reset ${res.resetTagCounts} tag counts · ` +
          `pruned ${res.prunedJobs} old jobs and ${res.prunedDownloadLogs} log lines`,
      );
      queryClient.invalidateQueries({ queryKey: ['system'] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });

  const migrateDialog = (target: 'home' | 'local') => ({
    title: target === 'home' ? 'Move data to ~/.sakuya?' : 'Move data back to the app folder?',
    confirmLabel: 'Move and shut down',
    body: (
      <>
        Everything in <span className="text-zinc-300">{storage?.current}</span> is copied to{' '}
        <span className="text-zinc-300">{target === 'home' ? storage?.home : storage?.local}</span> and the old folder
        is deleted. Large thumbnail and transcode caches can make this take a while — don't close the browser. The
        server shuts down when it's done; start it again to keep using Sakuya.
      </>
    ),
    run: () => migrateMutation.mutate(target),
  });
  const dialogs = {
    home: migrateDialog('home'),
    local: migrateDialog('local'),
    cache: {
      title: 'Disable thumbnail cache?',
      danger: true,
      confirmLabel: 'Disable anyway',
      body: 'Without cached thumbnails, the board and dashboard will load full-resolution images directly. This can significantly hurt performance and load times on large libraries.',
      run: () => cacheMutation.mutate({ thumbnail_cache_enabled: '0' }),
    },
    regenerate: {
      title: 'Regenerate all thumbnails?',
      confirmLabel: 'Regenerate',
      body: 'This may take a long time on large libraries. Existing thumbnails will be overwritten as each file is re-processed.',
      run: () => regenerateMutation.mutate(),
    },
    cleanup: {
      title: 'Clean up orphan data?',
      danger: true,
      confirmLabel: 'Clean up',
      body: 'Removes thumbnail files whose media rows no longer exist and recomputes usage counts for every tag. Safe to run any time — nothing referenced by current media is touched.',
      run: () => cleanupMutation.mutate(),
    },
  };
  const dialog = confirm && dialogs[confirm];

  const maintenance = [
    {
      title: 'Thumbnail cache',
      desc: 'Delete all cached thumbnails to free up disk space',
      label: 'Clear cache',
      danger: true,
      pending: clearMutation.isPending,
      onClick: () => clearMutation.mutate(),
    },
    {
      title: 'Regenerate thumbnails',
      desc: 'Re-process all media files and overwrite existing thumbnails',
      label: 'Regenerate all',
      pending: regenerateMutation.isPending,
      onClick: () => setConfirm('regenerate'),
    },
    {
      title: 'Transcode videos',
      desc: "Check every video and re-encode any the browser can't play",
      label: 'Transcode all videos now',
      pending: transcodeRunMutation.isPending,
      onClick: () => transcodeRunMutation.mutate(),
    },
    {
      title: 'Clean up orphan data',
      desc: 'Remove thumbnail files and tag counts with no matching media',
      label: 'Clean up',
      danger: true,
      pending: cleanupMutation.isPending,
      onClick: () => setConfirm('cleanup'),
    },
  ];

  return (
    <div>
      <TabHeader title="System" subtitle="Storage and maintenance." />
      <div className="mb-2.5 rounded-xl border border-line bg-surface p-[18px]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[13.5px] font-bold">Store data in your home folder</div>
            <div className="mt-0.5 max-w-[420px] text-[12px] text-zinc-500">
              Keeps the database, thumbnails, uploads and downloads in <code>~/.sakuya</code> instead of the app
              folder, so reinstalling or moving Sakuya leaves your library alone. Switching moves every file, then
              the server shuts down — start it again to continue.
            </div>
            <div className="mt-2 text-[11.5px] text-zinc-500">
              Currently: <span className="text-zinc-300">{storage?.current ?? '—'}</span>
            </div>
            {storage?.locked && (
              <div className="mt-1 text-[11.5px] text-amber-500">
                Pinned by <code>server.dataDir</code> in <code>sakuya.config.json</code> (Docker pins it to{' '}
                <code>/data</code>) — change it there.
              </div>
            )}
            {movedTo && (
              <div className="mt-1 text-[11.5px] text-emerald-500">Moved to {movedTo}. Restart Sakuya.</div>
            )}
          </div>
          <ToggleSwitch
            checked={storage?.usingHome ?? false}
            pending={migrateMutation.isPending}
            onChange={(value) => {
              if (storage?.locked || migrateMutation.isPending) return;
              setConfirm(value ? 'home' : 'local');
            }}
          />
        </div>
      </div>
      <div className="mb-2.5 rounded-xl border border-line bg-surface p-[18px]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13.5px] font-bold">Thumbnail cache</div>
            <div className="mt-0.5 max-w-[420px] text-[12px] text-zinc-500">
              Generate and serve small webp thumbnails. Disabling serves full-resolution originals for images
              (videos still use a generated frame).
            </div>
          </div>
          <ToggleSwitch
            checked={cacheEnabled}
            pending={cacheMutation.isPending}
            onChange={(value) => {
              if (!value) setConfirm('cache');
              else cacheMutation.mutate({ thumbnail_cache_enabled: '1' });
            }}
          />
        </div>
      </div>
      <div className="mb-2.5 rounded-xl border border-line bg-surface p-[18px]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13.5px] font-bold">Video transcoding</div>
            <div className="mt-0.5 max-w-[420px] text-[12px] text-zinc-500">
              After each scan, automatically re-encode videos the browser can't play (e.g. HEVC, or
              .mkv/.avi/.wmv files) to a compatible file used for playback. Originals are left untouched.
            </div>
          </div>
          <ToggleSwitch
            checked={transcodeEnabled}
            pending={transcodeToggleMutation.isPending}
            onChange={(value) => transcodeToggleMutation.mutate({ video_transcode_enabled: value ? '1' : '0' })}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-[18px]">
        <Row label="Version" value={info?.version ?? '—'} />
        <Row label="Media stored" value={info ? `${info.mediaCount} files · ${formatBytes(info.mediaBytes)}` : '—'} />
        <Row label="Database size" value={info ? formatBytes(info.dbBytes) : '—'} />
        <Row label="Thumbnail cache" value={info ? formatBytes(info.thumbBytes) : '—'} />
        <div className="mt-1.5 flex flex-col gap-2.5">
          {maintenance.map((row) => (
            <div
              key={row.title}
              className="flex items-center justify-between rounded-field border border-line bg-zinc-900 px-3 py-2"
            >
              <div>
                <div className="text-[13px] font-semibold text-zinc-200">{row.title}</div>
                <div className="text-[11px] text-zinc-500">{row.desc}</div>
              </div>
              <button
                disabled={row.pending}
                onClick={row.onClick}
                className={`cursor-pointer rounded-btn border border-line px-3 py-[5px] text-[12px] font-semibold disabled:opacity-40 ${
                  row.danger
                    ? 'text-rose-400 hover:border-rose-800 hover:text-rose-300'
                    : 'text-zinc-300 hover:border-line-strong hover:text-zinc-100'
                }`}
              >
                {row.label}
              </button>
            </div>
          ))}
        </div>
      </div>
      {dialog && (
        <ConfirmDialog
          {...dialog}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            dialog.run();
          }}
        />
      )}
    </div>
  );
}

export function ToggleSwitch({
  checked,
  onChange,
  pending,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  pending?: boolean;
}) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 flex-none cursor-pointer rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-zinc-700'
      } ${pending ? 'opacity-60' : ''}`}
    >
      <div
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </div>
  );
}

export function BehaviorTab() {
  const settings = useSettings();
  const patchMutation = usePatchSettings(() => toast('Behaviour updated'));

  const rows: { key: keyof Settings; label: string; desc: string; defaultOn?: boolean }[] = [
    {
      key: 'remember_mute_state',
      label: 'Remember video mute state',
      desc: 'Muting or unmuting a video carries over to the next video you play.',
    },
    {
      key: 'remember_volume_level',
      label: 'Remember volume level',
      desc: 'The volume you set on a video carries over to the next video you play.',
      defaultOn: true,
    },
    {
      key: 'continue_where_left',
      label: 'Continue where you left off (video)',
      desc: 'Resume videos at the position you last stopped watching.',
      defaultOn: true,
    },
    {
      key: 'board_remember_filters',
      label: 'Remember explore filters',
      desc: 'Restore your last Explore filters when you return. Turn off to reset the page each time you leave.',
      defaultOn: true,
    },
    {
      key: 'discover_enabled',
      label: 'Discover tab',
      desc: 'Show the Discover tab, which recommends media from the tags you like, watch and linger on. Your viewing is tracked either way, so the feed is already warm when you switch this on.',
    },
    {
      key: 'gifs_as_videos',
      label: 'Detect GIFs as videos',
      desc: 'Classify .gif files as videos instead of images (filters, badges, duration). New scans pick this up automatically; already-indexed GIFs need the button below.',
    },
  ];

  const reclassifyMutation = useMutation({
    mutationFn: api.reclassifyGifs,
    onSuccess: () => toast('Reclassifying existing GIFs…'),
  });

  return (
    <div>
      <TabHeader title="Behaviour" subtitle="Playback and interaction preferences." />
      <div className="flex flex-col gap-2.5">
        {rows.map((row) => {
          const raw = settings?.[row.key];
          const checked = raw !== undefined ? raw === '1' : !!row.defaultOn;
          return (
            <div key={row.key} className="rounded-xl border border-line bg-surface p-[18px]">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[13.5px] font-bold">{row.label}</div>
                  <div className="mt-0.5 max-w-[420px] text-[12px] text-zinc-500">{row.desc}</div>
                </div>
                <ToggleSwitch
                  checked={checked}
                  pending={patchMutation.isPending}
                  onChange={(value) => patchMutation.mutate({ [row.key]: value ? '1' : '0' })}
                />
              </div>
              {row.key === 'gifs_as_videos' && (
                <button
                  disabled={reclassifyMutation.isPending}
                  onClick={() => reclassifyMutation.mutate()}
                  className="mt-3 cursor-pointer rounded-btn border border-line px-3 py-[5px] text-[12px] font-semibold text-zinc-300 hover:border-line-strong hover:text-zinc-100 disabled:opacity-40"
                >
                  Reclassify existing GIFs now
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[13px]">
      <span className="text-zinc-500">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
