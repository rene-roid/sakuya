import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Media } from '@sakuya/shared';
import { api, fileUrl } from '../lib/api';
import { formatBytes, formatDuration, timeAgo } from '../lib/format';
import { useToast } from './Toast';

const MUTE_STORAGE_KEY = 'sakuya:videoMuted';

interface MediaViewerProps {
  items: Media[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onNearEnd?: () => void;
}

export function MediaViewer({ items, index, onIndexChange, onClose, onNearEnd }: MediaViewerProps) {
  const item = items[index];
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [tagInput, setTagInput] = useState('');
  const lastSavedProgress = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { data: detail } = useQuery({
    queryKey: ['media-detail', item?.id],
    queryFn: () => api.mediaDetail(item.id),
    enabled: !!item,
  });

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  const rememberMute = settings?.remember_mute_state === '1';

  const initialMuted = useMemo(() => {
    if (!rememberMute) return true;
    return localStorage.getItem(MUTE_STORAGE_KEY) !== '0';
  }, [rememberMute, item?.id]);

  const handleVolumeChange = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (!rememberMute) return;
      localStorage.setItem(MUTE_STORAGE_KEY, e.currentTarget.muted ? '1' : '0');
    },
    [rememberMute],
  );

  const step = useCallback(
    (dir: number) => {
      if (!items.length) return;
      let next = index + dir;
      if (next < 0) next = items.length - 1;
      if (next >= items.length) next = 0;
      onIndexChange(next);
      if (items.length - next < 10) onNearEnd?.();
    },
    [index, items.length, onIndexChange, onNearEnd],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, step]);

  const tagMutation = useMutation({
    mutationFn: (body: { add?: string[]; remove?: string[] }) => api.patchTags(item.id, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(['media-detail', item.id], updated);
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      queryClient.invalidateQueries({ queryKey: ['media'] });
      showToast('Tags saved');
    },
    onError: (err: Error) => showToast(`Failed: ${err.message}`),
  });

  const retagMutation = useMutation({
    mutationFn: () => api.retag(item.id),
    onSuccess: () => showToast('Re-tagging with AI…'),
    onError: (err: Error) => showToast(err.message),
  });

  const saveProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.duration || !item) return;
    const progress = Math.min(video.currentTime / video.duration, 1);
    if (Math.abs(progress - lastSavedProgress.current) < 0.03) return;
    lastSavedProgress.current = progress;
    api.saveProgress(item.id, progress).catch(() => {});
  }, [item]);

  if (!item) return null;

  return (
    <div className="fade-in fixed inset-0 z-[80] flex bg-zinc-950/92 backdrop-blur">
      <div className="relative flex min-w-0 flex-1 items-center justify-center p-10">
        <div
          className="absolute right-4 top-4 z-10 flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-white/5 text-base text-zinc-100 hover:bg-white/10"
          onClick={onClose}
        >
          ✕
        </div>
        <div
          className="absolute left-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/5 text-lg text-zinc-100 hover:bg-white/10"
          onClick={() => step(-1)}
        >
          ‹
        </div>
        <div
          className="absolute right-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/5 text-lg text-zinc-100 hover:bg-white/10"
          onClick={() => step(1)}
        >
          ›
        </div>
        {item.type === 'video' ? (
          <video
            key={item.id}
            ref={videoRef}
            src={fileUrl(item.id)}
            autoPlay
            muted={initialMuted}
            loop
            controls
            onTimeUpdate={saveProgress}
            onVolumeChange={handleVolumeChange}
            className="max-h-[85%] max-w-[92%] rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
          />
        ) : (
          <img
            key={item.id}
            src={fileUrl(item.id)}
            alt={item.filename}
            className="max-h-[85%] max-w-[92%] rounded-xl object-contain shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
          />
        )}
      </div>
      <div className="w-[340px] flex-none overflow-y-auto border-l border-zinc-800 bg-[#111113] p-[22px]">
        <div className="mb-0.5 break-all text-base font-bold">{item.filename}</div>
        <div className="mb-[18px] text-xs text-zinc-500">{item.libraryName}</div>
        <div className="mb-[22px] flex flex-col gap-[9px]">
          <MetaRow label="Path" value={item.path} mono />
          <MetaRow label="Size" value={formatBytes(item.sizeBytes)} />
          <MetaRow
            label="Dimensions"
            value={item.width && item.height ? `${item.width}×${item.height}` : '—'}
          />
          <MetaRow label="Type" value={item.type === 'video' ? `Video · ${formatDuration(item.durationSeconds) ?? ''}` : 'Image'} />
          <MetaRow label="Added" value={timeAgo(item.createdAt)} />
        </div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-bold tracking-[0.4px] text-zinc-500">TAGS</div>
          <div
            className="cursor-pointer text-[11.5px] font-semibold text-accent hover:opacity-80"
            onClick={() => retagMutation.mutate()}
          >
            ↻ AI re-tag
          </div>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(detail?.tags ?? []).map((tag) => (
            <div
              key={tag.name}
              title={tag.confidence != null ? `${tag.source} · ${(tag.confidence * 100).toFixed(0)}%` : tag.source}
              className={`flex items-center gap-[5px] rounded-full py-1 pl-2.5 pr-[5px] text-xs ${
                tag.category === 'rating'
                  ? 'bg-accent/20 text-violet-300'
                  : tag.category === 'character'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-zinc-800 text-zinc-200'
              }`}
            >
              <span>{tag.name}</span>
              <span
                className="flex h-[15px] w-[15px] cursor-pointer items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
                onClick={() => tagMutation.mutate({ remove: [tag.name] })}
              >
                ×
              </span>
            </div>
          ))}
          {detail && detail.tags.length === 0 && <div className="text-[11.5px] text-zinc-600">No tags yet</div>}
        </div>
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && tagInput.trim()) {
              tagMutation.mutate({ add: [tagInput.trim()] });
              setTagInput('');
            }
          }}
          placeholder="Add tag, press Enter…"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-[12.5px] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-600"
        />
      </div>
    </div>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-[12.5px]">
      <span className="flex-none text-zinc-500">{label}</span>
      <span className={`truncate text-right text-zinc-300 ${mono ? 'font-mono text-[11.5px]' : ''}`} title={value}>
        {value}
      </span>
    </div>
  );
}
