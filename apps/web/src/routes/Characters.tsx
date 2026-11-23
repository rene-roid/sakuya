import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, EyeOff, ScanFace, X } from 'lucide-react';
import type { CharacterModelStatus, CharacterSummary, Job, TagCount } from '@sakuya/shared';
import { api } from '../lib/api';
import { characterLabelText, characterTag } from '../lib/characters';
import { useJobs } from '../hooks/useJobs';
import { settingHref } from './settings/registry';
import { ProgressBar } from './settings/JobHistory';
import { TagName } from '../components/TagName';
import { toast, toastError } from '../components/Toast';
import { Crop, invalidateCharacters, NamePicker } from '../components/characters/NamePicker';
import { useNameCharacter } from '../components/characters/actions';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function useCharacterJob(): Job | undefined {
  return useJobs().find((j) => j.type === 'characters' && (j.status === 'running' || j.status === 'queued'));
}

export function useCharacterStatus(polling: boolean) {
  return useQuery({
    queryKey: ['character-status'],
    queryFn: api.characterStatus,
    refetchInterval: (query) => (polling || query.state.data?.status === 'downloading' ? 3000 : false),
  }).data;
}

/** Characters the library knows: named, suggested and unnamed clusters, and tags with no cluster yet. */
export function Characters() {
  const qc = useQueryClient();
  const job = useCharacterJob();
  const status = useCharacterStatus(!!job);
  const [showHidden, setShowHidden] = useState(false);
  const { data } = useQuery({
    queryKey: ['characters', 'all'],
    queryFn: () => api.characters(true),
    refetchInterval: job ? 5000 : false,
  });

  // Characters appear while a scan is still going; once it ends, show its final grouping.
  const hadJob = useRef(false);
  useEffect(() => {
    if (job) hadJob.current = true;
    else if (hadJob.current) {
      hadJob.current = false;
      invalidateCharacters(qc);
    }
  }, [job, qc]);

  const visible = (list: CharacterSummary[] | undefined) => (list ?? []).filter((c) => !c.hidden);
  const named = visible(data?.named);
  const suggested = visible(data?.suggested);
  const unnamed = visible(data?.unnamed);
  const tagOnly = data?.tagOnly ?? [];
  const hidden = [...(data?.named ?? []), ...(data?.suggested ?? []), ...(data?.unnamed ?? [])].filter((c) => c.hidden);
  const empty = data && !named.length && !suggested.length && !unnamed.length && !tagOnly.length;

  const summary = [
    named.length + tagOnly.length && plural(named.length + tagOnly.length, 'named'),
    suggested.length && `${suggested.length} suggested`,
    unnamed.length && `${unnamed.length} unnamed`,
    data?.unassignedCount && `${plural(data.unassignedCount, 'face')} not grouped yet`,
  ].filter(Boolean);

  return (
    <div className="fade-in mx-auto max-w-[1400px] px-4 pb-16 pt-6 sm:px-8">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="m-0 text-[22px] font-extrabold glass:text-[24px] glass:font-semibold">Characters</h1>
        <span className="text-[13px] text-zinc-500">{summary.join(' · ')}</span>
        <div className="ml-auto flex items-center gap-2">
          {hidden.length > 0 && (
            <button
              type="button"
              aria-pressed={showHidden}
              onClick={() => setShowHidden((v) => !v)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-btn border px-2.5 py-1 text-[12px] font-semibold ${
                showHidden ? 'border-line-hover bg-zinc-800 text-zinc-100' : 'border-line text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <EyeOff size={13} />
              {showHidden ? 'Hide hidden' : `Show hidden (${hidden.length})`}
            </button>
          )}
          <ScanButton status={status} job={job} />
        </div>
      </div>

      <StatusPanel status={status} job={job} empty={!!empty} />

      {(named.length > 0 || tagOnly.length > 0) && (
        <Section title="Named" count={named.length + tagOnly.length}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-x-2.5 gap-y-3 sm:grid-cols-[repeat(auto-fill,minmax(132px,1fr))]">
            {named.map((c) => (
              <NamedTile key={c.id} character={c} />
            ))}
            {tagOnly.map((t) => (
              <TagOnlyTile key={t.name} tag={t} />
            ))}
          </div>
        </Section>
      )}

      {suggested.length > 0 && (
        <Section title="Suggested" count={suggested.length}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-x-2.5 gap-y-3 sm:grid-cols-[repeat(auto-fill,minmax(132px,1fr))]">
            {suggested.map((c) => (
              <SuggestedTile key={c.id} character={c} />
            ))}
          </div>
        </Section>
      )}

      {unnamed.length > 0 && (
        <Section title="Unnamed" count={unnamed.length} hint="Click a face to name it. Future matches join that character.">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-x-2.5 gap-y-3 sm:grid-cols-[repeat(auto-fill,minmax(112px,1fr))]">
            {unnamed.map((c) => (
              <UnnamedTile key={c.id} character={c} />
            ))}
          </div>
        </Section>
      )}

      {showHidden && hidden.length > 0 && (
        <Section title="Hidden" count={hidden.length} hint="Hidden characters keep their tags.">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-x-2.5 gap-y-3 sm:grid-cols-[repeat(auto-fill,minmax(112px,1fr))]">
            {hidden.map((c) => (
              <NamedTile key={c.id} character={c} muted />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, count, hint, children }: { title: string; count: number; hint?: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <h2 className="m-0 text-[12px] font-bold uppercase tracking-[0.4px] text-zinc-400">{title}</h2>
        <span className="text-[12px] text-zinc-600">{count}</span>
        {hint && <span className="text-[12px] text-zinc-500 max-sm:basis-full">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function ScanButton({ status, job }: { status: CharacterModelStatus | undefined; job: Job | undefined }) {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: api.characterRun,
    onSuccess: () => {
      toast('Looking for characters…');
      qc.invalidateQueries({ queryKey: ['character-status'] });
    },
    onError: toastError,
  });
  if (!status?.enabled || status.status !== 'ready' || job || status.pendingCount === 0) return null;
  return (
    <button
      type="button"
      disabled={run.isPending}
      onClick={() => run.mutate()}
      className="flex cursor-pointer items-center gap-1.5 rounded-btn bg-zinc-800 px-2.5 py-1 text-[12px] font-semibold text-zinc-100 hover:bg-zinc-700 disabled:opacity-50 glass:bg-white/12 glass:hover:bg-white/18"
    >
      <ScanFace size={13} />
      Scan {plural(status.pendingCount, 'new file')}
    </button>
  );
}

function Notice({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-panel border border-line bg-surface px-4 py-3 text-[13px] text-zinc-300 glass:bg-white/[0.03]">
      <div className="min-w-0 flex-1 basis-[240px]">{children}</div>
      {action}
    </div>
  );
}

const linkClass = 'text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline';
const actionClass =
  'flex cursor-pointer items-center gap-1.5 rounded-btn bg-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-100 hover:bg-zinc-700 disabled:opacity-50 glass:bg-white/12 glass:hover:bg-white/18';

function StatusPanel({ status, job, empty }: { status: CharacterModelStatus | undefined; job: Job | undefined; empty: boolean }) {
  const qc = useQueryClient();
  const download = useMutation({
    mutationFn: api.characterDownload,
    onSuccess: () => {
      toast('Character model download started');
      qc.invalidateQueries({ queryKey: ['character-status'] });
    },
    onError: toastError,
  });
  if (!status) return null;

  if (job) {
    return (
      <Notice>
        <div className="flex items-center gap-2">
          <ScanFace size={15} className="flex-none text-zinc-500" />
          <span className="truncate">
            {job.status === 'queued'
              ? 'Waiting to look for characters…'
              : job.log || `Looking for characters in ${job.progress}/${job.total} files…`}
          </span>
        </div>
        <ProgressBar job={job} className="mt-2 w-full max-w-[520px]" />
        <div className="mt-1.5 text-[12px] text-zinc-500">Characters show up here while the scan runs.</div>
      </Notice>
    );
  }
  if (!status.enabled) {
    return (
      <Notice
        action={
          <Link to={settingHref('character-detection')} className={actionClass}>
            Open settings
          </Link>
        }
      >
        <div className="font-semibold text-zinc-200">Character detection is off</div>
        <div className="text-[12.5px] text-zinc-500">
          Turn it on in Settings › AI Tagging to find the characters in your images and group each one across
          your library.
          {empty ? '' : ' Characters found earlier stay listed below.'}
        </div>
      </Notice>
    );
  }
  if (status.status !== 'ready') {
    const downloading = status.status === 'downloading';
    return (
      <Notice
        action={
          <button
            type="button"
            disabled={downloading || download.isPending}
            onClick={() => download.mutate()}
            className={actionClass}
          >
            <Download size={13} />
            {downloading ? 'Downloading…' : 'Download'}
          </button>
        }
      >
        <div className="font-semibold text-zinc-200">
          {downloading ? 'Downloading the character models…' : 'The character models are not downloaded'}
        </div>
        <div className="text-[12.5px] text-zinc-500">
          A person detector and CCIP, about 195 MB, run on this machine.{' '}
          <Link to={settingHref('character-models')} className={linkClass}>
            Model settings
          </Link>
        </div>
      </Notice>
    );
  }
  if (empty) {
    return (
      <Notice>
        <div className="font-semibold text-zinc-200">No characters found yet</div>
        <div className="text-[12.5px] text-zinc-500">
          {status.pendingCount > 0
            ? `${plural(status.pendingCount, 'file')} still to scan. Characters show up here once a scan finds them.`
            : 'The scan found no characters in your images. New files are scanned after each library scan.'}
        </div>
      </Notice>
    );
  }
  return null;
}

function TileText({ children }: { children: ReactNode }) {
  return <div className="mt-1.5 min-w-0 px-0.5">{children}</div>;
}

function Count({ n }: { n: number }) {
  return <div className="truncate text-[11.5px] text-zinc-500">{plural(n, 'item')}</div>;
}

function NamedTile({ character, muted }: { character: CharacterSummary; muted?: boolean }) {
  const tag = characterTag(character);
  return (
    <Link to={`/characters/${character.id}`} className={`group min-w-0 ${muted ? 'opacity-60 hover:opacity-100' : ''}`}>
      <Crop
        url={character.coverUrl}
        alt={characterLabelText(character)}
        className="aspect-[4/5] transition-[filter] group-hover:brightness-110"
      />
      <TileText>
        <div className="flex text-[12.5px] font-semibold text-zinc-200">
          {tag ? <TagName tag={tag} /> : <span className="truncate text-zinc-400">Unnamed</span>}
        </div>
        <Count n={character.mediaCount} />
      </TileText>
    </Link>
  );
}

function TagOnlyTile({ tag }: { tag: TagCount }) {
  return (
    <Link
      to={`/explore?tags=${encodeURIComponent(tag.name)}`}
      title="Tagged by the AI tagger; no face of it has been grouped yet"
      className="group min-w-0"
    >
      <Crop url={null} alt="" className="aspect-[4/5] border border-dashed border-line" />
      <TileText>
        <div className="flex text-[12.5px] font-semibold text-zinc-200">
          <TagName tag={tag} />
        </div>
        <Count n={tag.count} />
      </TileText>
    </Link>
  );
}

function SuggestedTile({ character }: { character: CharacterSummary }) {
  const qc = useQueryClient();
  const suggestion = character.suggestion!;
  const tag = { name: suggestion.tag, category: 'character' as const, displayName: suggestion.displayName };
  const accept = useMutation({
    mutationFn: () => api.acceptCharacterSuggestion(character.id),
    onSuccess: (named) => {
      toast(`Named ${characterLabelText(named)}`);
      invalidateCharacters(qc);
    },
    onError: toastError,
  });
  const dismiss = useMutation({
    mutationFn: () => api.dismissCharacterSuggestion(character.id),
    onSuccess: () => invalidateCharacters(qc),
    onError: toastError,
  });
  const busy = accept.isPending || dismiss.isPending;
  return (
    <div className="min-w-0">
      <Link to={`/characters/${character.id}`} className="group block">
        <Crop url={character.coverUrl} alt="" className="aspect-[4/5] transition-[filter] group-hover:brightness-110" />
      </Link>
      <TileText>
        <div className="flex min-w-0 items-baseline gap-1 text-[12.5px] text-zinc-400">
          <span className="flex-none">Is this</span>
          <span className="flex min-w-0 font-semibold text-zinc-100">
            <TagName tag={tag} />
          </span>
          <span className="flex-none">?</span>
        </div>
        <div className="mt-1 flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => accept.mutate()}
            className="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-btn border border-line py-1 text-[11.5px] font-semibold text-zinc-200 hover:border-line-strong hover:text-zinc-100 disabled:opacity-40"
          >
            <Check size={12} />
            Yes
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => dismiss.mutate()}
            aria-label="Not this character"
            title="No, leave it unnamed"
            className="flex cursor-pointer items-center justify-center rounded-btn border border-line px-2 text-zinc-400 hover:border-line-strong hover:text-zinc-200 disabled:opacity-40"
          >
            <X size={12} />
          </button>
        </div>
      </TileText>
    </div>
  );
}

function UnnamedTile({ character }: { character: CharacterSummary }) {
  const [naming, setNaming] = useState(false);
  const name = useNameCharacter(() => setNaming(false));
  return (
    <div className="min-w-0">
      <button type="button" onClick={() => setNaming(true)} className="group block w-full cursor-pointer" title="Name this character">
        <Crop url={character.coverUrl} alt="" className="aspect-[4/5] transition-[filter] group-hover:brightness-110" />
      </button>
      <TileText>
        {naming ? (
          <NamePicker
            busy={name.isPending}
            excludeId={character.id}
            placeholder="Add a name"
            onPick={(option) => name.mutate({ id: character.id, option })}
            onCancel={() => setNaming(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="block w-full cursor-pointer truncate text-left text-[12.5px] font-semibold text-zinc-500 hover:text-zinc-200"
          >
            Add a name
          </button>
        )}
        <Link to={`/characters/${character.id}`} className="block truncate text-[11.5px] text-zinc-500 hover:text-zinc-300">
          {plural(character.mediaCount, 'item')} ›
        </Link>
      </TileText>
    </div>
  );
}

