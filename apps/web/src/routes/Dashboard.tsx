import { useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Heart, X } from 'lucide-react';
import type { Media } from '@sakuya/shared';
import { api, thumbUrl, libraryCoverUrl } from '../lib/api';
import { WideCard } from '../components/MediaCard';
import { MediaViewer } from '../components/MediaViewer';
import { useToast } from '../components/Toast';
import { useUiStyle } from '../hooks/useUiStyle';

export function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const glass = useUiStyle() === 'glass';
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  const [viewer, setViewer] = useState<{ items: Media[]; index: number } | null>(null);

  const hideHeroMutation = useMutation({
    mutationFn: () => api.patchSettings({ dashboard_hero: '0' }),
    onSuccess: (next) => {
      queryClient.setQueryData(['settings'], next);
      showToast('Banner hidden. Bring it back in Settings → Appearance');
    },
    onError: (err: Error) => showToast(err.message),
  });

  const Tile = glass ? GlassTile : ClassicTile;
  const libraryCover = (lib: NonNullable<typeof data>['libraries'][number]) =>
    lib.customImagePath ? (
      <img src={libraryCoverUrl(lib.id)} alt={lib.name} className="h-full w-full object-cover" />
    ) : lib.thumbMediaId ? (
      <img src={thumbUrl(lib.thumbMediaId)} alt={lib.name} className="h-full w-full object-cover" />
    ) : (
      <div className="flex h-full w-full items-center justify-center text-2xl text-zinc-700">◌</div>
    );

  return (
    <div className="fade-in mx-auto max-w-[1400px] px-4 pb-16 pt-7 sm:px-8 glass:pt-6">
      {glass && settings && settings.dashboard_hero !== '0' && (
        <Hero
          floating={(data?.recentlyAdded ?? []).slice(0, FLOAT_SLOTS.length)}
          totalItems={(data?.libraries ?? []).reduce((sum, lib) => sum + lib.itemCount, 0)}
          libraryCount={data?.libraries.length ?? 0}
          likedCount={data?.likedCount ?? 0}
          onExplore={() => navigate('/explore')}
          onLikes={() => navigate('/explore?liked=1')}
          onClose={() => hideHeroMutation.mutate()}
        />
      )}

      <SectionHeader title="Your Libraries" />
      <div className="mb-9 flex gap-4 overflow-x-auto pb-2 glass:-mx-1 glass:mb-10 glass:gap-3 glass:px-1 glass:pb-3">
        <Tile
          title="Likes"
          subtitle="Media you hearted"
          count={data?.likedCount ?? 0}
          liked
          onClick={() => navigate('/explore?liked=1')}
          cover={
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-rose-500/20 to-zinc-900 text-rose-500/80 glass:from-rose-400 glass:via-pink-500 glass:to-fuchsia-700 glass:text-white/90">
              <Heart size={glass ? 48 : 56} fill="currentColor" strokeWidth={1.5} />
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
          <div className="flex h-[130px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-line text-zinc-500 glass:h-[190px]">
            <div className="text-sm font-semibold">No libraries yet</div>
            <div
              className="mt-1 cursor-pointer text-[12.5px] font-semibold text-accent glass:mt-3 glass:rounded-full glass:bg-white/15 glass:px-4 glass:py-2 glass:text-[13px] glass:text-zinc-100 glass:hover:bg-white/20"
              onClick={() => navigate('/settings')}
            >
              Create one in Settings{glass ? '' : ' →'}
            </div>
          </div>
        )}
      </div>

      <SectionHeader title="Continue Watching" onSeeAll={() => navigate('/explore?type=video')} />
      <div className="mb-9 flex gap-3.5 overflow-x-auto pb-2 glass:mb-10 glass:gap-4 glass:pb-3">
        {(data?.continueWatching ?? []).map((item, i) => (
          <WideCard
            key={item.id}
            item={item}
            showProgress
            onClick={() => setViewer({ items: data!.continueWatching, index: i })}
          />
        ))}
        {data && data.continueWatching.length === 0 && (
          <div className="py-6 text-[12.5px] text-zinc-600">Videos you start watching will show up here.</div>
        )}
      </div>

      <SectionHeader title="Recently Viewed" onSeeAll={() => navigate('/explore')} />
      <div className="mb-9 flex gap-3.5 overflow-x-auto pb-2 glass:mb-10 glass:gap-4 glass:pb-3">
        {(data?.recentlyViewed ?? []).map((item, i) => (
          <WideCard
            key={item.id}
            item={item}
            showProgress={item.type === 'video'}
            onClick={() => setViewer({ items: data!.recentlyViewed, index: i })}
          />
        ))}
        {data && data.recentlyViewed.length === 0 && (
          <div className="py-6 text-[12.5px] text-zinc-600">Images and videos you open will show up here.</div>
        )}
      </div>

      <SectionHeader title="Recently Added" onSeeAll={() => navigate('/explore')} />
      <div className="flex gap-3.5 overflow-x-auto pb-2 glass:gap-4 glass:pb-3">
        {(data?.recentlyAdded ?? []).map((item, i) => (
          <WideCard key={item.id} item={item} onClick={() => setViewer({ items: data!.recentlyAdded, index: i })} />
        ))}
        {data && data.recentlyAdded.length === 0 && (
          <div className="py-6 text-[12.5px] text-zinc-600">Scan a library or upload files to get started.</div>
        )}
      </div>

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
    <div className="mb-3.5 flex items-baseline justify-between glass:mb-4 glass:items-center">
      <h2 className="m-0 text-lg font-bold glass:text-[22px] sm:glass:text-[26px]">{title}</h2>
      {onSeeAll && (
        <div
          className="cursor-pointer text-xs font-semibold text-accent glass:rounded-full glass:bg-white/10 glass:px-4 glass:py-1.5 glass:text-[13px] glass:font-medium glass:text-zinc-100 glass:transition-colors glass:hover:bg-white/15"
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

function ClassicTile({ title, subtitle, count, cover, onClick, liked }: TileProps) {
  return (
    <div className="w-[220px] flex-none cursor-pointer" onClick={onClick}>
      <div className="relative h-[130px] w-[220px] overflow-hidden rounded-xl border border-line bg-zinc-900">
        {cover}
        {liked && (
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-rose-500/80 px-[7px] py-0.5 text-[10px] font-bold tracking-[0.4px] text-white backdrop-blur">
            <Heart size={12} fill="currentColor" />
            LIKES
          </div>
        )}
        <div className="absolute right-2 top-2 rounded-md bg-black/60 px-[7px] py-0.5 text-[10px] font-semibold tracking-[0.4px] text-zinc-200 backdrop-blur">
          {count} ITEMS
        </div>
      </div>
      <div className="mt-2 text-[13px] font-semibold text-zinc-100">{title}</div>
      <div className="mt-px text-[11px] text-zinc-500">{subtitle}</div>
    </div>
  );
}

function GlassTile({ title, subtitle, count, cover, onClick }: TileProps) {
  return (
    <div className="glass-card w-[200px] flex-none cursor-pointer rounded-xl p-3" onClick={onClick}>
      <div className="relative h-[112px] overflow-hidden rounded-[14px] bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
        {cover}
        <div className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] font-semibold text-zinc-100 backdrop-blur">
          {count.toLocaleString()}
        </div>
      </div>
      <div className="mt-3 truncate text-center font-display text-[15px] font-semibold text-zinc-50">{title}</div>
      <div className="mt-0.5 text-center text-[12px] text-zinc-500">{subtitle}</div>
    </div>
  );
}

// Tilted thumbnails scattered around the hero, echoing the floating app icons on apps.umbrel.com.
const FLOAT_SLOTS = [
  { className: 'left-[4%] top-[-20px] h-[74px] w-[74px] opacity-35 blur-[1.5px]', r: '-14deg', delay: '0s' },
  { className: 'left-[40%] bottom-[-28px] h-[64px] w-[64px] opacity-30 blur-[2px]', r: '12deg', delay: '-2s' },
  { className: 'right-[5%] top-[24px] h-[84px] w-[84px] opacity-70', r: '10deg', delay: '-1s' },
  { className: 'right-[3%] bottom-[-16px] h-[92px] w-[92px] opacity-80', r: '-8deg', delay: '-3s' },
  { className: 'right-[34%] top-[-24px] h-[58px] w-[58px] opacity-45 blur-[1px]', r: '-6deg', delay: '-4s' },
  { className: 'right-[38%] bottom-[18px] h-[46px] w-[46px] opacity-25 blur-[2px]', r: '18deg', delay: '-5s' },
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
    <div className="relative mb-10 overflow-hidden rounded-3xl border border-white/[0.06] bg-black shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_34px_110px_rgba(0,0,0,0.42)] sm:mb-12">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 76% 50%, color-mix(in srgb, var(--accent) 38%, transparent), transparent 340px)',
        }}
      />
      {floating.map((item, i) => {
        const slot = FLOAT_SLOTS[i];
        return (
          <div
            key={item.id}
            className={`floaty pointer-events-none absolute hidden overflow-hidden rounded-[22%] border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_20px_40px_rgba(0,0,0,0.5)] md:block ${slot.className}`}
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
        className="absolute right-3 top-3 z-20 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-black/40 text-zinc-300 backdrop-blur transition-colors hover:bg-white/15 hover:text-white"
      >
        <X size={15} />
      </button>
      <div className="relative flex min-h-[260px] items-center gap-8 px-6 py-9 sm:min-h-[300px] sm:px-12 sm:py-10">
        <div className="relative z-10 max-w-[620px]">
          <h1 className="m-0 text-[30px] leading-[1.05] text-white sm:text-[50px]">
            Your whole collection.
            <br />
            Tagged by itself.
          </h1>
          <p className="mb-0 mt-4 max-w-[480px] text-[14.5px] leading-relaxed text-zinc-300 sm:text-[16px]">
            {totalItems.toLocaleString()} items across {libraryCount} {libraryCount === 1 ? 'library' : 'libraries'} and{' '}
            {likedCount.toLocaleString()} {likedCount === 1 ? 'favorite' : 'favorites'}. Searchable, private, and all
            yours.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <button
              onClick={onExplore}
              className="cursor-pointer rounded-full bg-white px-5 py-2.5 text-[14px] font-semibold text-zinc-950 transition-transform hover:scale-[1.03]"
            >
              Explore library
            </button>
            <button
              onClick={onLikes}
              className="cursor-pointer rounded-full bg-white/15 px-5 py-2.5 text-[14px] font-semibold text-white backdrop-blur transition-colors hover:bg-white/20"
            >
              View likes
            </button>
          </div>
        </div>
        <div className="ml-auto hidden shrink-0 pr-[10%] lg:block">
          <div
            className="floaty grid h-[168px] w-[168px] place-items-center rounded-[26%] border border-white/25 shadow-[inset_0_2px_0_rgba(255,255,255,0.35),inset_0_-8px_24px_rgba(0,0,0,0.25),0_0_80px_color-mix(in_srgb,var(--accent)_55%,transparent),0_30px_60px_rgba(0,0,0,0.5)]"
            style={
              {
                background:
                  'linear-gradient(145deg, color-mix(in srgb, var(--accent) 85%, white), color-mix(in srgb, var(--accent) 65%, black))',
                '--r': '-6deg',
              } as CSSProperties
            }
          >
            <img src="/icon.png" alt="" className="h-[92px] w-[92px] drop-shadow-[0_6px_16px_rgba(0,0,0,0.35)]" />
          </div>
        </div>
      </div>
    </div>
  );
}
