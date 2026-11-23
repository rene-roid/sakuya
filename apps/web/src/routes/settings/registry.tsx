import type { ComponentType, ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { Settings } from '@sakuya/shared';
import { api } from '../../lib/api';
import {
  AccentColorControl,
  HashImagesControl,
  HashImagesMeta,
  HomeFolderControl,
  InterfaceStyleControl,
  ScheduleControl,
  StatValue,
  TagUntaggedControl,
  TagUntaggedMeta,
  TaggerModelControl,
  TaggerModelMeta,
  ThumbnailSizeMeta,
  HomeFolderMeta,
  DuplicatesLink,
  UploadsLink,
} from './controls';
import { LibraryManager } from './LibraryManager';
import { PerLibrarySchedules } from './JobSchedules';
import { JobHistory } from './JobHistory';
import { ReleaseNotes } from './ReleaseNotes';
import {
  BackupList,
  BackupNowControl,
  BackupNowMeta,
  BackupScheduleLink,
  BackupScheduleMeta,
  TrashControl,
  TrashMeta,
} from './BackupsAndTrash';
import { UpdatesPanel } from '../../components/UpdatesPanel';

export type SettingsKey = keyof Settings;

export type SectionId = 'general' | 'playback' | 'libraries' | 'tagging' | 'processing' | 'jobs' | 'storage' | 'about';

export interface SettingsSection {
  id: SectionId;
  label: string;
  /** The sidebar heading the section sits under. */
  group: 'Preferences' | 'Library' | 'System';
  subtitle: string;
}

export const SECTIONS: readonly SettingsSection[] = [
  { id: 'general', label: 'General', group: 'Preferences', subtitle: 'How Sakuya looks and what it remembers.' },
  { id: 'playback', label: 'Playback', group: 'Preferences', subtitle: 'Video and viewer behaviour.' },
  { id: 'libraries', label: 'Libraries', group: 'Library', subtitle: 'Folders, scanning and indexing.' },
  { id: 'tagging', label: 'AI Tagging', group: 'Library', subtitle: 'The tagger model and what it keeps.' },
  {
    id: 'processing',
    label: 'Media processing',
    group: 'Library',
    subtitle: 'Thumbnails, transcodes and image hashes.',
  },
  { id: 'jobs', label: 'Jobs', group: 'Library', subtitle: 'When background work runs.' },
  {
    id: 'storage',
    label: 'Storage',
    group: 'System',
    subtitle: 'Where data lives, how big it is, backups and the trash.',
  },
  { id: 'about', label: 'About', group: 'System', subtitle: 'Version, updates and release notes.' },
];

/** A confirmation shown before an action runs, or before a toggle turns off. */
export interface ConfirmSpec {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
}

/**
 * One setting. Adding a setting is adding one of these to `SETTINGS`; the page, search and deep
 * links all come from it.
 *
 * - `toggle`, `select` and `slider` read and write one `Settings` key and need no component.
 * - `action` is a button that runs `run` and toasts the string it resolves to.
 * - `custom` renders `Control` on the right of the row, or with `block`, full width under the label
 *   (for hand-built panels like the library manager). List any `Settings` keys it writes in `keys`.
 */
interface SettingBase {
  /** Kebab-case and stable: it's the deep link, `/settings?tab=<section>#<id>`. */
  id: string;
  section: SectionId;
  /** Rows with the same group share one panel under a small heading. */
  group: string;
  label: string;
  description: string;
  /** Extra space-separated words search should find this by, beyond the label and description. */
  keywords: string;
  /** A status line under the description, like the size of a cache. */
  Meta?: ComponentType;
}

export interface ToggleEntry extends SettingBase {
  kind: 'toggle';
  key: SettingsKey;
  /** On when the key is missing; only an explicit '0' turns it off. */
  defaultOn?: boolean;
  confirmOff?: ConfirmSpec;
}

export interface SelectEntry extends SettingBase {
  kind: 'select';
  key: SettingsKey;
  options: readonly { value: string; label: string }[];
  fallback: string;
}

export interface SliderEntry extends SettingBase {
  kind: 'slider';
  key: SettingsKey;
  min: number;
  max: number;
  step?: number;
  fallback: number;
  unit?: string;
}

export interface ActionEntry extends SettingBase {
  kind: 'action';
  button: string;
  tone?: 'default' | 'danger' | 'primary';
  confirm?: ConfirmSpec;
  /** Resolves to the toast to show, if any. */
  run: (queryClient: QueryClient) => Promise<string | void>;
}

export interface CustomEntry extends SettingBase {
  kind: 'custom';
  Control: ComponentType;
  block?: boolean;
  keys?: SettingsKey[];
}

export type SettingEntry = ToggleEntry | SelectEntry | SliderEntry | ActionEntry | CustomEntry;

export const SETTINGS: readonly SettingEntry[] = [
  // General
  {
    id: 'interface-style',
    section: 'general',
    group: 'Appearance',
    label: 'Interface style',
    description: 'The original look, or the frosted Liquid Glass one.',
    keywords: 'theme glass classic ui look',
    kind: 'custom',
    Control: InterfaceStyleControl,
    keys: ['ui_style'],
  },
  {
    id: 'accent-color',
    section: 'general',
    group: 'Appearance',
    label: 'Accent color',
    description: 'Used for highlights, toggles and primary buttons.',
    keywords: 'colour theme purple teal rose',
    kind: 'custom',
    Control: AccentColorControl,
    keys: ['accent_color'],
  },
  {
    id: 'dashboard-banner',
    section: 'general',
    group: 'Appearance',
    label: 'Dashboard banner',
    description: 'The welcome banner at the top of the dashboard. Liquid Glass only.',
    keywords: 'hero header home',
    kind: 'toggle',
    key: 'dashboard_hero',
    defaultOn: true,
  },
  {
    id: 'remember-explore-filters',
    section: 'general',
    group: 'Explore',
    label: 'Remember explore filters',
    description: 'Restore your last Explore filters when you come back. Off resets the page each time you leave.',
    keywords: 'search tags board',
    kind: 'toggle',
    key: 'board_remember_filters',
    defaultOn: true,
  },
  {
    id: 'discover-enabled',
    section: 'general',
    group: 'Explore',
    label: 'Discover tab',
    description:
      'Recommend media from the tags you like, watch and linger on. Viewing is tracked either way, so the feed is warm when you switch it on.',
    keywords: 'recommendations feed taste for you',
    kind: 'toggle',
    key: 'discover_enabled',
  },

  // Playback
  {
    id: 'continue-watching',
    section: 'playback',
    group: 'Video',
    label: 'Continue where you left off',
    description: 'Resume videos at the position you last stopped watching.',
    keywords: 'resume progress position',
    kind: 'toggle',
    key: 'continue_where_left',
    defaultOn: true,
  },
  {
    id: 'remember-volume',
    section: 'playback',
    group: 'Video',
    label: 'Remember volume level',
    description: 'The volume you set on a video carries over to the next one.',
    keywords: 'sound audio loudness',
    kind: 'toggle',
    key: 'remember_volume_level',
    defaultOn: true,
  },
  {
    id: 'remember-mute',
    section: 'playback',
    group: 'Video',
    label: 'Remember mute state',
    description: 'Muting or unmuting a video carries over to the next one.',
    keywords: 'sound audio silent',
    kind: 'toggle',
    key: 'remember_mute_state',
  },

  // Libraries
  {
    id: 'library-manager',
    section: 'libraries',
    group: 'Libraries',
    label: 'Your libraries',
    description: 'Add folders, rename, reorder, set covers and auto-scan per library. Folders are read-only.',
    keywords: 'folders add create path rename reorder cover thumbnail scan auto-scan interval',
    kind: 'custom',
    block: true,
    Control: LibraryManager,
  },
  {
    id: 'scan-all',
    section: 'libraries',
    group: 'Indexing',
    label: 'Scan all libraries',
    description: 'Look for new, changed and removed files in every library now.',
    keywords: 'rescan refresh index',
    kind: 'action',
    button: 'Scan all',
    run: async () => {
      for (const lib of await api.libraries()) await api.scanLibrary(lib.id);
      return 'Scan started for all libraries';
    },
  },
  {
    id: 'gifs-as-videos',
    section: 'libraries',
    group: 'Indexing',
    label: 'Detect GIFs as videos',
    description: 'Treat .gif files as videos for filters, badges and duration. New scans pick this up.',
    keywords: 'animated classify',
    kind: 'toggle',
    key: 'gifs_as_videos',
  },
  {
    id: 'reclassify-gifs',
    section: 'libraries',
    group: 'Indexing',
    label: 'Reclassify existing GIFs',
    description: 'Apply the GIF setting to files that are already indexed.',
    keywords: 'rescan animated',
    kind: 'action',
    button: 'Run now',
    run: async () => {
      await api.reclassifyGifs();
      return 'Reclassifying existing GIFs…';
    },
  },
  {
    id: 'uploads',
    section: 'libraries',
    group: 'Uploads',
    label: 'Upload files',
    description: 'Uploads moved to each library: use Upload on a library page, or drop files onto its grid.',
    keywords: 'upload drag drop import add files moved',
    kind: 'custom',
    Control: UploadsLink,
  },

  // AI Tagging
  {
    id: 'tagger-model',
    section: 'tagging',
    group: 'Model',
    label: 'Tagger model',
    description: 'The anime tagger that labels new imports. Switching models needs a new download.',
    keywords: 'onnx wd swinv2 eva02 vit convnext download',
    kind: 'custom',
    Control: TaggerModelControl,
    Meta: TaggerModelMeta,
    keys: ['tagger_model'],
  },
  {
    id: 'auto-tag',
    section: 'tagging',
    group: 'Model',
    label: 'Auto-tag on import',
    description: 'Run the tagger on newly scanned or uploaded files.',
    keywords: 'automatic ai tagging enable',
    kind: 'toggle',
    key: 'ai_tagging_enabled',
  },
  {
    id: 'confidence-threshold',
    section: 'tagging',
    group: 'Model',
    label: 'General tag threshold',
    description: 'General tags scoring below this are discarded.',
    keywords: 'confidence accuracy score cutoff precision',
    kind: 'slider',
    key: 'confidence_threshold',
    min: 0,
    max: 100,
    fallback: 35,
    unit: '%',
  },
  {
    id: 'character-threshold',
    section: 'tagging',
    group: 'Model',
    label: 'Character tag threshold',
    description: 'Character tags scoring below this are discarded. Kept high because a wrong character name is worse than none.',
    keywords: 'confidence accuracy score cutoff precision character names',
    kind: 'slider',
    key: 'confidence_threshold_character',
    min: 0,
    max: 100,
    fallback: 85,
    unit: '%',
  },
  {
    id: 'tag-untagged',
    section: 'tagging',
    group: 'Run',
    label: 'Tag untagged files',
    description: 'Run the tagger on everything without AI tags.',
    keywords: 'bulk tag all',
    kind: 'custom',
    Control: TagUntaggedControl,
    Meta: TagUntaggedMeta,
  },

  // Media processing
  {
    id: 'thumbnail-cache',
    section: 'processing',
    group: 'Thumbnails',
    label: 'Thumbnail cache',
    description: 'Serve small webp thumbnails. Off serves full-resolution originals (videos still use a frame).',
    keywords: 'thumbs webp performance',
    kind: 'toggle',
    key: 'thumbnail_cache_enabled',
    defaultOn: true,
    Meta: ThumbnailSizeMeta,
    confirmOff: {
      title: 'Disable thumbnail cache?',
      danger: true,
      confirmLabel: 'Disable anyway',
      body: 'Without cached thumbnails, the board and dashboard load full-resolution images directly. This can significantly hurt performance and load times on large libraries.',
    },
  },
  {
    id: 'regenerate-thumbnails',
    section: 'processing',
    group: 'Thumbnails',
    label: 'Regenerate thumbnails',
    description: 'Re-process every file and overwrite its thumbnail.',
    keywords: 'rebuild thumbs',
    kind: 'action',
    button: 'Regenerate all',
    confirm: {
      title: 'Regenerate all thumbnails?',
      confirmLabel: 'Regenerate',
      body: 'This may take a long time on large libraries. Existing thumbnails are overwritten as each file is re-processed.',
    },
    run: async () => {
      await api.regenerateAllThumbnails();
      return 'Thumbnail regeneration started';
    },
  },
  {
    id: 'clear-thumbnails',
    section: 'processing',
    group: 'Thumbnails',
    label: 'Clear thumbnail cache',
    description: 'Delete every cached thumbnail to free disk space.',
    keywords: 'thumbs delete space',
    kind: 'action',
    button: 'Clear',
    tone: 'danger',
    run: async (queryClient) => {
      const res = await api.clearThumbnails();
      queryClient.invalidateQueries({ queryKey: ['system'] });
      return `Cleared ${res.removed} thumbnails`;
    },
  },
  {
    id: 'video-transcoding',
    section: 'processing',
    group: 'Video',
    label: 'Video transcoding',
    description:
      "After each scan, re-encode videos the browser can't play to a compatible copy. Originals are untouched.",
    keywords: 'hevc h265 mkv avi wmv mp4 ffmpeg convert',
    kind: 'toggle',
    key: 'video_transcode_enabled',
  },
  {
    id: 'transcode-videos',
    section: 'processing',
    group: 'Video',
    label: 'Transcode all videos',
    description: 'Check every video now instead of waiting for the next scan.',
    keywords: 'hevc h265 ffmpeg convert',
    kind: 'action',
    button: 'Run now',
    run: async () => {
      await api.transcodeVideos();
      return 'Checking videos for playback compatibility…';
    },
  },
  {
    id: 'image-hashes',
    section: 'processing',
    group: 'Similarity',
    label: 'Image hashes',
    description: 'Perceptual hashes power duplicate and similar-image detection.',
    keywords: 'duplicates phash similar dhash',
    kind: 'custom',
    Control: HashImagesControl,
    Meta: HashImagesMeta,
  },
  {
    id: 'duplicates',
    section: 'processing',
    group: 'Similarity',
    label: 'Duplicates',
    description: 'Find files with identical content across your libraries and delete the extra copies.',
    keywords: 'duplicate copies identical wasted space clean',
    kind: 'custom',
    Control: DuplicatesLink,
  },

  // Jobs
  {
    id: 'schedule-scan',
    section: 'jobs',
    group: 'Schedules',
    label: 'Library scan',
    description: 'Look for new and removed files in every library.',
    keywords: 'schedule interval rescan auto-scan',
    kind: 'custom',
    Control: () => <ScheduleControl jobType="scan" />,
  },
  {
    id: 'schedule-tag',
    section: 'jobs',
    group: 'Schedules',
    label: 'AI tagging',
    description: 'Tag what the last scan found. Recommended: after every scan.',
    keywords: 'schedule interval after-scan',
    kind: 'custom',
    Control: () => <ScheduleControl jobType="tag" />,
  },
  {
    id: 'schedule-hash',
    section: 'jobs',
    group: 'Schedules',
    label: 'Duplicate detection',
    description: 'Hash new images for similarity search. Recommended: after every scan.',
    keywords: 'schedule interval after-scan phash',
    kind: 'custom',
    Control: () => <ScheduleControl jobType="hash" />,
  },
  {
    id: 'schedule-cleanup',
    section: 'jobs',
    group: 'Schedules',
    label: 'Cleanup orphan data',
    description: 'Remove orphaned thumbnails, tag counts and stale job logs.',
    keywords: 'schedule interval maintenance',
    kind: 'custom',
    Control: () => <ScheduleControl jobType="cleanup" />,
  },
  {
    id: 'schedule-backup',
    section: 'jobs',
    group: 'Schedules',
    label: 'Database backup',
    description: 'Write a copy of the database to the backups folder. Recommended: daily.',
    keywords: 'schedule interval backup daily snapshot',
    kind: 'custom',
    Control: () => <ScheduleControl jobType="backup" />,
  },
  {
    id: 'library-schedules',
    section: 'jobs',
    group: 'Per library',
    label: 'Library overrides',
    description: 'Override the schedules above for one library. “Use global” inherits them.',
    keywords: 'schedule per-library custom override',
    kind: 'custom',
    block: true,
    Control: PerLibrarySchedules,
  },
  {
    id: 'job-history',
    section: 'jobs',
    group: 'History',
    label: 'Recent jobs',
    description: 'Every scan, tag, hash and download with its log.',
    keywords: 'history log progress status',
    kind: 'custom',
    block: true,
    Control: JobHistory,
  },

  // Storage
  {
    id: 'home-folder',
    section: 'storage',
    group: 'Location',
    label: 'Store data in your home folder',
    description:
      'Keep the database, thumbnails, uploads and downloads in ~/.sakuya so reinstalling or moving Sakuya leaves them alone. Switching moves every file, then the server shuts down.',
    keywords: 'data dir path move migrate sakuya',
    kind: 'custom',
    Control: HomeFolderControl,
    Meta: HomeFolderMeta,
  },
  {
    id: 'media-size',
    section: 'storage',
    group: 'Usage',
    label: 'Media',
    description: 'Files across every library.',
    keywords: 'size count disk',
    kind: 'custom',
    Control: () => <StatValue stat="media" />,
  },
  {
    id: 'database-size',
    section: 'storage',
    group: 'Usage',
    label: 'Database',
    description: 'Media index, tags and settings.',
    keywords: 'size sqlite db disk',
    kind: 'custom',
    Control: () => <StatValue stat="db" />,
  },
  {
    id: 'thumbnail-size',
    section: 'storage',
    group: 'Usage',
    label: 'Thumbnail cache',
    description: 'Cached webp thumbnails on disk.',
    keywords: 'size thumbs disk',
    kind: 'custom',
    Control: () => <StatValue stat="thumbs" />,
  },
  {
    id: 'trash',
    section: 'storage',
    group: 'Trash',
    label: 'Trash',
    description: 'Deleted media waits here for 30 days, then it is deleted for good. Open it to restore items.',
    keywords: 'deleted delete restore undo recycle bin bin empty purge',
    kind: 'custom',
    Control: TrashControl,
    Meta: TrashMeta,
  },
  {
    id: 'backup-now',
    section: 'storage',
    group: 'Backups',
    label: 'Database backup',
    description: 'A consistent copy of the database: library index, tags, likes, boards and settings.',
    keywords: 'backup back up now snapshot copy sqlite db restore',
    kind: 'custom',
    Control: BackupNowControl,
    Meta: BackupNowMeta,
  },
  {
    id: 'backup-keep',
    section: 'storage',
    group: 'Backups',
    label: 'Backups to keep',
    description: 'After each backup, all but this many of the newest are deleted.',
    keywords: 'backup retention keep prune count',
    kind: 'slider',
    key: 'backup_keep',
    min: 1,
    max: 30,
    fallback: 7,
  },
  {
    id: 'backup-schedule',
    section: 'storage',
    group: 'Backups',
    label: 'Backup schedule',
    description: 'How often a backup runs on its own. Set with the other schedules under Jobs.',
    keywords: 'backup schedule daily interval automatic',
    kind: 'custom',
    Control: BackupScheduleLink,
    Meta: BackupScheduleMeta,
  },
  {
    id: 'backup-list',
    section: 'storage',
    group: 'Backups',
    label: 'Saved backups',
    description: 'Every backup on disk, newest first.',
    keywords: 'backup files list history size date',
    kind: 'custom',
    block: true,
    Control: BackupList,
  },
  {
    id: 'cleanup-orphans',
    section: 'storage',
    group: 'Maintenance',
    label: 'Clean up orphan data',
    description: 'Remove thumbnails, transcodes and tag counts with no matching media, and prune old logs.',
    keywords: 'cleanup orphans tidy prune',
    kind: 'action',
    button: 'Clean up',
    tone: 'danger',
    confirm: {
      title: 'Clean up orphan data?',
      danger: true,
      confirmLabel: 'Clean up',
      body: 'Removes thumbnail files whose media no longer exist and recomputes usage counts for every tag. Safe to run any time: nothing referenced by current media is touched.',
    },
    run: async (queryClient) => {
      const res = await api.cleanupData();
      queryClient.invalidateQueries({ queryKey: ['system'] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      return (
        `Removed ${res.removedThumbs} orphan thumbnails and ${res.removedTranscodes} transcodes · reset ${res.resetTagCounts} tag counts · ` +
        `pruned ${res.prunedJobs} old jobs and ${res.prunedDownloadLogs} log lines · purged ${res.purgedTrash} expired trash items`
      );
    },
  },

  // About
  {
    id: 'updates',
    section: 'about',
    group: 'Version',
    label: 'Updates',
    description: 'The running version, a check for a newer one, and how this copy updates.',
    keywords: 'version update upgrade check auto-update automatic restart desktop docker release',
    kind: 'custom',
    block: true,
    Control: UpdatesPanel,
  },
  {
    id: 'release-notes',
    section: 'about',
    group: 'Release notes',
    label: "What's changed",
    description: 'Release notes for every version, newest first.',
    keywords: 'changelog releases whats new',
    kind: 'custom',
    block: true,
    Control: ReleaseNotes,
  },
];

/** Settings keys with no row here, and where they're set instead. */
export const KEYS_SET_ELSEWHERE: Partial<Record<SettingsKey, string>> = {
  ui_style_chosen: 'the first-run style picker',
  downloader_concurrency: 'the Downloader page',
};

/** Every `Settings` key, so a key added to the shared type fails typecheck here until it gets a home. */
export const ALL_SETTINGS_KEYS = Object.keys({
  ai_tagging_enabled: 1,
  confidence_threshold: 1,
  confidence_threshold_character: 1,
  accent_color: 1,
  remember_mute_state: 1,
  remember_volume_level: 1,
  continue_where_left: 1,
  thumbnail_cache_enabled: 1,
  board_remember_filters: 1,
  tagger_model: 1,
  downloader_concurrency: 1,
  gifs_as_videos: 1,
  video_transcode_enabled: 1,
  discover_enabled: 1,
  ui_style: 1,
  ui_style_chosen: 1,
  dashboard_hero: 1,
  backup_keep: 1,
} satisfies Record<SettingsKey, 1>) as SettingsKey[];

export function entryKeys(entry: SettingEntry): SettingsKey[] {
  if (entry.kind === 'toggle' || entry.kind === 'select' || entry.kind === 'slider') return [entry.key];
  if (entry.kind === 'custom') return entry.keys ?? [];
  return [];
}

/** Tabs from before the registry, mapped to the section that now holds their settings. */
const LEGACY_TABS: Record<string, SectionId> = {
  appearance: 'general',
  behavior: 'general',
  system: 'storage',
  releases: 'about',
};

export function resolveSection(tab: string | null): SettingsSection {
  const id = tab && (LEGACY_TABS[tab] ?? tab);
  return SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
}

export function settingHref(id: string): string {
  const entry = SETTINGS.find((s) => s.id === id);
  if (!entry) throw new Error(`Unknown setting: ${id}`);
  return `/settings?tab=${entry.section}#${id}`;
}
