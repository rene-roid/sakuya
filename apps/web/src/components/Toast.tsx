import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';

interface ToastAction {
  label: string;
  onClick: () => void;
}

let show: (msg: string, action?: ToastAction) => void = () => {};

/**
 * Shows a toast from anywhere, React or not. Goes nowhere until <Toaster /> has mounted. With an
 * action (an Undo) it stays up longer, long enough to read and reach the button.
 */
export function toast(msg: string, action?: ToastAction) {
  show(msg, action);
}

export const toastError = (err: Error) => toast(err.message);

export function Toaster() {
  const [message, setMessage] = useState<string | null>(null);
  const [action, setAction] = useState<ToastAction | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    show = (msg, next) => {
      setMessage(msg);
      setAction(next ?? null);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setMessage(null), next ? 6000 : 2200);
    };
  }, []);

  // A manual popover sits in the top layer, so the toast shows above an open modal <dialog>. The
  // top layer stacks in opening order: a modal opened since the toast appeared would cover it, so a
  // new message re-opens it on top.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el?.showPopover) return;
    el.popover = 'manual';
    if (el.matches(':popover-open')) {
      if (!document.querySelector('dialog[open]')) return;
      el.hidePopover();
    }
    el.showPopover();
  }, [message]);

  if (!message) return null;
  return (
    <div
      ref={ref}
      className="toast-in fixed inset-auto bottom-[calc(var(--dock-h)+24px)] right-6 z-[100] m-0 flex items-center gap-2.5 overflow-visible rounded-panel border border-line-hover bg-zinc-900 px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
    >
      <Check size={16} className="text-green-500" />
      <span className="text-[13px] text-zinc-200">{message}</span>
      {action && (
        <button
          onClick={() => {
            clearTimeout(timer.current);
            setMessage(null);
            action.onClick();
          }}
          className="ml-1 cursor-pointer rounded-btn px-1.5 py-0.5 text-[13px] font-semibold text-accent hover:bg-white/5"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
