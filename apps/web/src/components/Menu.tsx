import { useEffect, type ReactNode } from 'react';
import { Check } from 'lucide-react';

/**
 * Dropdown panel: a click-away layer plus the panel itself, anchored to a `relative` parent.
 * `side` is where the panel goes relative to that parent — 'top' for bars pinned to the bottom
 * of the screen, 'bottom' for anything in a header.
 */
export function MenuPanel({
  side = 'bottom',
  width = 230,
  onClose,
  children,
}: {
  side?: 'top' | 'bottom';
  width?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  // Capture phase, and the event stops here: Escape should dismiss the menu and nothing else.
  // Select mode listens for Escape on window too, and closing a menu must not also throw away
  // the selection underneath it.
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

  return (
    <>
      <div className="fixed inset-0 z-[70]" onClick={onClose} />
      <div
        style={{ width }}
        className={`absolute right-0 z-[71] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)] ${
          side === 'top' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
        }`}
      >
        {children}
      </div>
    </>
  );
}

export function MenuItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon?: ReactNode;
  label: ReactNode;
  /** Marks the chosen option in a group of alternatives. */
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-[12.5px] font-semibold hover:bg-white/5 hover:text-zinc-100 ${
        active ? 'text-zinc-100' : 'text-zinc-300'
      }`}
    >
      {icon !== undefined && <span className="flex-none text-zinc-500">{icon}</span>}
      <span className="flex-1 truncate">{label}</span>
      {active && <Check size={13} className="flex-none text-accent" />}
    </div>
  );
}

/** Section header for a group of related rows. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.6px] text-zinc-600">{children}</div>
  );
}
