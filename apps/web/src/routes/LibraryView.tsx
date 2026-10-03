import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useFilters } from '../hooks/useFilters';
import { MediaBrowser } from '../components/MediaBrowser';

export function LibraryView() {
  const { id } = useParams();
  const libraryId = Number(id);
  const [filters, actions] = useFilters(libraryId);

  const { data: library } = useQuery({
    queryKey: ['libraries', libraryId],
    queryFn: () => api.library(libraryId),
    enabled: Number.isInteger(libraryId),
  });

  return <MediaBrowser title={library?.name ?? '…'} filters={filters} actions={actions} />;
}
