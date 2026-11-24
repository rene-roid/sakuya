# Sakuya API Reference

The server is an Express app (`apps/server/src/index.ts`). All endpoints are mounted under
`/api` on a single port (default `3777`, set as `server.port` in `sakuya.config.json`). With `auth.enabled` off there is no authentication layer and the
API is meant for local/trusted-network use only; with it on, every route below except `/api/auth/*`
and `/api/health` needs the session cookie from `POST /api/auth/login`.

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

## Auth

### `GET /api/auth/status`
Response (`AuthStatus`): `{ enabled: boolean, unlocked: boolean }`.

### `POST /api/auth/login`
Body: `{ secret: string }`. Sets a signed, expiring session cookie. `401` on a wrong password; at
most 5 attempts per 10 minutes. Always `{ ok: true }` when auth is off.

### `POST /api/auth/logout`
Clears the session cookie. Response: `{ ok: true }`.

The desktop app's main process has no cookie; it sends the per-launch `SAKUYA_DESKTOP_TOKEN` in an
`X-Sakuya-Desktop-Token` header instead.

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
List all libraries in display order (`sortOrder`, then id). Response: `LibraryWithStats[]`.

### `GET /api/libraries/:id`
Get one library; also updates its `lastVisitedAt` timestamp. Response: `LibraryWithStats`.

### `POST /api/libraries`
Create a library.

Body: `{ name: string (1-120 chars), type?: 'image'|'video'|'mixed' (default 'mixed'), autoScanInterval?: number (default 0) }`

Response: `201` + `LibraryWithStats`.

### `PATCH /api/libraries/:id`
Partially update a library (this is how a rename is done). Body: any subset of the create body plus
`thumbnailMediaId?: number | null`.

Response: `LibraryWithStats`.

### `PUT /api/libraries/order`
Set the display order. Body: `{ ids: number[] }` — every library id, in the wanted order.

Response: `LibraryWithStats[]` in the new order.

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
| `tags` | comma-separated string | AND match on tag names; an old name merged into another tag matches the target |
| `liked` | number | `1` filters to liked only |
| `q` | string | matches filename or tag name from the start of a word; a merged tag's old name also finds its target |
| `describe` | string | search by description (max 500 chars): ranks by CLIP image-embedding similarity to the text instead of `sort`, `dir` and `seed`; combines with every other filter. Blank is ignored |
| `sort` | `'recent'\|'name'\|'random'` | default `recent` |
| `dir` | `'asc'\|'desc'` | default depends on `sort` |
| `seed` | number | seed for stable `random` ordering |
| `cursor` | string | opaque pagination cursor from a previous response |
| `limit` | number | 1-200, default 60 |

Response (`MediaListResponse`): `{ items: Media[], nextCursor: string | null, total: number }`.
With `describe`, the first page also carries `semantic: { status, embeddedCount, pendingCount }`:
`status` is `disabled` (setting off), `no-model`, `empty` (nothing indexed yet) or `ready`. Only
indexed files are ranked; `total` counts them. The cursor of a `describe` page holds the last
item's score and id, so it is only valid for the same description.

### `GET /api/media/ids`
Every media id matching a filter, in the same order `GET /api/media` would return them. Backs
"select all N matching" in multi-select mode, where the grid has only loaded the first few pages.
Accepts the same filter/sort params as `GET /api/media` (no `cursor`/`limit`).

Response (`MediaIdsResponse`): `{ ids: number[], total: number }`.

> Declared before `/api/media/:id` — route order matters, or `ids` is parsed as an id and `400`s.

### `POST /api/media/by-ids`
Rows for an explicit id list, **in the order requested**; unknown ids are dropped. Used by bulk
confirmation dialogs, whose selection can span pages the client never loaded.
Body: `{ ids: number[] }` (1-5000). Response: `Media[]`.

### `POST /api/media/tags-summary`
Tag histogram across a selection — drives the bulk "remove tags" picker.
Body: `{ ids: number[] }` (1-5000). Response: `TagCount[]`, most used first.

### `GET /api/media/duplicates`
Groups of media sharing an identical `content_hash`, sorted by wasted bytes descending.

Response (`DuplicatesResponse`): `{ groups: DuplicateGroup[], groupCount, fileCount, wastedBytes }`.

### `POST /api/media/delete-batch`
Bulk delete. Body: `{ ids: number[] }`. Moves each file, with its thumbnail and transcode, to the
[trash](#trash) and removes its row; tags, like and board memberships are kept with the trash entry
so a restore brings them back. Missing ids are silently skipped. Response:
`{ ok: true, deleted: number, failed: { id, error }[] }`.

## Bulk actions

Mutations behind the grid's multi-select mode. They report per-item outcomes rather than failing
wholesale on one bad row, so a selection containing a stale id still applies to the rest.

Shared response shape (`BulkResult`): `{ ok: true, updated: number, failed: { id, error }[] }`.

### `POST /api/media/tags-batch`
Add and/or remove tags across a selection. Body:
`{ ids: number[], add?: string[], remove?: string[], category?: TagCategory }`.
Added names are lowercased with whitespace collapsed to `_`; `category` (default `user`) applies
to newly created tags. A name merged into another tag adds its target, and implied tags follow.
Removing a tag a file doesn't have is a no-op, not a failure; removing one the AI, a sidecar or an
implication added records a veto, so a re-tag leaves it off. Usage counts are refreshed once at the
end. `400` if both `add` and `remove` are empty.

### `POST /api/media/like-batch`
Body: `{ ids: number[], liked: boolean }`. Sets `liked`/`liked_at` across the selection.

### `POST /api/media/rename-batch`
Body: `{ items: { id: number, filename: string }[] }`.

Validates everything before touching the disk, then moves files and updates rows for the moves
that succeeded. A row is refused (and reported in `failed`) when its name is empty/invalid, its
source file is missing, two items in the batch target the same path, or the target already exists
— which includes swaps (`a→b` while `b→a`). Names are reduced with `path.basename`, so a file can
never be renamed out of its own folder. An unchanged name is a skipped no-op, not a failure.

### `POST /api/media/retag-batch`
Body: `{ ids: number[] }`. Enqueues one AI tagging job for the whole selection. `409` if the
tagger model isn't downloaded, `404` if no id exists. Response: `{ job: Job }`.

### `POST /api/media/thumbnails-batch`
Body: `{ ids: number[] }`. Enqueues one thumbnail regeneration job for the selection.
Response: `{ job: Job }`.

### `POST /api/boards/:id/media/remove-batch`
Remove several media from a board at once. Body: `{ mediaIds: number[] }`. Membership-only: the
media rows and files on disk are untouched. A POST rather than a DELETE because DELETE-with-a-body
isn't reliably supported across clients. Response: `BoardWithStats`.

---

## Media — single item

### `GET /api/media/:id`
Media detail including tags (each with `displayName` and `source`: `ai`, `user`, `character`,
`meta` from a gallery-dl sidecar, or `implied`), boards, and `sourceUrl`, the post the file was
downloaded from when its sidecar named one. Response: `MediaDetail`.

### `GET /api/media/:id/file`
Streams the raw media file (supports HTTP Range requests, ETag, conditional GET).

### `PATCH /api/media/:id/rename`
Rename the file on disk. Body: `{ filename: string }`. `409` if a file with that name already
exists in the same directory. Response: `MediaDetail`.

### `DELETE /api/media/:id`
Move one media item to the [trash](#trash), as `delete-batch` does. `500` with the reason if the
file could not be moved. Response: `{ ok: true }`.

### `POST /api/media/:id/reveal`
Open the OS file manager to the file's location (`explorer.exe /select` on Windows, `open -R` on
macOS, `xdg-open <dir>` on Linux). Response: `{ ok: true }`.

### `GET /api/media/:id/thumbnail`
Serve (generating on first request) the media's thumbnail image. If the thumbnail cache is
disabled and the media is an image, serves the original file instead.

### `POST /api/media/:id/thumbnail/regenerate`
Force-regenerate the thumbnail (and a video's sprite). Response: `{ ok: true }`.

### `GET /api/media/:id/sprite`
A video's hover-scrub sprite: 10 evenly spaced frames tiled left to right in one webp, made on
first request when the background sprite job hasn't reached it. Headers `X-Sprite-Frames` and
`X-Sprite-Interval` (seconds between frames; frame i is at `(i + 0.5) * interval`). Cached for a
year when asked with `?v=<sprite.version>` from `Media.sprite`. `404` for images, with the
thumbnail cache off, or when no frame could be read.

### `GET /api/media/:id/detections`
The characters found on one item. Response: `CharacterDetection[]` — each with its `bbox`
(fractions of the image), `score`, `characterId`, `characterName`, `characterDisplayName`,
`assignment` (`auto`, `user` or `rejected`) and `cropUrl`.

### `PATCH /api/media/:id/tags`
Add/remove tags and optionally change tag categories.

Body:
```ts
{
  add?: string[];       // tag names to add (default [])
  remove?: string[];    // tag names to remove (default [])
  category?: TagCategory; // for newly created `add` tags, default 'user'
  setCategory?: Record<string, TagCategory>; // change the category of existing tags
}
```
`TagCategory` is `rating`, `general`, `character`, `user`, `artist` or `copyright`. Siblings,
implications and vetoes apply as in `tags-batch`. Response: `MediaDetail`.

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

Query params: `q?` (literal substring filter on the name or display name, and on old names merged
into a tag; `_` and `%` match themselves), `libraryId?` (number), `category?` (comma-separated list),
`limit?` (1-100, default 30; ignored when filtering to only the `rating` category).

Response: `TagCount[]` (`{ name, category, displayName, count }`).

### `GET /api/tags/info`
Category and display name for tags known only by name (filter chips, Discover reasons). Query:
`names` (comma-separated, at most 200). Unknown names are left out. Response: `TagInfo[]`
(`{ name, category, displayName }`).

### `PATCH /api/tags/:name`
Set or clear a tag's display name. The tag's real name, used in search and links, stays the same.
Body: `{ displayName: string | null }` (max 100 chars; blank clears it). `404` for an unknown tag,
`409` when another tag already reads the same. Response: `TagInfo`.

## Tag relations

Booru-style siblings and implications. A **sibling** merges one tag into another: its links,
vetoes and implications move to the target, and later writes of the old name land on the target.
An **implication** adds the implied tag (source `implied`) to every item carrying the tag, kept up
to date as tags change. Cycles are refused with `400`.

Every write answers with `TagRelationResult`: `{ siblings: TagSibling[], implications:
TagImplication[], job: Job | null }`. When a change reaches more than 5000 items, the implied tags
are brought up to date by a `tag-relations` job, returned in `job`; otherwise inline and `job` is
`null`.

### `GET /api/tag-relations`
Response (`TagRelations`): `{ siblings: { from, to, createdAt }[], implications: { tag, implies,
createdAt }[] }`, each side a `TagInfo`.

### `POST /api/tag-relations/siblings`
Merge `from` into `to`. Body: `{ from: string, to: string, category?: TagCategory }` (`category`,
default `general`, is used for a side that doesn't exist yet). `400` for a merge into the tag's
own alias or one that would make implications loop, `409` when `from` is already merged.

### `DELETE /api/tag-relations/siblings/:from`
Stop resolving the alias. Links already moved stay on the target.

### `POST /api/tag-relations/implications`
Body: `{ tag: string, implies: string, category?: TagCategory }` (`category` as above). Either
name may be an alias; it resolves to its target.

### `DELETE /api/tag-relations/implications/:tag/:implies`
Removes the implication and the implied links it made; a tag also added by hand stays. `404` if
there is no such implication.

---

## Jobs

### `GET /api/jobs`
List all jobs (queued/running/done/error). Response: `Job[]`.

### `GET /api/jobs/stream`
SSE stream of job updates. Events: `{ type: 'snapshot', jobs: Job[] }` on connect, then
`{ type: 'job', job: Job }` per update.

### `POST /api/jobs/run-now`
Manually trigger scheduled job types immediately.

Body: `{ scope: 'global' | { libraryId: number }, jobType?: 'scan'|'tag'|'hash'|'cleanup'|'backup' }`

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
  jobType: 'scan'|'tag'|'hash'|'cleanup'|'backup'; // backup is global only
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
Update one or more settings. Body: `Record<string, string>` — keys must be one of the keys in
`DEFAULTS` in `apps/server/src/lib/settings.ts` other than `tagger_model` (for example
`ai_tagging_enabled`, `confidence_threshold` and `confidence_threshold_character` (percent, general
and character tags), `discover_enabled`, `backup_keep`, `character_detection_enabled`,
`semantic_search_enabled`, `ui_style`); an unknown key returns `400` and nothing in the request is
saved. Toggling `gifs_as_videos` enqueues a GIF reclassification job. Response: `Settings`.

## System

### `GET /api/system`
Response (`SystemInfo`): `{ version, mediaCount, mediaBytes, dbBytes, thumbBytes, installKind }`.
`installKind` is `desktop`, `docker` or `source`, which decides how this copy updates.

### `GET /api/system/storage`
Response (`StorageInfo`): `{ current, home, local, usingHome, locked }` — where the data dir resolved
to this boot, the two candidates, and whether `server.dataDir` in `sakuya.config.json` pins it.

### `POST /api/system/storage/migrate`
Body: `{ target: 'home' | 'local' }`. Closes the DB, copies the whole data dir to the target, deletes
the original, responds `{ movedTo }`, then exits the process — the new location is only picked up on
restart. 400 if `server.dataDir` is set, the target is already in use, or a database already exists
there.

### `POST /api/system/clear-thumbnails`
Delete all cached thumbnails and video sprites; sprites are remade by the after-scan sprite job.
Response: `{ removed: number }`.

### `POST /api/system/reclassify-gifs`
Enqueue a job to reclassify existing GIFs as images/videos per the current `gifs_as_videos`
setting. Response: `Job`.

### `POST /api/system/regenerate-thumbnails`
Enqueue a bulk thumbnail regeneration job. Response: `{ ok: true }`.

### `POST /api/system/transcode-videos`
Enqueue a check of every video, transcoding the ones browsers can't play. Response: `{ ok: true }`.

### `POST /api/system/cleanup`
Run library cleanup synchronously (removes orphaned DB rows/files and trash entries past 30 days).
Response: cleanup result object (see `services/cleanup.ts`).

## Backups

Database backups are written to `<dataDir>/backups` with `VACUUM INTO`, on the `backup` job
schedule (daily by default) and before a desktop update. After each one, all but the newest
`backup_keep` (default 7) are deleted.

### `GET /api/backups`
Response (`BackupsPayload`): `{ backups: { name, sizeBytes, createdAt }[], keep: number, dir: string }`,
newest first.

### `POST /api/backups`
Queue a backup now. Response: `202` + `Job`; poll `/api/jobs` until it is done.

## Trash

Deleted media waits in `<dataDir>/trash` for 30 days, then is purged at boot, every six hours and by
the cleanup job. Errors answer `{ error }` with the status noted.

### `GET /api/trash`
Response (`TrashPayload`): `{ items: TrashItem[], count, totalBytes, retentionDays }`, newest first.
Each `TrashItem` has `id`, `mediaId`, `libraryId`, `libraryName` (null once the library is gone),
`filename`, `type`, `sizeBytes`, `originalPath`, `trashedAt` and `expiresAt`.

### `GET /api/trash/:id/thumb`
The item's saved thumbnail. `404` when there is none.

### `POST /api/trash/:id/restore`
Moves the file back and re-inserts the media row under its old id with its tags, vetoes, like and
boards. If a file now sits at the original path it comes back as `name (restored).ext`. `404` if
not in the trash, `409` when its library or folder no longer exists, `410` when the file is missing
from the trash folder. Response (`TrashRestoreResult`): `{ ok: true, mediaId, path, renamed }`.

### `DELETE /api/trash/:id`
Delete one entry for good. Response (`TrashRemoveResult`): `{ ok: true, removed, freedBytes }`.

### `DELETE /api/trash`
Empty the trash. Response: `TrashRemoveResult`.

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

Images are tagged from the file, videos from up to 5 frames spread across them (each tag at its
highest confidence in any frame). General and character tags have separate thresholds
(`confidence_threshold`, `confidence_threshold_character`). Tags a user removed (vetoes) stay off,
and `user`, `meta`, `character` and `implied` links survive a re-tag.

---

## Search by description

### `GET /api/semantic/status`
`{ status: 'absent'|'downloading'|'ready', enabled, modelSizeBytes, embeddedCount, pendingCount }`.

Off by default (`semantic_search_enabled`). The search itself is the `describe` param on
`GET /api/media` and `GET /api/media/ids`.

### `POST /api/semantic/download`
Queues a `model-download` job for the CLIP model (~155 MB). `409` when already downloaded or downloading.
Response: `{ job: Job }`.

### `POST /api/semantic/run`
Queues an `embeddings` job over every file not indexed yet. `409` without the model or with nothing to do.
New files are also indexed after each scan while `semantic_search_enabled` is `1`. Response: `{ job: Job }`.

## Characters

Character detection is off by default (`character_detection_enabled`). When on, an after-scan job
finds characters in new images and videos, embeds each with CCIP and clusters them into
characters. Naming a character gives every item it is on a `character`-category tag (link source
`character`). Lists answer `CharacterSummary` objects: `{ id, tagId, name, displayName, hidden,
createdAt, mediaCount, detectionCount, coverDetectionId, coverUrl, suggestion }`; `name` is the tag
name, null until named.

### `GET /api/characters/status`
Response (`CharacterModelStatus`): `{ status: 'absent'|'downloading'|'ready'|'error', enabled,
modelSizeBytes, pendingCount, detectionCount, characterCount }`.

### `POST /api/characters/download`
Queues a `model-download` job for the detector and CCIP models (~195 MB). `409` when already
downloaded or downloading. Response: `{ job: Job }`.

### `POST /api/characters/run`
Queues a job over every file not scanned for characters yet. `409` without the models or with
nothing to do. Response: `{ job: Job }`.

### `GET /api/characters`
Response (`CharactersResponse`): `{ named, suggested, unnamed, unassignedCount, tagOnly }`.
`suggested` are unnamed clusters whose `solo` images mostly carry one WD character tag
(`suggestion: { tag, displayName, mediaCount, soloCount }`); `tagOnly` lists character tags in use
that no character carries (`TagCount[]`). Hidden characters are left out unless `?hidden=1`.

### `GET /api/characters/:id`
Response: `CharacterSummary`. `404` if unknown.

### `GET /api/characters/:id/media`
The character's media, newest first, with its detections on them. Query: `offset` (default 0),
`limit` (1-200, default 60). Response (`CharacterMediaResponse`): `{ character, items: Media[],
detections: CharacterDetection[], total, nextOffset }`.

### `GET /api/characters/:id/detections`
The character's faces, best score first, rejected ones left out. Same `offset`/`limit`. Response
(`CharacterDetectionsResponse`): `{ items: CharacterDetection[], total, nextOffset }`.

### `GET /api/characters/crops/:detectionId`
A webp crop of one detection's box, made on first request and cached.

### `POST /api/characters/:id/name`
Body: `{ name: string }`, normalized like a tag name. Reuses a tag of that name (a `user` tag
becomes a character tag); naming after another character's tag merges the two. `409` when the
name is a general or rating tag, with a suggested `name_(character)` in the error. Renaming
moves the links to the new tag. Response: `CharacterSummary`.

### `POST /api/characters/:id/accept-suggestion`
Names the character after its suggestion. `409` without one. Response: `CharacterSummary`.

### `POST /api/characters/:id/dismiss-suggestion`
Drops the suggestion for good; the character waits in `unnamed`. `409` without one. Response:
`CharacterSummary`.

### `POST /api/characters/:id/merge`
Body: `{ into: number }`. Moves every detection into `into` and deletes this character; rejections
stay rejected. Response: the merged `CharacterSummary`.

### `POST /api/characters/:id/hidden`
Body: `{ hidden: boolean }`. Hides the character from the list; its tag is untouched. Response:
`CharacterSummary`.

### `POST /api/characters/:id/cover`
Body: `{ detectionId: number }`, one of the character's own detections (`400` otherwise).
Response: `CharacterSummary`.

### `POST /api/character-detections/:id/reject`
"Not this character": the detection leaves its character and a re-run won't put it back.
Response: `CharacterDetection`.

### `POST /api/character-detections/:id/assign`
Body: `{ characterId: number }`. Puts the detection in a character by hand. Response:
`CharacterDetection`.

### `POST /api/character-detections/:id/name`
Body: `{ name: string }`. A face in an unnamed cluster names the whole cluster; any other face
moves to the character with that name, created when none has it. `409` for a general tag's name.
Response: `CharacterDetection`.

## Discover

The recommendation feed, while `discover_enabled` is `1`. Items carry `reasonTag` (the taste tag
that scored them highest) and `reasonRelated`.

### `GET /api/discover`
Query: `type?`, `surprise` (0-1, default 0.3; the page offers 0.1 / 0.3 / 0.6), `shelf?` (narrows
the feed to one shelf, for "See all"), `seed` (default 1), `cursor`, `limit` (1-200, default 60).
Hidden items and items carrying a muted tag never appear. The feed keeps at most 4 items per folder
and 5 per reason tag in any 20, and near-duplicates 60 apart. Response: `MediaListResponse`.

### `GET /api/discover/shelves`
Query: `type?`, `surprise`, `seed`, and `visit=1` when the page opens (for "New since your last
visit"). Response (`DiscoverShelvesResponse`): `{ shelves: { id, title, subtitle, tag?, items }[] }`.
Shelf ids: `new`, `like:<tag>` (because you like), `rediscover`, `offbeat`. A shelf with fewer than 3
items is left out.

### `GET /api/discover/profile`
The taste panel. Response (`DiscoverProfileResponse`): `{ tags: DiscoverTasteTag[], activeTags,
hiddenCount }`; each tag has `name`, `category`, `displayName`, `weight` (0-1, relative to the
strongest), `related` and `mode`. Tags with a preference are listed even once they leave the top.

### `PUT /api/discover/tags/:name`
Body: `{ mode: 'boost' | 'less' | 'mute' | null }`. Boost doubles the tag's weight, less cuts it to a
quarter, mute hides every item carrying it; `null` clears the preference. Response: `{ name, mode }`.

### `POST /api/discover/feedback`
"Not interested". Body: `{ mediaId: number, hidden: boolean }`. A hidden item leaves every Discover
list and counts a little against its tags. Response: `{ mediaId, hidden }`.

### `DELETE /api/discover/feedback`
Un-hide everything. Response: `{ cleared: number }`.

### `GET /api/discover/like/:id`
More like this. Query: `limit` (1-200, default 60). Ranks by shared tags, rarer tags counting more
and rating tags ignored; with search by description ready, image-embedding neighbours are blended in.
Response (`DiscoverLikeResponse`): `{ source: Media, items: Media[], ranking: 'tags' | 'visual' }`.

## Boards

### `GET /api/boards`
Every board, oldest first. Response: `BoardWithStats[]` (`{ id, name, createdAt, itemCount, thumbMediaId }`).

### `GET /api/boards/:id`
Response: `BoardWithStats`.

### `POST /api/boards`
Body: `{ name: string }` (1-120 chars). Response: `201` + `BoardWithStats`.

### `PATCH /api/boards/:id`
Rename. Body: `{ name: string }`. Response: `BoardWithStats`.

### `DELETE /api/boards/:id`
Delete the board; its media are untouched. Response: `{ ok: true }`.

### `POST /api/boards/:id/media`
Body: `{ mediaIds: number[] }`. Adds the media that still exist; ones already on the board are
skipped. Response: `BoardWithStats`.

### `DELETE /api/boards/:id/media/:mediaId`
Remove one item from the board. Response: `{ ok: true }`.

## Saved searches

### `GET /api/saved-searches`
Response: `SavedSearch[]`, oldest first.

### `POST /api/saved-searches`
Body: `{ name: string (1-120 chars), query: string }`. Saving under an existing name overwrites it.
Response: `201` + `SavedSearch`.

### `DELETE /api/saved-searches/:id`
Response: `{ ok: true }`.

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
