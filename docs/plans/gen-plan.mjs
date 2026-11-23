import fs from 'node:fs';

const OUT = '/mnt/data/apps/sakuya/docs/plans/sakuya-roadmap-plan.md';
const RULE =
  'Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.';
const LANES = 'Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.';
const TEST = 'flock /tmp/sakuya-test.lock bun test --isolate';
const SCRATCH = 'docs/plans/mockups';

const box = (t) => `- [ ] ${t}`;
const lane = (n, scenario, slug, pass) => box(`Lane ${n}. ${scenario} Save \`${slug}.png\`. Pass when ${pass}`);

/** Lanes 9 and 10 for any web PR: the other UI style and phone width. */
const webTail = (id, what) => [
  [`Repeat ${what} with \`ui_style\` set to \`glass\`.`, `${id.toLowerCase()}-glass`, 'the same result shows with no clipped text and no overlapping controls.'],
  [`Repeat ${what} at 390px wide.`, `${id.toLowerCase()}-phone`, 'nothing scrolls sideways and every control stays reachable.'],
];

const PRS = [
  {
    id: 'P01', phase: 0, title: 'Schedule database backups',
    depends: 'None. P01 is the root of phase 0 and branches from `master`.',
    files: [
      'Create `apps/server/src/services/backup.ts`.',
      'Edit `packages/shared/src/index.ts` to add `backup` to `JOB_TYPES` and `SCHEDULE_JOB_TYPES`.',
      'Edit `apps/server/src/services/jobScheduler.ts` to resolve the `backup` schedule.',
      'Edit `apps/server/src/lib/settings.ts` to add `backup_keep` with a default of 7.',
      'Create `apps/server/src/backup.test.ts`.',
      'Create `apps/server/scripts/bench-backup.ts` for the perf probe.',
    ],
    build: [
      'Add `runBackup()` in `backup.ts`. It runs `VACUUM INTO` to `<dataDir>/backups/sakuya-<timestamp>.db`, then deletes all but the newest `backup_keep` files.',
      'Add `enqueueBackupJob()` so a backup is a tracked job like every other.',
      'Default the `backup` schedule to daily. The schedule is configured where scan and cleanup schedules are today.',
    ],
    see: [
      'A `backup` job in the jobs list ends with the log line `Completed. Backup written to <path>.`',
      'After eight runs with `backup_keep` at 7, `<dataDir>/backups` holds seven files.',
    ],
    unit: [
      '`apps/server/src/backup.test.ts` gains "a backup opens as a database with the same media count" and "pruning keeps the newest N". Run `' + TEST + ' apps/server/src/backup.test.ts`.',
      '`apps/server/src/jobScheduler.test.ts` gains "the backup schedule resolves to daily by default". Run `' + TEST + ' apps/server/src/jobScheduler.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Trunk has no backup job, so record that, then at head seed 500 synthetic items and run a backup from the API.', 'p01-regression', 'trunk has no `backup` job type and head writes one file that `sqlite3 <file> "select count(*) from media"` reads as 500.'],
      ['Run eight backups in a row with `backup_keep` at 7.', 'p01-prune', 'exactly seven files remain and the oldest is gone.'],
      ['Start a backup while a scan of 2,000 synthetic files runs.', 'p01-concurrent', 'both jobs end `done` and the backup opens cleanly.'],
      ['Make `<dataDir>/backups` read-only and run a backup.', 'p01-readonly', 'the job ends `error` with the path in its log and the server keeps serving `/api/health`.'],
      ['Set the schedule to off and wait past one interval.', 'p01-off', 'no new backup file appears.'],
      ['Restart the server between two scheduled backups.', 'p01-restart', 'the next backup still runs once at its slot, not twice.'],
      ['Run a backup with auth enabled and a valid session.', 'p01-auth', 'the job runs and an unauthenticated call to start it gets 401.'],
      ['Open the jobs history in the scratch UI after a backup.', 'p01-history', 'the backup row shows its label, status and log.'],
      ['Restore a backup by copying it over a scratch database and booting.', 'p01-restore', 'the server boots and lists the same 500 items.'],
      ['Run a backup with 0 bytes free simulated by a tiny tmpfs data dir.', 'p01-disk-full', 'the job ends `error`, no partial file is left, and the live database is untouched.'],
    ],
    perf: [
      'Metric. Wall time of one backup on a synthetic 30k-item database, and p95 `/api/media` latency while it runs.',
      'Probe. `bun apps/server/scripts/bench-backup.ts` run five times at trunk and at head, interleaved. Trunk runs the latency half only.',
      'Baseline. Record trunk p95 `/api/media` latency with no backup first.',
      'Rule. Fail if one backup takes over 5 s, or p95 `/api/media` latency during a backup exceeds trunk by more than 20%.',
    ],
    gated: false,
  },
  {
    id: 'D01', phase: 1, title: 'Publish desktop update metadata with each release',
    depends: 'None. D01 is the root of phase 1 and branches from `master`.',
    files: ['Edit `.github/workflows/desktop.yml`.', 'Edit `desktop/package.json`.'],
    build: [
      'Add `"publish": [{ "provider": "github", "owner": "rene-roid", "repo": "sakuya" }]` to the `build` block of `desktop/package.json`, keeping `--publish never` so CI still uploads.',
      'Add `desktop/dist/latest.yml`, `desktop/dist/latest-linux.yml` and `desktop/dist/*.blockmap` to the upload-artifact paths, and change the release step to upload `Sakuya-* latest*.yml *.blockmap`.',
    ],
    see: [
      'A `workflow_dispatch` run produces artifacts that include `latest.yml`, `latest-linux.yml` and two `.blockmap` files next to the installers.',
      '`latest-linux.yml` names `Sakuya-<version>-linux-x86_64.AppImage` with a `sha512` that matches the file.',
    ],
    unit: [
      'Run `npx electron-builder --linux --publish never` in `desktop/` locally and check `desktop/dist/latest-linux.yml` exists with a `sha512` that `sha512sum` reproduces.',
      'Run `actionlint .github/workflows/desktop.yml` and record a clean result.',
    ],
    lanes: [
      ['Regression lane against trunk. Run the Desktop workflow by `workflow_dispatch` on trunk and on the head branch.', 'd01-regression', 'trunk artifacts lack `latest*.yml` and head artifacts contain both files and both blockmaps.'],
      ['Download the Linux artifact and parse `latest-linux.yml`.', 'd01-linux-yml', 'its `path` and `sha512` match the AppImage.'],
      ['Download the Windows artifact and parse `latest.yml`.', 'd01-win-yml', 'its `path` and `sha512` match the installer.'],
      ['Tag a throwaway `v0.0.0-test.1` on a fork and let the release job run.', 'd01-release', 'the release lists the installers, both yml files and both blockmaps.'],
      ['Re-run the release job on the same tag.', 'd01-rerun', 'the upload with `--clobber` succeeds and no asset is duplicated.'],
      ['Open a PR that touches only `desktop/package.json`.', 'd01-pr-trigger', 'the Desktop workflow runs and uploads artifacts but creates no release.'],
      ['Compare installer sizes between trunk and head artifacts.', 'd01-sizes', 'each installer differs by less than 1 MB.'],
      ['Install the head AppImage on a clean Linux user and launch it.', 'd01-launch-linux', 'the window shows the dashboard.'],
      ['Install the head `.exe` on a Windows VM and launch it.', 'd01-launch-win', 'the window shows the dashboard.'],
      ['Check that the version in `latest.yml` equals the root `package.json` version.', 'd01-version', 'both read the same string.'],
    ],
    perf: [
      'Metric. Desktop workflow wall time per matrix job.',
      'Probe. Two `workflow_dispatch` runs each at trunk and head, interleaved.',
      'Baseline. Record trunk wall time for the Linux and Windows jobs first.',
      'Rule. Fail if either job takes more than 60 s longer than trunk.',
    ],
    gated: false,
  },
  {
    id: 'D02', phase: 1, title: 'Update the desktop app in the background',
    depends: 'D01 for the metadata and P01 for the pre-update backup.',
    files: [
      'Edit `desktop/main.js`.',
      'Edit `desktop/package.json` to add `electron-updater`.',
      'Create `desktop/updates.js`.',
      'Create `desktop/test/updates.spec.js` for Playwright `_electron`.',
    ],
    build: [
      'Add `desktop/updates.js` that owns the update state machine with the states `idle`, `checking`, `downloading`, `ready` and `error`, driven by `autoUpdater` events.',
      'Check on launch and every 6 hours. The mode is `auto`, `notify` or `off`, stored in `~/.sakuya/desktop.json`, default `auto`.',
      'In `ready`, add a tray and app-menu item `Restart to update`. Before `quitAndInstall`, call the P01 backup endpoint, then stop the server with the existing `stopServer()`.',
      'Keep the AppImage autostart re-pointing in `app.whenReady`, so the login entry follows the new file.',
    ],
    see: [
      'With a newer version on the feed, the tray menu shows `Restart to update (1.8.0)` within a minute of launch.',
      'Clicking it writes a backup, restarts, and the About line in the tray reads the new version.',
    ],
    unit: [
      '`desktop/test/updates.spec.js` gains "a newer feed version reaches ready", "mode off never checks" and "a failed download returns to idle with the error logged". Run `npx playwright test` in `desktop/`.',
    ],
    lanes: [
      ['Regression lane against trunk. Launch the trunk and head AppImages against a local `generic` feed that serves a newer version.', 'd02-regression', 'trunk shows no update item and head shows `Restart to update` within 60 s.'],
      ['Click `Restart to update` on Linux.', 'd02-apply-linux', 'the app restarts on the new version and `~/.sakuya/backups` gained one file.'],
      ['Click `Restart to update` on Windows.', 'd02-apply-win', 'the NSIS update finishes and the app reopens on the new version.'],
      ['Set the mode to `notify`.', 'd02-notify', 'the tray offers the update but nothing downloads until it is clicked.'],
      ['Set the mode to `off` and relaunch.', 'd02-off', 'the feed server log shows no request.'],
      ['Serve a feed with a bad `sha512`.', 'd02-bad-hash', 'the state returns to `idle`, `desktop.log` names the error, and the running version is unchanged.'],
      ['Take the feed offline.', 'd02-offline', 'the app keeps running with no error dialog.'],
      ['Quit from the tray while a download is in progress.', 'd02-quit-mid', 'the app exits within 5 s and the next launch starts clean.'],
      ['Enable Start at Login, then apply an update on Linux.', 'd02-autostart', 'the autostart entry points at the new AppImage path.'],
      ['Start a scan, then apply an update.', 'd02-busy', 'the server stops cleanly and the scan job reads `error` or `done`, never stuck `running`, after restart.'],
    ],
    perf: [
      'Metric. Desktop cold start, from process launch to the window showing the dashboard.',
      'Probe. Ten cold starts each of the trunk and head AppImages, interleaved, timed by Playwright `_electron`.',
      'Baseline. Record the trunk median first.',
      'Rule. Fail if the head median is more than 150 ms slower than trunk.',
    ],
    gated: true,
  },
  {
    id: 'T01', phase: 2, title: 'Remember AI tags the user removed',
    depends: 'None. T01 is the root of phase 2 and branches from `master` after phase 1 lands.',
    files: [
      'Edit `apps/server/src/db/index.ts` to add a migration for `media_tag_vetoes(media_id, tag_id)`.',
      'Edit `apps/server/src/db/schema.ts`.',
      'Edit `apps/server/src/routes/media.ts` at the remove branch near line 659.',
      'Edit `apps/server/src/services/tagger.ts` in `tagOneMedia`.',
      'Edit `apps/server/src/tagger.test.ts`.',
    ],
    build: [
      'When a user removes a tag whose row has `source` `ai`, insert a veto row. Adding the tag back by hand deletes the veto.',
      'In `tagOneMedia`, skip any predicted tag with a veto for that media.',
    ],
    see: [
      'Remove `simple_background` from an item, re-tag it, and the tag stays gone.',
      'Add it back by hand, re-tag, and it stays as a user tag.',
    ],
    unit: [
      '`apps/server/src/tagger.test.ts` gains "a removed AI tag is not re-added by retag" and "re-adding a vetoed tag clears the veto". Run `' + TEST + ' apps/server/src/tagger.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Remove an AI tag from a synthetic item in the viewer, then bulk re-tag it, at trunk and head.', 't01-regression', 'trunk shows the tag again and head does not.'],
      ['Remove three AI tags from one item and re-tag.', 't01-multi', 'all three stay gone and the others return.'],
      ['Remove a tag through the bulk tag dialog on 20 items, then re-tag them.', 't01-bulk', 'none of the 20 regain it.'],
      ['Re-add the vetoed tag by hand and re-tag.', 't01-readd', 'the tag is present once, as a user tag.'],
      ['Delete a media item that has vetoes.', 't01-delete', 'its veto rows are gone, checked with a count query on the scratch database.'],
      ['Search Explore for the vetoed tag.', 't01-search', 'the item is not in the results.'],
      ['Remove a user tag, then re-tag.', 't01-user-tag', 'no veto row is written.'],
      ['Restart the server and re-tag again.', 't01-restart', 'the veto still holds.'],
      ...webTail('T01', 'lane 1'),
    ],
    perf: [
      'Metric. Tag job throughput in items per second on 2,000 synthetic images.',
      'Probe. Three tag runs each at trunk and head, interleaved, with the real model symlinked into a scratch data dir.',
      'Baseline. Record trunk items per second first.',
      'Rule. Fail if head is more than 3% slower than trunk.',
    ],
    gated: true,
  },
  {
    id: 'T02', phase: 2, title: 'Give character and general tags their own thresholds',
    depends: 'T01 in the phase 2 stack.',
    files: [
      'Edit `apps/server/src/lib/settings.ts` to add `confidence_threshold_character` and keep `confidence_threshold` for general.',
      'Edit `apps/server/src/services/tagger.ts` so `selectTags` takes a threshold per category.',
      'Edit `apps/web/src/routes/settings/TaggingTab.tsx`.',
      'Edit `apps/server/src/tagger.test.ts`.',
    ],
    build: [
      'Change `selectTags(scores, labels, thresholds)` to read `thresholds[label.category]`. The character default is 85 and general stays at 35.',
      'Show two sliders in the tagging settings, labelled General and Character.',
    ],
    see: [
      'A character tag scoring 0.6 is dropped and a general tag scoring 0.6 is kept.',
    ],
    unit: [
      '`apps/server/src/tagger.test.ts` gains "selectTags applies the character threshold to character labels" with literal scores and expected names. Run `' + TEST + ' apps/server/src/tagger.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Tag the same 50 synthetic images at trunk and head with defaults.', 't02-regression', 'head has no more character tags than trunk and the same general tags.'],
      ['Set the character slider to 50 and re-tag.', 't02-lower', 'character tag count rises compared with lane 1.'],
      ['Set the general slider to 90 and re-tag.', 't02-general', 'general tag count falls and character tags are unchanged.'],
      ['Move a slider with the arrow keys only and reload.', 't02-keyboard', 'the new value persisted.'],
      ['Upgrade a scratch database from trunk.', 't02-upgrade', 'the general threshold keeps its old value and the character one reads 85.'],
      ['Check that rating tags are still picked.', 't02-rating', 'each item still has exactly one rating tag.'],
      ['Set both sliders to 0.', 't02-zero', 'tagging finishes and the item count with tags equals the item count.'],
      ['Set both sliders to 100.', 't02-hundred', 'items get only a rating tag.'],
      ...webTail('T02', 'lane 4'),
    ],
    perf: [
      'Metric. Tag job items per second on 2,000 synthetic images.',
      'Probe. Three runs each at trunk and head, interleaved.',
      'Baseline. Record trunk items per second first.',
      'Rule. Fail if head is more than 3% slower than trunk.',
    ],
    gated: true,
  },
  {
    id: 'T03', phase: 2, title: 'Show tags under display names',
    depends: 'T02 in the phase 2 stack.',
    files: [
      'Edit `apps/server/src/db/index.ts` to add a migration for `tags.display_name`.',
      'Edit `apps/server/src/db/schema.ts`.',
      'Edit `packages/shared/src/index.ts` to add `displayName` to `TagCount` and `MediaTag`, and export `tagLabel` and `prettifyTag`.',
      'Edit `apps/server/src/routes/tags.ts` to match `display_name` in autocomplete and add `PATCH /api/tags/:name`.',
      'Edit the tag render sites in `apps/web/src/components/TagSidebar.tsx`, `MediaViewer.tsx`, `FilterToolbar.tsx`, `BulkTagDialog.tsx`, `TagSearchInput.tsx`, `SelectionBar.tsx` and `Navbar.tsx`.',
      'Edit `packages/shared/src/index.test.ts`.',
    ],
    build: [
      'Add `prettifyTag(name)`, which turns `uraraka_ochako` into `Uraraka Ochako` and splits `asuna_(sao)` into the name `Asuna` and the subtitle `sao`.',
      'Add `tagLabel(tag)`, which returns `displayName ?? prettifyTag(name)`, and use it at every render site.',
      'Add a rename control to the tag menu in the viewer. URLs, saved searches and `media_fts` keep the canonical name.',
    ],
    see: [
      'The sidebar shows `Uraraka Ochako`, and after a rename it shows `Uraraka`, while the URL still reads `tags=uraraka_ochako`.',
      'Typing `Urar` in the search box suggests the renamed tag.',
    ],
    unit: [
      '`packages/shared/src/index.test.ts` gains literal cases for `prettifyTag`, including `asuna_(sao)` and `1girl`. Run `' + TEST + ' packages/shared/src/index.test.ts`.',
      '`apps/server/src/search.test.ts` gains "autocomplete matches a display name and returns the canonical name". Run `' + TEST + ' apps/server/src/search.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Open Explore on a library tagged `uraraka_ochako` at trunk and head.', 't03-regression', 'trunk shows `uraraka_ochako` and head shows `Uraraka Ochako`.'],
      ['Rename the tag to `Uraraka` from the viewer.', 't03-rename', 'the sidebar, viewer and filter chip all read `Uraraka`.'],
      ['Type `Urar` in the tag search.', 't03-autocomplete', 'the suggestion reads `Uraraka` and choosing it filters to the right items.'],
      ['Re-tag the item after the rename.', 't03-retag', 'the display name survives.'],
      ['Replay a saved search made before the rename.', 't03-saved', 'it returns the same items.'],
      ['Clear the display name.', 't03-clear', 'the label falls back to `Uraraka Ochako`.'],
      ['Open the bulk tag dialog on items with the renamed tag.', 't03-bulk', 'the dialog shows `Uraraka` and removing it works.'],
      ['Rename a tag to a name that another tag uses as its display name.', 't03-collision', 'the API answers 409 with a message and nothing changes.'],
      ...webTail('T03', 'lane 2'),
    ],
    perf: [
      'Metric. `/api/tags?q=` latency on a synthetic 30k-item, 8k-tag library.',
      'Probe. 200 autocomplete requests each at trunk and head, interleaved, with random two-letter prefixes.',
      'Baseline. Record trunk p95 first.',
      'Rule. Fail if head p95 exceeds trunk p95 by more than 10%.',
    ],
    gated: true,
  },
  {
    id: 'S01', phase: 2, title: 'Rebuild settings on one registry',
    depends: 'T03 in the phase 2 stack.',
    files: [
      'Create `apps/web/src/routes/settings/registry.tsx`.',
      'Create `apps/web/src/routes/settings/SettingRow.tsx`.',
      'Edit `apps/web/src/routes/settings/index.tsx`.',
      'Edit `apps/web/src/routes/settings/MiscTabs.tsx`, `TaggingTab.tsx`, `LibrariesTab.tsx` and `JobsTab.tsx`.',
      'Edit `apps/web/src/routes/Discover.tsx` for the settings link.',
      'Create `apps/web/src/routes/settings/registry.test.ts`.',
    ],
    build: [
      'Declare every setting once in `registry.tsx` with `section`, `group`, `label`, `description`, `keywords` and `kind`, where `kind` is toggle, select, slider, action or custom.',
      'Render rows with one `SettingRow`, grouped into one panel per group with dividers. Sections are General, Playback, Libraries, AI Tagging, Media processing, Jobs, Storage and About.',
      'Make `ToggleSwitch` a `button` with `role="switch"`, save the slider on `onChange` with a debounce, render sidebar tabs as buttons, and drop the toast on toggles.',
      'Add an exported `settingHref(id)` and use it for the Discover-off link instead of `?tab=behavior`.',
    ],
    see: [
      'Settings shows the eight sections in three groups and every old setting is present.',
      'Tab moves through every switch and Space toggles it.',
    ],
    unit: [
      '`apps/web/src/routes/settings/registry.test.ts` gains "every Settings key appears in exactly one registry entry" and "ids are unique". Run `' + TEST + ' apps/web/src/routes/settings/registry.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Toggle every setting at trunk and head, reload, and read `/api/settings`.', 's01-regression', 'head persists every value trunk persists.'],
      ['Walk all eight sections.', 's01-sections', 'every setting from trunk appears once.'],
      ['Use only the keyboard to change the confidence slider and reload.', 's01-slider-keys', 'the new value persisted.'],
      ['Tab through Playback and press Space on each switch.', 's01-switch-keys', 'each switch flips and has a visible focus ring.'],
      ['Toggle three settings quickly.', 's01-no-toast', 'no toast appears and all three persisted.'],
      ['Turn Discover off and open `/discover`.', 's01-discover-link', 'the link lands on the Discover setting in General.'],
      ['Open `/settings?tab=behavior` from an old bookmark.', 's01-old-tab', 'it opens General.'],
      ['Compare row spacing across sections.', 's01-spacing', 'every row has the same padding and every group has the same gap.'],
      ...webTail('S01', 'lane 2'),
    ],
    perf: [
      'Metric. Time from clicking a settings section to its content painted.',
      'Probe. 50 section switches each at trunk and head, interleaved, timed with `performance.now()` around the click and the next paint.',
      'Baseline. Record trunk p95 first.',
      'Rule. Fail if head p95 is over 50 ms or more than 20% slower than trunk.',
    ],
    gated: true,
  },
  {
    id: 'S02', phase: 2, title: 'Search settings',
    depends: 'S01 in the phase 2 stack.',
    files: [
      'Create `apps/web/src/routes/settings/SettingsSearch.tsx`.',
      'Edit `apps/web/src/routes/settings/index.tsx`.',
      'Edit `apps/web/src/routes/settings/registry.tsx` to fill `keywords`.',
      'Edit `apps/web/src/routes/settings/registry.test.ts`.',
    ],
    build: [
      'Add a search box above the section list. Words match with AND across label, description, keywords, group and section.',
      'While searching, show matches grouped by section with a breadcrumb, highlight the matched words, and show a count per section in the sidebar.',
      'Enter opens the first match, Escape clears, `/` focuses the box, and each match links to `?tab=<section>#<id>`, which scrolls to the row and flashes it.',
    ],
    see: [
      'Typing `hevc` shows Video transcoding under Media processing.',
      'Opening `/settings?tab=processing#thumbnail-cache` scrolls to that row and flashes it.',
    ],
    unit: [
      '`apps/web/src/routes/settings/registry.test.ts` gains literal search cases, `gif` gives two ids and `video hevc` gives two ids. Run `' + TEST + ' apps/web/src/routes/settings/registry.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Trunk has no settings search, so record that, then at head type `thumb`.', 's02-regression', 'head lists the thumbnail rows under Media processing and the cleanup row under Storage.'],
      ['Type `video hevc`.', 's02-and', 'only rows matching both words show.'],
      ['Type `zzz`.', 's02-empty', 'an empty state with example queries shows.'],
      ['Press `/` from anywhere on the page, type `volume`, and press Enter.', 's02-enter', 'Playback opens and the volume row flashes.'],
      ['Click a breadcrumb in the results.', 's02-crumb', 'that section opens scrolled to the row.'],
      ['Toggle a switch inside the results.', 's02-toggle', 'the value persists and the results stay open.'],
      ['Open a deep link in a new tab.', 's02-deeplink', 'the row is scrolled into view and flashes.'],
      ['Press Escape.', 's02-escape', 'the query clears and the previous section returns.'],
      ...webTail('S02', 'lane 4'),
    ],
    perf: [
      'Metric. Keystroke to results painted in settings search.',
      'Probe. Type a 12-character query 20 times at head. Trunk lacks the feature, so measure section-switch paint at both as a control.',
      'Baseline. Record the trunk section-switch p95 first.',
      'Rule. Fail if head keystroke-to-paint p95 exceeds 16 ms, or the head control is more than 10% slower than trunk.',
    ],
    gated: true,
  },
  {
    id: 'S03', phase: 2, title: 'Move uploads and duplicates out of settings',
    depends: 'S02 in the phase 2 stack.',
    files: [
      'Create `apps/web/src/components/UploadButton.tsx` from the upload logic in `apps/web/src/routes/settings/UploadsTab.tsx`.',
      'Create `apps/web/src/routes/Duplicates.tsx` from `apps/web/src/routes/settings/DuplicatesTab.tsx`.',
      'Delete `apps/web/src/routes/settings/UploadsTab.tsx` and `DuplicatesTab.tsx`.',
      'Edit `apps/web/src/App.tsx`, `apps/web/src/components/Navbar.tsx` and the library page.',
    ],
    build: [
      'Add an Upload button to each library page that opens the file picker and accepts drops onto the grid.',
      'Serve Duplicates at `/duplicates`, linked from the Explore toolbar menu. Old `?tab=uploads` and `?tab=duplicates` links redirect.',
    ],
    see: [
      'Dropping two images onto a library grid uploads them into that library with progress shown.',
      '`/settings?tab=duplicates` redirects to `/duplicates`.',
    ],
    unit: [
      'Run `bun run typecheck` and `bun run lint` and record clean results. Server upload behavior is unchanged and `' + TEST + ' apps/server/src/removal.test.ts` stays green.',
    ],
    lanes: [
      ['Regression lane against trunk. Upload two files at trunk from Settings and at head from the library page.', 's03-regression', 'both land in the same library with the same count.'],
      ['Drop five images onto a library grid.', 's03-drop', 'all five appear without a reload.'],
      ['Upload a non-image file.', 's03-reject', 'a toast names the file and nothing is added.'],
      ['Open `/duplicates` and delete one of a pair.', 's03-duplicates', 'the pair disappears and the file is gone.'],
      ['Open `/settings?tab=uploads`.', 's03-redirect-uploads', 'it lands on the first library page.'],
      ['Open `/settings?tab=duplicates`.', 's03-redirect-dupes', 'it lands on `/duplicates`.'],
      ['Search settings for `upload`.', 's03-search', 'the result explains uploads moved and links to a library.'],
      ['Upload with no library.', 's03-no-library', 'the button is disabled with a hint to create one.'],
      ...webTail('S03', 'lane 2'),
    ],
    perf: [
      'Metric. Upload throughput in MB per second for 50 synthetic 2 MB images.',
      'Probe. Three uploads each at trunk and head, interleaved.',
      'Baseline. Record trunk MB per second first.',
      'Rule. Fail if head is more than 5% slower than trunk.',
    ],
    gated: true,
  },
  {
    id: 'D03', phase: 2, title: 'Show updates inside the app by install kind',
    depends: 'D02 for the updater and S01 for the About section.',
    files: [
      'Create `desktop/preload.js`.',
      'Edit `desktop/main.js` to load the preload and answer `update:state`, `update:check`, `update:install` and `update:mode`.',
      'Edit `apps/web/src/components/UpdateToast.tsx`.',
      'Edit `apps/server/src/routes/settings.ts` to report `installKind` as desktop, docker or source.',
      'Edit `apps/web/src/routes/settings/registry.tsx` for the About rows.',
    ],
    build: [
      'Expose `window.sakuyaDesktop` through `contextBridge` with the four update calls.',
      'Branch `UpdateToast` on `installKind`. Desktop shows `Restart to update`, Docker shows `docker compose pull && docker compose up -d`, and source shows `./update.sh`.',
      'Add About rows for the version, a Check now button, and the update mode select on desktop.',
    ],
    see: [
      'In the desktop app with an update ready, the toast reads `Sakuya 1.8.0 is ready` with a `Restart to update` button.',
      'In the browser on a source install, the toast still says `Run ./update.sh to upgrade`.',
    ],
    unit: [
      '`apps/server/src/version.test.ts` gains "installKind reads docker when `/.dockerenv` exists and source otherwise". Run `' + TEST + ' apps/server/src/version.test.ts`.',
      '`desktop/test/updates.spec.js` gains "the renderer sees ready through the bridge". Run `npx playwright test` in `desktop/`.',
    ],
    lanes: [
      ['Regression lane against trunk. Open a source install in the browser at trunk and head with a newer release on the feed.', 'd03-regression', 'both show the toast with `./update.sh`.'],
      ['Open the desktop app with an update ready.', 'd03-desktop-toast', 'the toast shows `Restart to update` and clicking it restarts into the new version.'],
      ['Run the Docker image with a newer release.', 'd03-docker', 'the toast shows the compose command.'],
      ['Click Check now in About on desktop with no update.', 'd03-check-none', 'About reads `Up to date`.'],
      ['Change the update mode in About to off.', 'd03-mode', '`~/.sakuya/desktop.json` reads `off` and the tray agrees.'],
      ['Open the desktop UI from Open in Browser.', 'd03-browser-from-desktop', 'the browser tab shows the source-style message, not a broken button.'],
      ['Dismiss the toast and reload.', 'd03-dismiss', 'it stays hidden for that version.'],
      ['Search settings for `update`.', 'd03-search', 'the About rows appear.'],
      ...webTail('D03', 'lane 2'),
    ],
    perf: [
      'Metric. Dashboard first paint in the desktop window.',
      'Probe. Ten cold starts each of trunk and head builds, interleaved.',
      'Baseline. Record the trunk median first.',
      'Rule. Fail if head is more than 50 ms slower than trunk.',
    ],
    gated: true,
  },
  {
    id: 'P02', phase: 2, title: 'Send deleted media to a trash folder',
    depends: 'D03 in the phase 2 stack, and S01 for the Storage section.',
    files: [
      'Create `apps/server/src/services/trash.ts`.',
      'Edit `apps/server/src/routes/media.ts` at lines 282 and 581 to call `moveToTrash` instead of `fs.unlink`.',
      'Edit `apps/server/src/db/index.ts` to add a migration for `trash(id, original_path, trashed_path, trashed_at, media_json)`.',
      'Edit `apps/server/src/services/cleanup.ts` to purge items older than 30 days.',
      'Edit `apps/web/src/routes/settings/registry.tsx` for a Trash row in Storage.',
      'Create `apps/server/src/trash.test.ts`.',
    ],
    build: [
      'Move a deleted file to `<dataDir>/trash/<id>` with a rename, or a copy then unlink across devices, and keep its media row and tags as JSON.',
      'Add `GET /api/trash`, `POST /api/trash/:id/restore` and `DELETE /api/trash`. Restore puts the file back and re-inserts the row with its tags.',
      'Show the Trash in Storage with its size, a Restore action per item and Empty trash.',
    ],
    see: [
      'Deleting an image leaves it in Trash, and Restore brings it back with its tags and likes.',
      'Items older than 30 days are gone after the cleanup job.',
    ],
    unit: [
      '`apps/server/src/trash.test.ts` gains "delete moves the file and restore brings back tags" and "purge removes only items older than 30 days". Run `' + TEST + ' apps/server/src/trash.test.ts`.',
      '`apps/server/src/removal.test.ts` stays green. Run `' + TEST + ' apps/server/src/removal.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Delete a synthetic image at trunk and head.', 'p02-regression', 'trunk removes the file for good and head lists it in Trash.'],
      ['Restore the item.', 'p02-restore', 'it returns to its library with its tags, like and board membership.'],
      ['Bulk delete 100 items, then Empty trash.', 'p02-bulk', 'Trash lists 100 items, then 0, and disk usage drops.'],
      ['Restore an item whose original folder was removed.', 'p02-missing-folder', 'the API answers 409 with the path and the item stays in Trash.'],
      ['Delete across devices with the trash on another mount.', 'p02-cross-device', 'the file is copied and the original is unlinked.'],
      ['Set the clock forward 31 days and run cleanup.', 'p02-purge', 'the old item is gone and a newer one stays.'],
      ['Delete a video with a transcode.', 'p02-video', 'restore plays the video again.'],
      ['Rescan the library after a delete.', 'p02-rescan', 'the scan does not re-add the trashed file.'],
      ...webTail('P02', 'lane 2'),
    ],
    perf: [
      'Metric. Bulk delete time for 500 synthetic items.',
      'Probe. Three bulk deletes each at trunk and head, interleaved, on the same device.',
      'Baseline. Record trunk wall time first.',
      'Rule. Fail if head takes more than 1.5 times trunk, or more than 3 s.',
    ],
    gated: true,
  },
  {
    id: 'R01', phase: 3, title: 'Fix Discover scoring',
    depends: 'None. R01 is the root of phase 3 and branches from `master` after phase 2 lands.',
    files: ['Edit `apps/server/src/routes/discover.ts`.', 'Edit `apps/server/src/routes/media.ts` near line 766.', 'Edit `apps/server/src/discover.test.ts`.'],
    build: [
      'Score an item by the sum of its five best profile weights instead of `SUM(p.weight)` over every tag.',
      'Weight each item in `buildProfile` by a 60-day half-life from `liked_at` and `last_viewed_at`.',
      'Count a view only when the client reports at least 2 s open, through the existing progress call.',
    ],
    see: [
      'An item with five strongly liked tags ranks above one with 40 weak matches.',
      'A like from a year ago moves the feed less than a like from today.',
    ],
    unit: [
      '`apps/server/src/discover.test.ts` gains "five strong tags beat forty weak ones", "a fresh like outweighs an old one" and "a 1 s open does not count as a view", each asserting literal ids in order. Run `' + TEST + ' apps/server/src/discover.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Seed the 40-weak versus 5-strong fixture and read the first page at trunk and head.', 'r01-regression', 'trunk ranks the 40-tag item first and head ranks the 5-tag item first.'],
      ['Like 10 items tagged `rain` today and 10 tagged `snow` a year ago.', 'r01-decay', 'the first page has more `rain` than `snow`.'],
      ['Open and close 30 items within 1 s each.', 'r01-quickskip', 'their view counts stay 0.'],
      ['Keep an item open for 5 s.', 'r01-view', 'its view count is 1.'],
      ['Page through 600 items.', 'r01-pagination', 'no id repeats and none is skipped.'],
      ['Read the feed on an empty profile.', 'r01-cold', 'the feed is random and has 60 items.'],
      ['Like an item mid-scroll.', 'r01-snapshot', 'the next page keeps the old ordering.'],
      ['Set surprise to 1.', 'r01-random', 'the order matches trunk for the same seed.'],
      ['Read the reason tag on the top 20 cards.', 'r01-reason', 'each reason is one of that item\'s tags.'],
      ['Run with the type filter set to video.', 'r01-video', 'only videos return.'],
    ],
    perf: [
      'Metric. Discover first-page latency and snapshot build time on a synthetic 30k-item library.',
      'Probe. 30 first-page requests each at trunk and head, interleaved, with a forced snapshot rebuild every tenth request.',
      'Baseline. Record trunk p95 and snapshot build time first.',
      'Rule. Fail if head p95 or build time exceeds trunk by more than 15%.',
    ],
    gated: false,
  },
  {
    id: 'R02', phase: 3, title: 'Spread similar items through the Discover feed',
    depends: 'R01 in the phase 3 stack.',
    files: ['Edit `apps/server/src/routes/discover.ts`.', 'Create `apps/server/src/lib/diversify.ts`.', 'Edit `apps/server/src/discover.test.ts`.'],
    build: [
      'Add `diversify(items, window)` in `diversify.ts`. In each window of 20 it allows at most 4 items from one folder and 5 with one reason tag, and keeps only one of a group within dHash distance 6.',
      'Apply it to each page after ranking, before the cursor is taken, so pagination stays stable.',
    ],
    see: [
      'A 50-image batch from one folder shows at most 4 per 20 cards.',
    ],
    unit: [
      '`apps/server/src/discover.test.ts` gains "one folder never fills a window" and "near-duplicates collapse to one" with literal ids. Run `' + TEST + ' apps/server/src/discover.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Seed a 50-image single-folder batch that matches taste and read page one at trunk and head.', 'r02-regression', 'trunk shows over 4 from that folder in the first 20 and head shows at most 4.'],
      ['Seed 10 near-identical images.', 'r02-dupes', 'one of them appears in the first page.'],
      ['Page through 600 items.', 'r02-pagination', 'no id repeats and none is skipped.'],
      ['Seed a library with one folder only.', 'r02-one-folder', 'the feed still fills 60 items.'],
      ['Count reason tags in the first 20.', 'r02-reasons', 'no reason appears more than 5 times.'],
      ['Set surprise to 0.', 'r02-familiar', 'the caps still hold.'],
      ['Read with the type filter set to image.', 'r02-images', 'the caps hold and only images return.'],
      ['Open the viewer from the feed and page to the end.', 'r02-viewer', 'the viewer order matches the grid.'],
      ['Seed items with no perceptual hash.', 'r02-no-hash', 'they rank without errors.'],
      ['Reshuffle three times.', 'r02-reshuffle', 'each page obeys the caps.'],
    ],
    perf: [
      'Metric. Discover page latency on a synthetic 30k-item library.',
      'Probe. 30 page requests each at trunk and head, interleaved.',
      'Baseline. Record trunk p95 first.',
      'Rule. Fail if head p95 is more than 20 ms above trunk.',
    ],
    gated: false,
  },
  {
    id: 'R03', phase: 3, title: 'Let users steer Discover',
    depends: 'R02 in the phase 3 stack, and T03 for display names.',
    files: [
      'Edit `apps/server/src/db/index.ts` to add migrations for `tag_preferences(tag_id, mode)` and `media_feedback(media_id, kind, at)`.',
      'Edit `apps/server/src/routes/discover.ts` to apply them and add `GET /api/discover/profile`, `PUT /api/discover/tags/:name` and `POST /api/discover/feedback`.',
      'Create `apps/web/src/components/TastePanel.tsx`.',
      'Edit `apps/web/src/components/MediaCard.tsx` for the card menu.',
      'Edit `apps/web/src/routes/Discover.tsx`.',
      'Edit `apps/server/src/discover.test.ts`.',
    ],
    build: [
      'Boost doubles a tag weight. Mute removes every item carrying the tag from the feed. Both writes call `bumpTasteVersion()`.',
      'Not interested hides the item and lowers its tags by a small fixed amount. Less of X halves that tag weight without hiding anything.',
      'Show the taste panel with the top profile tags under their display names, and an Undo toast after each card action.',
    ],
    see: [
      'Muting `Rain` removes every rain item from the feed at once.',
      'Not interested hides the card, and Undo brings it back.',
    ],
    unit: [
      '`apps/server/src/discover.test.ts` gains "a muted tag removes its items", "boost raises an item above an unboosted peer" and "hidden items never return". Run `' + TEST + ' apps/server/src/discover.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Trunk has no feedback, so record that, then at head mute the top taste tag.', 'r03-regression', 'no item with that tag is in the first 200.'],
      ['Boost a mid-ranked tag.', 'r03-boost', 'its items move into the first 20.'],
      ['Choose Not interested on a card.', 'r03-hide', 'the card fades out and does not return after reload.'],
      ['Press Undo after hiding.', 'r03-undo', 'the card is back in the same place.'],
      ['Choose Less of X on a card.', 'r03-less', 'that tag shows less in the first page but its items still appear.'],
      ['Open the taste panel.', 'r03-panel', 'tags show display names and weight bars.'],
      ['Click a taste chip three times.', 'r03-cycle', 'it goes boost, mute, normal, and the feed follows each step.'],
      ['Mute every taste tag.', 'r03-all-muted', 'the feed falls back to random with an explanation.'],
      ...webTail('R03', 'lane 3'),
    ],
    perf: [
      'Metric. Time from a mute click to the refreshed first page painted.',
      'Probe. 20 mute and unmute cycles at head. Trunk lacks the feature, so measure first-page latency at both as a control.',
      'Baseline. Record trunk first-page p95 first.',
      'Rule. Fail if mute-to-paint p95 exceeds 600 ms, or head first-page p95 exceeds trunk by more than 15%.',
    ],
    gated: true,
  },
  {
    id: 'R04', phase: 3, title: 'Add Discover shelves and presets',
    depends: 'R03 in the phase 3 stack.',
    files: [
      'Create `apps/server/src/lib/discoverShelves.ts`.',
      'Edit `apps/server/src/routes/discover.ts` to add `GET /api/discover/shelves` and a `shelf` query parameter.',
      'Create `apps/web/src/components/Shelf.tsx`.',
      'Edit `apps/web/src/routes/Discover.tsx`.',
      'Edit `apps/server/src/discover.test.ts`.',
    ],
    build: [
      'Declare shelves in `discoverShelves.ts` as `{ id, title, where }`, filtered from the current snapshot. The shelves are because-you-like for the top two tags, new since last visit, rediscover, and off the beaten path from `discover_scores.related`.',
      'Store `discover_last_visit` when the page opens.',
      'Replace the slider with Familiar, Balanced and Adventurous at 0.1, 0.3 and 0.6, and rename I\'m feeling lucky to Surprise me. Old `surprise=` URLs map to the nearest preset.',
      'Show the shelves above the existing infinite grid. See all opens the grid with `?shelf=<id>`.',
    ],
    see: [
      'Discover opens with four shelves above the grid, and each shelf title explains its rows.',
    ],
    unit: [
      '`apps/server/src/discover.test.ts` gains one literal case per shelf, such as "rediscover returns items liked over 60 days ago and unopened for 30". Run `' + TEST + ' apps/server/src/discover.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Open Discover at trunk and head on the same seeded library.', 'r04-regression', 'trunk shows the slider and head shows the presets and four shelves.'],
      ['Click See all on a shelf.', 'r04-see-all', 'the grid shows only that shelf and paginates.'],
      ['Add 20 items and reopen Discover.', 'r04-new', 'New since your last visit shows them.'],
      ['Open with no likes.', 'r04-cold', 'the shelves that need taste are hidden and the grid shows.'],
      ['Switch presets.', 'r04-presets', 'the grid reorders and the URL records the preset.'],
      ['Open an old `?surprise=0.25` URL.', 'r04-old-url', 'Balanced is selected.'],
      ['Mute the top tag.', 'r04-mute', 'its because-you-like shelf is replaced by the next tag.'],
      ['Click Surprise me.', 'r04-surprise', 'the viewer opens on a random item.'],
      ...webTail('R04', 'lane 1'),
    ],
    perf: [
      'Metric. Discover time to first shelf painted on a synthetic 30k-item library.',
      'Probe. 20 page loads each at trunk and head, interleaved. Trunk has no shelves, so compare the head shelf paint against the trunk first grid paint.',
      'Baseline. Record the trunk first grid paint p95 first.',
      'Rule. Fail if the head first shelf p95 exceeds 800 ms, or the head grid paint is more than 15% slower than trunk.',
    ],
    gated: true,
  },
  {
    id: 'R05', phase: 3, title: 'Rank more like this by shared tags',
    depends: 'R04 in the phase 3 stack.',
    files: ['Edit `apps/server/src/routes/discover.ts` to add `GET /api/discover/like/:id`.', 'Edit `apps/server/src/discover.test.ts`.'],
    build: [
      'Score candidates by the sum of `log(N / usage)` over tags shared with the source item, exclude rating tags, and return 60 items.',
    ],
    see: [
      'More like this on an item tagged `rain` and `umbrella` returns items sharing both before items sharing one.',
    ],
    unit: [
      '`apps/server/src/discover.test.ts` gains "a rare shared tag outranks a common one" with literal ids. Run `' + TEST + ' apps/server/src/discover.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Trunk has no endpoint, so record the 404, then at head call it on a seeded item.', 'r05-regression', 'head returns 60 items with the two-tag matches first.'],
      ['Call it on an item with no tags.', 'r05-untagged', 'it returns an empty list with 200.'],
      ['Call it on a missing id.', 'r05-missing', 'it returns 404.'],
      ['Check that the source item is excluded.', 'r05-self', 'the source id is absent.'],
      ['Check that hidden items are excluded.', 'r05-hidden', 'no hidden id appears.'],
      ['Check that muted tags are respected.', 'r05-muted', 'no item carries a muted tag.'],
      ['Call it on a video.', 'r05-video', 'videos and images both return, ranked by shared tags.'],
      ['Call it with auth on and no session.', 'r05-auth', 'it returns 401.'],
      ['Call it on an item tagged only `1girl`.', 'r05-common', 'results are ranked and the call finishes.'],
      ['Call it 50 times in parallel.', 'r05-parallel', 'every call returns 200.'],
    ],
    perf: [
      'Metric. More-like-this latency on a synthetic 30k-item library.',
      'Probe. 100 calls on random items at head. Trunk lacks the endpoint, so measure `/api/media/:id/similar` at both as a control.',
      'Baseline. Record the trunk control p95 first.',
      'Rule. Fail if head p95 exceeds 150 ms, or the head control is more than 10% slower than trunk.',
    ],
    gated: false,
  },
  {
    id: 'M01', phase: 4, title: 'Read gallery-dl metadata into tags',
    depends: 'None. M01 is the root of phase 4 and branches from `master` after phase 3 lands.',
    files: [
      'Edit `apps/server/src/services/downloader.ts` near line 171 to pass `--write-metadata`.',
      'Edit `packages/shared/src/index.ts` to add `artist` and `copyright` to `TAG_CATEGORIES`.',
      'Edit `apps/server/src/services/scanner.ts` to read `<file>.json` sidecars.',
      'Edit `apps/server/src/db/index.ts` to add a migration for `media.source_url`.',
      'Edit `apps/web/src/components/TagSidebar.tsx` and `MediaViewer.tsx`.',
      'Edit `apps/server/src/downloader.test.ts` and `apps/server/src/scan.test.ts`.',
    ],
    build: [
      'Map known sidecar fields to artist and copyright tags with `source` `user`, and store the post URL in `source_url`.',
      'Show Artists and Series sections in the sidebar and a View source link in the viewer.',
    ],
    see: [
      'A downloaded post shows its artist under Artists and a View source link that opens the post.',
    ],
    unit: [
      '`apps/server/src/scan.test.ts` gains "a sidecar adds artist and copyright tags and the source URL" with a literal JSON fixture. Run `' + TEST + ' apps/server/src/scan.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Scan a folder of synthetic images with sidecar JSON at trunk and head.', 'm01-regression', 'trunk ignores the sidecars and head shows the artist tags.'],
      ['Open the viewer and click View source.', 'm01-source', 'the URL from the sidecar opens externally.'],
      ['Scan a sidecar with unknown fields.', 'm01-unknown', 'the scan finishes and only known fields map.'],
      ['Scan a malformed sidecar.', 'm01-malformed', 'the scan logs the file and continues.'],
      ['Filter Explore by an artist.', 'm01-filter', 'only that artist\'s items show.'],
      ['Re-tag an item with metadata tags.', 'm01-retag', 'the artist tags stay.'],
      ['Run a download batch with the new flag.', 'm01-download', 'sidecars appear next to the files.'],
      ['Check that sidecars are not indexed as media.', 'm01-no-index', 'the media count equals the image count.'],
      ...webTail('M01', 'lane 1'),
    ],
    perf: [
      'Metric. Scan time for 5,000 synthetic images with sidecars.',
      'Probe. Three scans each at trunk and head, interleaved.',
      'Baseline. Record trunk scan time first.',
      'Rule. Fail if head is more than 15% slower than trunk.',
    ],
    gated: true,
  },
  {
    id: 'M02', phase: 4, title: 'Merge and imply tags',
    depends: 'M01 in the phase 4 stack, and T03 for display names.',
    files: [
      'Edit `apps/server/src/db/index.ts` to add migrations for `tag_siblings(from_tag_id, to_tag_id)` and `tag_implications(tag_id, implies_tag_id)`.',
      'Create `apps/server/src/services/tagRelations.ts`.',
      'Edit `apps/server/src/routes/tags.ts`.',
      'Edit `apps/server/src/services/tagger.ts` to apply siblings and implications after `selectTags`.',
      'Create `apps/web/src/routes/settings/TagRelations.tsx` registered as a custom row.',
      'Create `apps/server/src/tagRelations.test.ts`.',
    ],
    build: [
      'A sibling rewrites every link from one tag to another in one transaction and points future writes at the target.',
      'An implication adds the implied tag with `source` `implied` whenever the source tag is added. Cycles are rejected.',
    ],
    see: [
      'Making `uraraka_ochako` imply `boku_no_hero_academia` tags every Uraraka item with the series.',
    ],
    unit: [
      '`apps/server/src/tagRelations.test.ts` gains "a sibling moves links", "an implication adds the series" and "a cycle is rejected". Run `' + TEST + ' apps/server/src/tagRelations.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Trunk has no relations, so record that, then at head add an implication.', 'm02-regression', 'every source-tag item gains the implied tag.'],
      ['Merge a user tag into an AI tag.', 'm02-sibling', 'the user tag is gone and its items carry the target.'],
      ['Add an implication cycle.', 'm02-cycle', 'the API answers 400 and nothing changes.'],
      ['Remove an implication.', 'm02-remove', 'only `implied` links are removed.'],
      ['Re-tag after a sibling.', 'm02-retag', 'new AI tags land on the target.'],
      ['Search for the old sibling name.', 'm02-search', 'results come from the target.'],
      ['Chain two implications.', 'm02-chain', 'both implied tags are added.'],
      ['Search settings for `implication`.', 'm02-settings', 'the relations row appears.'],
      ...webTail('M02', 'lane 1'),
    ],
    perf: [
      'Metric. Time to apply one implication to 5,000 items.',
      'Probe. Five runs at head. Trunk lacks the feature, so measure bulk tag add of 5,000 items at both as a control.',
      'Baseline. Record the trunk control first.',
      'Rule. Fail if one implication takes over 2 s, or the head control is more than 10% slower than trunk.',
    ],
    gated: true,
  },
  {
    id: 'ML01', phase: 5, title: 'Share one model session lifecycle',
    depends: 'None. ML01 is the root of phase 5 and branches from `master` after phase 4 lands.',
    files: ['Create `apps/server/src/lib/modelSession.ts`.', 'Edit `apps/server/src/services/tagger.ts` at lines 29 to 71.', 'Edit `apps/server/src/tagger.test.ts`.'],
    build: [
      'Move load sharing, the idle release timer, the in-flight count and `trimNativeHeap` into `createModelSession(path, options)`. The tagger calls it and behaves as before.',
    ],
    see: [
      'Tagging still frees the model 60 s after the last item, shown by RSS dropping in the server log.',
    ],
    unit: [
      '`apps/server/src/tagger.test.ts` keeps its cases and gains "two sessions from one module load and release independently". Run `' + TEST + ' apps/server/src/tagger.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Tag 200 synthetic images at trunk and head and read the tag sets.', 'ml01-regression', 'both produce identical tag sets.'],
      ['Wait 70 s after tagging.', 'ml01-release', 'RSS falls by at least 500 MB.'],
      ['Start two tag jobs at once.', 'ml01-concurrent', 'one session loads and RSS never doubles.'],
      ['Switch models during idle.', 'ml01-switch', 'the old session is released.'],
      ['Corrupt the model file and tag.', 'ml01-bad-model', 'the job errors and the next run with a good file works.'],
      ['Tag one item every 30 s for 5 minutes.', 'ml01-trickle', 'the session is not reloaded between items.'],
      ['Run on a host without glibc trim available.', 'ml01-no-trim', 'release still runs without error.'],
      ['Stop the server mid-tag.', 'ml01-shutdown', 'it exits within 5 s.'],
      ['Read `/api/tagger/status` during tagging.', 'ml01-status', 'it reports ready.'],
      ['Tag a video.', 'ml01-video', 'it tags from the thumbnail as before.'],
    ],
    perf: [
      'Metric. Tag job items per second and peak RSS on 2,000 synthetic images.',
      'Probe. Three runs each at trunk and head, interleaved.',
      'Baseline. Record trunk items per second and peak RSS first.',
      'Rule. Fail if head is more than 2% slower or uses more than 30 MB more peak RSS.',
    ],
    gated: false,
  },
  {
    id: 'V01', phase: 5, title: 'Tag videos from several frames',
    depends: 'ML01 in the phase 5 stack.',
    files: ['Edit `apps/server/src/services/tagger.ts` in `tagOneMedia`.', 'Edit `apps/server/src/services/thumbnailer.ts` to extract frames at 10, 30, 50, 70 and 90 percent.', 'Edit `apps/server/src/tagger.test.ts`.'],
    build: [
      'For videos, tag five frames and keep each tag at its highest confidence. Frames go to a temp folder and are removed after.',
    ],
    see: [
      'A synthetic video whose second half is a different scene gains tags from both halves.',
    ],
    unit: [
      '`apps/server/src/tagger.test.ts` gains "max confidence across frames wins" with literal frame scores. Run `' + TEST + ' apps/server/src/tagger.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Tag a two-scene synthetic video at trunk and head.', 'v01-regression', 'trunk has tags from one scene and head from both.'],
      ['Tag a 2 s video.', 'v01-short', 'it tags without error.'],
      ['Tag a video FFmpeg cannot seek.', 'v01-unseekable', 'it falls back to the thumbnail frame.'],
      ['Check the temp folder after tagging 20 videos.', 'v01-cleanup', 'no frame files remain.'],
      ['Tag an image.', 'v01-image', 'tags match trunk.'],
      ['Tag a GIF classified as video.', 'v01-gif', 'it tags from frames.'],
      ['Re-tag a video with a veto.', 'v01-veto', 'the vetoed tag stays gone.'],
      ['Tag with transcoding on.', 'v01-transcode', 'frames come from the original.'],
      ['Stop the server mid-video.', 'v01-stop', 'no frame files remain after restart.'],
      ['Tag 50 videos in a job.', 'v01-job', 'the job ends `done` with 50 tagged.'],
    ],
    perf: [
      'Metric. Video tag time per item on 50 synthetic 30 s videos.',
      'Probe. Two runs each at trunk and head, interleaved.',
      'Baseline. Record trunk seconds per video first.',
      'Rule. Fail if head exceeds 6 times trunk per video, or 4 s per video.',
    ],
    gated: false,
  },
  {
    id: 'ML02', phase: 5, title: 'Detect characters and embed them',
    depends: 'V01 in the phase 5 stack, ML01 for sessions and T02 for the character threshold.',
    files: [
      'Create `apps/server/src/services/characters.ts`.',
      'Create `apps/server/src/lib/vectors.ts` for float16 packing and brute-force cosine search.',
      'Edit `apps/server/src/db/index.ts` to add migrations for `character_detections` and `characters`.',
      'Edit `packages/shared/src/index.ts` to add a `characters` job type and the `character` media tag source.',
      'Edit `apps/server/src/lib/config.ts` to register the detector and CCIP models.',
      'Create `apps/server/src/characters.test.ts`.',
    ],
    build: [
      'Detect characters with an anime person detector, crop each box, and embed it with CCIP into a 768-value vector stored as float16.',
      'Assign each detection to the nearest named character under the model\'s published threshold, else to an unnamed cluster.',
      'Seed named characters from images tagged `solo` with exactly one character tag. Assigned detections write `media_tags` rows with `source` `character`.',
    ],
    see: [
      'After the job, `/api/characters` lists seeded characters with counts and some unnamed clusters.',
    ],
    unit: [
      '`apps/server/src/characters.test.ts` gains "float16 round trip within 1e-3", "nearest neighbour picks the closer centroid" and "retag keeps `character` links". Run `' + TEST + ' apps/server/src/characters.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Trunk has no character job, so record that, then at head run it on 300 public-domain test illustrations.', 'ml02-regression', 'the job ends `done` and every image has a detection row or a logged no-detection.'],
      ['Seed from `solo` images.', 'ml02-seed', 'each single-character tag with 3 or more solo images becomes a named character.'],
      ['Run on a group image of two seeded characters.', 'ml02-group', 'both are assigned.'],
      ['Re-run the job.', 'ml02-idempotent', 'detection count is unchanged.'],
      ['Delete a media item.', 'ml02-delete', 'its detections are removed.'],
      ['Run with the models absent.', 'ml02-absent', 'the job ends `error` naming the download step.'],
      ['Run on a landscape with no characters.', 'ml02-empty', 'no detection is written.'],
      ['Wait 70 s after the job.', 'ml02-release', 'both model sessions are released.'],
      ['Run during a tag job.', 'ml02-concurrent', 'both finish and peak RSS stays under the configured memory limit.'],
      ['Filter Explore by a character tag.', 'ml02-filter', 'items assigned only by CCIP appear.'],
    ],
    perf: [
      'Metric. Character job items per second and peak RSS on 1,000 synthetic illustrations.',
      'Probe. Two runs at head. Trunk lacks the job, so run the tag job at both as a control.',
      'Baseline. Record the trunk tag job items per second first.',
      'Rule. Fail if the character job is under 2 items per second on 2 cores, peak RSS exceeds 1.5 GB, or the control is more than 5% slower than trunk.',
    ],
    gated: false,
  },
  {
    id: 'ML03', phase: 5, title: 'Add the Characters tab',
    depends: 'ML02 in the phase 5 stack, and T03 for names.',
    files: [
      'Create `apps/web/src/routes/Characters.tsx` and `apps/web/src/routes/Character.tsx`.',
      'Edit `apps/server/src/routes/characters.ts` for list, name, merge, reject and cover.',
      'Edit `apps/web/src/components/MediaViewer.tsx` for box overlays.',
      'Edit `apps/web/src/components/Navbar.tsx` with a monochrome icon.',
      'Edit `apps/server/src/characters.test.ts`.',
    ],
    build: [
      'List characters in three groups, named, suggested and unnamed. Naming an unnamed cluster creates a character-category tag.',
      'A suggestion reads `Is this <display name>?` when most of a cluster carries one WD character tag, with a one-click confirm.',
      'The character page supports merge, not this character per face, set cover and hide. The viewer draws boxes with names and lets you assign a box.',
    ],
    see: [
      'Naming a cluster `Mira` creates the tag, and Explore filtered by `Mira` shows those items.',
    ],
    unit: [
      '`apps/server/src/characters.test.ts` gains "naming creates a character tag", "merge moves detections" and "reject keeps the detection off that character after a re-run". Run `' + TEST + ' apps/server/src/characters.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Trunk has no Characters tab, so record that, then at head open it after ML02 ran.', 'ml03-regression', 'named, suggested and unnamed groups each show cards with cover crops.'],
      ['Name an unnamed cluster.', 'ml03-name', 'it moves to named and the tag exists.'],
      ['Confirm a suggestion.', 'ml03-confirm', 'it becomes named under the WD tag display name.'],
      ['Merge two characters.', 'ml03-merge', 'one remains with the combined count.'],
      ['Mark a face as not this character.', 'ml03-reject', 'it leaves the character and stays out after a re-run.'],
      ['Open the viewer on a group image.', 'ml03-overlay', 'boxes show names and clicking one opens the character.'],
      ['Set a cover.', 'ml03-cover', 'the card shows the chosen crop.'],
      ['Hide a character.', 'ml03-hide', 'it leaves the list and its tag stays.'],
      ...webTail('ML03', 'lane 1'),
    ],
    perf: [
      'Metric. Characters tab first paint with 500 characters.',
      'Probe. 20 loads at head. Trunk lacks the tab, so measure the dashboard first paint at both as a control.',
      'Baseline. Record the trunk dashboard p95 first.',
      'Rule. Fail if the tab p95 exceeds 700 ms, or the head dashboard is more than 10% slower than trunk.',
    ],
    gated: true,
  },
  {
    id: 'ML04', phase: 5, title: 'Search by description with image embeddings',
    depends: 'ML03 in the phase 5 stack, and ML02 for `vectors.ts`.',
    files: [
      'Create `apps/server/src/services/semantic.ts`.',
      'Edit `apps/server/src/db/index.ts` to add a migration for `media_embeddings`.',
      'Edit `apps/server/src/routes/media.ts` to accept `q` in semantic mode.',
      'Edit `apps/web/src/components/FilterToolbar.tsx` for a semantic toggle.',
      'Create `apps/server/src/semantic.test.ts`.',
    ],
    build: [
      'Embed images with a SigLIP-class ONNX image encoder in an `embed` job, embed queries with its text encoder, and rank by cosine using `vectors.ts`.',
      'Add a Describe toggle in the Explore search box.',
    ],
    see: [
      'Searching `red umbrella in the rain` ranks synthetic images with those shapes and colors first.',
    ],
    unit: [
      '`apps/server/src/semantic.test.ts` gains "query ranking follows cosine order" with literal fixture vectors. Run `' + TEST + ' apps/server/src/semantic.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Search `red umbrella` at trunk and head in Describe mode.', 'ml04-regression', 'trunk falls back to tag search and head ranks the red-umbrella fixtures first.'],
      ['Search with Describe off.', 'ml04-off', 'results match trunk.'],
      ['Search before the embed job ran.', 'ml04-not-ready', 'a message offers to run it.'],
      ['Combine Describe with a tag filter.', 'ml04-combined', 'only filtered items rank.'],
      ['Search an empty string.', 'ml04-empty', 'the normal grid shows.'],
      ['Search in Japanese text.', 'ml04-cjk', 'the call returns ranked results without error.'],
      ['Run the embed job twice.', 'ml04-idempotent', 'the embedding count is unchanged.'],
      ['Wait 70 s after a search.', 'ml04-release', 'the text model is released.'],
      ...webTail('ML04', 'lane 1'),
    ],
    perf: [
      'Metric. Describe search latency on 30k synthetic embeddings.',
      'Probe. 50 queries at head. Trunk lacks the mode, so measure tag search at both as a control.',
      'Baseline. Record the trunk tag search p95 first.',
      'Rule. Fail if warm Describe p95 exceeds 400 ms, or head tag search is more than 10% slower than trunk.',
    ],
    gated: true,
  },
  {
    id: 'V02', phase: 5, title: 'Scrub videos on hover',
    depends: 'ML04 in the phase 5 stack.',
    files: [
      'Edit `apps/server/src/services/thumbnailer.ts` to write a 10-frame sprite per video.',
      'Edit `apps/server/src/routes/media.ts` to serve `/api/media/:id/sprite`.',
      'Edit `apps/web/src/components/MediaCard.tsx`.',
      'Edit `apps/server/src/transcode.test.ts`.',
    ],
    build: [
      'Generate a 10-frame horizontal sprite with FFmpeg after the thumbnail, and on card hover map the pointer x to a frame.',
    ],
    see: [
      'Moving the pointer across a video card steps through ten frames.',
    ],
    unit: [
      '`apps/server/src/transcode.test.ts` gains "a sprite is ten frames wide" checking the sprite width. Run `' + TEST + ' apps/server/src/transcode.test.ts`.',
    ],
    lanes: [
      ['Regression lane against trunk. Hover a video card at trunk and head.', 'v02-regression', 'trunk shows a still and head steps through frames.'],
      ['Hover before the sprite exists.', 'v02-pending', 'the still shows with no broken image.'],
      ['Hover an image card.', 'v02-image', 'nothing changes.'],
      ['Regenerate thumbnails.', 'v02-regen', 'sprites are rebuilt.'],
      ['Delete a video.', 'v02-delete', 'its sprite file is removed.'],
      ['Turn the thumbnail cache off.', 'v02-cache-off', 'hover falls back to the still.'],
      ['Touch a card on a phone.', 'v02-touch', 'a tap opens the viewer as before.'],
      ['Scroll a grid of 200 videos.', 'v02-scroll', 'no sprite loads until hover.'],
      ...webTail('V02', 'lane 1'),
    ],
    perf: [
      'Metric. Thumbnail job time per video, and grid scroll frame time.',
      'Probe. Thumbnail 100 synthetic videos at trunk and head, interleaved, then record a 10 s scroll trace at both.',
      'Baseline. Record trunk seconds per video and p95 frame time first.',
      'Rule. Fail if head adds more than 0.5 s per video or p95 frame time rises above 16.7 ms.',
    ],
    gated: true,
  },
];

const ids = PRS.map((p) => p.id);
const byPhase = [0, 1, 2, 3, 4, 5].map((ph) => PRS.filter((p) => p.phase === ph).map((p) => p.id));
const gated = PRS.filter((p) => p.gated).map((p) => p.id);

const out = [];
const w = (s = '') => out.push(s);

w('# Sakuya roadmap plan');
w();
w(`This plan turns every idea from the 2026-11-23 planning conversation into ${PRS.length} PRs in six phases. It is for Sakuya users who want a safer library, an app that updates itself, clearer tags and settings, a Discover feed they can steer, and characters found by a model.`);
w('The rule it enforces is that a PR is done only when its unit, live and perf boxes are checked with evidence, and nothing lands without the operator.');
w(`Phase 0 is ${byPhase[0].join(', ')}. Phase 1 is ${byPhase[1].join(', ')}. Phase 2 is ${byPhase[2].join(', ')}.`);
w(`Phase 3 is ${byPhase[3].join(', ')}. Phase 4 is ${byPhase[4].join(', ')}. Phase 5 is ${byPhase[5].join(', ')}.`);
w('Each phase is one linear stack on `master`, and the operator lands it before the next phase starts. The defaults the operator must confirm are in Appendix B.');
w();
w('## How to read this');
w();
w('One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.');
w();
w('The program runs `~/.claude/skills/poteto-mode/playbooks/autopilot-stack.md`. The operator reviews and lands every PR. No owner merges. Every PR stops at merge-ready inside its phase stack.');
w();
w(RULE);
w();
w('## Program checklist');
w();
w('### Arm the program');
w();
w(box('State the protocol and this plan to the operator, then stop. Start execution only on the operator\'s explicit go.'));
w(box(`On the operator's go, arm a \`/goal\` with this exact text. "Run docs/plans/sakuya-roadmap-plan.md under autopilot-stack. Build ${ids.join(', ')} in that order, one linear stack per phase on master. ${RULE} The operator lands each phase. Done when every phase stack is merge-ready with a clean verdict per PR and the operator has landed it."`));
w(box('Read these at program start and re-read them at every tick. The skills live on disk under `~/.claude/skills`, not in this repo, so read them with `cat` where the template says `git show origin/main:<path>`.'));
w('  ' + box('`cat ~/.claude/skills/poteto-mode/playbooks/autopilot-stack.md`'));
w('  ' + box('`cat ~/.claude/skills/swarm/SKILL.md`'));
w('  ' + box('`cat ~/.claude/skills/poteto-mode/playbooks/opening-a-pr.md`'));
w('  ' + box('`cat ~/.claude/skills/principle-prove-it-works/SKILL.md` and `cat ~/.claude/skills/show-me-your-work/SKILL.md`'));
w('  ' + box('`git show origin/master:docs/plans/sakuya-roadmap-plan.md` once the plan is committed, else the local file.'));
w(box('Arm the 30-minute audit tick as a real terminal `/loop` in this local session. Never leave the cadence to memory.'));
w(box('Use this tick prompt, verbatim. "Re-read the execution playbook from disk and the armed /goal. Audit the operation against both and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a status message to the operator in chat, whether or not anything changed, with the queue table of PR, owner, state, and head SHA, the verdicts since the last tick, what merged, open operator gates, and blockers."'));
w(box('On the operator\'s hold or stand-down, send every owner a zero-writes order at once.'));
w();
w('### Spawn owners');
w();
w(box('Spawn one owner per PR with the full lifecycle autopilot-stack names. Owners run locally in their own git worktrees.'));
w(box('Follow this dependency graph. Within a phase each PR bases on the one before it.'));
for (const p of PRS) w('  ' + box(`${p.id}. ${p.depends}`));
w(box('Hold the file boundaries. Server PRs touch `apps/server/**` and `packages/shared/**`. Desktop PRs touch `desktop/**` and `.github/workflows/desktop.yml`. Web PRs touch `apps/web/**` plus the routes they name.'));
w(box(`Hold the review gate. ${gated.join(', ')} change an interaction. They wait for the operator's review in chat with screenshots and a video before they join the stack.`));
w();
w('### PR mechanics, for every PR');
w();
w(box('Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.'));
w(box('Open the PR ready, never draft, with `gh pr create --base <parent-branch>`. The phase root targets `master` and every child targets its parent branch.'));
w(box('Run `bun run lint` and `bun run typecheck` once before the PR-facing push. Push with hooks on. Commit messages and PR bodies carry no attribution lines, per the operator\'s global instructions.'));
w(box('Run `/deslop` before each commit and `/no-comments` before review.'));
w(box('Triage every Bugbot and security-reviewer comment per `~/.claude/skills/poteto-mode/references/bugbot-triage.md`.'));
w(box('Rebase onto current `master` before babysit and again before the merge-ready report.'));
w();
w('### Verdict and merge, for every PR');
w();
w(box('At the merge-ready head SHA, run the swarm per `~/.claude/skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR\'s **Verify, live** block. The perf lane from its **Verify, perf** block. One audit lane that reads the diff and the receipts and distrusts the PR body.'));
w(box('Clean only when every lane is `PASS`. Findings go back to the owner. A new head gets a fresh swarm and a fresh verdict.'));
w(box('On a clean verdict the root appends the PR to its phase stack. After any rebase the root compares `git patch-id` at the verdict SHA and the new head, and a changed patch-id sends the PR back for a fresh verdict, per `playbooks/shipping.md`. The operator lands each phase bottom-up.'));
w();
w('### Boot recipe, for every live lane');
w();
w('Each live lane runs locally at the PR head on its own ports. There is no cloud VM and no `control-ui` skill in this environment, so lanes drive the surface with Playwright.');
w();
w(box('`git fetch origin <head-branch> && git worktree add /tmp/sakuya-lane-<pr-id>-<n> <head SHA>`, then `export PATH=$HOME/.bun/bin:$PATH && bun install`.'));
w(box('Never point a lane at `apps/server/data/tbge.db` or the backup folder under `/mnt/data/apps/`. Every lane uses a fresh data dir with synthetic fixtures made by a sharp script placed inside `apps/server`.'));
w(box('For web lanes, write a config with server port `38790 + n`, web port `5190 + n`, a data dir under `/tmp/sakuya-lane-<pr-id>-<n>/data` and auth enabled with secret `test`. Start `bun src/launch.ts` in `apps/server` and `bun run dev -- --host 0.0.0.0` in `apps/web` with `SAKUYA_CONFIG` set. Wait for `/api/health`, then `PATCH /api/settings` with `{"ui_style_chosen":"1","discover_enabled":"1"}`.'));
w(box('For desktop lanes, stage with `bash desktop/stage.sh`, launch through Playwright `_electron`, and serve updates from a local folder through the `generic` provider instead of GitHub.'));
w(box('For server-only lanes, drive the API with `curl` and render the response to a PNG with the same headless Chrome the web lanes use.'));
w(box('Run tests as `' + TEST + '` from the repo root, never from `apps/server`.'));
w(box('Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.'));
w();

for (const p of PRS) {
  w(`## ${p.title} (${p.id})`);
  w();
  w(`**Depends on.** ${p.depends}`);
  w();
  w('**Files.**');
  w();
  p.files.forEach((f) => w(box(f)));
  w();
  w('**Build.**');
  w();
  p.build.forEach((b) => w(box(b)));
  w();
  w('**You see.**');
  w();
  p.see.forEach((s) => w(box(s)));
  w();
  w(`**Verify, unit.** ${RULE}`);
  w();
  p.unit.forEach((u) => w(box(u)));
  w();
  w(`**Verify, live.** ${RULE} ${LANES}`);
  w();
  if (p.lanes.length !== 10) throw new Error(`${p.id} has ${p.lanes.length} lanes`);
  p.lanes.forEach(([s, slug, pass], i) => w(lane(i + 1, s, slug, pass)));
  w();
  w(`**Verify, perf.** ${RULE}`);
  w();
  p.perf.forEach((x) => w(box(x)));
  w();
  if (p.gated) {
    w('**Review gate.** The operator reviews before merge.');
    w();
    w(box(`Copy the lane 1 and lane 2 screenshots into \`docs/plans/media/${p.id.toLowerCase()}-review-<slug>.png\`.`));
    w(box(`Record a 30 to 60 second video of the change on a lane worktree. Save it as \`docs/plans/media/${p.id.toLowerCase()}-review.mp4\`.`));
    w(box('Post the screenshots and the video to the operator in chat. Stop at merge-ready. Wait for the operator\'s click.'));
  } else {
    w(`**Review gate.** None. ${p.id} is not review-gated.`);
  }
  w();
  w('**Merge.**');
  w();
  w(box('Root\'s clean verdict at the exact head SHA.'));
  w(box('Bugbot triage done.'));
  w(box('Rebased onto current `master` after the verdict, patch-id unchanged.'));
  w(box(`The root appends ${p.id} to the phase ${p.phase} stack and the operator lands that stack bottom-up.`));
  w();
}

w('## Close the program');
w();
w(box('Every box above is checked with its evidence.'));
w(box('Reply to the operator with the autopilot-stack report, links to each phase stack root and tip, a one-line verdict per PR, and anything parked with the reason.'));
w();
w('## Appendix A. Prototype evidence');
w();
w(`The settings mockup is \`${SCRATCH}/settings-mockup.html\`. Its search logic was exercised with node, where \`thumb\` returned five rows, \`gif\` two, \`volume\` one, \`zzz\` none and \`video hevc\` two, and a breadcrumb jump flashed the target row. It settles the S01 and S02 layout and search behavior. No branch or SHA exists because it is a throwaway file.`);
w();
w(`The Discover mockup is \`${SCRATCH}/discover-mockup.html\`. Node runs showed four shelves, muting the top tag swapped the first shelf, hiding a card dropped the tile count from 24 to 23, and Undo restored it. It settles the R03 and R04 layout.`);
w();
w('Both mockups were shown inline in chat. The T3 preview browser could not start on this host, so neither was screenshotted in a browser here.');
w();
w('These stay unproven until their PR runs. CCIP accuracy on this library, which ML02 lane 2 and lane 3 measure. electron-updater on an AppImage end to end, which D02 lane 2 proves. NSIS differential updates through blockmaps on Windows, which D02 lane 3 proves.');
w();
w('## Appendix B. Alternatives rejected');
w();
w('These defaults were chosen without the operator. Each needs a yes before its PR starts.');
w();
w('- Mute in Discover hides items fully. Down-ranking only was rejected because "mute" reads as gone. Less of X covers soft down-ranking.');
w('- Discover keeps the infinite grid below the shelves. A shelves-only page was rejected because the grid is the long-scroll view people already use.');
w('- Uploads and Duplicates leave Settings. A Tools group in the settings sidebar was the alternative, and it keeps non-settings inside Settings.');
w('- Danger actions stay inline in red. A Danger zone group per section was the alternative and adds a group to most sections for one or two rows.');
w('- A named character cluster becomes a character-category tag. An Immich-style person entity was rejected because tags already drive search, filters and Discover.');
w('- Desktop updates default to automatic download and install on quit, with a Restart to update prompt. Notify-only was the alternative and stays one setting away.');
w('- No Windows code signing. The SmartScreen warning stays on first install. Azure Trusted Signing is the cheapest way to remove it later.');
w('- macOS is out of scope. Squirrel.Mac only applies updates to a signed app, which needs an Apple developer account.');
w('- InsightFace from Immich was rejected for ML02. It is built for photographs of real people, and CCIP is trained to tell anime characters apart.');
w('- sqlite-vec was rejected for now. Brute-force cosine over float16 vectors is about 77 MB at 50k detections and needs no native extension.');
w();
w('## Appendix C. Risks');
w();
w('- The live database and its backup folder hold real data that must never be used for tests or benchmarks. Every PR uses synthetic fixtures. The boot recipe enforces this and the audit lane checks lane logs for the live path.');
w('- There is no `control-ui` skill and no cloud VM here. Lanes run locally in worktrees on unique ports, driven by Playwright. Port clashes are the watch item, so each lane offsets its ports by its number and every test run holds `/tmp/sakuya-test.lock`.');
w('- The T3 preview browser lacks system libraries on this host. Screenshots come from a headless Chrome shell with its libraries in a local folder, per the dev-environment notes. `/tmp` may be wiped on reboot, so the owner of the first web PR rebuilds that setup and records where it lives.');
w('- The checker wants lanes on `grok-4.6-fast-xhigh`. This environment serves Claude models, so lanes run on whatever `/setup-pstack` configures, and the parent model if nothing is configured.');
w('- This host is Linux only. D02 lane 3 and every other Windows lane run on a Windows machine the operator provides, or on a `windows-latest` GitHub Actions runner through `workflow_dispatch`. A lane with neither stays unchecked and blocks merge.');
w('- D02 and D03 touch the update path. A bad release could strand desktop users on a broken version. D02 lane 6 and lane 7 cover a bad hash and an offline feed, and the P01 backup runs before every install.');
w('- ML02 adds two models and hundreds of MB while it runs. ML01 releases sessions when idle, and ML02 lane 9 checks peak memory against the configured limit.');
w('- R01 changes ranking for everyone. The literal-order tests in `apps/server/src/discover.test.ts` make the change reviewable, and lane 5 guards pagination.');
w('- P02 changes delete from permanent to recoverable. Disk usage grows for 30 days. The Storage section shows the trash size and Empty trash.');
w('- The operator approves UI screenshots before any commit or push. Every review-gated PR stops for that.');
w();
w('## Appendix D. Links and reading list');
w();
w('- [deepghs/ccip_onnx on Hugging Face](https://huggingface.co/deepghs/ccip_onnx/tree/main/ccip-v2-caformer_s36-10) for ML02 model files and thresholds.');
w('- [imgutils CCIP docs](https://deepghs.github.io/imgutils/main/api_doc/metrics/ccip.html) for the 768-value features and the per-model threshold warning.');
w('- [Immich facial recognition docs](https://docs.immich.app/features/facial-recognition) for the incremental DBSCAN-style clustering ML02 borrows.');
w('- `docs/SETUP.md` and `docs/API.md` in this repo before any server PR.');
w('- `~/.claude/skills/how/SKILL.md` before ML01, ML02 and D02. `~/.claude/skills/interrogate/SKILL.md` before R01 and ML02, whose designs are contested.');
w('- Each owner keeps a `decisions.tsv` trail per `~/.claude/skills/show-me-your-work/SKILL.md`, uncommitted, returned with its report.');

fs.mkdirSync('/mnt/data/apps/sakuya/docs/plans', { recursive: true });
fs.writeFileSync(OUT, out.join('\n') + '\n');
console.log('wrote', OUT, out.length, 'lines');
