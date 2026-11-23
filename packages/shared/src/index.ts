// Runtime arrays, so the server's drizzle columns and zod schemas validate against the same lists.
export const LIBRARY_TYPES = ['image', 'video', 'mixed'] as const;
export const MEDIA_TYPES = ['image', 'video'] as const;
export const JOB_TYPES = [
  'scan',
  'tag',
  'thumbnail',
  'model-download',
  'hash',
  'cleanup',
  'downloader-install',
  'reclassify-gifs',
  'transcode',
  'backup',
  'characters',
  'embeddings',
] as const;
export const TAG_CATEGORIES = ['rating', 'general', 'character', 'user'] as const;
/** Who linked a tag to a media item. `character` links come from a named character and survive retagging. */
export const TAG_SOURCES = ['ai', 'user', 'character'] as const;
/** How a detection joined its character: clustering, a person's choice, or a person's "not this one". */
export const CHARACTER_ASSIGNMENTS = ['auto', 'user', 'rejected'] as const;
export const SCHEDULE_MODES = ['off', 'interval', 'after-scan'] as const;
export const SCHEDULE_JOB_TYPES = ['scan', 'tag', 'hash', 'cleanup', 'backup'] as const;

/**
 * Tags are stored lowercase with underscores for spaces. Every user-typed name goes through this, on
 * the server before it is stored or matched and in the web app before it lands in a filter, so both
 * spell a tag the same way.
 */
export function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}

export interface TagLabelParts {
  label: string;
  /** A booru disambiguator like the `sao` in `asuna_(sao)`, shown muted beside the label. */
  qualifier: string | null;
}

const QUALIFIED = /^(.+?)_\(([^()]+)\)$/;

/**
 * The automatic human form of a canonical tag name. Underscores become spaces and a trailing
 * `_(qualifier)` is split off. Characters are names, so every word is capitalised; ratings get a
 * leading capital; general and user tags stay lowercase, the way booru tags read in a list. Names of
 * three characters or fewer are left alone, since that is where emoticon tags like `^_^` live.
 */
export function prettifyTag(name: string, category?: TagCategory): TagLabelParts {
  if (name.length <= 3) return { label: name, qualifier: null };
  const match = QUALIFIED.exec(name);
  const spaced = (s: string) => s.replace(/_+/g, ' ').trim();
  const base = spaced(match ? match[1] : name);
  const qualifier = match ? spaced(match[2]) : null;
  const label =
    category === 'character'
      ? base.replace(/(^|\s)(\S)/g, (_, gap: string, c: string) => gap + c.toUpperCase())
      : category === 'rating'
        ? base.charAt(0).toUpperCase() + base.slice(1)
        : base;
  return { label: label || name, qualifier: label ? qualifier : null };
}

/** What a tag is called on screen: its display name if the user gave it one, else the automatic form. */
export function tagLabel(tag: { name: string; category?: TagCategory; displayName?: string | null }): TagLabelParts {
  const custom = tag.displayName?.trim();
  return custom ? { label: custom, qualifier: null } : prettifyTag(tag.name, tag.category);
}

/** tagLabel as one string, for places that can't style a subtitle (titles, toasts, aria labels). */
export function tagLabelText(tag: { name: string; category?: TagCategory; displayName?: string | null }): string {
  const { label, qualifier } = tagLabel(tag);
  return qualifier ? `${label} (${qualifier})` : label;
}

type LibraryType = (typeof LIBRARY_TYPES)[number];
type MediaType = (typeof MEDIA_TYPES)[number];
type MediaSource = 'folder' | 'upload';
type FolderStatus = 'pending' | 'scanning' | 'indexed' | 'error';
export type JobType = (typeof JOB_TYPES)[number];
type JobStatus = 'queued' | 'running' | 'done' | 'error';
export type TagCategory = (typeof TAG_CATEGORIES)[number];
type TagSource = (typeof TAG_SOURCES)[number];
export type CharacterAssignment = (typeof CHARACTER_ASSIGNMENTS)[number];
type ModelStatus = 'absent' | 'downloading' | 'ready' | 'error';
export type ScheduleMode = (typeof SCHEDULE_MODES)[number];
export type ScheduleJobType = (typeof SCHEDULE_JOB_TYPES)[number];

export interface Library {
  id: number;
  name: string;
  type: LibraryType;
  thumbnailMediaId: number | null;
  customImagePath: string | null;
  createdAt: number;
  lastVisitedAt: number | null;
  sortOrder: number;
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
  viewCount: number;
  watchedSeconds: number;
  /** Seconds an image/GIF was open in the viewer (foreground only). */
  dwellSeconds: number;
  liked: boolean;
  likedAt: number | null;
  perceptualHash?: string | null;
  tagCount: number;
  libraryName?: string;
  /** Discover only: the taste-profile tag that scored this item highest. */
  reasonTag?: string;
  /** Discover only: true when reasonTag is a related tag rather than one you engaged with directly. */
  reasonRelated?: boolean;
}

export interface MediaTag {
  name: string;
  category: TagCategory;
  displayName: string | null;
  confidence: number | null;
  source: TagSource;
}

export interface MediaDetail extends Media {
  tags: MediaTag[];
  /** Boards this media belongs to — the membership marker, editable from the viewer. */
  boards: Board[];
}

export interface Board {
  id: number;
  name: string;
  createdAt: number;
}

export interface BoardWithStats extends Board {
  itemCount: number;
  thumbMediaId: number | null;
}

export interface TagCount {
  name: string;
  category: TagCategory;
  displayName: string | null;
  count: number;
}

export interface TagInfo {
  name: string;
  category: TagCategory;
  displayName: string | null;
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

/** A user's standing instruction for one tag in Discover. "less" halves its weight, "boost" doubles it,
 * "mute" removes every item carrying it. */
export const DISCOVER_TAG_MODES = ['boost', 'less', 'mute'] as const;
export type DiscoverTagMode = (typeof DISCOVER_TAG_MODES)[number];

export interface DiscoverTasteTag extends TagInfo {
  /** Strength in the profile before boost/less/mute, relative to the strongest tag (0..1). */
  weight: number;
  /** Reached through co-occurrence with tags you like rather than your own engagement. */
  related: boolean;
  mode: DiscoverTagMode | null;
}

export interface DiscoverProfileResponse {
  tags: DiscoverTasteTag[];
  /** Tags still steering the feed: zero when nothing is liked yet or every taste tag is muted. */
  activeTags: number;
  hiddenCount: number;
}

export interface DiscoverShelf {
  id: string;
  title: string;
  subtitle: string;
  /** The tag a "because you like" shelf is built on. */
  tag?: string;
  items: Media[];
}

export interface DiscoverShelvesResponse {
  shelves: DiscoverShelf[];
}

export interface DiscoverLikeResponse {
  source: Media;
  /** Ranked by shared tags, rarest counting most; reasonTag is the rarest one each item shares. */
  items: Media[];
  /** `visual` when image embeddings were blended into the tag ranking. */
  ranking: 'tags' | 'visual';
}

export interface MediaListResponse {
  items: Media[];
  nextCursor: string | null;
  /**
   * Count of everything matching the filter, not of this page. Only the first request of a
   * result set computes it; cursor-paginated follow-ups return null, since the filter — and so
   * the count — hasn't changed. Clients should keep the first page's value.
   */
  total: number | null;
  /** Set on a search by description (`describe`): whether it could run, and how much is indexed. */
  semantic?: SemanticSearchInfo;
}

export interface SemanticSearchInfo {
  /**
   * `disabled`: the setting is off. `no-model`: the model is not downloaded. `empty`: nothing is
   * embedded yet. `ready`: ranked over the embedded files.
   */
  status: 'disabled' | 'no-model' | 'empty' | 'ready';
  embeddedCount: number;
  /** Files the embeddings job has not reached yet; they are left out of the ranking. */
  pendingCount: number;
}

export interface SemanticStatus {
  status: ModelStatus;
  enabled: boolean;
  modelSizeBytes: number | null;
  embeddedCount: number;
  pendingCount: number;
}

export interface MediaIdsResponse {
  ids: number[];
  total: number;
}

/** Per-item outcome of a bulk mutation — batch routes never fail wholesale on one bad row. */
export interface BulkFailure {
  id: number;
  error: string;
}

export interface BulkResult {
  ok: true;
  updated: number;
  failed: BulkFailure[];
}

export interface BulkRenameItem {
  id: number;
  filename: string;
}

export interface Settings {
  ai_tagging_enabled: string;
  /** Percent; applies to general tags. */
  confidence_threshold: string;
  /** Percent; applies to character tags. */
  confidence_threshold_character: string;
  accent_color: string;
  remember_mute_state: string;
  remember_volume_level: string;
  continue_where_left: string;
  thumbnail_cache_enabled: string;
  board_remember_filters: string;
  tagger_model: string;
  downloader_concurrency: string;
  gifs_as_videos: string;
  video_transcode_enabled: string;
  discover_enabled: string;
  ui_style: UiStyle;
  ui_style_chosen: string;
  dashboard_hero: string;
  /** How many database backups to keep; older ones are deleted after each backup. */
  backup_keep: string;
  character_detection_enabled: string;
  /** Search by description: the Describe toggle, and indexing new files after each scan. */
  semantic_search_enabled: string;
}

export type UiStyle = 'glass' | 'classic';

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

/** Normalized 0-1 to the displayed image. */
export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CharacterDetection {
  id: number;
  mediaId: number;
  bbox: BoundingBox;
  score: number;
  characterId: number | null;
  /** The character's tag name, when it is named. */
  characterName: string | null;
  assignment: CharacterAssignment;
  cropUrl: string;
}

export interface CharacterSuggestion {
  /** A WD character tag most of the cluster's `solo` images carry. */
  tag: string;
  /** Solo images in the cluster carrying the tag, out of `soloCount`. */
  mediaCount: number;
  soloCount: number;
}

export interface CharacterSummary {
  id: number;
  tagId: number | null;
  /** The tag name; null until named. */
  name: string | null;
  hidden: boolean;
  createdAt: number;
  mediaCount: number;
  detectionCount: number;
  coverDetectionId: number | null;
  coverUrl: string | null;
  suggestion: CharacterSuggestion | null;
}

export interface CharactersResponse {
  named: CharacterSummary[];
  /** Unnamed clusters with a name suggestion. */
  suggested: CharacterSummary[];
  unnamed: CharacterSummary[];
  /** Detections not (yet) in any character. */
  unassignedCount: number;
}

export interface CharacterMediaResponse {
  character: CharacterSummary;
  items: Media[];
  /** This character's detections on `items`, rejected ones included. */
  detections: CharacterDetection[];
  total: number;
  nextOffset: number | null;
}

export interface CharacterModelStatus {
  status: ModelStatus;
  enabled: boolean;
  modelSizeBytes: number | null;
  /** Images and videos the character job has not looked at yet. */
  pendingCount: number;
  detectionCount: number;
  characterCount: number;
}

export interface SimilarResponse {
  duplicates: Media[];
  similar: Media[];
}

export interface DuplicateGroup {
  contentHash: string;
  items: Media[];
  wastedBytes: number;
}

export interface DuplicatesResponse {
  groups: DuplicateGroup[];
  groupCount: number;
  fileCount: number;
  wastedBytes: number;
}

export interface SystemInfo {
  version: string;
  mediaCount: number;
  mediaBytes: number;
  dbBytes: number;
  thumbBytes: number;
  /** How this copy was installed, which decides how it updates. */
  installKind: InstallKind;
}

export type InstallKind = 'desktop' | 'docker' | 'source';

export interface BackupFile {
  name: string;
  sizeBytes: number;
  createdAt: number;
}

export interface BackupsPayload {
  backups: BackupFile[];
  keep: number;
  dir: string;
}

/** A deleted media item waiting in <dataDir>/trash until it is restored or purged. */
export interface TrashItem {
  id: number;
  mediaId: number;
  libraryId: number;
  /** Null when the library was deleted after the item was trashed. */
  libraryName: string | null;
  filename: string;
  type: MediaType;
  sizeBytes: number;
  originalPath: string;
  trashedAt: number;
  /** When the automatic purge removes it for good. */
  expiresAt: number;
}

export interface TrashPayload {
  items: TrashItem[];
  count: number;
  totalBytes: number;
  retentionDays: number;
}

export interface TrashRestoreResult {
  ok: true;
  mediaId: number;
  path: string;
  /** True when a file already sat at the original path, so the item came back under a new name. */
  renamed: boolean;
}

export interface TrashRemoveResult {
  ok: true;
  removed: number;
  freedBytes: number;
}

export interface StorageInfo {
  /** Data dir this process actually booted with. */
  current: string;
  home: string;
  local: string;
  usingHome: boolean;
  /** SAKUYA_DATA_DIR is set (Docker), so the location can't be changed from the UI. */
  locked: boolean;
}

export interface AuthStatus {
  enabled: boolean;
  unlocked: boolean;
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

export type DownloadItemStatus = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'skipped';

export interface DownloadBatch {
  id: number;
  libraryId: number;
  folderPath: string;
  extraArgs: string | null;
  cookieFileId: number | null;
  createdAt: number;
}

export interface DownloadItem {
  id: number;
  batchId: number;
  url: string;
  status: DownloadItemStatus;
  filesDownloaded: number;
  pid: number | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DownloadBatchWithItems extends DownloadBatch {
  items: DownloadItem[];
}

export interface DownloadCookie {
  id: number;
  filename: string;
  uploadedAt: number;
}

export interface DownloaderStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
}

export interface DownloadLogLine {
  id: number;
  itemId: number;
  line: string;
  createdAt: number;
}

export interface ConsoleSessionStatus {
  running: boolean;
  pid: number | null;
  command: string | null;
  startedAt: number | null;
}

export interface SavedSearch {
  id: number;
  name: string;
  query: string;
  createdAt: number;
}
