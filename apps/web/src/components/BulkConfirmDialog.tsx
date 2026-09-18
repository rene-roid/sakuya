import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { thumbUrl } from '../lib/api';

/** One line in the confirmation list: what this file is, and what is about to happen to it. */
export interface BulkChangeRow {
  id: number;
  label: string;
  /** The change itself — "→ new-name.jpg", "+2 tags", "removed from Trip". */
  detail?: ReactNode;
  /** Set when the row can't be applied; rendered in red and counted in the header. */
  warning?: string;
}

/** Past this, the list is summarised — a 5000-row DOM list helps nobody and janks the dialog. */
const MAX_ROWS = 200;

/**
 * Confirmation step shared by every bulk action. It always renders the full per-file change
 * list rather than just a count, so a mis-click on "select all" is visible before it is applied
 * rather than after.
 */
export function BulkConfirmDialog({
  title,
  summary,
  rows,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  summary: ReactNode;
  rows: BulkChangeRow[];
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const shown = rows.slice(0, MAX_ROWS);
  const hidden = rows.length - shown.length;
  const blocking = rows.filter((row) => row.warning).length;

  return (
    <div
      className="fade-in fixed inset-0 z-[95] flex items-center justify-center bg-zinc-950/80 p-6 backdrop-blur"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-[560px] flex-col rounded-xl border border-zinc-800 bg-[#111113] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 text-[15px] font-bold">{title}</div>
        <div className="mb-3 text-[12.5px] leading-relaxed text-zinc-400">{summary}</div>

        {blocking > 0 && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300">
            <AlertTriangle size={14} className="mt-px flex-none" />
            <span>
              {blocking} file{blocking === 1 ? '' : 's'} will be skipped — see the highlighted rows below.
            </span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/40">
          {shown.map((row) => (
            <div
              key={row.id}
              className={`flex items-center gap-2.5 border-b border-zinc-800/60 px-2.5 py-1.5 last:border-b-0 ${
                row.warning ? 'bg-rose-500/5' : ''
              }`}
            >
              <img
                src={thumbUrl(row.id)}
                alt=""
                loading="lazy"
                className="h-7 w-7 flex-none rounded border border-zinc-800 object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-semibold text-zinc-200" title={row.label}>
                  {row.label}
                </div>
                {row.warning ? (
                  <div className="truncate text-[11px] text-rose-400">{row.warning}</div>
                ) : (
                  row.detail && <div className="truncate text-[11px] text-zinc-400">{row.detail}</div>
                )}
              </div>
            </div>
          ))}
          {hidden > 0 && (
            <div className="px-2.5 py-2 text-center text-[11.5px] text-zinc-500">
              …and {hidden} more file{hidden === 1 ? '' : 's'}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            disabled={busy}
            onClick={onCancel}
            className="cursor-pointer rounded-[7px] border border-zinc-800 px-3.5 py-1.5 text-[12.5px] font-semibold text-zinc-300 hover:text-zinc-100 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            disabled={busy || rows.length === blocking}
            onClick={onConfirm}
            className={`cursor-pointer rounded-[7px] px-3.5 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-40 ${
              danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-accent hover:opacity-90'
            }`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
