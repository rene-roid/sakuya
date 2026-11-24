import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Copy, MoreVertical, Settings } from 'lucide-react';
import { api } from '../lib/api';
import { useFilters } from '../hooks/useFilters';
import { MediaBrowser } from '../components/MediaBrowser';
import { MenuItem, MenuPanel } from '../components/Menu';
import { UploadButton, UploadDropZone } from '../components/UploadButton';
import { settingHref } from './settings/registry';

export function LibraryView() {
  const { id } = useParams();
  const libraryId = Number(id);
  const [filters, actions] = useFilters(libraryId);

  const { data: library } = useQuery({
    queryKey: ['libraries', libraryId],
    queryFn: () => api.library(libraryId),
    enabled: Number.isInteger(libraryId),
  });

  return (
    <UploadDropZone library={library}>
      <MediaBrowser
        title={library?.name ?? '…'}
        filters={filters}
        actions={actions}
        headerExtra={
          <div className="ml-auto flex items-center gap-2 self-center">
            <UploadButton library={library} />
            <LibraryMenu libraryId={libraryId} />
          </div>
        }
      />
    </UploadDropZone>
  );
}

function LibraryMenu({ libraryId }: { libraryId: number }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const go = (to: string) => () => {
    setOpen(false);
    navigate(to);
  };
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Library menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex cursor-pointer items-center rounded-btn border border-line px-2 py-1.5 text-zinc-400 hover:text-zinc-200 glass:bg-white/[0.04]"
      >
        <MoreVertical size={15} />
      </button>
      {open && (
        <MenuPanel width={210} onClose={() => setOpen(false)}>
          <MenuItem
            icon={<Copy size={13} />}
            label="Find duplicates"
            onClick={go(`/duplicates?library=${libraryId}`)}
          />
          <MenuItem
            icon={<Settings size={13} />}
            label="Library settings"
            onClick={go(settingHref('library-manager'))}
          />
        </MenuPanel>
      )}
    </div>
  );
}
