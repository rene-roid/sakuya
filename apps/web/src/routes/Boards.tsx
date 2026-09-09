import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Images, Pencil, Trash2 } from 'lucide-react';
import type { BoardWithStats } from '@sakuya/shared';
import { api, thumbUrl } from '../lib/api';
import { useFilters } from '../hooks/useFilters';
import { useMediaInfinite } from '../hooks/useMedia';
import { FilterToolbar } from '../components/FilterToolbar';
import { MediaGrid } from '../components/MediaGrid';
import { MediaViewer } from '../components/MediaViewer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';

/** Index of user-created boards: cover, item count, rename/delete. */
export function Boards() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { data: boards } = useQuery({ queryKey: ['boards'], queryFn: api.boards });
  const [newName, setNewName] = useState('');

  const createMutation = useMutation({
    mutationFn: () => api.createBoard(newName.trim()),
    onSuccess: (board) => {
      setNewName('');
      queryClient.invalidateQueries({ queryKey: ['boards'] });
      showToast(`Board “${board.name}” created`);
    },
    onError: (err: Error) => showToast(err.message),
  });

  return (
    <div className="fade-in mx-auto max-w-[1400px] px-4 sm:px-8 pb-16 pt-7">
      <h1 className="m-0 text-[22px] font-extrabold">Boards</h1>
      <div className="mb-5 mt-1 text-[13px] text-zinc-500">
        Your own collections — add any image or video to a board from its detail view.
      </div>

      <div className="mb-7 flex max-w-[520px] gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newName.trim()) createMutation.mutate();
          }}
          placeholder="New board name"
          className="flex-1 rounded-[7px] border border-zinc-800 bg-zinc-900 px-3 py-[7px] text-[13px] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-600"
        />
        <button
          disabled={!newName.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate()}
          className="cursor-pointer rounded-[7px] bg-accent px-4 py-[7px] text-[12.5px] font-semibold text-white disabled:opacity-40"
        >
          Create
        </button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
        {(boards ?? []).map((board) => (
          <BoardCard key={board.id} board={board} />
        ))}
      </div>
      {boards && boards.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 py-16 text-zinc-500">
          <Images size={34} className="mb-2.5 text-zinc-700" />
          <div className="text-sm font-semibold text-zinc-400">No boards yet</div>
          <div className="mt-1 text-[12.5px]">Create one above, then add media to it from the viewer.</div>
        </div>
      )}
    </div>
  );
}

function BoardCard({ board }: { board: BoardWithStats }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(board.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['boards'] });
  const renameMutation = useMutation({
    mutationFn: (value: string) => api.renameBoard(board.id, value),
    onSuccess: () => {
      setRenaming(false);
      invalidate();
    },
    onError: (err: Error) => showToast(err.message),
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.deleteBoard(board.id),
    onSuccess: () => {
      invalidate();
      showToast('Board deleted');
    },
    onError: (err: Error) => showToast(err.message),
  });

  return (
    <div className="group">
      <div
        className="relative aspect-[16/10] w-full cursor-pointer overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
        onClick={() => navigate(`/boards/${board.id}`)}
      >
        {board.thumbMediaId ? (
          <img src={thumbUrl(board.thumbMediaId)} alt={board.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-700">
            <Images size={30} />
          </div>
        )}
        <div className="absolute right-2 top-2 rounded-md bg-black/60 px-[7px] py-0.5 text-[10px] font-semibold tracking-[0.4px] text-zinc-200 backdrop-blur">
          {board.itemCount} ITEMS
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        {renaming ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) renameMutation.mutate(name.trim());
              else if (e.key === 'Escape') setRenaming(false);
            }}
            onBlur={() => setRenaming(false)}
            className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[13px] font-semibold text-zinc-100 outline-none focus:border-accent"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-100" title={board.name}>
            {board.name}
          </span>
        )}
        <button
          title="Rename board"
          onClick={() => {
            setName(board.name);
            setRenaming(true);
          }}
          className="flex h-[18px] w-[18px] flex-none cursor-pointer items-center justify-center rounded text-zinc-500 opacity-0 hover:bg-white/10 hover:text-zinc-200 group-hover:opacity-100"
        >
          <Pencil size={12} />
        </button>
        <button
          title="Delete board"
          onClick={() => setConfirmDelete(true)}
          className="flex h-[18px] w-[18px] flex-none cursor-pointer items-center justify-center rounded text-zinc-500 opacity-0 hover:bg-rose-500/20 hover:text-rose-400 group-hover:opacity-100"
        >
          <Trash2 size={12} />
        </button>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this board?"
          danger
          confirmLabel="Delete"
          body={`“${board.name}” will be removed. The ${board.itemCount} item${
            board.itemCount === 1 ? '' : 's'
          } on it stay in your libraries.`}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => deleteMutation.mutate()}
        />
      )}
    </div>
  );
}

/** One board's contents — the library grid, restricted to that board's media. */
export function BoardView() {
  const { id } = useParams();
  const boardId = Number(id);
  const [filters, actions] = useFilters();
  const media = useMediaInfinite({ ...filters, boardId });
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const { data: board } = useQuery({
    queryKey: ['boards', boardId],
    queryFn: () => api.board(boardId),
    enabled: Number.isInteger(boardId),
  });

  return (
    <div className="fade-in">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-8 pt-6">
        <div className="mb-1 flex items-baseline gap-3">
          <h1 className="m-0 text-[22px] font-extrabold">{board?.name ?? '…'}</h1>
          <span className="text-[13px] text-zinc-500">
            {media.total} item{media.total === 1 ? '' : 's'}
          </span>
        </div>
      </div>
      <div className="sticky top-[60px] z-20 mt-3.5 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-8 py-3">
          <FilterToolbar filters={filters} actions={actions} />
        </div>
      </div>
      <div className="mx-auto max-w-[1400px] px-4 sm:px-8 pb-16 pt-5">
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
