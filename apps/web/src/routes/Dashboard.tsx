import { Fragment, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Heart, X } from 'lucide-react';
import type { Media } from '@sakuya/shared';
import { api, thumbUrl, libraryCoverUrl } from '../lib/api';
import { WideCard } from '../components/MediaCard';
import { MediaViewer } from '../components/MediaViewer';
import { toast } from '../components/Toast';
import { useUiStyle } from '../hooks/useUiStyle';
import { usePatchSettings, useSettings } from '../hooks/useSettings';

const ROWS = [
  {
    key: 'continueWatching',
    title: 'Continue Watching',
    seeAll: '/explore?type=video',
    empty: 'Videos you start watching will show up here.',
    progress: () => true,
  },
  {
    key: 'recentlyViewed',
    title: 'Recently Viewed',
    seeAll: '/explore',
    empty: 'Images and videos you open will show up here.',
    progress: (item: Media) => item.type === 'video',
  },
  {
    key: 'recentlyAdded',
    title: 'Recently Added',
    seeAll: '/explore',
    empty: 'Scan a library or upload files to get started.',
    progress: () => false,
  },
] as const;

export function Dashboard() {
  const navigate = useNavigate();
  const glass = useUiStyle() === 'glass';
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const settings = useSettings();
  const [viewer, setViewer] = useState<{ items: Media[]; index: number } | null>(null);

  const hideHeroMutation = usePatchSettings(() => toast('Banner hidden. Bring it back in Settings → Appearance'));

  const libraryCover = (lib: NonNullable<typeof data>['libraries'][number]) =>
    lib.customImagePath ? (
      <img src={libraryCoverUrl(lib.id)} alt={lib.name} className="h-full w-full object-cover" />
    ) : lib.thumbMediaId ? (
      <img src={thumbUrl(lib.thumbMediaId)} alt={lib.name} className="h-full w-full object-cover" />
    ) : (
      <div className="flex h-full w-full items-center justify-center text-2xl text-zinc-700">◌</div>
    );

  return (
    <div className="fade-in mx-auto max-w-[1400px] px-4 pb-16 pt-7 sm:px-8 glass:pt-5">
      {glass && settings && settings.dashboard_hero !== '0' && (
        <Hero
          floating={(data?.recentlyAdded ?? []).slice(0, FLOAT_SLOTS.length)}
          totalItems={(data?.libraries ?? []).reduce((sum, lib) => sum + lib.itemCount, 0)}
          libraryCount={data?.libraries.length ?? 0}
          likedCount={data?.likedCount ?? 0}
          onExplore={() => navigate('/explore')}
          onLikes={() => navigate('/explore?liked=1')}
          onClose={() => hideHeroMutation.mutate({ dashboard_hero: '0' })}
        />
      )}

      <SectionHeader title="Your Libraries" />
      <div className="mb-9 flex gap-4 overflow-x-auto pb-2">
        <Tile
          title="Likes"
          subtitle="Media you hearted"
          count={data?.likedCount ?? 0}
          liked
          onClick={() => navigate('/explore?liked=1')}
          cover={
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-rose-500/20 to-zinc-900 text-rose-500/80">
              <Heart size={56} fill="currentColor" strokeWidth={1.5} />
            </div>
          }
        />
        {(data?.libraries ?? []).map((lib) => (
          <Tile
            key={lib.id}
            title={lib.name}
            subtitle={`${lib.type.charAt(0).toUpperCase()}${lib.type.slice(1)} Library`}
            count={lib.itemCount}
            onClick={() => navigate(`/library/${lib.id}`)}
            cover={libraryCover(lib)}
          />
        ))}
        {data && data.libraries.length === 0 && (
          <div className="flex h-[130px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-line text-zinc-500">
            <div className="text-sm font-semibold">No libraries yet</div>
            <div
              className="mt-1 cursor-pointer text-[12.5px] font-semibold text-accent"
              onClick={() => navigate('/settings')}
            >
              Create one in Settings →
            </div>
          </div>
        )}
      </div>

      {ROWS.map((row, r) => {
        const items = data?.[row.key] ?? [];
        return (
          <Fragment key={row.key}>
            <SectionHeader title={row.title} onSeeAll={() => navigate(row.seeAll)} />
            <div className={`${r < ROWS.length - 1 ? 'mb-9 ' : ''}flex gap-3.5 overflow-x-auto pb-2`}>
              {items.map((item, i) => (
                <WideCard
                  key={item.id}
                  item={item}
                  showProgress={row.progress(item)}
                  onClick={() => setViewer({ items, index: i })}
                />
              ))}
              {data && items.length === 0 && <div className="py-6 text-[12.5px] text-zinc-600">{row.empty}</div>}
            </div>
          </Fragment>
        );
      })}

      {viewer && (
        <MediaViewer
          items={viewer.items}
          index={viewer.index}
          onIndexChange={(index) => setViewer({ ...viewer, index })}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}

function SectionHeader({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  return (
    <div className="mb-3.5 flex items-baseline justify-between glass:items-center">
      <h2 className="m-0 text-lg font-bold glass:text-[20px]">{title}</h2>
      {onSeeAll && (
        <div
          className="cursor-pointer text-xs font-semibold text-accent glass:rounded-full glass:border glass:border-white/10 glass:px-3 glass:py-1 glass:text-[12px] glass:font-medium glass:text-zinc-300 glass:transition-colors glass:hover:bg-white/5 glass:hover:text-white"
          onClick={onSeeAll}
        >
          See all<span className="glass:hidden"> →</span>
        </div>
      )}
    </div>
  );
}

interface TileProps {
  title: string;
  subtitle: string;
  count: number;
  cover: ReactNode;
  onClick: () => void;
  /** The Likes tile, which gets its own badge in the original style. */
  liked?: boolean;
}

function Tile({ title, subtitle, count, cover, onClick, liked }: TileProps) {
  return (
    <div className="group w-[220px] flex-none cursor-pointer" onClick={onClick}>
      <div className="relative h-[130px] w-[220px] overflow-hidden rounded-media border border-line bg-zinc-900 glass:border-white/[0.07] glass:transition-colors glass:group-hover:border-white/25">
        {cover}
        {liked && (
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-rose-500/80 px-[7px] py-0.5 text-[10px] font-bold tracking-[0.4px] text-white backdrop-blur glass:rounded-full">
            <Heart size={12} fill="currentColor" />
            LIKES
          </div>
        )}
        <div className="absolute right-2 top-2 rounded-md bg-black/60 px-[7px] py-0.5 text-[10px] font-semibold tracking-[0.4px] text-zinc-200 backdrop-blur glass:rounded-full">
          {count.toLocaleString()} ITEMS
        </div>
      </div>
      <div className="mt-2 truncate text-[13px] font-semibold text-zinc-100">{title}</div>
      <div className="mt-px text-[11px] text-zinc-500">{subtitle}</div>
    </div>
  );
}

// Tilted thumbnails drifting on the right of the banner, echoing the floating app icons on
// apps.umbrel.com. Kept to the right half so they never sit behind the headline.
const FLOAT_SLOTS = [
  { className: 'right-[30%] top-[-14px] h-[64px] w-[64px] opacity-40 blur-[1px]', r: '-10deg', delay: '0s' },
  { className: 'right-[4%] top-[14px] h-[76px] w-[76px] opacity-75', r: '9deg', delay: '-1.5s' },
  { className: 'right-[6%] bottom-[-14px] h-[84px] w-[84px] opacity-85', r: '-7deg', delay: '-3s' },
  { className: 'right-[33%] bottom-[-18px] h-[56px] w-[56px] opacity-35 blur-[1.5px]', r: '14deg', delay: '-4.5s' },
];

function Hero({
  floating,
  totalItems,
  libraryCount,
  likedCount,
  onExplore,
  onLikes,
  onClose,
}: {
  floating: Media[];
  totalItems: number;
  libraryCount: number;
  likedCount: number;
  onExplore: () => void;
  onLikes: () => void;
  onClose: () => void;
}) {
  return (
    <div className="relative mb-9 overflow-hidden rounded-2xl border border-white/[0.07] bg-black shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_24px_70px_rgba(0,0,0,0.4)]">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 78% 50%, color-mix(in srgb, var(--accent) 34%, transparent), transparent 300px)',
        }}
      />
      {floating.map((item, i) => {
        const slot = FLOAT_SLOTS[i];
        return (
          <div
            key={item.id}
            className={`floaty pointer-events-none absolute hidden overflow-hidden rounded-media border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_16px_32px_rgba(0,0,0,0.5)] lg:block ${slot.className}`}
            style={{ '--r': slot.r, animationDelay: slot.delay } as CSSProperties}
          >
            <img src={thumbUrl(item.id)} alt="" className="h-full w-full object-cover" />
          </div>
        );
      })}
      <button
        title="Hide banner"
        aria-label="Hide banner"
        onClick={onClose}
        className="absolute right-3 top-3 z-20 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-black/40 text-zinc-300 backdrop-blur transition-colors hover:bg-white/15 hover:text-white"
      >
        <X size={14} />
      </button>
      <div className="relative flex min-h-[176px] items-center gap-8 px-6 py-7 sm:px-9 sm:py-8">
        <div className="relative z-10 max-w-[560px]">
          <h1 className="m-0 text-[26px] leading-[1.08] text-white sm:text-[34px]">
            Your whole collection, tagged by itself.
          </h1>
          <p className="mb-0 mt-2.5 max-w-[460px] text-[13.5px] leading-relaxed text-zinc-300 sm:text-[14.5px]">
            {totalItems.toLocaleString()} items across {libraryCount} {libraryCount === 1 ? 'library' : 'libraries'} and{' '}
            {likedCount.toLocaleString()} {likedCount === 1 ? 'favorite' : 'favorites'}. Searchable, private, and all
            yours.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={onExplore}
              className="cursor-pointer rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
            >
              Explore library
            </button>
            <button
              onClick={onLikes}
              className="cursor-pointer rounded-full border border-white/10 bg-white/10 px-4 py-2 text-[13px] font-semibold text-white backdrop-blur transition-colors hover:bg-white/15"
            >
              View likes
            </button>
          </div>
        </div>
        <div className="ml-auto hidden shrink-0 pr-[12%] lg:block">
          <div
            className="floaty grid h-[112px] w-[112px] place-items-center rounded-[26px] border border-white/25 shadow-[inset_0_2px_0_rgba(255,255,255,0.35),inset_0_-8px_24px_rgba(0,0,0,0.25),0_0_60px_color-mix(in_srgb,var(--accent)_50%,transparent),0_20px_40px_rgba(0,0,0,0.5)]"
            style={
              {
                background:
                  'linear-gradient(145deg, color-mix(in srgb, var(--accent) 85%, white), color-mix(in srgb, var(--accent) 65%, black))',
                '--r': '-6deg',
              } as CSSProperties
            }
          >
            <img src="/icon.png" alt="" className="h-[64px] w-[64px] drop-shadow-[0_6px_16px_rgba(0,0,0,0.35)]" />
          </div>
        </div>
      </div>
    </div>
  );
}
