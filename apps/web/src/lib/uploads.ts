import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { toast } from '../components/Toast';

export interface UploadRow {
  id: string;
  label: string;
  libraryName: string;
  status: 'uploading' | 'done' | 'error';
  progress: number;
}

// Uploads live outside any page so they keep going, and keep reporting, after you navigate away.
let rows: UploadRow[] = [];
const listeners = new Set<() => void>();

function set(next: UploadRow[]) {
  rows = next;
  for (const listener of listeners) listener();
}

function update(id: string, patch: Partial<UploadRow>) {
  set(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
}

export function dismissUpload(id: string) {
  set(rows.filter((r) => r.id !== id));
}

export function useUploads(): UploadRow[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => rows,
  );
}

const DONE_LINGER_MS = 4000;

/** Uploads files into a library, tracked in the upload tray. */
export function startUpload(
  files: FileList | File[],
  library: { id: number; name: string },
  queryClient: QueryClient,
): void {
  const list = Array.from(files);
  if (!list.length) return;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const label = list.length === 1 ? list[0].name : `${list.length} files`;
  set([{ id, label, libraryName: library.name, status: 'uploading', progress: 0 }, ...rows]);

  const form = new FormData();
  form.set('libraryId', String(library.id));
  for (const file of list) form.append('files', file, file.name);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/uploads');
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) update(id, { progress: Math.round((e.loaded / e.total) * 100) });
  };
  xhr.onload = () => {
    let body: { mediaIds?: number[]; rejected?: string[]; error?: string } = {};
    try {
      body = JSON.parse(xhr.responseText);
    } catch {
      // A proxy error page isn't JSON; the status code still says what happened.
    }
    const added = body.mediaIds?.length ?? 0;
    const rejected = body.rejected ?? [];
    const ok = xhr.status >= 200 && xhr.status < 300 && added > 0;
    update(id, { status: ok ? 'done' : 'error', progress: ok ? 100 : 0 });
    if (rejected.length) {
      const names =
        rejected.length > 3
          ? `${rejected.slice(0, 3).join(', ')} and ${rejected.length - 3} more`
          : rejected.join(', ');
      toast(`Skipped ${names}: not a supported image or video`);
    } else if (!ok) {
      toast(body.error ? `Upload failed: ${body.error}` : 'Upload failed');
    }
    if (added > 0) {
      queryClient.invalidateQueries({ queryKey: ['media'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['libraries'] });
      setTimeout(() => dismissUpload(id), DONE_LINGER_MS);
    }
  };
  xhr.onerror = () => {
    update(id, { status: 'error' });
    toast('Upload failed');
  };
  xhr.send(form);
}
