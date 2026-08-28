# Sakuya API Reference

The server is an Express app (`apps/server/src/index.ts`). All endpoints are mounted under
`/api` on a single port (default `3777`, configurable via the `PORT` env var — see
`apps/server/src/lib/config.ts`). There is no authentication/authorization layer; the API is
meant for local/trusted-network use only.

Request bodies are validated with [Zod](https://zod.dev); invalid input returns `400` with
`{ error, issues }`. Unhandled errors return `500` with `{ error }`. All routes return JSON
unless noted otherwise (file streams, cover images, SSE streams).

Shared response/request types live in `packages/shared/src/index.ts` and are referenced below
by name (e.g. `Media`, `Job`).

## Conventions

- **IDs** in path params are validated as non-negative integers (`intParam`); a non-integer
  returns `400 { error: "Invalid id" }`.
- **Not found** resources return `404 { error: "Not found" }` (or a resource-specific message).
- **Pagination** (media list) uses an opaque base64url cursor, not offsets.
- **Server-Sent Events** endpoints (`/stream` suffix) push JSON-encoded events over
  `text/event-stream`, with a `: ping` heartbeat every 25s and a `snapshot` event on connect.

---

## Health

### `GET /api/health`
Liveness check. Response: `{ ok: true }`.

---

## Dashboard

### `GET /api/dashboard`
Aggregated home-screen data.

Response (`DashboardResponse`):
```ts
{
  libraries: LibraryWithStats[];
  continueWatching: Media[];   // view_progress between 0.01 and 0.98, most recent first (max 12)
  recentlyViewed: Media[];     // last_viewed_at not null, most recent first (max 12)
  recentlyAdded: Media[];      // most recently created (max 12)
  likedCount: number;
  likedSampleId: number | null;
}
```

---

## Libraries

### `GET /api/libraries`
List all libraries. Response: `LibraryWithStats[]`.

### `GET /api/libraries/:id`
Get one library; also updates its `lastVisitedAt` timestamp. Response: `LibraryWithStats`.

### `POST /api/libraries`
Create a library.

Body: `{ name: string (1-120 chars), type?: 'image'|'video'|'mixed' (default 'mixed'), autoScanInterval?: number (default 0) }`

Response: `201` + `LibraryWithStats`.

### `PATCH /api/libraries/:id`
Partially update a library. Body: any subset of the create body plus `thumbnailMediaId?: number | null`.

Response: `LibraryWithStats`.

### `DELETE /api/libraries/:id`
Delete a library and all its media, tags, thumbnails, and folders (files on disk are removed for
uploaded media). Response: `{ ok: true }`.

### `POST /api/libraries/:id/scan`
Enqueue a scan job for the library's folders. Response: `{ job: Job }`.

### `GET /api/libraries/:id/cover`
Serve the library's custom cover image file, if one is set. `404` if none/missing.

### `POST /api/libraries/:id/cover`
Upload a custom cover image. `multipart/form-data` with a `file` field. Replaces any previous
custom cover. Response: `LibraryWithStats`.

### `DELETE /api/libraries/:id/cover`
Remove the custom cover (falls back to auto/media cover). Response: `LibraryWithStats`.

## Folders

### `POST /api/libraries/:id/folders`
Attach a filesystem folder to a library (must exist and be a directory; duplicates rejected with
`409`). Body: `{ path: string }`. Response: `201` + `Folder`.

### `DELETE /api/folders/:id`
Detach a folder and delete all indexed media under it (and their tags/thumbnails). Response:
`{ ok: true }`.

---

## Media

### `GET /api/media`
Paginated, filterable media listing.

Query params:
| param | type | notes |
|---|---|---|
| `libraryId` | number | filter by library |
| `type` | `'image'\|'video'` | filter by type |
| `tags` | comma-separated string | AND match on tag names |
| `liked` | number | `1` filters to liked only |
| `q` | string | matches filename or tag name (substring) |
| `sort` | `'recent'\|'name'\|'random'` | default `recent` |
| `dir` | `'asc'\|'desc'` | default depends on `sort` |
| `seed` | number | seed for stable `random` ordering |
| `cursor` | string | opaque pagination cursor from a previous response |
| `limit` | number | 1-200, default 60 |

Response (`MediaListResponse`): `{ items: Media[], nextCursor: string | null, total: number }`.

### `GET /api/media/duplicates`
Groups of media sharing an identical `content_hash`, sorted by wasted bytes descending.

Response (`DuplicatesResponse`): `{ groups: DuplicateGroup[], groupCount, fileCount, wastedBytes }`.

### `POST /api/media/delete-batch`
Bulk delete. Body: `{ ids: number[] }`. Deletes DB rows, tag links, and files/thumbnails on disk
for existing ids (missing ids are silently skipped). Response: `{ ok: true, deleted: number }`.

### `GET /api/media/:id`
Media detail including tags. Response: `MediaDetail`.

### `GET /api/media/:id/file`
Streams the raw media file (supports HTTP Range requests, ETag, conditional GET).

### `PATCH /api/media/:id/rename`
Rename the file on disk. Body: `{ filename: string }`. `409` if a file with that name already
exists in the same directory. Response: `MediaDetail`.

### `DELETE /api/media/:id`
Delete one media item (DB row, tags, file, thumbnail). Response: `{ ok: true }`.

### `POST /api/media/:id/reveal`
Open the OS file manager to the file's location (`explorer.exe /select` on Windows, `open -R` on
macOS, `xdg-open <dir>` on Linux). Response: `{ ok: true }`.

### `GET /api/media/:id/thumbnail`
Serve (generating on first request) the media's thumbnail image. If the thumbnail cache is
disabled and the media is an image, serves the original file instead.

### `POST /api/media/:id/thumbnail/regenerate`
Force-regenerate the thumbnail. Response: `{ ok: true }`.

### `PATCH /api/media/:id/tags`
Add/remove tags and optionally change tag categories.

Body:
```ts
{
  add?: string[];       // tag names to add (default [])
  remove?: string[];    // tag names to remove (default [])
  category?: 'rating'|'general'|'character'|'user'; // category for newly created `add` tags, default 'user'
  setCategory?: Record<string, 'rating'|'general'|'character'|'user'>; // rename category of existing tags
}
```
Response: `MediaDetail`.

### `PATCH /api/media/:id/like`
Body: `{ liked: boolean }`. Response: `MediaDetail`.

### `GET /api/media/:id/similar`
Finds exact duplicates (by content hash) and visually similar images (perceptual-hash Hamming
distance ≤ 10, images only). Response (`SimilarResponse`): `{ duplicates: Media[], similar: Media[] }`.

### `POST /api/media/:id/retag`
Enqueue an AI re-tag job for a single item. `409` if the tagger model isn't downloaded. Response:
`{ job: Job }`.

### `PATCH /api/media/:id/progress`
Update playback/view progress. Body: `{ progress: number (0-1) }`. Response: `{ ok: true }`.

---

## Tags

### `GET /api/tags`
Tag usage counts, optionally scoped to a library.

Query params: `q?` (substring filter), `libraryId?` (number), `category?` (comma-separated list),
`limit?` (1-100, default 30; ignored when filtering to only the `rating` category).

Response: `TagCount[]`.

---

## Jobs

### `GET /api/jobs`
List all jobs (queued/running/done/error). Response: `Job[]`.

### `GET /api/jobs/stream`
SSE stream of job updates. Events: `{ type: 'snapshot', jobs: Job[] }` on connect, then
`{ type: 'job', job: Job }` per update.

### `POST /api/jobs/run-now`
Manually trigger scheduled job types immediately.

Body: `{ scope: 'global' | { libraryId: number }, jobType?: 'scan'|'tag'|'hash'|'cleanup' }`

Response: `{ ok: true }`.

## Job Schedules

### `GET /api/job-schedules`
Response (`JobSchedulesPayload`):
```ts
{
  globals: Record<string, JobSchedule>;              // keyed by job type
  perLibrary: Record<number, Record<string, JobSchedule>>; // keyed by library id, then job type
}
```

### `PATCH /api/job-schedules`
Upsert a schedule (global if `libraryId` omitted/`null`, per-library otherwise).

Body:
```ts
{
  jobType: 'scan'|'tag'|'hash'|'cleanup';
  libraryId?: number | null;
  mode?: 'off'|'interval'|'after-scan';
  intervalMinutes?: number;
  useGlobal?: boolean;  // per-library only: fall back to the global schedule
}
```
Response: `{ ok: true }`.

---

## Settings

### `GET /api/settings`
All settings key/value pairs. Response: `Settings`.

### `PATCH /api/settings`
Update one or more settings. Body: `Record<string, string>` — keys must be one of the editable
keys (`ai_tagging_enabled`, `confidence_threshold`, `accent_color`, `remember_mute_state`,
`remember_volume_level`, `autosearch_first_tag`, `continue_where_left`,
`thumbnail_cache_enabled`, `board_remember_filters`, `downloader_concurrency`,
`gifs_as_videos`); unknown keys return `400`. Toggling `gifs_as_videos` enqueues a GIF
reclassification job. Response: `Settings`.

## System

### `GET /api/system`
Response (`SystemInfo`): `{ version, mediaCount, mediaBytes, dbBytes, thumbBytes }`.

### `POST /api/system/clear-thumbnails`
Delete all cached thumbnails. Response: `{ removed: number }`.

### `POST /api/system/reclassify-gifs`
Enqueue a job to reclassify existing GIFs as images/videos per the current `gifs_as_videos`
setting. Response: `Job`.

### `POST /api/system/regenerate-thumbnails`
Enqueue a bulk thumbnail regeneration job. Response: `{ ok: true }`.

### `POST /api/system/cleanup`
Run library cleanup synchronously (removes orphaned DB rows/files). Response: cleanup result
object (see `services/cleanup.ts`).

---

## Tagger (AI auto-tagging)

### `GET /api/tagger/status`
Response: `TaggerStatus` — `{ status: 'absent'|'downloading'|'ready'|'error', model, modelSizeBytes, tagCount, untaggedCount, unhashedCount }`.

### `GET /api/tagger/models`
Available tagger models. Response: `TaggerModel[]` (`{ id, label, repo }`).

### `POST /api/tagger/select`
Select the active model. Body: `{ modelId: string }`. Response: `TaggerStatus`.

### `POST /api/tagger/hash-all`
Enqueue perceptual-hashing for all unhashed images. `409` if none need hashing. Response:
`{ job: Job }`.

### `POST /api/tagger/download`
Enqueue a model download. `409` if already downloading or already ready. Response: `{ job: Job }`.

### `POST /api/tagger/tag-all`
Enqueue AI tagging for all untagged media. `409` if the model isn't ready or there's nothing to
tag. Response: `{ job: Job }`.

---

## Uploads

### `POST /api/uploads`
Upload one or more files directly into a library. `multipart/form-data` with fields `libraryId`
(number) and one or more `files`. Unsupported extensions are rejected (not an error for the
whole request). If AI tagging is enabled and the model is ready, an AI tag job is enqueued for
the newly indexed files.

Response: `201` + `{ mediaIds: number[], rejected: string[] }`.

---

## Downloader (gallery-dl integration)

### `GET /api/downloader/status`
Detects whether `gallery-dl` is installed. Response: `DownloaderStatus`.

### `POST /api/downloader/install`
Enqueue installation of `gallery-dl`. `409` if already installed. Response: `{ job: Job }`.

### `GET /api/downloader/resolve-path`
Resolve which library (if any) owns a given filesystem path. Query: `path` (string). Response:
`{ library: LibraryWithStats | null }`.

### Cookies

#### `GET /api/downloader/cookies`
List uploaded cookie files. Response: `DownloadCookie[]`.

#### `POST /api/downloader/cookies`
Upload one or more cookie files. `multipart/form-data`, field `files`. Response: `201` +
`DownloadCookie[]`.

#### `DELETE /api/downloader/cookies/:id`
Delete a cookie file (DB row + file on disk). Response: `{ ok: true }`.

### Batches & items

#### `POST /api/downloader/batches`
Create a download batch (a set of URLs downloaded into a folder attached to a library).

Body:
```ts
{
  libraryId: number;
  folderPath: string;
  urls: string[];          // min 1
  extraArgs?: string;      // extra gallery-dl CLI args
  cookieFileId?: number | null;
}
```
`404` if the library doesn't exist; `409` if the folder already belongs to a different library;
`400` if `cookieFileId` doesn't resolve. The folder is created on disk and attached to the
library. Response: `201` + `DownloadBatchWithItems`.

#### `GET /api/downloader/batches`
List all batches with their items. Response: `DownloadBatchWithItems[]`.

#### `GET /api/downloader/items/:id/logs`
Log lines for one download item. Query: `after?` (number, log id cursor). Response:
`DownloadLogLine[]`.

#### `POST /api/downloader/items/:id/pause`
Response: `{ ok: true }`.

#### `POST /api/downloader/items/:id/resume`
Response: `{ ok: true }`.

#### `POST /api/downloader/items/:id/skip`
Response: `{ ok: true }`.

#### `POST /api/downloader/items/:id/redo`
Retry a failed/skipped item. Response: `{ ok: true }`.

#### `DELETE /api/downloader/items/:id`
Remove an item. Body: `{ deleteFiles?: boolean (default false) }`. Response: `{ ok: true }`.

### Console session

A single interactive shell session used for running arbitrary downloader commands.

#### `GET /api/downloader/console/status`
Response: `ConsoleSessionStatus`.

#### `POST /api/downloader/console/start`
Body: `{ command: string }`. `409` if a session is already running. Response:
`ConsoleSessionStatus`.

#### `POST /api/downloader/console/input`
Write to the running session's stdin. Body: `{ text: string }`. `409` if none running. Response:
`{ ok: true }`.

#### `POST /api/downloader/console/stop`
Response: `{ ok: true }`.

#### `GET /api/downloader/console/stream`
SSE stream of console output/status. Events: `{ type: 'snapshot', buffer, status }` on connect,
then `{ type: 'data', chunk }` and `{ type: 'status', status }`.

### Batch/item stream

#### `GET /api/downloader/stream`
SSE stream of downloader state. Events: `{ type: 'snapshot', batches: DownloadBatchWithItems[] }`
on connect, then `{ type: 'batch', batch }`, `{ type: 'item', item }`, `{ type: 'log', log }`,
`{ type: 'removed', id, batchId }`.
