import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight, ScanFace, UserX } from 'lucide-react';
import type { CharacterDetection } from '@sakuya/shared';
import { api } from '../../lib/api';
import { characterLabelText, clampLeft, containRect, type Rect } from '../../lib/characters';
import { Crop, NamePicker } from './NamePicker';
import { useNameDetection, useRejectDetection } from './actions';

const STORAGE_KEY = 'sakuya:characterBoxes';
const MENU_WIDTH = 250;

export function useMediaDetections(mediaId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: ['media-detections', mediaId],
    queryFn: () => api.mediaDetections(mediaId!),
    enabled: enabled && mediaId !== undefined,
    staleTime: 30_000,
  }).data;
}

/** Whether the viewer draws character boxes, remembered across visits. */
export function useCharacterBoxesToggle(): [boolean, () => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setOn((v) => {
      try {
        localStorage.setItem(STORAGE_KEY, v ? '0' : '1');
      } catch {
        // The toggle still works for this visit.
      }
      return !v;
    });
  return [on, toggle];
}

/** The viewer's toolbar button. Shown only for media the character scan found someone in. */
export function CharacterBoxesButton({ mediaId, on, onToggle }: { mediaId: number; on: boolean; onToggle: () => void }) {
  const detections = useMediaDetections(mediaId);
  if (!detections?.length) return null;
  return (
    <button
      type="button"
      aria-pressed={on}
      title={on ? 'Hide characters' : `Show characters (${detections.length})`}
      onClick={onToggle}
      className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-zinc-100 ${
        on ? 'bg-white/20' : 'bg-white/5 hover:bg-white/10'
      }`}
    >
      <ScanFace size={18} />
    </button>
  );
}

/** Where the picture is drawn inside its pane, for an <img> that may be letterboxed. */
function usePictureRect(imgRef: RefObject<HTMLImageElement>, mediaId: number): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const measure = () => {
      if (!img.naturalWidth) return setRect(null);
      const inner = containRect(img.clientWidth, img.clientHeight, img.naturalWidth, img.naturalHeight);
      setRect({ ...inner, left: img.offsetLeft + inner.left, top: img.offsetTop + inner.top });
    };
    measure();
    img.addEventListener('load', measure);
    const observer = new ResizeObserver(measure);
    observer.observe(img);
    return () => {
      img.removeEventListener('load', measure);
      observer.disconnect();
    };
  }, [imgRef, mediaId]);
  return rect;
}

/**
 * Character boxes drawn over the open image, each with its name. Clicking a box opens a menu to
 * name the face, put it in another character, or say it is not the character it was grouped in.
 */
export function CharacterBoxes({ mediaId, imgRef }: { mediaId: number; imgRef: RefObject<HTMLImageElement> }) {
  const detections = useMediaDetections(mediaId);
  const rect = usePictureRect(imgRef, mediaId);
  const [openId, setOpenId] = useState<number | null>(null);
  useEffect(() => setOpenId(null), [mediaId]);
  if (!rect || !detections?.length) return null;
  const open = detections.find((d) => d.id === openId) ?? null;

  return (
    <div
      className="pointer-events-none absolute z-10"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      {detections.map((d) => {
        const known = d.assignment !== 'rejected' && d.characterId !== null;
        const named = known && d.characterName !== null;
        return (
          <button
            type="button"
            key={d.id}
            onClick={() => setOpenId(openId === d.id ? null : d.id)}
            aria-label={`Character: ${characterLabelText({ name: d.characterName, displayName: d.characterDisplayName }, 'Unknown')}`}
            className={`group pointer-events-auto absolute cursor-pointer rounded-[6px] border-2 shadow-[0_0_0_1px_rgba(0,0,0,0.45)] transition-colors ${
              openId === d.id
                ? 'border-white bg-white/10'
                : named
                  ? 'border-white/75 hover:border-white hover:bg-white/5'
                  : 'border-dashed border-white/55 hover:border-white hover:bg-white/5'
            }`}
            style={{
              left: `${d.bbox.x * 100}%`,
              top: `${d.bbox.y * 100}%`,
              width: `${d.bbox.w * 100}%`,
              height: `${d.bbox.h * 100}%`,
            }}
          >
            <span
              className={`absolute left-1 top-1 max-w-[calc(100%-8px)] truncate rounded-[4px] bg-zinc-950/85 px-1.5 py-0.5 text-left text-[11px] font-semibold leading-tight ${
                named ? 'text-zinc-100' : 'text-zinc-400'
              }`}
            >
              {named
                ? characterLabelText({ name: d.characterName, displayName: d.characterDisplayName })
                : known
                  ? 'Unnamed'
                  : 'Unknown'}
            </span>
          </button>
        );
      })}
      {open && <BoxMenu detection={open} rect={rect} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function BoxMenu({ detection, rect, onClose }: { detection: CharacterDetection; rect: Rect; onClose: () => void }) {
  const name = useNameDetection(onClose);
  const reject = useRejectDetection(onClose);
  const assigned = detection.assignment !== 'rejected' && detection.characterId !== null;
  const label = assigned
    ? characterLabelText({ name: detection.characterName, displayName: detection.characterDisplayName })
    : 'Unknown';

  // Capture phase, so Escape closes this menu and not the whole viewer behind it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const boxBottom = (detection.bbox.y + detection.bbox.h) * rect.height;
  const below = rect.height - boxBottom > 200 || detection.bbox.y * rect.height < 200;
  const left = clampLeft(detection.bbox.x * rect.width, MENU_WIDTH, rect.width);

  return (
    <>
      <div className="pointer-events-auto fixed inset-0 z-20" onClick={onClose} />
      <div
        style={{
          width: MENU_WIDTH,
          left,
          ...(below
            ? { top: Math.min(boxBottom + 6, rect.height - 8) }
            : { bottom: rect.height - detection.bbox.y * rect.height + 6 }),
        }}
        className="pointer-events-auto absolute z-30 rounded-lg border border-line-strong bg-zinc-900 p-2 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          <Crop url={detection.cropUrl} alt="" className="h-10 w-8 flex-none !rounded-[6px]" />
          <div className="min-w-0 flex-1">
            <div className={`truncate text-[13px] font-semibold ${assigned && detection.characterName ? 'text-zinc-100' : 'text-zinc-400'}`}>
              {label}
            </div>
            {assigned && (
              <Link
                to={`/characters/${detection.characterId}`}
                className="flex items-center text-[11.5px] font-semibold text-zinc-500 hover:text-zinc-200"
              >
                Open character
                <ChevronRight size={12} />
              </Link>
            )}
          </div>
        </div>
        <NamePicker
          inline
          busy={name.isPending}
          excludeId={assigned ? detection.characterId! : undefined}
          placeholder={assigned && detection.characterName ? 'Someone else? Type a name' : 'Name or pick a character'}
          onPick={(option) => name.mutate({ detection, option })}
          onCancel={onClose}
        />
        {assigned && (
          <button
            type="button"
            disabled={reject.isPending}
            onClick={() => reject.mutate(detection)}
            className="mt-1.5 flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-zinc-300 hover:bg-white/5 hover:text-zinc-100 disabled:opacity-40"
          >
            <UserX size={13} className="text-zinc-500" />
            Not {label}
          </button>
        )}
      </div>
    </>
  );
}
