import type { ReactNode } from 'react';

/** Styled confirm/warning modal built on the shared overlay pattern. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fade-in fixed inset-0 z-[95] flex items-center justify-center bg-zinc-950/80 p-6 backdrop-blur"
      onClick={onCancel}
    >
      <div
        className="w-[420px] rounded-xl border border-zinc-800 bg-[#111113] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 text-[15px] font-bold">{title}</div>
        <div className="mb-4 text-[12.5px] leading-relaxed text-zinc-400">{body}</div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="cursor-pointer rounded-[7px] border border-zinc-800 px-3.5 py-1.5 text-[12.5px] font-semibold text-zinc-300 hover:text-zinc-100"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`cursor-pointer rounded-[7px] px-3.5 py-1.5 text-[12.5px] font-semibold text-white ${
              danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-accent hover:opacity-90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
