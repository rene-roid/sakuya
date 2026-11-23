import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Eye, EyeOff, ImageIcon, Merge, Pencil, Star, UserX } from 'lucide-react';
import type { CharacterDetection, CharacterSummary } from '@sakuya/shared';
import { api, ApiError } from '../lib/api';
import { characterLabelText, characterTag } from '../lib/characters';
import { TagName, TagRenameInput } from '../components/TagName';
import { Segmented } from '../components/Segmented';
import { MediaGrid } from '../components/MediaGrid';
import { MediaViewer } from '../components/MediaViewer';
import { toast, toastError } from '../components/Toast';
import { Crop, invalidateCharacters, NamePicker } from '../components/characters/NamePicker';
import { useNameCharacter, useRejectDetection } from '../components/characters/actions';
import { MergeDialog } from '../components/characters/MergeDialog';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const buttonClass =
  'flex cursor-pointer items-center gap-1.5 rounded-btn border border-line px-2.5 py-1 text-[12px] font-semibold text-zinc-300 hover:border-line-strong hover:text-zinc-100 disabled:opacity-40';

/** One character: its faces to curate and the media it appears in. */
export function Character() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'media' | 'faces'>('media');
  const [editing, setEditing] = useState(false);
  const [pickingCover, setPickingCover] = useState(false);
  const [merging, setMerging] = useState(false);

  const { data: character, error } = useQuery({
    queryKey: ['character', id],
    queryFn: () => api.character(id),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });

  const name = useNameCharacter(() => setEditing(false));
  const hide = useMutation({
    mutationFn: (hidden: boolean) => api.setCharacterHidden(id, hidden),
    onSuccess: (c) => {
      toast(c.hidden ? `Hid ${characterLabelText(c)}` : `${characterLabelText(c)} is shown again`);
      invalidateCharacters(qc);
    },
    onError: toastError,
  });
  const cover = useMutation({
    mutationFn: (detectionId: number) => api.setCharacterCover(id, detectionId),
    onSuccess: () => {
      toast('Cover set');
      setPickingCover(false);
      invalidateCharacters(qc);
    },
    onError: toastError,
  });

  if (error) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 pt-6 sm:px-8">
        <BackLink />
        <div className="mt-3 text-[13px] text-zinc-500">
          {error instanceof ApiError && error.status === 404
            ? 'This character no longer exists. It may have been merged into another one.'
            : error.message}
        </div>
      </div>
    );
  }
  if (!character) return null;

  const tag = characterTag(character);
  const label = characterLabelText(character);

  return (
    <div className="fade-in mx-auto max-w-[1400px] px-4 pb-16 pt-4 sm:px-8">
      <BackLink />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-3">
        <Crop url={character.coverUrl} alt={label} className="h-[72px] w-[58px] flex-none" />
        <div className="min-w-0 flex-1 basis-[200px]">
          {editing ? (
            tag ? (
              <TagRenameInput
                tag={tag}
                onDone={() => {
                  setEditing(false);
                  invalidateCharacters(qc);
                }}
                className="w-full max-w-[320px] !text-[15px]"
              />
            ) : (
              <div className="max-w-[320px]">
                <NamePicker
                  busy={name.isPending}
                  excludeId={id}
                  onPick={(option) => name.mutate({ id, option })}
                  onCancel={() => setEditing(false)}
                />
              </div>
            )
          ) : (
            <h1 className="m-0 flex min-w-0 items-center gap-2 text-[22px] font-extrabold glass:text-[24px] glass:font-semibold">
              {tag ? <TagName tag={tag} /> : <span className="text-zinc-400">Unnamed</span>}
              {character.hidden && (
                <span className="flex-none rounded-md border border-line px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.4px] text-zinc-500">
                  Hidden
                </span>
              )}
            </h1>
          )}
          <div className="mt-0.5 text-[13px] text-zinc-500">
            {plural(character.mediaCount, 'item')} · {plural(character.detectionCount, 'face')}
            {tag && (
              <>
                {' · '}
                <span className="font-mono text-[12px] text-zinc-600">{tag.name}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={buttonClass} onClick={() => setEditing(true)}>
            <Pencil size={13} />
            {tag ? 'Rename' : 'Name'}
          </button>
          <button
            type="button"
            className={`${buttonClass} ${pickingCover ? '!border-accent !text-zinc-100' : ''}`}
            onClick={() => {
              setPickingCover((v) => !v);
              setTab('faces');
            }}
          >
            <Star size={13} />
            {pickingCover ? 'Pick a face…' : 'Set cover'}
          </button>
          <button type="button" className={buttonClass} onClick={() => setMerging(true)}>
            <Merge size={13} />
            Merge
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={hide.isPending}
            onClick={() => hide.mutate(!character.hidden)}
          >
            {character.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
            {character.hidden ? 'Unhide' : 'Hide'}
          </button>
          {tag && (
            <Link to={`/explore?tags=${encodeURIComponent(tag.name)}`} className={buttonClass}>
              <ImageIcon size={13} />
              Explore
            </Link>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Segmented
          options={[
            { key: 'media', label: `Media ${character.mediaCount}` },
            { key: 'faces', label: `Faces ${character.detectionCount}` },
          ]}
          value={tab}
          onChange={(key) => {
            setTab(key);
            if (key === 'media') setPickingCover(false);
          }}
        />
        {pickingCover && <span className="text-[12.5px] text-zinc-400">Click the face to use as the cover.</span>}
      </div>

      <div className="mt-3">
        {tab === 'media' ? (
          <CharacterMedia id={id} />
        ) : (
          <Faces
            character={character}
            pickingCover={pickingCover}
            onPickCover={(d) => cover.mutate(d.id)}
          />
        )}
      </div>

      {merging && (
        <MergeDialog
          character={character}
          onClose={() => setMerging(false)}
          onMerged={(into) => {
            setMerging(false);
            navigate(`/characters/${into.id}`, { replace: true });
          }}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/characters" className="inline-flex items-center gap-0.5 text-[12.5px] font-semibold text-zinc-500 hover:text-zinc-200">
      <ChevronLeft size={15} />
      Characters
    </Link>
  );
}

function CharacterMedia({ id }: { id: number }) {
  const [viewerId, setViewerId] = useState<number | null>(null);
  const query = useInfiniteQuery({
    queryKey: ['character-media', id],
    queryFn: ({ pageParam }) => api.characterMedia(id, pageParam, 60),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  return (
    <>
      <MediaGrid
        items={items}
        hasNextPage={!!query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        fetchNextPage={query.fetchNextPage}
        isLoading={query.isLoading}
        onOpen={(index) => setViewerId(items[index].id)}
      />
      {viewerId !== null && (
        <MediaViewer
          items={items}
          itemId={viewerId}
          onItemChange={setViewerId}
          onClose={() => setViewerId(null)}
          onNearEnd={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        />
      )}
    </>
  );
}

function Faces({
  character,
  pickingCover,
  onPickCover,
}: {
  character: CharacterSummary;
  pickingCover: boolean;
  onPickCover: (d: CharacterDetection) => void;
}) {
  const query = useInfiniteQuery({
    queryKey: ['character-faces', character.id],
    queryFn: ({ pageParam }) => api.characterDetections(character.id, pageParam, 120),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });
  const reject = useRejectDetection();
  const faces = query.data?.pages.flatMap((p) => p.items) ?? [];
  if (query.isLoading) return null;
  if (!faces.length) return <div className="text-[13px] text-zinc-500">No faces left in this character.</div>;
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(100px,1fr))]">
        {faces.map((face) => (
          <FaceTile
            key={face.id}
            face={face}
            isCover={face.id === character.coverDetectionId}
            pickingCover={pickingCover}
            onPickCover={() => onPickCover(face)}
            onReject={() => reject.mutate(face)}
            busy={reject.isPending && reject.variables?.id === face.id}
          />
        ))}
      </div>
      {query.hasNextPage && (
        <button
          type="button"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
          className={`${buttonClass} mx-auto mt-4`}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Show more faces'}
        </button>
      )}
    </>
  );
}

function FaceTile({
  face,
  isCover,
  pickingCover,
  onPickCover,
  onReject,
  busy,
}: {
  face: CharacterDetection;
  isCover: boolean;
  pickingCover: boolean;
  onPickCover: () => void;
  onReject: () => void;
  busy: boolean;
}): ReactNode {
  return (
    <div
      className={`group relative min-w-0 ${busy ? 'opacity-40' : ''} ${pickingCover ? 'cursor-pointer' : ''}`}
      onClick={pickingCover ? onPickCover : undefined}
    >
      <Crop
        url={face.cropUrl}
        alt=""
        className={`aspect-[4/5] ${pickingCover ? 'ring-2 ring-transparent hover:ring-accent' : ''} ${
          isCover ? 'ring-2 !ring-zinc-300' : ''
        }`}
      />
      {isCover && (
        <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded-md bg-zinc-950/80 px-1 py-0.5 text-[10px] font-bold text-zinc-200">
          <Star size={10} />
          Cover
        </span>
      )}
      {!pickingCover && (
        <button
          type="button"
          disabled={busy}
          onClick={onReject}
          title="Not this character"
          aria-label="Not this character"
          className="absolute bottom-1 right-1 flex cursor-pointer items-center gap-1 rounded-md bg-zinc-950/85 px-1.5 py-1 text-[11px] font-semibold text-zinc-200 opacity-100 hover:bg-zinc-900 hover:text-white md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
        >
          <UserX size={12} />
          <span className="max-sm:hidden">Not this</span>
        </button>
      )}
    </div>
  );
}
