import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { Media } from '@sakuya/shared';
import type { BulkRenameItem } from '@sakuya/shared';
import { buildRenamePlan, planStats, DEFAULT_RENAME_OPTIONS, type RenameOptions } from '../lib/bulkRename';
import { BulkConfirmDialog, type BulkChangeRow } from './BulkConfirmDialog';

function segStyle(active: boolean): string {
  return `cursor-pointer rounded-md px-[13px] py-1.5 text-[12.5px] font-semibold ${
    active ? 'bg-accent text-white' : 'text-zinc-400 hover:text-zinc-200'
  }`;
}

const inputClass =
  'w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-[12.5px] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-600';

/**
 * Bulk rename with a live preview. The preview rows and the payload come from the same
 * `buildRenamePlan` call, so the confirmation is a faithful picture of what will be applied;
 * the server re-validates and can still reject a row (e.g. a name taken by an unselected file).
 */
export function BulkRenameDialog({
  selected,
  busy,
  onApply,
  onCancel,
}: {
  selected: Media[];
  busy?: boolean;
  onApply: (items: BulkRenameItem[]) => void;
  onCancel: () => void;
}) {
  const [opts, setOpts] = useState<RenameOptions>(DEFAULT_RENAME_OPTIONS);
  const [confirming, setConfirming] = useState(false);

  const plan = useMemo(
    () => buildRenamePlan(selected.map((m) => ({ id: m.id, filename: m.filename, path: m.path, createdAt: m.createdAt })), opts),
    [selected, opts],
  );
  const stats = planStats(plan);
  const set = (patch: Partial<RenameOptions>) => setOpts((prev) => ({ ...prev, ...patch }));

  if (confirming) {
    const changed = plan.filter((row) => row.changed || row.error);
    const rows: BulkChangeRow[] = changed.map((row) => ({
      id: row.id,
      label: row.from,
      detail: (
        <span className="inline-flex items-center gap-1">
          <ArrowRight size={10} className="flex-none text-zinc-600" />
          <span className="text-zinc-300">{row.to}</span>
        </span>
      ),
      warning: row.error,
    }));
    return (
      <BulkConfirmDialog
        title={`Rename ${stats.changed} file${stats.changed === 1 ? '' : 's'}?`}
        summary={
          <span>
            {stats.changed} of {selected.length} selected file{selected.length === 1 ? '' : 's'} will be renamed on
            disk. Files whose name doesn't change are left alone.
          </span>
        }
        rows={rows}
        confirmLabel="Rename files"
        busy={busy}
        onConfirm={() =>
          onApply(plan.filter((row) => row.changed && !row.error).map((row) => ({ id: row.id, filename: row.to })))
        }
        onCancel={() => setConfirming(false)}
      />
    );
  }

  return (
    <div
      className="fade-in fixed inset-0 z-[95] flex items-center justify-center bg-zinc-950/80 p-6 backdrop-blur"
      onClick={onCancel}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-[600px] flex-col rounded-xl border border-zinc-800 bg-[#111113] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-[15px] font-bold">Rename {selected.length} files</div>

        <div className="mb-3 flex w-fit rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
          <div className={segStyle(opts.mode === 'pattern')} onClick={() => set({ mode: 'pattern' })}>
            Pattern
          </div>
          <div className={segStyle(opts.mode === 'replace')} onClick={() => set({ mode: 'replace' })}>
            Find &amp; replace
          </div>
        </div>

        {opts.mode === 'pattern' ? (
          <>
            <div className="flex gap-2">
              <input
                autoFocus
                value={opts.pattern}
                onChange={(e) => set({ pattern: e.target.value })}
                placeholder="{name}{ext}"
                className={inputClass}
              />
              <div className="flex flex-none items-center gap-1.5">
                <span className="text-[11.5px] text-zinc-500">Start at</span>
                <input
                  type="number"
                  min={0}
                  value={opts.startAt}
                  onChange={(e) => set({ startAt: Number(e.target.value) || 0 })}
                  className="w-[68px] rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 text-[12.5px] text-zinc-100 outline-none focus:border-zinc-600"
                />
              </div>
            </div>
            <div className="mt-1.5 text-[11.5px] text-zinc-500">
              <code className="text-zinc-400">{'{name}'}</code> original name ·{' '}
              <code className="text-zinc-400">{'{ext}'}</code> extension ·{' '}
              <code className="text-zinc-400">{'{n}'}</code> counter (
              <code className="text-zinc-400">{'{n:3}'}</code> pads to 001) ·{' '}
              <code className="text-zinc-400">{'{date}'}</code> date added
            </div>
          </>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                autoFocus
                value={opts.find}
                onChange={(e) => set({ find: e.target.value })}
                placeholder="Find…"
                className={inputClass}
              />
              <input
                value={opts.replace}
                onChange={(e) => set({ replace: e.target.value })}
                placeholder="Replace with…"
                className={inputClass}
              />
            </div>
            <label className="mt-2 flex w-fit cursor-pointer items-center gap-1.5 text-[11.5px] text-zinc-400">
              <input
                type="checkbox"
                checked={opts.useRegex}
                onChange={(e) => set({ useRegex: e.target.checked })}
                className="accent-accent"
              />
              Regular expression (use $1 for capture groups)
            </label>
          </>
        )}

        <div className="mb-1.5 mt-4 flex items-baseline justify-between">
          <div className="text-xs font-bold tracking-[0.4px] text-zinc-500">PREVIEW</div>
          <div className="text-[11.5px] text-zinc-500">
            {stats.changed} renamed
            {stats.errors > 0 && <span className="text-rose-400"> · {stats.errors} blocked</span>}
          </div>
        </div>
        <div className="min-h-[120px] flex-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/40">
          {plan.map((row) => (
            <div
              key={row.id}
              className={`flex items-center gap-2 border-b border-zinc-800/60 px-2.5 py-1.5 text-[11.5px] last:border-b-0 ${
                row.error ? 'bg-rose-500/5' : ''
              }`}
            >
              <span className={`min-w-0 flex-1 truncate ${row.changed ? 'text-zinc-500' : 'text-zinc-400'}`}>
                {row.from}
              </span>
              {row.changed && <ArrowRight size={11} className="flex-none text-zinc-600" />}
              {row.changed && (
                <span className={`min-w-0 flex-1 truncate font-semibold ${row.error ? 'text-rose-400' : 'text-zinc-100'}`}>
                  {row.error ?? row.to}
                </span>
              )}
              {!row.changed && <span className="flex-none text-zinc-600">unchanged</span>}
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="cursor-pointer rounded-[7px] border border-zinc-800 px-3.5 py-1.5 text-[12.5px] font-semibold text-zinc-300 hover:text-zinc-100"
          >
            Cancel
          </button>
          <button
            disabled={stats.changed === 0}
            onClick={() => setConfirming(true)}
            className="cursor-pointer rounded-[7px] bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            Review changes
          </button>
        </div>
      </div>
    </div>
  );
}
