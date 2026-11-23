import { useEffect, type RefObject } from 'react';
import { Search, X } from 'lucide-react';
import { SECTIONS, type SettingEntry } from './registry';
import { groupRuns } from './groups';
import { SettingRow, SettingsPanel } from './SettingRow';

const EXAMPLES = ['thumbnail', 'gif', 'volume'];

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function SettingsSearchBox({
  value,
  onChange,
  onEnter,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
  inputRef: RefObject<HTMLInputElement>;
}) {
  // `/` from anywhere on the page, unless it's being typed into a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inputRef]);

  return (
    <div className="relative">
      <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        aria-label="Search settings"
        placeholder="Search settings"
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onChange('');
          } else if (e.key === 'Enter') {
            e.preventDefault();
            onEnter();
          }
        }}
        className="w-full rounded-field border border-line bg-zinc-900 py-[7px] pl-8 pr-8 text-[12.5px] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-line-strong glass:bg-white/[0.04] [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 flex -translate-y-1/2 cursor-pointer text-zinc-500 hover:text-zinc-300"
        >
          <X size={13} />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line px-[5px] font-mono text-[10.5px] text-zinc-500 max-sm:hidden">
          /
        </kbd>
      )}
    </div>
  );
}

export function SettingsSearchResults({
  query,
  terms,
  results,
  onOpen,
  onExample,
}: {
  query: string;
  terms: string[];
  results: SettingEntry[];
  /** Opens a setting in its section. */
  onOpen: (entry: SettingEntry) => void;
  onExample: (query: string) => void;
}) {
  return (
    <div>
      <h2 className="m-0 text-[19px] font-bold glass:text-[20px]">Results</h2>
      <div className="mb-4 mt-0.5 text-[12.5px] text-zinc-500">
        {results.length} setting{results.length === 1 ? '' : 's'} matching “{query.trim()}”
      </div>
      {results.length === 0 && (
        <div className="py-14 text-center text-[13px] text-zinc-500">
          No settings match. Try{' '}
          {EXAMPLES.map((example, i) => (
            <span key={example}>
              <button
                type="button"
                onClick={() => onExample(example)}
                className="cursor-pointer font-semibold text-zinc-300 hover:text-zinc-100 hover:underline"
              >
                “{example}”
              </button>
              {i < EXAMPLES.length - 2 ? ', ' : i === EXAMPLES.length - 2 ? ' or ' : '.'}
            </span>
          ))}
        </div>
      )}
      {groupRuns(results).map((run) => {
        const first = run.entries[0];
        const section = SECTIONS.find((s) => s.id === first.section);
        return (
          <div key={run.key} className="mt-5 first:mt-0">
            <div className="mb-1.5 ml-0.5 flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.5px] text-zinc-500">
              <button
                type="button"
                onClick={() => onOpen(first)}
                className="cursor-pointer text-[11.5px] font-semibold normal-case tracking-normal text-zinc-400 hover:text-zinc-100 hover:underline"
              >
                {section?.label}
              </button>
              <span aria-hidden>›</span>
              <span>{first.group}</span>
            </div>
            <SettingsPanel>
              {run.entries.map((entry) => (
                <SettingRow key={entry.id} entry={entry} terms={terms} inResults />
              ))}
            </SettingsPanel>
          </div>
        );
      })}
    </div>
  );
}
