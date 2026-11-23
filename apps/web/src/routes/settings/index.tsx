import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { SECTIONS, SETTINGS, resolveSection, settingHref, type SettingEntry, type SettingsSection } from './registry';
import { GroupHeading, SettingRow, SettingsPanel } from './SettingRow';
import { SettingsSearchBox, SettingsSearchResults } from './SettingsSearch';
import { groupRuns } from './groups';
import { queryTerms, searchSettings } from './search';

const FLASH_MS = 1600;

/** A group's rows: plain rows share one panel, `block` entries stand on their own. */
export function GroupBody({ entries, flashId }: { entries: SettingEntry[]; flashId: string | null }) {
  const parts: SettingEntry[][] = [];
  for (const entry of entries) {
    const block = entry.kind === 'custom' && entry.block;
    const last = parts[parts.length - 1];
    if (!block && last && !(last[0].kind === 'custom' && last[0].block)) last.push(entry);
    else parts.push([entry]);
  }
  return (
    <div className="flex flex-col gap-2.5">
      {parts.map((part) =>
        part[0].kind === 'custom' && part[0].block ? (
          <SettingRow key={part[0].id} entry={part[0]} flash={flashId === part[0].id} />
        ) : (
          <SettingsPanel key={part[0].id}>
            {part.map((entry) => (
              <SettingRow key={entry.id} entry={entry} flash={flashId === entry.id} />
            ))}
          </SettingsPanel>
        ),
      )}
    </div>
  );
}

function SectionButton({
  section,
  active,
  count,
  onClick,
}: {
  section: SettingsSection;
  active: boolean;
  /** Matches in this section while searching; null when not searching. */
  count: number | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex flex-none cursor-pointer items-center justify-between gap-2 whitespace-nowrap rounded-lg border px-3 py-[7px] text-left text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent glass:rounded-full glass:px-3.5 glass:transition-colors ${
        active
          ? 'border-line bg-zinc-900 text-zinc-100 glass:border-white/10 glass:bg-white/10 glass:text-white'
          : 'border-transparent text-zinc-400 hover:text-zinc-200 glass:font-medium glass:hover:bg-white/5'
      } ${count === 0 ? 'opacity-35' : ''}`}
    >
      {section.label}
      {!!count && <span className="text-[10.5px] font-semibold text-zinc-500">{count}</span>}
    </button>
  );
}

export function Settings() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const tab = searchParams.get('tab');
  const section = resolveSection(tab);
  const mainRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const terms = queryTerms(query);
  const results = useMemo(() => searchSettings(query), [query]);
  const searching = terms.length > 0;

  // Old bookmarks name tabs that were folded into other sections; rewrite them in place.
  useEffect(() => {
    if (tab && tab !== section.id) navigate(`/settings?tab=${section.id}${location.hash}`, { replace: true });
  }, [tab, section.id, location.hash, navigate]);

  // A #setting-id scrolls its row into view and flashes it; a bare section starts at the top. It
  // runs again when a search ends, since the results stood in for the section until then.
  const hash = decodeURIComponent(location.hash.slice(1));
  useEffect(() => {
    const main = mainRef.current;
    if (!main || searching) return;
    const row = hash ? main.querySelector<HTMLElement>(`[id="${CSS.escape(hash)}"]`) : null;
    if (!row) {
      main.scrollTop = 0;
      return;
    }
    row.scrollIntoView({ block: 'center' });
    setFlashId(hash);
    const timer = setTimeout(() => setFlashId(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [section.id, hash, location.key, searching]);

  // On phones the sections are one scrolling strip; keep the open one in view.
  useEffect(() => {
    const strip = stripRef.current;
    const active = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !active || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollLeft = active.offsetLeft - strip.offsetLeft - 16;
  }, [section.id]);

  // Following any link, a result's included, ends the search.
  useEffect(() => setQuery(''), [location.key]);

  const open = (id: string) => {
    setQuery('');
    navigate(`/settings?tab=${id}`, { replace: true });
  };
  const openSetting = (entry: SettingEntry) => navigate(settingHref(entry.id));
  const entries = SETTINGS.filter((s) => s.section === section.id);

  return (
    <div className="fade-in mx-auto flex h-[calc(100dvh-var(--nav-h)-var(--dock-h))] max-w-[1200px] flex-col gap-3 overflow-hidden px-4 py-5 sm:flex-row sm:gap-8 sm:px-8 sm:py-7">
      <nav aria-label="Settings sections" className="flex flex-none flex-col gap-2 sm:w-[190px]">
        <SettingsSearchBox
          value={query}
          onChange={setQuery}
          onEnter={() => results[0] && openSetting(results[0])}
          inputRef={searchRef}
        />
        <div ref={stripRef} className="scrollbar-hide -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-col sm:gap-0.5 sm:overflow-visible sm:px-0">
          {SECTIONS.map((s, i) => (
            <Fragment key={s.id}>
              {s.group !== SECTIONS[i - 1]?.group && (
                <div className="hidden px-3 pb-1 pt-3 text-[10.5px] font-bold uppercase tracking-[0.5px] text-zinc-500 first:pt-1.5 sm:block">
                  {s.group}
                </div>
              )}
              <SectionButton
                section={s}
                active={!searching && s.id === section.id}
                count={searching ? results.filter((r) => r.section === s.id).length : null}
                onClick={() => open(s.id)}
              />
            </Fragment>
          ))}
        </div>
      </nav>
      <div ref={mainRef} className="scrollbar-hide min-w-0 flex-1 overflow-y-auto pb-16">
        {searching ? (
          <SettingsSearchResults
            query={query}
            terms={terms}
            results={results}
            onOpen={openSetting}
            onExample={(example) => {
              setQuery(example);
              searchRef.current?.focus();
            }}
          />
        ) : (
          <>
            <h2 className="m-0 text-[19px] font-bold glass:text-[20px]">{section.label}</h2>
            <div className="mb-4 mt-0.5 text-[12.5px] text-zinc-500">{section.subtitle}</div>
            {groupRuns(entries).map((run) => (
              <div key={run.key} className="mt-5 first:mt-0">
                <GroupHeading>{run.entries[0].group}</GroupHeading>
                <GroupBody entries={run.entries} flashId={flashId} />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
