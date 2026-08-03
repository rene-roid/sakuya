import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { X, RotateCw, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import type { Media, MediaTag, TagCategory } from '@sakuya/shared';
import { api, fileUrl, thumbUrl } from '../lib/api';
import { formatBytes, formatDuration, timeAgo } from '../lib/format';
import { useToast } from './Toast';
import { HeartButton } from './HeartButton';

const MUTE_STORAGE_KEY = 'sakuya:videoMuted';
const VOLUME_STORAGE_KEY = 'sakuya:videoVolume';

interface MediaViewerProps {
  items: Media[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onNearEnd?: () => void;
}

const ADD_CATEGORIES: { key: TagCategory; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'character', label: 'Character' },
  { key: 'rating', label: 'Rating' },
];

export function MediaViewer({ items, index, onIndexChange, onClose, onNearEnd }: MediaViewerProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showToast = useToast();
  const [tagInput, setTagInput] = useState('');
  const [addCategory, setAddCategory] = useState<TagCategory>('general');
  // Lets the viewer jump to a duplicate/similar item that isn't in the parent list.
  const [jumpItem, setJumpItem] = useState<Media | null>(null);
  const item = jumpItem ?? items[index];
  const lastSavedProgress = useRef(0);
  const completedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { data: detail } = useQuery({
    queryKey: ['media-detail', item?.id],
    queryFn: () => api.mediaDetail(item.id),
    enabled: !!item,
  });

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  const rememberMute = settings?.remember_mute_state === '1';
  const rememberVolume = settings?.remember_volume_level !== '0';
  const resumeEnabled = settings?.continue_where_left !== '0';

  const { data: similar } = useQuery({
    queryKey: ['similar', item?.id],
    queryFn: () => api.similar(item.id),
    enabled: !!item,
    staleTime: 30_000,
  });

  const initialMuted = useMemo(() => {
    if (!rememberMute) return true;
    return localStorage.getItem(MUTE_STORAGE_KEY) !== '0';
  }, [rememberMute, item?.id]);

  const handleVolumeChange = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (rememberMute) localStorage.setItem(MUTE_STORAGE_KEY, e.currentTarget.muted ? '1' : '0');
      if (rememberVolume) localStorage.setItem(VOLUME_STORAGE_KEY, String(e.currentTarget.volume));
    },
    [rememberMute, rememberVolume],
  );

  const saveProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.duration || !item) return;
    // Once the video has been watched to the end, stop tracking for this mount so that
    // the autoloop restarting at 0 doesn't re-add it to Continue Watching.
    if (completedRef.current) return;
    const progress = Math.min(video.currentTime / video.duration, 1);
    if (progress >= 0.98) {
      completedRef.current = true;
      lastSavedProgress.current = progress;
      api.saveProgress(item.id, progress).catch(() => {});
      return;
    }
    if (Math.abs(progress - lastSavedProgress.current) < 0.03) return;
    lastSavedProgress.current = progress;
    api.saveProgress(item.id, progress).catch(() => {});
  }, [item]);

  // Mark viewed (updates lastViewedAt for both images and videos) when a new item opens.
  useEffect(() => {
    if (!item) return;
    completedRef.current = false;
    lastSavedProgress.current = item.viewProgress ?? 0;
    api.saveProgress(item.id, item.viewProgress ?? 0).catch(() => {});
  }, [item?.id]);

  const handleClose = useCallback(() => {
    saveProgress();
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    onClose();
  }, [saveProgress, queryClient, onClose]);

  const step = useCallback(
    (dir: number) => {
      if (!items.length) return;
      setJumpItem(null);
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
      if (e.key === 'Escape') handleClose();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose, step]);

  const onLoadedMetadata = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const video = e.currentTarget;
      if (rememberVolume) {
        const saved = localStorage.getItem(VOLUME_STORAGE_KEY);
        if (saved !== null) {
          const vol = Number(saved);
          if (Number.isFinite(vol)) video.volume = Math.min(Math.max(vol, 0), 1);
        }
      }
      if (!resumeEnabled || !item) return;
      const p = item.viewProgress;
      if (p > 0.01 && p < 0.98 && video.duration) {
        video.currentTime = p * video.duration;
      }
    },
    [resumeEnabled, rememberVolume, item],
  );

  const tagMutation = useMutation({
    mutationFn: (body: { add?: string[]; remove?: string[]; category?: TagCategory; setCategory?: Record<string, TagCategory> }) =>
      api.patchTags(item.id, body),
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

  const openTag = useCallback(
    (tag: string) => {
      handleClose();
      navigate(`/board?tags=${encodeURIComponent(tag)}`);
    },
    [handleClose, navigate],
  );

  if (!item) return null;

  const hasSimilar = (similar?.duplicates.length ?? 0) > 0 || (similar?.similar.length ?? 0) > 0;

  return (
    <div className="fade-in fixed inset-0 z-[80] flex bg-zinc-950/92 backdrop-blur">
      <div className="relative flex min-w-0 flex-1 items-center justify-center p-10">
        <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
          <HeartButton mediaId={item.id} liked={detail?.liked ?? item.liked} size="lg" />
          <button
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-white/5 text-zinc-100 hover:bg-white/10"
            onClick={handleClose}
          >
            <X size={20} />
          </button>
        </div>
        <button
          className="absolute left-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/5 text-zinc-100 hover:bg-white/10"
          onClick={() => step(-1)}
        >
          <ChevronLeft size={24} />
        </button>
        <button
          className="absolute right-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/5 text-zinc-100 hover:bg-white/10"
          onClick={() => step(1)}
        >
          <ChevronRight size={24} />
        </button>
        {item.type === 'video' ? (
          <video
            key={item.id}
            ref={videoRef}
            src={fileUrl(item.id)}
            autoPlay
            muted={initialMuted}
            loop
            controls
            onLoadedMetadata={onLoadedMetadata}
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

        {hasSimilar && (
          <SimilarPanel
            duplicates={similar?.duplicates ?? []}
            similar={similar?.similar ?? []}
            onPick={(m) => setJumpItem(m)}
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
          <button
            className="flex items-center gap-1 cursor-pointer text-[11.5px] font-semibold text-accent hover:opacity-80"
            onClick={() => retagMutation.mutate()}
          >
            <RotateCw size={13} />
            AI re-tag
          </button>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(detail?.tags ?? []).map((tag) => (
            <TagPill
              key={tag.name}
              tag={tag}
              onOpen={() => openTag(tag.name)}
              onRemove={() => tagMutation.mutate({ remove: [tag.name] })}
              onSetCategory={(category) => tagMutation.mutate({ setCategory: { [tag.name]: category } })}
            />
          ))}
          {detail && detail.tags.length === 0 && <div className="text-[11.5px] text-zinc-600">No tags yet</div>}
        </div>
        <div className="mb-1.5 flex gap-1">
          {ADD_CATEGORIES.map((c) => (
            <div
              key={c.key}
              onClick={() => setAddCategory(c.key)}
              className={`cursor-pointer rounded-md px-2 py-1 text-[11px] font-semibold ${
                addCategory === c.key ? 'bg-accent text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {c.label}
            </div>
          ))}
        </div>
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && tagInput.trim()) {
              tagMutation.mutate({ add: [tagInput.trim()], category: addCategory });
              setTagInput('');
            }
          }}
          placeholder={`Add ${addCategory} tag, press Enter…`}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-[12.5px] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-600"
        />
      </div>
    </div>
  );
}

function categoryClasses(category: TagCategory): string {
  return category === 'rating'
    ? 'bg-accent/20 text-violet-300'
    : category === 'character'
      ? 'bg-emerald-500/15 text-emerald-300'
      : 'bg-zinc-800 text-zinc-200';
}

function TagPill({
  tag,
  onOpen,
  onRemove,
  onSetCategory,
}: {
  tag: MediaTag;
  onOpen: () => void;
  onRemove: () => void;
  onSetCategory: (category: TagCategory) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      title={tag.confidence != null ? `${tag.source} · ${(tag.confidence * 100).toFixed(0)}%` : tag.source}
      className={`relative flex items-center gap-[5px] rounded-full py-1 pl-2.5 pr-[5px] text-xs ${categoryClasses(tag.category)}`}
    >
      <span className="cursor-pointer hover:underline" onClick={onOpen}>
        {tag.name}
      </span>
      <button
        className="flex h-[15px] w-[15px] cursor-pointer items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
        onClick={() => setMenuOpen((v) => !v)}
        title="Change category"
      >
        <ChevronDown size={11} />
      </button>
      <button
        className="flex h-[15px] w-[15px] cursor-pointer items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
        onClick={onRemove}
      >
        <X size={11} />
      </button>
      {menuOpen && (
        <div className="absolute left-0 top-[26px] z-20 flex flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
          {(['general', 'character', 'rating', 'user'] as TagCategory[]).map((c) => (
            <div
              key={c}
              className="cursor-pointer px-3 py-1.5 text-[11.5px] capitalize text-zinc-200 hover:bg-zinc-800"
              onClick={() => {
                setMenuOpen(false);
                onSetCategory(c);
              }}
            >
              {c}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SimilarPanel({
  duplicates,
  similar,
  onPick,
}: {
  duplicates: Media[];
  similar: Media[];
  onPick: (m: Media) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <div className="absolute bottom-4 left-4 z-10 w-[240px] rounded-xl border border-zinc-800 bg-zinc-950/85 backdrop-blur">
      <button className={`w-full flex cursor-pointer items-center justify-between ${collapsed ? 'px-3 py-2' : 'px-3 py-3 mb-2'}`} onClick={() => setCollapsed((c) => !c)}>
        <span className="text-[11px] font-bold tracking-[0.4px] text-zinc-400">SIMILAR & DUPLICATES</span>
        <ChevronRight size={16} className={`text-zinc-500 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {duplicates.length > 0 && (
            <Section title={`Duplicates (${duplicates.length})`} items={duplicates} onPick={onPick} />
          )}
          {similar.length > 0 && <Section title={`Similar (${similar.length})`} items={similar} onPick={onPick} />}
        </div>
      )}
    </div>
  );
}

function Section({ title, items, onPick }: { title: string; items: Media[]; onPick: (m: Media) => void }) {
  return (
    <div>
      <div className="mb-1 text-[10.5px] font-semibold text-zinc-500">{title}</div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {items.map((m) => (
          <img
            key={m.id}
            src={thumbUrl(m.id)}
            alt={m.filename}
            title={m.filename}
            onClick={() => onPick(m)}
            className="h-12 w-12 flex-none cursor-pointer rounded-md border border-zinc-800 object-cover hover:border-accent"
          />
        ))}
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
