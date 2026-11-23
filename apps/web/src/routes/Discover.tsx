import { useCallback, useState } from 'react';
import { Link, useNavigate, useSearchParams, type NavigateOptions } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, ListChecks, ChevronLeft, Shuffle } from 'lucide-react';
import type { DiscoverShelf, Media } from '@sakuya/shared';
import { api, thumbUrl } from '../lib/api';
import { useDiscoverInfinite } from '../hooks/useMedia';
import { useSelection } from '../hooks/useSelection';
import { MediaGrid } from '../components/MediaGrid';
import { SelectionBar } from '../components/SelectionBar';
import { MediaViewer } from '../components/MediaViewer';
import { toast } from '../components/Toast';
import { Segmented, TYPE_OPTIONS } from '../components/Segmented';
import { useSettings } from '../hooks/useSettings';
import { settingHref } from './settings/registry';
import { TastePanel } from '../components/TastePanel';
import { Shelf } from '../components/Shelf';
import { TagName } from '../components/TagName';

const randomSeed = () => Math.floor(Math.random() * 2 ** 30) + 1;

const PRESETS = [
  { key: 'familiar', label: 'Familiar', value: 0.1, hint: 'Mostly what you already like' },
  { key: 'balanced', label: 'Balanced', value: 0.3, hint: 'Your taste, with some wildcards' },
  { key: 'adventurous', label: 'Adventurous', value: 0.6, hint: 'More wildcards than favourites' },
] as const;
type PresetKey = (typeof PRESETS)[number]['key'];

/** The preset for a ?surprise= value. Links from the slider era carry any number; take the nearest. */
function presetFor(param: string | null) {
  const value = param === null ? NaN : Number(param);
  if (!Number.isFinite(value)) return PRESETS[1];
  return PRESETS.reduce((best, p) => (Math.abs(p.value - value) < Math.abs(best.value - value) ? p : best));
}

const SHELF_TITLES: Record<string, string> = {
  new: 'New since your last visit',
  rediscover: 'Rediscover',
  offbeat: 'Off the beaten path',
};

function ShelfTitle({ id }: { id: string }) {
  if (id.startsWith('like:')) {
    return (
      <span className="flex min-w-0 gap-1.5">
        Because you like <TagName tag={id.slice(5)} />
      </span>
    );
  }
  return <>{SHELF_TITLES[id] ?? id}</>;
}

type ViewerList = { items: Media[]; id: number };

export function Discover() {
  const settings = useSettings();
  const [params, setParams] = useSearchParams();
  const typeParam = params.get('type') === 'image' ? 'image' : params.get('type') === 'video' ? 'video' : 'all';
  const seed = Number(params.get('seed') ?? 1) || 1;
  const preset = presetFor(params.get('surprise'));
  const shelf = params.get('shelf') ?? undefined;
  const likeId = Number(params.get('like')) || null;
  const type = typeParam === 'all' ? undefined : typeParam;

  const feed = useDiscoverInfinite({ type, surprise: preset.value, seed, shelf }, !likeId);
  const shelves = useQuery({
    queryKey: ['discover-shelves', { type, surprise: preset.value, seed }],
    queryFn: () => api.discoverShelves({ type, surprise: preset.value, seed }),
    enabled: !shelf && !likeId && settings?.discover_enabled === '1',
    staleTime: 15_000,
  });
  const selection = useSelection(feed.items, `${typeParam}|${preset.value}|${seed}|${shelf ?? ''}`);
  const [viewerId, setViewerId] = useState<number | null>(null);
  // Shelf tiles and "Surprise me" open their own list in the viewer, outside the feed's.
  const [other, setOther] = useState<ViewerList | null>(null);
  const [luckyPending, setLuckyPending] = useState(false);
  const openShelf = useCallback(
    (s: DiscoverShelf, index: number) => setOther({ items: s.items, id: s.items[index].id }),
    [],
  );

  const update = (fn: (next: URLSearchParams) => void, options?: NavigateOptions) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      fn(next);
      return next;
    }, options);
  const shelfHref = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('shelf', id);
    return `/discover?${next}`;
  };

  const surpriseMe = async () => {
    setLuckyPending(true);
    try {
      // Pure chance: item 0 is the pick, and the rest of the page is the same shuffle waiting
      // behind it if you keep going.
      const res = await api.discover({ type, surprise: 1, seed: randomSeed() });
      if (res.items.length) setOther({ items: res.items, id: res.items[0].id });
      else toast('No media to pick from yet');
    } catch (err) {
      toast(`Failed: ${(err as Error).message}`);
    } finally {
      setLuckyPending(false);
    }
  };

  if (likeId) return <MoreLikeThis id={likeId} />;

  // Reachable by direct URL even while the navbar pill is hidden, so say why it's empty rather
  // than serving a dead page. Engagement tracking keeps running either way.
  if (settings && settings.discover_enabled !== '1') {
    return (
      <div className="fade-in flex flex-col items-center justify-center py-24 text-center">
        <Sparkles size={30} className="mb-3 text-zinc-600" />
        <div className="text-[15px] font-bold text-zinc-300">Discover is turned off</div>
        <div className="mt-1.5 max-w-[420px] text-[12.5px] text-zinc-500">
          Turn it on in Settings to get recommendations built from what you like, watch and linger on.
          Sakuya keeps tracking that either way, so the feed is ready the moment you enable it.
        </div>
        <Link
          to={settingHref('discover-enabled')}
          className="mt-4 cursor-pointer rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-white hover:opacity-90"
        >
          Open Settings
        </Link>
      </div>
    );
  }

  const shelfList = shelves.data?.shelves ?? [];
  return (
    <div className="fade-in">
      <div className="max-w-[1400px] px-4 sm:px-8 pt-6">
        {shelf ? (
          <div className="flex min-w-0 items-baseline gap-2">
            <Link
              to={`/discover?${(() => {
                const next = new URLSearchParams(params);
                next.delete('shelf');
                return next;
              })()}`}
              className="flex flex-none items-center gap-0.5 text-[13px] font-semibold text-zinc-400 hover:text-zinc-100"
            >
              <ChevronLeft size={16} />
              Discover
            </Link>
            <h1 className="m-0 min-w-0 truncate text-[20px] font-extrabold glass:font-semibold">
              <ShelfTitle id={shelf} />
            </h1>
            <span className="flex-none text-[13px] text-zinc-500">{feed.total}</span>
          </div>
        ) : (
          <div className="flex items-baseline gap-3">
            <h1 className="m-0 text-[22px] font-extrabold glass:text-[24px] glass:font-semibold">Discover</h1>
            <span className="text-[13px] text-zinc-500">
              picked from {feed.total} item{feed.total === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </div>
      <div className="sticky top-(--nav-h) z-20 mt-3 border-b border-line bg-bar backdrop-blur transition-transform duration-300 max-md:nav-hidden:-translate-y-[calc(100%+var(--nav-h))] glass:backdrop-blur-2xl">
        <div className="flex flex-wrap items-center gap-2.5 px-4 py-2.5 sm:gap-3 sm:px-8">
          <Segmented
            options={TYPE_OPTIONS}
            value={typeParam}
            onChange={(t) => update((p) => (t === 'all' ? p.delete('type') : p.set('type', t)))}
          />
          <Segmented<PresetKey>
            options={PRESETS.map((p) => ({ key: p.key, label: <span title={p.hint}>{p.label}</span> }))}
            value={preset.key}
            onChange={(key) => update((p) => p.set('surprise', String(PRESETS.find((x) => x.key === key)!.value)))}
          />
          <button
            onClick={() => update((p) => p.set('seed', String(randomSeed())))}
            className="cursor-pointer rounded-btn border border-line px-3 py-[7px] text-[13px] font-semibold text-zinc-400 hover:text-zinc-200"
          >
            Reshuffle
          </button>
          <button
            onClick={surpriseMe}
            disabled={luckyPending}
            title="Open one item picked at random"
            className="flex cursor-pointer items-center gap-1.5 rounded-btn border border-line px-3 py-[7px] text-[13px] font-semibold text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
          >
            <Shuffle size={15} />
            Surprise me
          </button>
          {!selection.active && (
            <button
              onClick={selection.enter}
              title="Select multiple files for bulk actions"
              className="flex cursor-pointer items-center gap-1.5 rounded-btn border border-line px-3 py-[7px] text-[13px] font-semibold text-zinc-400 hover:text-zinc-200"
            >
              <ListChecks size={16} />
              Select
            </button>
          )}
        </div>
      </div>
      <div className="px-4 sm:px-8 pb-16 pt-4">
        {!shelf && (
          <div className="mb-5 flex flex-col gap-4">
            <TastePanel />
            {shelfList.map((s) => (
              <Shelf key={s.id} shelf={s} seeAll={shelfHref(s.id)} onOpen={openShelf} />
            ))}
            {shelfList.length > 0 && (
              <h2 className="m-0 -mb-1.5 text-[13.5px] font-bold text-zinc-100 glass:font-semibold">All picks</h2>
            )}
          </div>
        )}
        <MediaGrid
          items={feed.items}
          hasNextPage={!!feed.hasNextPage}
          isFetchingNextPage={feed.isFetchingNextPage}
          fetchNextPage={feed.fetchNextPage}
          isLoading={feed.isLoading}
          onOpen={(index) => setViewerId(feed.items[index].id)}
          selection={selection}
          discoverMenu
          empty={
            shelf ? (
              <div className="py-16 text-center text-[13px] text-zinc-500">Nothing on this shelf right now.</div>
            ) : undefined
          }
        />
      </div>
      {selection.active && <SelectionBar selection={selection} total={feed.items.length} />}
      {other && (
        <MediaViewer
          items={other.items}
          itemId={other.id}
          onItemChange={(id) => setOther((l) => l && { ...l, id })}
          onClose={() => setOther(null)}
        />
      )}
      {viewerId !== null && (
        <MediaViewer
          items={feed.items}
          itemId={viewerId}
          onItemChange={setViewerId}
          onClose={() => setViewerId(null)}
          onNearEnd={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
        />
      )}
    </div>
  );
}

/** "More like this": items ranked by the tags they share with one item, rarest tags counting most. */
function MoreLikeThis({ id }: { id: number }) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['discover-like', id],
    queryFn: () => api.moreLikeThis(id),
    staleTime: 15_000,
  });
  const [viewerId, setViewerId] = useState<number | null>(null);
  const items = data?.items ?? [];
  return (
    <div className="fade-in">
      <div className="flex max-w-[1400px] items-center gap-3 px-4 pt-6 sm:px-8">
        <button
          onClick={() => navigate(-1)}
          title="Back"
          className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-btn border border-line text-zinc-400 hover:text-zinc-100"
        >
          <ChevronLeft size={17} />
        </button>
        {data && (
          <img
            src={thumbUrl(data.source.id)}
            alt=""
            className="h-10 w-10 flex-none cursor-pointer rounded-media border border-line object-cover"
            onClick={() => setViewerId(data.source.id)}
          />
        )}
        <div className="min-w-0">
          <h1 className="m-0 truncate text-[20px] font-extrabold glass:font-semibold">
            More like {data ? data.source.filename : 'this'}
          </h1>
          <div className="text-[12.5px] text-zinc-500">
            {error
              ? (error as Error).message
              : `${items.length} item${items.length === 1 ? '' : 's'} sharing its tags, rarer tags counting more`}
          </div>
        </div>
      </div>
      <div className="px-4 pb-16 pt-4 sm:px-8">
        <MediaGrid
          items={items}
          hasNextPage={false}
          isFetchingNextPage={false}
          fetchNextPage={() => {}}
          isLoading={isLoading}
          onOpen={(index) => setViewerId(items[index].id)}
          discoverMenu
          empty={
            <div className="py-16 text-center text-[13px] text-zinc-500">
              {error ? 'Nothing to compare against.' : 'No other item shares a tag with this one yet.'}
            </div>
          }
        />
      </div>
      {viewerId !== null && data && (
        <MediaViewer
          items={viewerId === data.source.id ? [data.source, ...items] : items}
          itemId={viewerId}
          onItemChange={setViewerId}
          onClose={() => setViewerId(null)}
        />
      )}
    </div>
  );
}
