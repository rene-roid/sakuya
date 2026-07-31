export type LibraryType = 'image' | 'video' | 'mixed';
export type MediaType = 'image' | 'video';
export type MediaSource = 'folder' | 'upload';
export type FolderStatus = 'pending' | 'scanning' | 'indexed' | 'error';
export type JobType = 'scan' | 'tag' | 'thumbnail' | 'model-download';
export type JobStatus = 'queued' | 'running' | 'done' | 'error';
export type TagCategory = 'rating' | 'general' | 'character' | 'user';
export type TagSource = 'ai' | 'user';
export type SortMode = 'recent' | 'name' | 'random';
export type SortDir = 'asc' | 'desc';
export type ModelStatus = 'absent' | 'downloading' | 'ready' | 'error';

export interface Library {
  id: number;
  name: string;
  type: LibraryType;
  thumbnailMediaId: number | null;
  createdAt: number;
  lastVisitedAt: number | null;
  autoScanInterval: number;
}

export interface LibraryWithStats extends Library {
  itemCount: number;
  thumbMediaId: number | null;
  folders: Folder[];
}

export interface Folder {
  id: number;
  libraryId: number;
  path: string;
  status: FolderStatus;
  createdAt: number;
}

export interface Media {
  id: number;
  libraryId: number;
  source: MediaSource;
  path: string;
  filename: string;
  type: MediaType;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  durationSeconds: number | null;
  createdAt: number;
  indexedAt: number | null;
  taggedAt: number | null;
  lastViewedAt: number | null;
  viewProgress: number;
  tagCount: number;
  libraryName?: string;
}

export interface MediaTag {
  name: string;
  category: TagCategory;
  confidence: number | null;
  source: TagSource;
}

export interface MediaDetail extends Media {
  tags: MediaTag[];
}

export interface TagCount {
  name: string;
  category: TagCategory;
  count: number;
}

export interface Job {
  id: number;
  type: JobType;
  libraryId: number | null;
  label: string;
  status: JobStatus;
  progress: number;
  total: number;
  log: string;
  createdAt: number;
  updatedAt: number;
}

export interface MediaListQuery {
  libraryId?: number;
  type?: MediaType;
  tags?: string[];
  q?: string;
  sort?: SortMode;
  dir?: SortDir;
  seed?: number;
  cursor?: string;
  limit?: number;
}

export interface MediaListResponse {
  items: Media[];
  nextCursor: string | null;
  total: number;
}

export interface Settings {
  ai_tagging_enabled: string;
  confidence_threshold: string;
  accent_color: string;
  model_status: ModelStatus;
  remember_mute_state: string;
}

export interface DashboardResponse {
  libraries: LibraryWithStats[];
  continueWatching: Media[];
  recentlyAdded: Media[];
}

export interface TaggerStatus {
  status: ModelStatus;
  modelSizeBytes: number | null;
  tagCount: number | null;
  untaggedCount: number;
}

export interface SystemInfo {
  version: string;
  mediaCount: number;
  mediaBytes: number;
  dbBytes: number;
  thumbBytes: number;
}
