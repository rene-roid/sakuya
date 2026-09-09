import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { Media } from '@sakuya/shared';
import { api } from '../lib/api';
import { useDebounce } from '../hooks/useDebounce';
import { useDiscoverInfinite } from '../hooks/useMedia';
import { MediaGrid } from '../components/MediaGrid';
import { MediaViewer } from '../components/MediaViewer';
import { useToast } from '../components/Toast';

function segStyle(active: boolean): string {
  return `cursor-pointer rounded-md px-[13px] py-1.5 text-[12.5px] font-semibold ${
    active ? 'bg-accent text-white' : 'text-zinc-400 hover:text-zinc-200'
  }`;
}

const randomSeed = () => Math.floor(Math.random() * 2 ** 30) + 1;

/** Plain-language reading of the slider, so the number isn't the only clue to direction. */
function surpriseLabel(value: number): string {
  if (value === 0) return 'Only things I already like';
  if (value <= 0.2) return 'Mostly my taste';
  if (value <= 0.45) return 'My taste, with some wildcards';
  if (value <= 0.7) return 'An even mix';
  if (value < 1) return 'Mostly wildcards';
  return 'Pure chance';
}

export function Discover() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  const [params, setParams] = useSearchParams();
  const typeParam = params.get('type') === 'image' ? 'image' : params.get('type') === 'video' ? 'video' : 'all';
  const seed = Number(params.get('seed') ?? 1) || 1;
  const showToast = useToast();

  // The slider thumb has to track the pointer at 60fps; the feed only refetches once it settles.
  const [surprise, setSurprise] = useState(() => Number(params.get('surprise') ?? 0.25));
  const debouncedSurprise = useDebounce(surprise, 300);

  const feed = useDiscoverInfinite({
    type: typeParam === 'all' ? undefined : typeParam,
    surprise: debouncedSurprise,
    seed,
  });
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // "I'm feeling lucky" opens its pick outside the feed's list, on a max-surprise run of its own
  // so you can keep paging past the first pick instead of being stuck on one item.
  const [lucky, setLucky] = useState<{ items: Media[]; index: number } | null>(null);
  const [luckyPending, setLuckyPending] = useState(false);

  const update = (fn: (next: URLSearchParams) => void) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      fn(next);
      return next;
    });

  const feelLucky = async () => {
    setLuckyPending(true);
    try {
      // The slider pushed all the way over: item 0 is the single pick you asked for, and the rest
      // of the page is the same max-surprise shuffle waiting behind it if you keep going.
      const res = await api.discover({
        type: typeParam === 'all' ? undefined : typeParam,
        surprise: 1,
        seed: randomSeed(),
      });
      if (res.items.length) setLucky({ items: res.items, index: 0 });
      else showToast('No media to pick from yet');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`);
    } finally {
      setLuckyPending(false);
    }
  };

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
          to="/settings?tab=behavior"
          className="mt-4 cursor-pointer rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-white hover:opacity-90"
        >
          Open Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="max-w-[1400px] px-4 sm:px-8 pt-6">
        <div className="mb-1 flex items-baseline gap-3">
          <h1 className="m-0 text-[22px] font-extrabold">Discover</h1>
          <span className="text-[13px] text-zinc-500">
            picked from {feed.total} item{feed.total === 1 ? '' : 's'}
          </span>
        </div>
        <div className="text-[13px] text-zinc-500">
          Built from what you like, watch and linger on. Cards show the tag that earned them a spot.
        </div>
      </div>
      <div className="sticky top-[60px] z-20 mt-3.5 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="flex flex-wrap items-center gap-4 px-4 sm:px-8 py-3">
          <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
            {(['all', 'image', 'video'] as const).map((t) => (
              <div
                key={t}
                className={segStyle(typeParam === t)}
                onClick={() => update((p) => (t === 'all' ? p.delete('type') : p.set('type', t)))}
              >
                {t === 'all' ? 'All' : t === 'image' ? 'Images' : 'Videos'}
              </div>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <div className="flex items-center gap-2.5">
              <span className="text-[12.5px] font-semibold text-zinc-400">Surprise</span>
              <span className="text-[12.5px] font-semibold text-accent">{surpriseLabel(surprise)}</span>
              <span className="text-[11.5px] text-zinc-600">{Math.round(surprise * 100)}% random</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10.5px] font-semibold text-zinc-500">My taste</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={surprise}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  setSurprise(value);
                  update((p) => p.set('surprise', String(value)));
                }}
                className="w-[150px] cursor-pointer"
                title="Left: only what matches your taste. Right: pure chance."
              />
              <span className="text-[10.5px] font-semibold text-zinc-500">Random</span>
            </div>
          </label>
          <button
            onClick={feelLucky}
            disabled={luckyPending}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-accent/40 px-3 py-[7px] text-[13px] font-semibold text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            <Sparkles size={16} />
            I'm feeling lucky
          </button>
          <button
            onClick={() => update((p) => p.set('seed', String(randomSeed())))}
            className="cursor-pointer rounded-lg border border-zinc-800 px-3 py-[7px] text-[13px] font-semibold text-zinc-400 hover:text-zinc-200"
          >
            Reshuffle
          </button>
        </div>
      </div>
      <div className="px-4 sm:px-8 pb-16 pt-5">
        <MediaGrid
          items={feed.items}
          hasNextPage={!!feed.hasNextPage}
          isFetchingNextPage={feed.isFetchingNextPage}
          fetchNextPage={feed.fetchNextPage}
          isLoading={feed.isLoading}
          onOpen={setViewerIndex}
        />
      </div>
      {lucky && (
        <MediaViewer
          items={lucky.items}
          index={lucky.index}
          onIndexChange={(index) => setLucky((l) => l && { ...l, index })}
          onClose={() => setLucky(null)}
        />
      )}
      {viewerIndex !== null && (
        <MediaViewer
          items={feed.items}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          onNearEnd={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
        />
      )}
    </div>
  );
}
