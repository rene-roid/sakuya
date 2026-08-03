import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { TabHeader } from './index';

interface UploadRow {
  id: string;
  name: string;
  status: 'uploading' | 'done' | 'error';
  progress: number;
}

const STATUS_COLOR: Record<string, string> = {
  done: 'text-green-500',
  uploading: 'text-accent',
  error: 'text-red-500',
};

export function UploadsTab() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { data: libraries } = useQuery({ queryKey: ['libraries'], queryFn: api.libraries });
  const [libraryId, setLibraryId] = useState<number | ''>('');
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const effectiveLibraryId = libraryId || libraries?.[0]?.id || '';

  function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    if (!effectiveLibraryId) {
      showToast('Create a library first');
      return;
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const label = list.length === 1 ? list[0].name : `${list.length} files`;
    setRows((prev) => [{ id, name: label, status: 'uploading', progress: 0 }, ...prev]);

    const form = new FormData();
    form.set('libraryId', String(effectiveLibraryId));
    for (const file of list) form.append('files', file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/uploads');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, progress: pct } : r)));
      }
    };
    xhr.onload = () => {
      const ok = xhr.status >= 200 && xhr.status < 300;
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: ok ? 'done' : 'error', progress: ok ? 100 : r.progress } : r)),
      );
      if (ok) {
        showToast(`Uploaded ${label}`);
        queryClient.invalidateQueries({ queryKey: ['media'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['libraries'] });
      } else {
        showToast('Upload failed');
      }
    };
    xhr.onerror = () => {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'error' } : r)));
      showToast('Upload failed');
    };
    xhr.send(form);
  }

  return (
    <div>
      <TabHeader title="Uploads" subtitle="Web uploads are stored separately from library folders." />
      <div className="mb-4 flex items-center gap-2.5">
        <span className="text-[12.5px] text-zinc-500">Upload into</span>
        <select
          value={effectiveLibraryId}
          onChange={(e) => setLibraryId(Number(e.target.value))}
          className="rounded-[7px] border border-zinc-800 bg-zinc-900 px-2 py-[7px] text-[13px] text-zinc-100 outline-none"
        >
          {(libraries ?? []).map((lib) => (
            <option key={lib.id} value={lib.id}>
              {lib.name}
            </option>
          ))}
          {(libraries ?? []).length === 0 && <option value="">No libraries</option>}
        </select>
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          uploadFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInput.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed py-10 transition-colors ${
          dragOver ? 'border-accent bg-accent/5' : 'border-zinc-800 bg-[#111113] hover:border-zinc-700'
        }`}
      >
        <Upload className="mb-2 text-zinc-400" size={26} />
        <div className="text-[13.5px] font-semibold text-zinc-200">Drag and drop files here</div>
        <div className="mt-0.5 text-xs text-zinc-500">or click to browse — bulk upload supported</div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) uploadFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-2.5 rounded-[9px] border border-zinc-800 bg-[#111113] px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-zinc-200">{row.name}</div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full ${row.status === 'error' ? 'bg-red-500' : 'bg-accent'}`}
                  style={{ width: `${row.progress}%` }}
                />
              </div>
            </div>
            <span className={`text-[11px] font-bold uppercase tracking-[0.3px] ${STATUS_COLOR[row.status]}`}>
              {row.status}
            </span>
            <span
              className="cursor-pointer text-zinc-500 hover:text-zinc-300"
              onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
            >
              <X size={14} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
