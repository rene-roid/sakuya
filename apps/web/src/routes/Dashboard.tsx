import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import type { Media } from '@sakuya/shared';
import { api, thumbUrl, libraryCoverUrl } from '../lib/api';
import { WideCard } from '../components/MediaCard';
import { MediaViewer } from '../components/MediaViewer';

export function Dashboard() {
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const [viewer, setViewer] = useState<{ items: Media[]; index: number } | null>(null);

  return (
    <div className="fade-in mx-auto max-w-[1400px] px-8 pb-16 pt-7">
      <SectionHeader title="Your Libraries" />
      <div className="mb-9 flex gap-4 overflow-x-auto pb-2">
        <div className="w-[220px] flex-none cursor-pointer" onClick={() => navigate('/board?liked=1')}>
          <div className="relative h-[130px] w-[220px] overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-br from-rose-500/20 to-zinc-900">
            <div className="flex h-full w-full items-center justify-center text-rose-500/80">
              <Heart size={56} fill="currentColor" strokeWidth={1.5} />
            </div>
              <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-rose-500/80 px-[7px] py-0.5 text-[10px] font-bold tracking-[0.4px] text-white backdrop-blur">
                <Heart size={12} fill="currentColor" />
                LIKES
              </div>
              <div
                  className="absolute right-2 top-2 rounded-md bg-black/60 px-[7px] py-0.5 text-[10px] font-semibold tracking-[0.4px] text-zinc-200 backdrop-blur">
                  {data?.likedCount ?? 0} ITEMS
              </div>
          </div>
            <div className="mt-2 text-[13px] font-semibold text-zinc-100">Likes</div>
            <div className="mt-px text-[11px] text-zinc-500">Media you hearted</div>
        </div>
        {(data?.libraries ?? []).map((lib) => (
          <div key={lib.id} className="w-[220px] flex-none cursor-pointer" onClick={() => navigate(`/library/${lib.id}`)}>
            <div className="relative h-[130px] w-[220px] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
              {lib.customImagePath ? (
                <img src={libraryCoverUrl(lib.id)} alt={lib.name} className="h-full w-full object-cover" />
              ) : lib.thumbMediaId ? (
                <img src={thumbUrl(lib.thumbMediaId)} alt={lib.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl text-zinc-700">◌</div>
              )}
              <div className="absolute right-2 top-2 rounded-md bg-black/60 px-[7px] py-0.5 text-[10px] font-semibold tracking-[0.4px] text-zinc-200 backdrop-blur">
                {lib.itemCount} ITEMS
              </div>
            </div>
            <div className="mt-2 text-[13px] font-semibold text-zinc-100">{lib.name}</div>
            <div className="mt-px text-[11px] text-zinc-500 capitalize">{lib.type} Library</div>
          </div>
        ))}
        {data && data.libraries.length === 0 && (
          <div className="flex h-[130px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 text-zinc-500">
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

      <SectionHeader title="Continue Watching" onSeeAll={() => navigate('/board?type=video')} />
      <div className="mb-9 flex gap-3.5 overflow-x-auto pb-2">
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

      <SectionHeader title="Recently Viewed" onSeeAll={() => navigate('/board')} />
      <div className="mb-9 flex gap-3.5 overflow-x-auto pb-2">
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

      <SectionHeader title="Recently Added" onSeeAll={() => navigate('/board')} />
      <div className="flex gap-3.5 overflow-x-auto pb-2">
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
    <div className="mb-3.5 flex items-baseline justify-between">
      <h2 className="m-0 text-lg font-bold">{title}</h2>
      {onSeeAll && (
        <div className="cursor-pointer text-xs font-semibold text-accent" onClick={onSeeAll}>
          See all →
        </div>
      )}
    </div>
  );
}
