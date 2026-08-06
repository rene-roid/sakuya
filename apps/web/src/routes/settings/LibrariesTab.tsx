import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, X, Upload, RotateCw } from 'lucide-react';
import { api, thumbUrl, libraryCoverUrl } from '../../lib/api';
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

  const scanAllMutation = useMutation({
    mutationFn: async () => {
      for (const lib of libraries ?? []) {
        await api.scanLibrary(lib.id);
      }
    },
    onSuccess: () => showToast('Scan started for all libraries'),
    onError: (err: Error) => showToast(err.message),
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <TabHeader title="Libraries" subtitle="Manage read-only folder imports per library." />
        <button
          disabled={!libraries?.length || scanAllMutation.isPending}
          onClick={() => scanAllMutation.mutate()}
          className="mb-4 cursor-pointer rounded-[7px] border border-zinc-800 px-3 py-1.5 text-[12.5px] font-semibold text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
        >
          Scan All
        </button>
      </div>
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

const AUTO_SCAN_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '2 hours', value: 120 },
  { label: '6 hours', value: 360 },
  { label: '12 hours', value: 720 },
  { label: '24 hours', value: 1440 },
];

function LibraryCard({ lib, onChanged }: { lib: LibraryWithStats; onChanged: () => void }) {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const [folderInput, setFolderInput] = useState('');
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [showThumbPicker, setShowThumbPicker] = useState(false);
  const [thumbBust, setThumbBust] = useState(0);
  const { data: schedules } = useQuery({ queryKey: ['job-schedules'], queryFn: api.jobSchedules });

  // Effective scan interval: per-library scan row if not inheriting, otherwise global.
  const perLib = schedules?.perLibrary[lib.id]?.scan;
  const effectiveScan = perLib && !perLib.useGlobal ? perLib : schedules?.globals.scan;
  const scanInterval = effectiveScan?.mode === 'interval' ? effectiveScan.intervalMinutes : 0;

  const scanMutation = useMutation({
    mutationFn: () => api.scanLibrary(lib.id),
    onSuccess: () => showToast(`Scan started: ${lib.name}`),
    onError: (err: Error) => showToast(err.message),
  });
  const autoScanMutation = useMutation({
    mutationFn: (intervalMinutes: number) =>
      api.updateJobSchedule({
        jobType: 'scan',
        libraryId: lib.id,
        mode: intervalMinutes > 0 ? 'interval' : 'off',
        intervalMinutes,
        useGlobal: false,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-schedules'] });
      onChanged();
      showToast('Auto-scan updated');
    },
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
          <div
            className="group relative h-10 w-10 flex-none cursor-pointer overflow-hidden rounded-lg bg-zinc-900"
            title="Edit thumbnail"
            onClick={() => setShowThumbPicker(true)}
          >
            {lib.customImagePath ? (
              <img src={libraryCoverUrl(lib.id, thumbBust)} alt="" className="h-full w-full object-cover" />
            ) : (
              lib.thumbMediaId && (
                <img src={thumbUrl(lib.thumbMediaId, thumbBust)} alt="" className="h-full w-full object-cover" />
              )
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-zinc-100 opacity-0 transition-opacity group-hover:opacity-100">
              <Pencil size={12} />
            </div>
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
          <X size={15} />
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
                <X size={14} />
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
      <div className="mt-3 flex items-center gap-2.5 border-t border-zinc-800 pt-3">
        <span className="text-[12px] text-zinc-500">Auto-scan</span>
        <select
          value={scanInterval}
          disabled={autoScanMutation.isPending}
          onChange={(e) => autoScanMutation.mutate(Number(e.target.value))}
          className="rounded-[7px] border border-zinc-800 bg-zinc-900 px-2 py-[5px] text-[12px] text-zinc-300 outline-none disabled:opacity-40"
        >
          {AUTO_SCAN_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {scanInterval > 0 && (
          <span className="text-[11px] text-zinc-600">
            Next scan in ~{scanInterval >= 60 ? `${scanInterval / 60}h` : `${scanInterval}m`}
          </span>
        )}
      </div>
      {showThumbPicker && (
        <ThumbnailPickerModal
          lib={lib}
          onClose={() => setShowThumbPicker(false)}
          onChanged={() => {
            onChanged();
            setThumbBust((b) => b + 1);
          }}
        />
      )}
    </div>
  );
}

function ThumbnailPickerModal({
  lib,
  onClose,
  onChanged,
}: {
  lib: LibraryWithStats;
  onClose: () => void;
  onChanged: () => void;
}) {
  const showToast = useToast();
  const [bust, setBust] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: media } = useQuery({
    queryKey: ['media', 'thumb-picker', lib.id],
    queryFn: () => api.mediaList({ libraryId: lib.id, tags: [], sort: 'recent', dir: 'desc', seed: 1 }),
  });

  const setThumbMutation = useMutation({
    mutationFn: (mediaId: number | null) => api.updateLibrary(lib.id, { thumbnailMediaId: mediaId }),
    onSuccess: () => {
      onChanged();
      showToast('Library thumbnail updated');
    },
    onError: (err: Error) => showToast(err.message),
  });

  const regenerateMutation = useMutation({
    mutationFn: (mediaId: number) => api.regenerateThumbnail(mediaId),
    onSuccess: () => {
      setBust((b) => b + 1);
      onChanged();
      showToast('Thumbnail regenerated');
    },
    onError: (err: Error) => showToast(err.message),
  });

  const uploadCoverMutation = useMutation({
    mutationFn: (file: File) => api.uploadLibraryCover(lib.id, file),
    onSuccess: () => {
      setBust((b) => b + 1);
      onChanged();
      showToast('Custom cover uploaded');
    },
    onError: (err: Error) => showToast(err.message),
  });

  const removeCoverMutation = useMutation({
    mutationFn: () => api.removeLibraryCover(lib.id),
    onSuccess: () => {
      setBust((b) => b + 1);
      onChanged();
      showToast('Custom cover removed');
    },
    onError: (err: Error) => showToast(err.message),
  });

  const currentThumbId = lib.thumbMediaId;

  return (
    <div
      className="fade-in fixed inset-0 z-[90] flex items-center justify-center bg-zinc-950/80 p-6 backdrop-blur"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-[560px] flex-col rounded-xl border border-zinc-800 bg-[#111113] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <div className="text-[15px] font-bold">Library thumbnail</div>
          <div className="cursor-pointer text-zinc-500 hover:text-zinc-200" onClick={onClose}>
            <X size={16} />
          </div>
        </div>
        <div className="mb-3.5 text-[12.5px] text-zinc-500">
          {lib.customImagePath
            ? 'A custom cover is set. It stays fixed until removed — pick a media item or remove it to auto-update again.'
            : 'Pick a media item as the cover, upload a custom image, or force-regenerate the current thumbnail.'}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadCoverMutation.mutate(file);
            e.target.value = '';
          }}
        />
        <div className="mb-3.5 flex flex-wrap gap-2">
          <button
            disabled={uploadCoverMutation.isPending}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 cursor-pointer rounded-[7px] border border-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-300 hover:text-zinc-100 disabled:opacity-40"
          >
            <Upload size={13} /> Upload custom image
          </button>
          {lib.customImagePath && (
            <button
              disabled={removeCoverMutation.isPending}
              onClick={() => removeCoverMutation.mutate()}
              className="cursor-pointer rounded-[7px] border border-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-rose-400 hover:text-rose-300 disabled:opacity-40"
            >
              Remove custom image
            </button>
          )}
          <button
            disabled={!currentThumbId || regenerateMutation.isPending}
            onClick={() => currentThumbId && regenerateMutation.mutate(currentThumbId)}
            className="flex items-center gap-1.5 cursor-pointer rounded-[7px] border border-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-300 hover:text-zinc-100 disabled:opacity-40"
          >
            <RotateCw size={13} /> Regenerate current thumbnail
          </button>
          <button
            disabled={lib.thumbnailMediaId === null || setThumbMutation.isPending}
            onClick={() => setThumbMutation.mutate(null)}
            className="cursor-pointer rounded-[7px] border border-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-300 hover:text-zinc-100 disabled:opacity-40"
          >
            Use latest media
          </button>
        </div>
        <div className="grid flex-1 grid-cols-5 gap-2 overflow-y-auto">
          {(media?.items ?? []).map((m) => (
            <div
              key={m.id}
              title={m.filename}
              onClick={() => setThumbMutation.mutate(m.id)}
              className={`relative aspect-square cursor-pointer overflow-hidden rounded-lg border-2 ${
                currentThumbId === m.id ? 'border-accent' : 'border-transparent hover:border-zinc-700'
              }`}
            >
              <img src={thumbUrl(m.id, bust)} alt="" className="h-full w-full object-cover" />
            </div>
          ))}
          {media && media.items.length === 0 && (
            <div className="col-span-5 py-6 text-center text-[12.5px] text-zinc-600">No media in this library yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
