import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { settingHref, type SettingEntry } from './registry';
import { EntryControl } from './controls';
import { highlightSegments } from './search';

/** Text with every query term wrapped in <mark>. */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  return (
    <>
      {highlightSegments(text, terms).map((seg, i) =>
        seg.match ? (
          <mark key={i} className="rounded-[2px] bg-accent/30 text-inherit">
            {seg.text}
          </mark>
        ) : (
          seg.text
        ),
      )}
    </>
  );
}

/** One bordered panel holding a group's rows, separated by dividers. */
export function SettingsPanel({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-panel border border-line bg-surface glass:bg-white/[0.03]">{children}</div>
  );
}

export function GroupHeading({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1.5 ml-0.5 text-[10.5px] font-bold uppercase tracking-[0.5px] text-zinc-500">{children}</div>
  );
}

/**
 * A setting: label and description on the left, its control on the right. A `block` custom entry
 * stands outside the group panel with its content under the label, full width, because its content
 * brings its own cards. In search results it shrinks to a link into its section, so a whole library
 * manager doesn't land in the result list.
 */
export function SettingRow({
  entry,
  terms = [],
  flash,
  inResults,
}: {
  entry: SettingEntry;
  /** Search words to highlight in the label and description. */
  terms?: string[];
  flash?: boolean;
  inResults?: boolean;
}) {
  const block = entry.kind === 'custom' && entry.block;
  const Meta = entry.Meta;
  const text = (
    <div className="min-w-[180px] flex-1">
      <div className="text-[13px] font-semibold text-zinc-100">
        <Highlight text={entry.label} terms={terms} />
      </div>
      <div className="mt-px max-w-[440px] text-[12px] leading-snug text-zinc-500">
        <Highlight text={entry.description} terms={terms} />
      </div>
      {Meta && (
        <div className="mt-1 text-[11.5px] text-zinc-400">
          <Meta />
        </div>
      )}
    </div>
  );

  if (block && !inResults) {
    return (
      <div id={entry.id} data-setting-row className={`scroll-mt-4 rounded-panel ${flash ? 'setting-flash' : ''}`}>
        <div className="mb-2.5 px-0.5">{text}</div>
        <EntryControl entry={entry} />
      </div>
    );
  }

  return (
    <div
      id={entry.id}
      data-setting-row
      className={`flex scroll-mt-4 items-center justify-between gap-4 border-t border-line px-3.5 py-3 first:border-t-0 max-sm:flex-wrap ${
        flash ? 'setting-flash' : ''
      }`}
    >
      {text}
      {block ? (
        <Link
          to={settingHref(entry.id)}
          className="flex-none rounded-btn border border-line px-3 py-[5px] text-[12px] font-semibold text-zinc-300 hover:border-line-strong hover:text-zinc-100"
        >
          Open
        </Link>
      ) : (
        <div className="flex min-w-0 flex-none items-center gap-2 max-sm:ml-auto">
          <EntryControl entry={entry} />
        </div>
      )}
    </div>
  );
}
