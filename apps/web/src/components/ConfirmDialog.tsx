import type { ReactNode } from 'react';
import { Modal } from './Modal';

/** Styled confirm/warning modal. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel} className="w-full max-w-[420px] rounded-xl border border-line bg-surface p-5">
      <div className="mb-2 text-[15px] font-bold">{title}</div>
      <div className="mb-4 text-[12.5px] leading-relaxed text-zinc-400">{body}</div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="cursor-pointer rounded-btn border border-line px-3.5 py-1.5 text-[12.5px] font-semibold text-zinc-300 hover:text-zinc-100"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className={`cursor-pointer rounded-btn px-3.5 py-1.5 text-[12.5px] font-semibold text-white ${
            danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-accent hover:opacity-90'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
