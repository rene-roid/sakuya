import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const libraries = sqliteTable('libraries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', { enum: ['image', 'video', 'mixed'] }).notNull().default('mixed'),
  thumbnailMediaId: integer('thumbnail_media_id'),
  customImagePath: text('custom_image_path'),
  createdAt: integer('created_at').notNull(),
  lastVisitedAt: integer('last_visited_at'),
  autoScanInterval: integer('auto_scan_interval').notNull().default(0),
});

export const folders = sqliteTable('folders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  libraryId: integer('library_id').notNull(),
  path: text('path').notNull(),
  status: text('status', { enum: ['pending', 'scanning', 'indexed', 'error'] }).notNull().default('pending'),
  createdAt: integer('created_at').notNull(),
});

export const media = sqliteTable(
  'media',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    libraryId: integer('library_id').notNull(),
    source: text('source', { enum: ['folder', 'upload'] }).notNull(),
    path: text('path').notNull(),
    filename: text('filename').notNull(),
    type: text('type', { enum: ['image', 'video'] }).notNull(),
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
    lastViewedAt: integer('last_viewed_at'),
    viewProgress: real('view_progress').notNull().default(0),
    liked: integer('liked').notNull().default(0),
    likedAt: integer('liked_at'),
    perceptualHash: text('perceptual_hash'),
  },
  (t) => [
    uniqueIndex('media_path_idx').on(t.path),
    index('media_library_idx').on(t.libraryId),
    index('media_created_idx').on(t.createdAt),
    index('media_type_idx').on(t.type),
    index('media_hash_idx').on(t.contentHash),
    index('media_liked_idx').on(t.liked),
  ],
);

export const tags = sqliteTable(
  'tags',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    category: text('category', { enum: ['rating', 'general', 'character', 'user'] }).notNull().default('general'),
    usageCount: integer('usage_count').notNull().default(0),
  },
  (t) => [uniqueIndex('tags_name_idx').on(t.name)],
);

export const mediaTags = sqliteTable(
  'media_tags',
  {
    mediaId: integer('media_id').notNull(),
    tagId: integer('tag_id').notNull(),
    confidence: real('confidence'),
    source: text('source', { enum: ['ai', 'user'] }).notNull().default('user'),
  },
  (t) => [
    primaryKey({ columns: [t.mediaId, t.tagId] }),
    index('media_tags_tag_idx').on(t.tagId),
    index('media_tags_media_idx').on(t.mediaId),
  ],
);

export const jobs = sqliteTable('jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type', { enum: ['scan', 'tag', 'thumbnail', 'model-download', 'hash'] }).notNull(),
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

export const jobSchedules = sqliteTable(
  'job_schedules',
  {
    jobType: text('job_type', { enum: ['scan', 'tag', 'hash'] }).notNull(),
    libraryId: integer('library_id'),
    mode: text('mode', { enum: ['off', 'interval', 'after-scan'] }).notNull(),
    intervalMinutes: integer('interval_minutes').notNull().default(0),
    useGlobal: integer('use_global').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.jobType, t.libraryId] })],
);
