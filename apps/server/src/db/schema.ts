import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { JOB_TYPES, LIBRARY_TYPES, MEDIA_TYPES, SCHEDULE_JOB_TYPES, SCHEDULE_MODES, TAG_CATEGORIES } from '@sakuya/shared';

// Indexes and composite primary keys live in the raw DDL in db/index.ts; nothing here generates SQL.

export const libraries = sqliteTable('libraries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', { enum: LIBRARY_TYPES }).notNull().default('mixed'),
  thumbnailMediaId: integer('thumbnail_media_id'),
  customImagePath: text('custom_image_path'),
  createdAt: integer('created_at').notNull(),
  lastVisitedAt: integer('last_visited_at'),
  autoScanInterval: integer('auto_scan_interval').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const folders = sqliteTable('folders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  libraryId: integer('library_id').notNull(),
  path: text('path').notNull(),
  status: text('status', { enum: ['pending', 'scanning', 'indexed', 'error'] }).notNull().default('pending'),
  createdAt: integer('created_at').notNull(),
});

export const media = sqliteTable('media', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  libraryId: integer('library_id').notNull(),
  source: text('source', { enum: ['folder', 'upload'] }).notNull(),
  path: text('path').notNull(),
  filename: text('filename').notNull(),
  type: text('type', { enum: MEDIA_TYPES }).notNull(),
  width: integer('width'),
  height: integer('height'),
  sizeBytes: integer('size_bytes').notNull().default(0),
  durationSeconds: real('duration_seconds'),
  thumbnailPath: text('thumbnail_path'),
  contentHash: text('content_hash'),
  mtime: integer('mtime'),
  createdAt: integer('created_at').notNull(),
  indexedAt: integer('indexed_at'),
  taggedAt: integer('tagged_at'),
  transcodedAt: integer('transcoded_at'),
  lastViewedAt: integer('last_viewed_at'),
  viewProgress: real('view_progress').notNull().default(0),
  viewCount: integer('view_count').notNull().default(0),
  watchedSeconds: real('watched_seconds').notNull().default(0),
  // How long an image/GIF stayed open in the viewer — the still-image counterpart to watchedSeconds.
  dwellSeconds: real('dwell_seconds').notNull().default(0),
  liked: integer('liked').notNull().default(0),
  likedAt: integer('liked_at'),
  perceptualHash: text('perceptual_hash'),
  // Eight 8-bit bands of perceptualHash, indexed so similarity search can prefilter
  // candidates instead of scanning every image. See lib/phashBands.ts.
  phashB0: integer('phash_b0'),
  phashB1: integer('phash_b1'),
  phashB2: integer('phash_b2'),
  phashB3: integer('phash_b3'),
  phashB4: integer('phash_b4'),
  phashB5: integer('phash_b5'),
  phashB6: integer('phash_b6'),
  phashB7: integer('phash_b7'),
});

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  category: text('category', { enum: TAG_CATEGORIES }).notNull().default('general'),
  usageCount: integer('usage_count').notNull().default(0),
});

export const mediaTags = sqliteTable('media_tags', {
  mediaId: integer('media_id').notNull(),
  tagId: integer('tag_id').notNull(),
  confidence: real('confidence'),
  source: text('source', { enum: ['ai', 'user'] }).notNull().default('user'),
});

export const boards = sqliteTable('boards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
});

// Membership rows are the "belongs to board N" marker on a media item. Both columns cascade
// on delete (see db/index.ts), so deleting media or a board can't leave orphan memberships.
export const boardMedia = sqliteTable('board_media', {
  boardId: integer('board_id').notNull(),
  mediaId: integer('media_id').notNull(),
  addedAt: integer('added_at').notNull(),
});

export const jobs = sqliteTable('jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type', { enum: JOB_TYPES }).notNull(),
  libraryId: integer('library_id'),
  label: text('label').notNull().default(''),
  status: text('status', { enum: ['queued', 'running', 'done', 'error'] }).notNull().default('queued'),
  progress: integer('progress').notNull().default(0),
  total: integer('total').notNull().default(0),
  log: text('log').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const downloadBatches = sqliteTable('download_batches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  libraryId: integer('library_id').notNull(),
  folderPath: text('folder_path').notNull(),
  extraArgs: text('extra_args'),
  cookieFileId: integer('cookie_file_id'),
  createdAt: integer('created_at').notNull(),
});

export const downloadItems = sqliteTable('download_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  batchId: integer('batch_id').notNull(),
  url: text('url').notNull(),
  status: text('status', {
    enum: ['queued', 'running', 'paused', 'done', 'error', 'skipped'],
  })
    .notNull()
    .default('queued'),
  filesDownloaded: integer('files_downloaded').notNull().default(0),
  pid: integer('pid'),
  errorMessage: text('error_message'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const downloadLogs = sqliteTable('download_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull(),
  line: text('line').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const downloadFiles = sqliteTable('download_files', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull(),
  path: text('path').notNull(),
});

export const downloadCookies = sqliteTable('download_cookies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  filename: text('filename').notNull(),
  storedPath: text('stored_path').notNull(),
  uploadedAt: integer('uploaded_at').notNull(),
});

export const jobSchedules = sqliteTable('job_schedules', {
  jobType: text('job_type', { enum: SCHEDULE_JOB_TYPES }).notNull(),
  libraryId: integer('library_id'),
  mode: text('mode', { enum: SCHEDULE_MODES }).notNull(),
  intervalMinutes: integer('interval_minutes').notNull().default(0),
  useGlobal: integer('use_global').notNull().default(0),
});

export const savedSearches = sqliteTable('saved_searches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  // Explore URL query string (e.g. "tags=solo,blue_hair&liked=1&sort=name"), replayed as /explore?<query>.
  query: text('query').notNull(),
  createdAt: integer('created_at').notNull(),
});
