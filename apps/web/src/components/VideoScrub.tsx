import { useEffect, useRef } from 'react';
import type { Media } from '@sakuya/shared';
import { spriteUrl } from '../lib/api';

/** A pointer only passing over a card on its way elsewhere shouldn't fetch (or make) its sprite. */
const HOVER_INTENT_MS = 120;

interface Sprite {
  url: string;
  frames: number;
  frameW: number;
  frameH: number;
}

async function loadSprite(id: number, version: number | undefined): Promise<Sprite | null> {
  const res = await fetch(spriteUrl(id, version));
  const frames = Number(res.headers.get('X-Sprite-Frames'));
  if (!res.ok || !frames) return null;
  const url = URL.createObjectURL(await res.blob());
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
  return { url, frames, frameW: img.naturalWidth / frames, frameH: img.naturalHeight };
}

/**
 * Hover-scrub for a video card: the pointer's horizontal position picks a frame from the video's
 * sprite, drawn over the still, with a thin line marking the position. Render it inside the card's
 * positioned, clipping container, right after the thumbnail so the badges stay on top. Touch input
 * is ignored, so a tap still just opens the viewer.
 *
 * The sprite is fetched on the first deliberate hover, never on render, so a long grid of videos
 * loads nothing extra while scrolling. Pointer moves write styles directly instead of re-rendering.
 */
export function VideoScrub({ media }: { media: Media }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const enabled = media.type === 'video' && media.sprite?.frames !== 0;
  const { id } = media;
  const version = media.sprite?.version;

  useEffect(() => {
    const layer = layerRef.current;
    const bar = barRef.current;
    const card = layer?.parentElement;
    if (!enabled || !layer || !bar || !card) return;
    let sprite: Sprite | null = null;
    let state: 'idle' | 'loading' | 'done' = 'idle';
    let inside = false;
    let x = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const paint = () => {
      if (!sprite || !inside) return;
      const rect = card.getBoundingClientRect();
      const w = layer.clientWidth;
      const h = layer.clientHeight;
      const pos = Math.min(Math.max((x - rect.left) / rect.width, 0), 1);
      const i = Math.min(sprite.frames - 1, Math.floor(pos * sprite.frames));
      // object-fit: cover for one frame of the strip.
      const scale = Math.max(w / sprite.frameW, h / sprite.frameH);
      const dw = sprite.frameW * scale;
      const dh = sprite.frameH * scale;
      layer.style.backgroundImage = `url(${sprite.url})`;
      layer.style.backgroundSize = `${dw * sprite.frames}px ${dh}px`;
      layer.style.backgroundPosition = `${(w - dw) / 2 - i * dw}px ${(h - dh) / 2}px`;
      bar.style.width = `${pos * 100}%`;
      layer.hidden = false;
      bar.hidden = false;
    };

    const load = () => {
      state = 'loading';
      loadSprite(id, version)
        .catch(() => null)
        .then((loaded) => {
          state = 'done';
          if (disposed) {
            if (loaded) URL.revokeObjectURL(loaded.url);
            return;
          }
          sprite = loaded;
          paint();
        });
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      x = e.clientX;
      inside = true;
      if (state === 'idle' && !timer) {
        timer = setTimeout(() => {
          timer = undefined;
          if (inside) load();
        }, HOVER_INTENT_MS);
      }
      paint();
    };
    const onLeave = () => {
      inside = false;
      clearTimeout(timer);
      timer = undefined;
      layer.hidden = true;
      bar.hidden = true;
    };

    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerleave', onLeave);
    return () => {
      disposed = true;
      clearTimeout(timer);
      card.removeEventListener('pointermove', onMove);
      card.removeEventListener('pointerleave', onLeave);
      if (sprite) URL.revokeObjectURL(sprite.url);
    };
  }, [enabled, id, version]);

  if (!enabled) return null;
  return (
    <>
      <div ref={layerRef} hidden aria-hidden className="pointer-events-none absolute inset-0 bg-no-repeat" />
      <div
        ref={barRef}
        hidden
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 z-[1] h-[2px] bg-accent shadow-[0_0_4px_rgba(0,0,0,0.6)]"
      />
    </>
  );
}
