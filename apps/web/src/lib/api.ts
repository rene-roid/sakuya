import type {
  DashboardResponse,
  Job,
  LibraryWithStats,
  MediaDetail,
  MediaListResponse,
  Settings,
  SystemInfo,
  TagCount,
  TaggerStatus,
} from '@sakuya/shared';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error ?? message;
    } catch {}
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export interface MediaFilters {
  libraryId?: number;
  type?: 'image' | 'video';
  tags: string[];
  q?: string;
  sort: 'recent' | 'name' | 'random';
  dir: 'asc' | 'desc';
  seed: number;
}

export function mediaQueryString(filters: MediaFilters, cursor?: string): string {
  const params = new URLSearchParams();
  if (filters.libraryId) params.set('libraryId', String(filters.libraryId));
  if (filters.type) params.set('type', filters.type);
  if (filters.tags.length) params.set('tags', filters.tags.join(','));
  if (filters.q) params.set('q', filters.q);
  params.set('sort', filters.sort);
  params.set('dir', filters.dir);
  params.set('seed', String(filters.seed));
  params.set('limit', '60');
  if (cursor) params.set('cursor', cursor);
  return params.toString();
}

export const api = {
  dashboard: () => request<DashboardResponse>('/api/dashboard'),
  libraries: () => request<LibraryWithStats[]>('/api/libraries'),
  library: (id: number) => request<LibraryWithStats>(`/api/libraries/${id}`),
  createLibrary: (body: { name: string; type: string; autoScanInterval?: number }) =>
    request<LibraryWithStats>('/api/libraries', { method: 'POST', body: JSON.stringify(body) }),
  updateLibrary: (
    id: number,
    body: { name?: string; type?: string; autoScanInterval?: number; thumbnailMediaId?: number | null },
  ) => request<LibraryWithStats>(`/api/libraries/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteLibrary: (id: number) => request<{ ok: true }>(`/api/libraries/${id}`, { method: 'DELETE' }),
  addFolder: (libraryId: number, path: string) =>
    request(`/api/libraries/${libraryId}/folders`, { method: 'POST', body: JSON.stringify({ path }) }),
  removeFolder: (folderId: number) => request(`/api/folders/${folderId}`, { method: 'DELETE' }),
  scanLibrary: (id: number) => request<{ job: Job }>(`/api/libraries/${id}/scan`, { method: 'POST' }),
  mediaList: (filters: MediaFilters, cursor?: string) =>
    request<MediaListResponse>(`/api/media?${mediaQueryString(filters, cursor)}`),
  mediaDetail: (id: number) => request<MediaDetail>(`/api/media/${id}`),
  patchTags: (id: number, body: { add?: string[]; remove?: string[] }) =>
    request<MediaDetail>(`/api/media/${id}/tags`, { method: 'PATCH', body: JSON.stringify(body) }),
  retag: (id: number) => request<{ job: Job }>(`/api/media/${id}/retag`, { method: 'POST' }),
  regenerateThumbnail: (id: number) => request<{ ok: true }>(`/api/media/${id}/thumbnail/regenerate`, { method: 'POST' }),
  saveProgress: (id: number, progress: number) =>
    request(`/api/media/${id}/progress`, { method: 'PATCH', body: JSON.stringify({ progress }) }),
  tags: (opts: { q?: string; libraryId?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts.q) params.set('q', opts.q);
    if (opts.libraryId) params.set('libraryId', String(opts.libraryId));
    if (opts.limit) params.set('limit', String(opts.limit));
    return request<TagCount[]>(`/api/tags?${params}`);
  },
  jobs: () => request<Job[]>('/api/jobs'),
  settings: () => request<Settings>('/api/settings'),
  patchSettings: (body: Partial<Record<keyof Settings, string>>) =>
    request<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  system: () => request<SystemInfo>('/api/system'),
  clearThumbnails: () => request<{ removed: number }>('/api/system/clear-thumbnails', { method: 'POST' }),
  taggerStatus: () => request<TaggerStatus>('/api/tagger/status'),
  taggerDownload: () => request<{ job: Job }>('/api/tagger/download', { method: 'POST' }),
};

export const fileUrl = (id: number) => `/api/media/${id}/file`;
export const thumbUrl = (id: number, cacheBust?: number) =>
  cacheBust ? `/api/media/${id}/thumbnail?v=${cacheBust}` : `/api/media/${id}/thumbnail`;
