import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, thumbUrl } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { TabHeader } from './index';
import type { LibraryWithStats } from '@sakuya/shared';

const FOLDER_STATUS_COLOR: Record<string, string> = {
  indexed: 'text-green-500',
  scanning: 'text-amber-500',
  pending: 'text-zinc-500',
  error: 'text-red-500',
};

export function LibrariesTab() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { data: libraries } = useQuery({ queryKey: ['libraries'], queryFn: api.libraries });
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('mixed');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['libraries'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const createMutation = useMutation({
    mutationFn: () => api.createLibrary({ name: newName.trim(), type: newType }),
    onSuccess: () => {
      setNewName('');
      invalidate();
      showToast('Library created');
    },
    onError: (err: Error) => showToast(err.message),
  });

  return (
    <div>
      <TabHeader title="Libraries" subtitle="Manage read-only folder imports per library." />
      {(libraries ?? []).map((lib) => (
        <LibraryCard key={lib.id} lib={lib} onChanged={invalidate} />
      ))}
      <div className="rounded-xl border border-dashed border-zinc-800 p-4">
        <div className="mb-2.5 text-[13.5px] font-bold">New library</div>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Library name"
            className="flex-1 rounded-[7px] border border-zinc-800 bg-zinc-900 px-3 py-[7px] text-[13px] text-zinc-100 outline-none placeholder:text-zinc-500"
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            className="rounded-[7px] border border-zinc-800 bg-zinc-900 px-2 py-[7px] text-[13px] text-zinc-100 outline-none"
          >
            <option value="mixed">Mixed</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
          </select>
          <button
            disabled={!newName.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            className="cursor-pointer rounded-[7px] bg-accent px-4 py-[7px] text-[12.5px] font-semibold text-white disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function LibraryCard({ lib, onChanged }: { lib: LibraryWithStats; onChanged: () => void }) {
  const showToast = useToast();
  const [folderInput, setFolderInput] = useState('');
  const [showFolderInput, setShowFolderInput] = useState(false);

  const scanMutation = useMutation({
    mutationFn: () => api.scanLibrary(lib.id),
    onSuccess: () => showToast(`Scan started: ${lib.name}`),
    onError: (err: Error) => showToast(err.message),
  });
  const addFolderMutation = useMutation({
    mutationFn: () => api.addFolder(lib.id, folderInput.trim()),
    onSuccess: () => {
      setFolderInput('');
      setShowFolderInput(false);
      onChanged();
      showToast('Folder added');
    },
    onError: (err: Error) => showToast(err.message),
  });
  const removeFolderMutation = useMutation({
    mutationFn: (folderId: number) => api.removeFolder(folderId),
    onSuccess: () => {
      onChanged();
      showToast('Folder removed');
    },
    onError: (err: Error) => showToast(err.message),
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.deleteLibrary(lib.id),
    onSuccess: () => {
      onChanged();
      showToast('Library deleted');
    },
    onError: (err: Error) => showToast(err.message),
  });

  return (
    <div className="mb-3.5 rounded-xl border border-zinc-800 bg-[#111113] p-4">
      <div className="mb-2.5 flex items-center gap-2.5">
        <div className="flex flex-1 items-center gap-2.5">
          <div className="h-10 w-10 flex-none overflow-hidden rounded-lg bg-zinc-900">
            {lib.thumbMediaId && (
              <img src={thumbUrl(lib.thumbMediaId)} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div>
            <div className="text-sm font-bold">{lib.name}</div>
            <div className="text-[11.5px] capitalize text-zinc-500">
              {lib.type} Library · {lib.itemCount} items
            </div>
          </div>
        </div>
        <div
          className="cursor-pointer rounded-[7px] border border-zinc-800 px-3 py-1.5 text-[12.5px] font-semibold text-zinc-400 hover:text-zinc-200"
          onClick={() => scanMutation.mutate()}
        >
          Scan
        </div>
        <div
          className="cursor-pointer rounded-[7px] border border-transparent px-2 py-1.5 text-[12.5px] font-semibold text-zinc-600 hover:text-red-400"
          title="Delete library"
          onClick={() => {
            if (confirm(`Delete library "${lib.name}"? Uploaded files are removed; folder files stay on disk.`)) {
              deleteMutation.mutate();
            }
          }}
        >
          ✕
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {lib.folders.map((folder) => (
          <div
            key={folder.id}
            className="flex items-center justify-between rounded-[7px] border border-zinc-800 bg-zinc-900 px-2.5 py-[7px] text-[12.5px]"
          >
            <span className="truncate font-mono text-zinc-300">{folder.path}</span>
            <div className="flex flex-none items-center gap-2.5 pl-3">
              <span
                className={`text-[11px] font-bold tracking-[0.3px] capitalize ${FOLDER_STATUS_COLOR[folder.status] ?? 'text-zinc-400'}`}
              >
                {folder.status}
              </span>
              <span
                className="cursor-pointer text-zinc-500 hover:text-red-400"
                onClick={() => removeFolderMutation.mutate(folder.id)}
              >
                ✕
              </span>
            </div>
          </div>
        ))}
      </div>
      {showFolderInput ? (
        <div className="mt-2 flex gap-2">
          <input
            autoFocus
            value={folderInput}
            onChange={(e) => setFolderInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && folderInput.trim() && addFolderMutation.mutate()}
            placeholder="/absolute/path/to/folder"
            className="flex-1 rounded-[7px] border border-zinc-800 bg-zinc-900 px-2.5 py-[7px] font-mono text-[12.5px] text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          <button
            disabled={!folderInput.trim() || addFolderMutation.isPending}
            onClick={() => addFolderMutation.mutate()}
            className="cursor-pointer rounded-[7px] bg-accent px-3 py-[7px] text-[12px] font-semibold text-white disabled:opacity-40"
          >
            Add
          </button>
        </div>
      ) : (
        <div
          className="mt-2 cursor-pointer text-[12.5px] font-semibold text-accent"
          onClick={() => setShowFolderInput(true)}
        >
          + Add folder
        </div>
      )}
    </div>
  );
}
