import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Settings } from '@sakuya/shared';
import { api } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TabHeader } from './index';

const ACCENTS = ['#8b5cf6', '#14b8a6', '#f43f5e'];

export function AppearanceTab() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const current = settings?.accent_color ?? '#8b5cf6';

  const patchMutation = useMutation({
    mutationFn: (accent: string) => api.patchSettings({ accent_color: accent }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
      document.documentElement.style.setProperty('--accent', data.accent_color);
      showToast('Accent updated');
    },
    onError: (err: Error) => showToast(err.message),
  });

  return (
    <div>
      <TabHeader title="Appearance" subtitle="Visual preferences for the board." />
      <div className="rounded-xl border border-zinc-800 bg-[#111113] p-[18px]">
        <div className="mb-2.5 text-[13.5px] font-bold">Accent color</div>
        <div className="flex gap-2.5">
          {ACCENTS.map((color) => (
            <div
              key={color}
              onClick={() => patchMutation.mutate(color)}
              className="h-[34px] w-[34px] cursor-pointer rounded-lg border-2"
              style={{ background: color, borderColor: current === color ? '#f4f4f5' : 'transparent' }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SystemTab() {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const { data: info } = useQuery({ queryKey: ['system'], queryFn: api.system });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [showCacheWarning, setShowCacheWarning] = useState(false);
  const [showRegenerateWarning, setShowRegenerateWarning] = useState(false);
  const [showCleanupWarning, setShowCleanupWarning] = useState(false);

  const cacheEnabled = settings?.thumbnail_cache_enabled !== '0';

  const clearMutation = useMutation({
    mutationFn: api.clearThumbnails,
    onSuccess: (res) => {
      showToast(`Cleared ${res.removed} thumbnails`);
      queryClient.invalidateQueries({ queryKey: ['system'] });
    },
    onError: (err: Error) => showToast(err.message),
  });

  const cacheMutation = useMutation({
    mutationFn: (value: boolean) => api.patchSettings({ thumbnail_cache_enabled: value ? '1' : '0' }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
      showToast('Thumbnail cache setting updated');
    },
    onError: (err: Error) => showToast(err.message),
  });

  const regenerateMutation = useMutation({
    mutationFn: api.regenerateAllThumbnails,
    onSuccess: () => showToast('Thumbnail regeneration started'),
    onError: (err: Error) => showToast(err.message),
  });

  const cleanupMutation = useMutation({
    mutationFn: api.cleanupData,
    onSuccess: (res) => {
      showToast(`Removed ${res.removedThumbs} orphan thumbnails · reset ${res.resetTagCounts} tag counts`);
      queryClient.invalidateQueries({ queryKey: ['system'] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
    onError: (err: Error) => showToast(err.message),
  });

  return (
    <div>
      <TabHeader title="System" subtitle="Storage and maintenance." />
      <div className="mb-2.5 rounded-xl border border-zinc-800 bg-[#111113] p-[18px]">
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
              if (!value) setShowCacheWarning(true);
              else cacheMutation.mutate(true);
            }}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2.5 rounded-xl border border-zinc-800 bg-[#111113] p-[18px]">
        <Row label="Version" value={info?.version ?? '—'} />
        <Row label="Media stored" value={info ? `${info.mediaCount} files · ${formatBytes(info.mediaBytes)}` : '—'} />
        <Row label="Database size" value={info ? formatBytes(info.dbBytes) : '—'} />
        <Row label="Thumbnail cache" value={info ? formatBytes(info.thumbBytes) : '—'} />
        <div className="mt-1.5 flex flex-col gap-1.5">
          <div
            className="cursor-pointer text-[12.5px] font-semibold text-rose-500 hover:text-rose-400"
            onClick={() => clearMutation.mutate()}
          >
            Clear thumbnail cache
          </div>
          <div
            className="cursor-pointer text-[12.5px] font-semibold text-zinc-300 hover:text-zinc-100"
            onClick={() => setShowRegenerateWarning(true)}
          >
            Regenerate all thumbnails
          </div>
          <div
            className="cursor-pointer text-[12.5px] font-semibold text-rose-500 hover:text-rose-400"
            onClick={() => setShowCleanupWarning(true)}
          >
            Clean up orphan data
          </div>
        </div>
      </div>
      {showCacheWarning && (
        <ConfirmDialog
          title="Disable thumbnail cache?"
          danger
          confirmLabel="Disable anyway"
          body="Without cached thumbnails, the board and dashboard will load full-resolution images directly. This can significantly hurt performance and load times on large libraries."
          onCancel={() => setShowCacheWarning(false)}
          onConfirm={() => {
            setShowCacheWarning(false);
            cacheMutation.mutate(false);
          }}
        />
      )}
      {showRegenerateWarning && (
        <ConfirmDialog
          title="Regenerate all thumbnails?"
          confirmLabel="Regenerate"
          body="This may take a long time on large libraries. Existing thumbnails will be overwritten as each file is re-processed."
          onCancel={() => setShowRegenerateWarning(false)}
          onConfirm={() => {
            setShowRegenerateWarning(false);
            regenerateMutation.mutate();
          }}
        />
      )}
      {showCleanupWarning && (
        <ConfirmDialog
          title="Clean up orphan data?"
          danger
          confirmLabel="Clean up"
          body="Removes thumbnail files whose media rows no longer exist and recomputes usage counts for every tag. Safe to run any time — nothing referenced by current media is touched."
          onCancel={() => setShowCleanupWarning(false)}
          onConfirm={() => {
            setShowCleanupWarning(false);
            cleanupMutation.mutate();
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
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings });

  const patchMutation = useMutation({
    mutationFn: (body: Record<string, string>) => api.patchSettings(body),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
      showToast('Behaviour updated');
    },
    onError: (err: Error) => showToast(err.message),
  });

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
      key: 'autosearch_first_tag',
      label: 'Auto-search first tag on Enter',
      desc: 'Pressing Enter in a search box adds the first matching tag instead of a free-text search.',
      defaultOn: true,
    },
    {
      key: 'board_remember_filters',
      label: 'Remember board filters',
      desc: 'Restore your last Board filters when you return. Turn off to reset the board each time you leave.',
      defaultOn: true,
    },
  ];

  return (
    <div>
      <TabHeader title="Behaviour" subtitle="Playback and interaction preferences." />
      <div className="flex flex-col gap-2.5">
        {rows.map((row) => {
          const raw = settings?.[row.key];
          const checked = raw !== undefined ? raw === '1' : !!row.defaultOn;
          return (
            <div key={row.key} className="rounded-xl border border-zinc-800 bg-[#111113] p-[18px]">
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
