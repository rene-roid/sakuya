import type {
  DashboardResponse,
  DownloadBatchWithItems,
  DownloadCookie,
  DownloadLogLine,
  DownloaderStatus,
  Job,
  LibraryWithStats,
  MediaDetail,
  MediaListResponse,
  ScheduleMode,
  Settings,
  SimilarResponse,
  SystemInfo,
  TagCategory,
  TagCount,
  TaggerModel,
  TaggerStatus,
  JobSchedulesPayload,
} from '@sakuya/shared';

export type ScheduleJobType = 'scan' | 'tag' | 'hash' | 'cleanup';

export interface UpdateJobScheduleBody {
  jobType: ScheduleJobType;
  libraryId?: number | null;
  mode?: ScheduleMode;
  intervalMinutes?: number;
  useGlobal?: boolean;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData sets its own multipart Content-Type (with boundary); don't override it.
  const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const res = await fetch(path, {
    ...init,
    headers: init?.body && !isForm ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
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
  liked?: boolean;
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
  if (filters.liked) params.set('liked', '1');
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
  patchTags: (
    id: number,
    body: { add?: string[]; remove?: string[]; category?: TagCategory; setCategory?: Record<string, TagCategory> },
  ) => request<MediaDetail>(`/api/media/${id}/tags`, { method: 'PATCH', body: JSON.stringify(body) }),
  likeMedia: (id: number, liked: boolean) =>
    request<MediaDetail>(`/api/media/${id}/like`, { method: 'PATCH', body: JSON.stringify({ liked }) }),
  similar: (id: number) => request<SimilarResponse>(`/api/media/${id}/similar`),
  retag: (id: number) => request<{ job: Job }>(`/api/media/${id}/retag`, { method: 'POST' }),
  regenerateThumbnail: (id: number) => request<{ ok: true }>(`/api/media/${id}/thumbnail/regenerate`, { method: 'POST' }),
  saveProgress: (id: number, progress: number) =>
    request(`/api/media/${id}/progress`, { method: 'PATCH', body: JSON.stringify({ progress }) }),
  tags: (opts: { q?: string; libraryId?: number; limit?: number; category?: TagCategory | TagCategory[] }) => {
    const params = new URLSearchParams();
    if (opts.q) params.set('q', opts.q);
    if (opts.libraryId) params.set('libraryId', String(opts.libraryId));
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.category) params.set('category', ([] as TagCategory[]).concat(opts.category).join(','));
    return request<TagCount[]>(`/api/tags?${params}`);
  },
  jobs: () => request<Job[]>('/api/jobs'),
  settings: () => request<Settings>('/api/settings'),
  patchSettings: (body: Partial<Record<keyof Settings, string>>) =>
    request<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  system: () => request<SystemInfo>('/api/system'),
  clearThumbnails: () => request<{ removed: number }>('/api/system/clear-thumbnails', { method: 'POST' }),
  jobSchedules: () => request<JobSchedulesPayload>('/api/job-schedules'),
  updateJobSchedule: (body: UpdateJobScheduleBody) =>
    request<{ ok: true }>('/api/job-schedules', { method: 'PATCH', body: JSON.stringify(body) }),
  runJobsNow: (scope: 'global' | { libraryId: number }, jobType?: ScheduleJobType) =>
    request<{ ok: true }>('/api/jobs/run-now', {
      method: 'POST',
      body: JSON.stringify(jobType ? { scope, jobType } : { scope }),
    }),
  regenerateAllThumbnails: () => request<{ ok: true }>('/api/system/regenerate-thumbnails', { method: 'POST' }),
  cleanupData: () => request<{ removedThumbs: number; resetTagCounts: number }>('/api/system/cleanup', { method: 'POST' }),
  taggerStatus: () => request<TaggerStatus>('/api/tagger/status'),
  taggerDownload: () => request<{ job: Job }>('/api/tagger/download', { method: 'POST' }),
  taggerTagAll: () => request<{ job: Job }>('/api/tagger/tag-all', { method: 'POST' }),
  taggerModels: () => request<TaggerModel[]>('/api/tagger/models'),
  selectTaggerModel: (modelId: string) =>
    request<TaggerStatus>('/api/tagger/select', { method: 'POST', body: JSON.stringify({ modelId }) }),
  taggerHashAll: () => request<{ job: Job }>('/api/tagger/hash-all', { method: 'POST' }),
  uploadLibraryCover: (id: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<LibraryWithStats>(`/api/libraries/${id}/cover`, { method: 'POST', body: form });
  },
  removeLibraryCover: (id: number) =>
    request<LibraryWithStats>(`/api/libraries/${id}/cover`, { method: 'DELETE' }),
  downloaderStatus: () => request<DownloaderStatus>('/api/downloader/status'),
  installDownloader: () => request<{ job: Job }>('/api/downloader/install', { method: 'POST' }),
  resolveDownloaderPath: (path: string) =>
    request<{ library: LibraryWithStats | null }>(`/api/downloader/resolve-path?path=${encodeURIComponent(path)}`),
  listCookies: () => request<DownloadCookie[]>('/api/downloader/cookies'),
  uploadCookies: (files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append('files', file);
    return request<DownloadCookie[]>('/api/downloader/cookies', { method: 'POST', body: form });
  },
  deleteCookie: (id: number) => request<{ ok: true }>(`/api/downloader/cookies/${id}`, { method: 'DELETE' }),
  createDownloadBatch: (body: {
    libraryId: number;
    folderPath: string;
    urls: string[];
    extraArgs?: string;
    cookieFileId?: number | null;
  }) => request<DownloadBatchWithItems>('/api/downloader/batches', { method: 'POST', body: JSON.stringify(body) }),
  listDownloadBatches: () => request<DownloadBatchWithItems[]>('/api/downloader/batches'),
  downloadItemLogs: (id: number, after?: number) =>
    request<DownloadLogLine[]>(`/api/downloader/items/${id}/logs${after ? `?after=${after}` : ''}`),
  pauseDownloadItem: (id: number) => request<{ ok: true }>(`/api/downloader/items/${id}/pause`, { method: 'POST' }),
  resumeDownloadItem: (id: number) => request<{ ok: true }>(`/api/downloader/items/${id}/resume`, { method: 'POST' }),
  skipDownloadItem: (id: number) => request<{ ok: true }>(`/api/downloader/items/${id}/skip`, { method: 'POST' }),
  removeDownloadItem: (id: number, deleteFiles: boolean) =>
    request<{ ok: true }>(`/api/downloader/items/${id}`, { method: 'DELETE', body: JSON.stringify({ deleteFiles }) }),
};

export const fileUrl = (id: number) => `/api/media/${id}/file`;
export const thumbUrl = (id: number, cacheBust?: number) =>
  cacheBust ? `/api/media/${id}/thumbnail?v=${cacheBust}` : `/api/media/${id}/thumbnail`;
export const libraryCoverUrl = (id: number, cacheBust?: number) =>
  cacheBust ? `/api/libraries/${id}/cover?v=${cacheBust}` : `/api/libraries/${id}/cover`;
