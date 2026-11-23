import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, EyeOff, MoreHorizontal, Sparkles } from 'lucide-react';
import type { DiscoverProfileResponse, Media } from '@sakuya/shared';
import { useDiscoverFeedback } from '../hooks/useDiscoverFeedback';
import { MenuItem } from './Menu';
import { useTagLabelText } from './TagName';

const WIDTH = 210;
const PANEL_HEIGHT = 112;

/**
 * The "⋯" on a Discover card. The panel is portalled to the body: cards sit in clipped shelf rows
 * and in virtualized grid rows that each form their own stacking context, so a panel rendered in
 * place was cut off or drawn under the next row.
 */
export function DiscoverCardMenu({ item }: { item: Media }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { hide, setMode } = useDiscoverFeedback();
  const reasonLabel = useTagLabelText(item.reasonTag);
  const close = () => setAnchor(null);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setAnchor(null);
    };
    const onScroll = () => setAnchor(null);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor]);

  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  const left = anchor ? Math.max(8, Math.min(anchor.right - WIDTH, window.innerWidth - WIDTH - 8)) : 0;
  // Opens upward when a card near the bottom of the screen leaves no room below.
  const top = anchor
    ? anchor.bottom + PANEL_HEIGHT + 12 > window.innerHeight
      ? anchor.top - PANEL_HEIGHT - 6
      : anchor.bottom + 6
    : 0;

  return (
    <>
      <button
        ref={button}
        title="More options"
        aria-label="More options"
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(anchor ? null : button.current!.getBoundingClientRect());
        }}
        className={`flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-md bg-black/55 text-white/90 backdrop-blur transition-opacity hover:bg-black/75 ${
          anchor ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100'
        }`}
      >
        <MoreHorizontal size={15} />
      </button>
      {anchor &&
        createPortal(
          <div onClick={(e) => e.stopPropagation()}>
            <div className="fixed inset-0 z-[90]" onClick={close} />
            <div
              role="menu"
              style={{ top, left, width: WIDTH }}
              className="fixed z-[91] overflow-hidden rounded-lg border border-line-strong bg-zinc-900 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
            >
              <MenuItem icon={<EyeOff size={14} />} label="Not interested" onClick={run(() => hide(item))} />
              {item.reasonTag && (
                <MenuItem
                  icon={<ArrowDown size={14} />}
                  label={`Less of “${reasonLabel}”`}
                  onClick={run(() => {
                    const profile = qc.getQueryData<DiscoverProfileResponse>(['discover-profile']);
                    const previous = profile?.tags.find((t) => t.name === item.reasonTag)?.mode ?? null;
                    setMode(item.reasonTag!, reasonLabel, 'less', previous);
                  })}
                />
              )}
              <MenuItem
                icon={<Sparkles size={14} />}
                label="More like this"
                onClick={run(() => navigate(`/discover?like=${item.id}`))}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
