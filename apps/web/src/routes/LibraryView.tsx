import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useFilters } from '../hooks/useFilters';
import { useMediaInfinite } from '../hooks/useMedia';
import { FilterToolbar } from '../components/FilterToolbar';
import { MediaGrid } from '../components/MediaGrid';
import { MediaViewer } from '../components/MediaViewer';

export function LibraryView() {
  const { id } = useParams();
  const libraryId = Number(id);
  const [filters, actions] = useFilters(libraryId);
  const media = useMediaInfinite(filters);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const { data: library } = useQuery({
    queryKey: ['libraries', libraryId],
    queryFn: () => api.library(libraryId),
    enabled: Number.isInteger(libraryId),
  });

  return (
    <div className="fade-in">
      <div className="mx-auto max-w-[1400px] px-8 pt-6">
        <div className="mb-1 flex items-baseline gap-3">
          <h1 className="m-0 text-[22px] font-extrabold">{library?.name ?? '…'}</h1>
          <span className="text-[13px] text-zinc-500">
            {media.total} item{media.total === 1 ? '' : 's'}
          </span>
        </div>
      </div>
      <div className="sticky top-[60px] z-20 mt-3.5 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto max-w-[1400px] px-8 py-3">
          <FilterToolbar filters={filters} actions={actions} />
        </div>
      </div>
      <div className="mx-auto max-w-[1400px] px-8 pb-16 pt-5">
        <MediaGrid
          items={media.items}
          hasNextPage={!!media.hasNextPage}
          isFetchingNextPage={media.isFetchingNextPage}
          fetchNextPage={media.fetchNextPage}
          isLoading={media.isLoading}
          onOpen={setViewerIndex}
        />
      </div>
      {viewerIndex !== null && (
        <MediaViewer
          items={media.items}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          onNearEnd={() => media.hasNextPage && !media.isFetchingNextPage && media.fetchNextPage()}
        />
      )}
    </div>
  );
}
