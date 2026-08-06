export type LibraryType = 'image' | 'video' | 'mixed';
export type MediaType = 'image' | 'video';
export type MediaSource = 'folder' | 'upload';
export type FolderStatus = 'pending' | 'scanning' | 'indexed' | 'error';
export type JobType = 'scan' | 'tag' | 'thumbnail' | 'model-download' | 'hash' | 'cleanup';
export type JobStatus = 'queued' | 'running' | 'done' | 'error';
export type TagCategory = 'rating' | 'general' | 'character' | 'user';
export type TagSource = 'ai' | 'user';
export type SortMode = 'recent' | 'name' | 'random';
export type SortDir = 'asc' | 'desc';
export type ModelStatus = 'absent' | 'downloading' | 'ready' | 'error';
export type ScheduleMode = 'off' | 'interval' | 'after-scan';

export interface Library {
  id: number;
  name: string;
  type: LibraryType;
  thumbnailMediaId: number | null;
  customImagePath: string | null;
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
  liked: boolean;
  likedAt: number | null;
  perceptualHash?: string | null;
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
  liked?: boolean;
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
  remember_volume_level: string;
  autosearch_first_tag: string;
  continue_where_left: string;
  thumbnail_cache_enabled: string;
  board_remember_filters: string;
  tagger_model: string;
}

export interface DashboardResponse {
  libraries: LibraryWithStats[];
  continueWatching: Media[];
  recentlyViewed: Media[];
  recentlyAdded: Media[];
  likedCount: number;
  likedSampleId: number | null;
}

export interface TaggerModel {
  id: string;
  label: string;
  repo: string;
}

export interface TaggerStatus {
  status: ModelStatus;
  model: string;
  modelSizeBytes: number | null;
  tagCount: number | null;
  untaggedCount: number;
  unhashedCount: number;
}

export interface SimilarResponse {
  duplicates: Media[];
  similar: Media[];
}

export interface SystemInfo {
  version: string;
  mediaCount: number;
  mediaBytes: number;
  dbBytes: number;
  thumbBytes: number;
}

export interface JobSchedule {
  mode: ScheduleMode;
  intervalMinutes: number;
  useGlobal?: boolean;
}

export interface JobSchedulesPayload {
  globals: Record<string, JobSchedule>;
  perLibrary: Record<number, Record<string, JobSchedule>>;
}
