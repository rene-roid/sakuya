# Sakuya roadmap plan

This plan turns every idea from the 2026-11-23 planning conversation into 24 PRs in six phases. It is for Sakuya users who want a safer library, an app that updates itself, clearer tags and settings, a Discover feed they can steer, and characters found by a model.
The rule it enforces is that a PR is done only when its unit, live and perf boxes are checked with evidence, and nothing lands without the operator.
Phase 0 is P01. Phase 1 is D01, D02. Phase 2 is T01, T02, T03, S01, S02, S03, D03, P02.
Phase 3 is R01, R02, R03, R04, R05. Phase 4 is M01, M02. Phase 5 is ML01, V01, ML02, ML03, ML04, V02.
Each phase is one linear stack on `master`, and the operator lands it before the next phase starts. The defaults the operator must confirm are in Appendix B.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `~/.claude/skills/poteto-mode/playbooks/autopilot-stack.md`. The operator reviews and lands every PR. No owner merges. Every PR stops at merge-ready inside its phase stack.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] On the operator's go, arm a `/goal` with this exact text. "Run docs/plans/sakuya-roadmap-plan.md under autopilot-stack. Build P01, D01, D02, T01, T02, T03, S01, S02, S03, D03, P02, R01, R02, R03, R04, R05, M01, M02, ML01, V01, ML02, ML03, ML04, V02 in that order, one linear stack per phase on master. Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. The operator lands each phase. Done when every phase stack is merge-ready with a clean verdict per PR and the operator has landed it."
- [ ] Read these at program start and re-read them at every tick. The skills live on disk under `~/.claude/skills`, not in this repo, so read them with `cat` where the template says `git show origin/main:<path>`.
  - [ ] `cat ~/.claude/skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `cat ~/.claude/skills/swarm/SKILL.md`
  - [ ] `cat ~/.claude/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `cat ~/.claude/skills/principle-prove-it-works/SKILL.md` and `cat ~/.claude/skills/show-me-your-work/SKILL.md`
  - [ ] `git show origin/master:docs/plans/sakuya-roadmap-plan.md` once the plan is committed, else the local file.
- [ ] Arm the 30-minute audit tick as a real terminal `/loop` in this local session. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from disk and the armed /goal. Audit the operation against both and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a status message to the operator in chat, whether or not anything changed, with the queue table of PR, owner, state, and head SHA, the verdicts since the last tick, what merged, open operator gates, and blockers."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle autopilot-stack names. Owners run locally in their own git worktrees.
- [ ] Follow this dependency graph. Within a phase each PR bases on the one before it.
  - [ ] P01. None. P01 is the root of phase 0 and branches from `master`.
  - [ ] D01. None. D01 is the root of phase 1 and branches from `master`.
  - [ ] D02. D01 for the metadata and P01 for the pre-update backup.
  - [ ] T01. None. T01 is the root of phase 2 and branches from `master` after phase 1 lands.
  - [ ] T02. T01 in the phase 2 stack.
  - [ ] T03. T02 in the phase 2 stack.
  - [ ] S01. T03 in the phase 2 stack.
  - [ ] S02. S01 in the phase 2 stack.
  - [ ] S03. S02 in the phase 2 stack.
  - [ ] D03. D02 for the updater and S01 for the About section.
  - [ ] P02. D03 in the phase 2 stack, and S01 for the Storage section.
  - [ ] R01. None. R01 is the root of phase 3 and branches from `master` after phase 2 lands.
  - [ ] R02. R01 in the phase 3 stack.
  - [ ] R03. R02 in the phase 3 stack, and T03 for display names.
  - [ ] R04. R03 in the phase 3 stack.
  - [ ] R05. R04 in the phase 3 stack.
  - [ ] M01. None. M01 is the root of phase 4 and branches from `master` after phase 3 lands.
  - [ ] M02. M01 in the phase 4 stack, and T03 for display names.
  - [ ] ML01. None. ML01 is the root of phase 5 and branches from `master` after phase 4 lands.
  - [ ] V01. ML01 in the phase 5 stack.
  - [ ] ML02. V01 in the phase 5 stack, ML01 for sessions and T02 for the character threshold.
  - [ ] ML03. ML02 in the phase 5 stack, and T03 for names.
  - [ ] ML04. ML03 in the phase 5 stack, and ML02 for `vectors.ts`.
  - [ ] V02. ML04 in the phase 5 stack.
- [ ] Hold the file boundaries. Server PRs touch `apps/server/**` and `packages/shared/**`. Desktop PRs touch `desktop/**` and `.github/workflows/desktop.yml`. Web PRs touch `apps/web/**` plus the routes they name.
- [ ] Hold the review gate. D02, T01, T02, T03, S01, S02, S03, D03, P02, R03, R04, M01, M02, ML03, ML04, V02 change an interaction. They wait for the operator's review in chat with screenshots and a video before they join the stack.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, with `gh pr create --base <parent-branch>`. The phase root targets `master` and every child targets its parent branch.
- [ ] Run `bun run lint` and `bun run typecheck` once before the PR-facing push. Push with hooks on. Commit messages and PR bodies carry no attribution lines, per the operator's global instructions.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every Bugbot and security-reviewer comment per `~/.claude/skills/poteto-mode/references/bugbot-triage.md`.
- [ ] Rebase onto current `master` before babysit and again before the merge-ready report.

### Verdict and merge, for every PR

- [ ] At the merge-ready head SHA, run the swarm per `~/.claude/skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. One audit lane that reads the diff and the receipts and distrusts the PR body.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner. A new head gets a fresh swarm and a fresh verdict.
- [ ] On a clean verdict the root appends the PR to its phase stack. After any rebase the root compares `git patch-id` at the verdict SHA and the new head, and a changed patch-id sends the PR back for a fresh verdict, per `playbooks/shipping.md`. The operator lands each phase bottom-up.

### Boot recipe, for every live lane

Each live lane runs locally at the PR head on its own ports. There is no cloud VM and no `control-ui` skill in this environment, so lanes drive the surface with Playwright.

- [ ] `git fetch origin <head-branch> && git worktree add /tmp/sakuya-lane-<pr-id>-<n> <head SHA>`, then `export PATH=$HOME/.bun/bin:$PATH && bun install`.
- [ ] Never point a lane at `apps/server/data/tbge.db` or the backup folder under `/mnt/data/apps/`. Every lane uses a fresh data dir with synthetic fixtures made by a sharp script placed inside `apps/server`.
- [ ] For web lanes, write a config with server port `38790 + n`, web port `5190 + n`, a data dir under `/tmp/sakuya-lane-<pr-id>-<n>/data` and auth enabled with secret `test`. Start `bun src/launch.ts` in `apps/server` and `bun run dev -- --host 0.0.0.0` in `apps/web` with `SAKUYA_CONFIG` set. Wait for `/api/health`, then `PATCH /api/settings` with `{"ui_style_chosen":"1","discover_enabled":"1"}`.
- [ ] For desktop lanes, stage with `bash desktop/stage.sh`, launch through Playwright `_electron`, and serve updates from a local folder through the `generic` provider instead of GitHub.
- [ ] For server-only lanes, drive the API with `curl` and render the response to a PNG with the same headless Chrome the web lanes use.
- [ ] Run tests as `flock /tmp/sakuya-test.lock bun test --isolate` from the repo root, never from `apps/server`.
- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.

## Schedule database backups (P01)

**Depends on.** None. P01 is the root of phase 0 and branches from `master`.

**Files.**

- [ ] Create `apps/server/src/services/backup.ts`.
- [ ] Edit `packages/shared/src/index.ts` to add `backup` to `JOB_TYPES` and `SCHEDULE_JOB_TYPES`.
- [ ] Edit `apps/server/src/services/jobScheduler.ts` to resolve the `backup` schedule.
- [ ] Edit `apps/server/src/lib/settings.ts` to add `backup_keep` with a default of 7.
- [ ] Create `apps/server/src/backup.test.ts`.
- [ ] Create `apps/server/scripts/bench-backup.ts` for the perf probe.

**Build.**

- [ ] Add `runBackup()` in `backup.ts`. It runs `VACUUM INTO` to `<dataDir>/backups/sakuya-<timestamp>.db`, then deletes all but the newest `backup_keep` files.
- [ ] Add `enqueueBackupJob()` so a backup is a tracked job like every other.
- [ ] Default the `backup` schedule to daily. The schedule is configured where scan and cleanup schedules are today.

**You see.**

- [ ] A `backup` job in the jobs list ends with the log line `Completed. Backup written to <path>.`
- [ ] After eight runs with `backup_keep` at 7, `<dataDir>/backups` holds seven files.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/server/src/backup.test.ts` gains "a backup opens as a database with the same media count" and "pruning keeps the newest N". Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/backup.test.ts`.
- [ ] `apps/server/src/jobScheduler.test.ts` gains "the backup schedule resolves to daily by default". Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/jobScheduler.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no backup job, so record that, then at head seed 500 synthetic items and run a backup from the API. Save `p01-regression.png`. Pass when trunk has no `backup` job type and head writes one file that `sqlite3 <file> "select count(*) from media"` reads as 500.
- [ ] Lane 2. Run eight backups in a row with `backup_keep` at 7. Save `p01-prune.png`. Pass when exactly seven files remain and the oldest is gone.
- [ ] Lane 3. Start a backup while a scan of 2,000 synthetic files runs. Save `p01-concurrent.png`. Pass when both jobs end `done` and the backup opens cleanly.
- [ ] Lane 4. Make `<dataDir>/backups` read-only and run a backup. Save `p01-readonly.png`. Pass when the job ends `error` with the path in its log and the server keeps serving `/api/health`.
- [ ] Lane 5. Set the schedule to off and wait past one interval. Save `p01-off.png`. Pass when no new backup file appears.
- [ ] Lane 6. Restart the server between two scheduled backups. Save `p01-restart.png`. Pass when the next backup still runs once at its slot, not twice.
- [ ] Lane 7. Run a backup with auth enabled and a valid session. Save `p01-auth.png`. Pass when the job runs and an unauthenticated call to start it gets 401.
- [ ] Lane 8. Open the jobs history in the scratch UI after a backup. Save `p01-history.png`. Pass when the backup row shows its label, status and log.
- [ ] Lane 9. Restore a backup by copying it over a scratch database and booting. Save `p01-restore.png`. Pass when the server boots and lists the same 500 items.
- [ ] Lane 10. Run a backup with 0 bytes free simulated by a tiny tmpfs data dir. Save `p01-disk-full.png`. Pass when the job ends `error`, no partial file is left, and the live database is untouched.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall time of one backup on a synthetic 30k-item database, and p95 `/api/media` latency while it runs.
- [ ] Probe. `bun apps/server/scripts/bench-backup.ts` run five times at trunk and at head, interleaved. Trunk runs the latency half only.
- [ ] Baseline. Record trunk p95 `/api/media` latency with no backup first.
- [ ] Rule. Fail if one backup takes over 5 s, or p95 `/api/media` latency during a backup exceeds trunk by more than 20%.

**Review gate.** None. P01 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends P01 to the phase 0 stack and the operator lands that stack bottom-up.

## Publish desktop update metadata with each release (D01)

**Depends on.** None. D01 is the root of phase 1 and branches from `master`.

**Files.**

- [ ] Edit `.github/workflows/desktop.yml`.
- [ ] Edit `desktop/package.json`.

**Build.**

- [ ] Add `"publish": [{ "provider": "github", "owner": "rene-roid", "repo": "sakuya" }]` to the `build` block of `desktop/package.json`, keeping `--publish never` so CI still uploads.
- [ ] Add `desktop/dist/latest.yml`, `desktop/dist/latest-linux.yml` and `desktop/dist/*.blockmap` to the upload-artifact paths, and change the release step to upload `Sakuya-* latest*.yml *.blockmap`.

**You see.**

- [ ] A `workflow_dispatch` run produces artifacts that include `latest.yml`, `latest-linux.yml` and two `.blockmap` files next to the installers.
- [ ] `latest-linux.yml` names `Sakuya-<version>-linux-x86_64.AppImage` with a `sha512` that matches the file.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `npx electron-builder --linux --publish never` in `desktop/` locally and check `desktop/dist/latest-linux.yml` exists with a `sha512` that `sha512sum` reproduces.
- [ ] Run `actionlint .github/workflows/desktop.yml` and record a clean result.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run the Desktop workflow by `workflow_dispatch` on trunk and on the head branch. Save `d01-regression.png`. Pass when trunk artifacts lack `latest*.yml` and head artifacts contain both files and both blockmaps.
- [ ] Lane 2. Download the Linux artifact and parse `latest-linux.yml`. Save `d01-linux-yml.png`. Pass when its `path` and `sha512` match the AppImage.
- [ ] Lane 3. Download the Windows artifact and parse `latest.yml`. Save `d01-win-yml.png`. Pass when its `path` and `sha512` match the installer.
- [ ] Lane 4. Tag a throwaway `v0.0.0-test.1` on a fork and let the release job run. Save `d01-release.png`. Pass when the release lists the installers, both yml files and both blockmaps.
- [ ] Lane 5. Re-run the release job on the same tag. Save `d01-rerun.png`. Pass when the upload with `--clobber` succeeds and no asset is duplicated.
- [ ] Lane 6. Open a PR that touches only `desktop/package.json`. Save `d01-pr-trigger.png`. Pass when the Desktop workflow runs and uploads artifacts but creates no release.
- [ ] Lane 7. Compare installer sizes between trunk and head artifacts. Save `d01-sizes.png`. Pass when each installer differs by less than 1 MB.
- [ ] Lane 8. Install the head AppImage on a clean Linux user and launch it. Save `d01-launch-linux.png`. Pass when the window shows the dashboard.
- [ ] Lane 9. Install the head `.exe` on a Windows VM and launch it. Save `d01-launch-win.png`. Pass when the window shows the dashboard.
- [ ] Lane 10. Check that the version in `latest.yml` equals the root `package.json` version. Save `d01-version.png`. Pass when both read the same string.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Desktop workflow wall time per matrix job.
- [ ] Probe. Two `workflow_dispatch` runs each at trunk and head, interleaved.
- [ ] Baseline. Record trunk wall time for the Linux and Windows jobs first.
- [ ] Rule. Fail if either job takes more than 60 s longer than trunk.

**Review gate.** None. D01 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends D01 to the phase 1 stack and the operator lands that stack bottom-up.

## Update the desktop app in the background (D02)

**Depends on.** D01 for the metadata and P01 for the pre-update backup.

**Files.**

- [ ] Edit `desktop/main.js`.
- [ ] Edit `desktop/package.json` to add `electron-updater`.
- [ ] Create `desktop/updates.js`.
- [ ] Create `desktop/test/updates.spec.js` for Playwright `_electron`.

**Build.**

- [ ] Add `desktop/updates.js` that owns the update state machine with the states `idle`, `checking`, `downloading`, `ready` and `error`, driven by `autoUpdater` events.
- [ ] Check on launch and every 6 hours. The mode is `auto`, `notify` or `off`, stored in `~/.sakuya/desktop.json`, default `auto`.
- [ ] In `ready`, add a tray and app-menu item `Restart to update`. Before `quitAndInstall`, call the P01 backup endpoint, then stop the server with the existing `stopServer()`.
- [ ] Keep the AppImage autostart re-pointing in `app.whenReady`, so the login entry follows the new file.

**You see.**

- [ ] With a newer version on the feed, the tray menu shows `Restart to update (1.8.0)` within a minute of launch.
- [ ] Clicking it writes a backup, restarts, and the About line in the tray reads the new version.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `desktop/test/updates.spec.js` gains "a newer feed version reaches ready", "mode off never checks" and "a failed download returns to idle with the error logged". Run `npx playwright test` in `desktop/`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Launch the trunk and head AppImages against a local `generic` feed that serves a newer version. Save `d02-regression.png`. Pass when trunk shows no update item and head shows `Restart to update` within 60 s.
- [ ] Lane 2. Click `Restart to update` on Linux. Save `d02-apply-linux.png`. Pass when the app restarts on the new version and `~/.sakuya/backups` gained one file.
- [ ] Lane 3. Click `Restart to update` on Windows. Save `d02-apply-win.png`. Pass when the NSIS update finishes and the app reopens on the new version.
- [ ] Lane 4. Set the mode to `notify`. Save `d02-notify.png`. Pass when the tray offers the update but nothing downloads until it is clicked.
- [ ] Lane 5. Set the mode to `off` and relaunch. Save `d02-off.png`. Pass when the feed server log shows no request.
- [ ] Lane 6. Serve a feed with a bad `sha512`. Save `d02-bad-hash.png`. Pass when the state returns to `idle`, `desktop.log` names the error, and the running version is unchanged.
- [ ] Lane 7. Take the feed offline. Save `d02-offline.png`. Pass when the app keeps running with no error dialog.
- [ ] Lane 8. Quit from the tray while a download is in progress. Save `d02-quit-mid.png`. Pass when the app exits within 5 s and the next launch starts clean.
- [ ] Lane 9. Enable Start at Login, then apply an update on Linux. Save `d02-autostart.png`. Pass when the autostart entry points at the new AppImage path.
- [ ] Lane 10. Start a scan, then apply an update. Save `d02-busy.png`. Pass when the server stops cleanly and the scan job reads `error` or `done`, never stuck `running`, after restart.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Desktop cold start, from process launch to the window showing the dashboard.
- [ ] Probe. Ten cold starts each of the trunk and head AppImages, interleaved, timed by Playwright `_electron`.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Fail if the head median is more than 150 ms slower than trunk.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 and lane 2 screenshots into `docs/plans/media/d02-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane worktree. Save it as `docs/plans/media/d02-review.mp4`.
- [ ] Post the screenshots and the video to the operator in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends D02 to the phase 1 stack and the operator lands that stack bottom-up.

## Remember AI tags the user removed (T01)

**Depends on.** None. T01 is the root of phase 2 and branches from `master` after phase 1 lands.

**Files.**

- [ ] Edit `apps/server/src/db/index.ts` to add a migration for `media_tag_vetoes(media_id, tag_id)`.
- [ ] Edit `apps/server/src/db/schema.ts`.
- [ ] Edit `apps/server/src/routes/media.ts` at the remove branch near line 659.
- [ ] Edit `apps/server/src/services/tagger.ts` in `tagOneMedia`.
- [ ] Edit `apps/server/src/tagger.test.ts`.

**Build.**

- [ ] When a user removes a tag whose row has `source` `ai`, insert a veto row. Adding the tag back by hand deletes the veto.
- [ ] In `tagOneMedia`, skip any predicted tag with a veto for that media.

**You see.**

- [ ] Remove `simple_background` from an item, re-tag it, and the tag stays gone.
- [ ] Add it back by hand, re-tag, and it stays as a user tag.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/server/src/tagger.test.ts` gains "a removed AI tag is not re-added by retag" and "re-adding a vetoed tag clears the veto". Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/tagger.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Remove an AI tag from a synthetic item in the viewer, then bulk re-tag it, at trunk and head. Save `t01-regression.png`. Pass when trunk shows the tag again and head does not.
- [ ] Lane 2. Remove three AI tags from one item and re-tag. Save `t01-multi.png`. Pass when all three stay gone and the others return.
- [ ] Lane 3. Remove a tag through the bulk tag dialog on 20 items, then re-tag them. Save `t01-bulk.png`. Pass when none of the 20 regain it.
- [ ] Lane 4. Re-add the vetoed tag by hand and re-tag. Save `t01-readd.png`. Pass when the tag is present once, as a user tag.
- [ ] Lane 5. Delete a media item that has vetoes. Save `t01-delete.png`. Pass when its veto rows are gone, checked with a count query on the scratch database.
- [ ] Lane 6. Search Explore for the vetoed tag. Save `t01-search.png`. Pass when the item is not in the results.
- [ ] Lane 7. Remove a user tag, then re-tag. Save `t01-user-tag.png`. Pass when no veto row is written.
- [ ] Lane 8. Restart the server and re-tag again. Save `t01-restart.png`. Pass when the veto still holds.
- [ ] Lane 9. Repeat lane 1 with `ui_style` set to `glass`. Save `t01-glass.png`. Pass when the same result shows with no clipped text and no overlapping controls.
- [ ] Lane 10. Repeat lane 1 at 390px wide. Save `t01-phone.png`. Pass when nothing scrolls sideways and every control stays reachable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Tag job throughput in items per second on 2,000 synthetic images.
- [ ] Probe. Three tag runs each at trunk and head, interleaved, with the real model symlinked into a scratch data dir.
- [ ] Baseline. Record trunk items per second first.
- [ ] Rule. Fail if head is more than 3% slower than trunk.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 and lane 2 screenshots into `docs/plans/media/t01-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane worktree. Save it as `docs/plans/media/t01-review.mp4`.
- [ ] Post the screenshots and the video to the operator in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends T01 to the phase 2 stack and the operator lands that stack bottom-up.

## Give character and general tags their own thresholds (T02)

**Depends on.** T01 in the phase 2 stack.

**Files.**

- [ ] Edit `apps/server/src/lib/settings.ts` to add `confidence_threshold_character` and keep `confidence_threshold` for general.
- [ ] Edit `apps/server/src/services/tagger.ts` so `selectTags` takes a threshold per category.
- [ ] Edit `apps/web/src/routes/settings/TaggingTab.tsx`.
- [ ] Edit `apps/server/src/tagger.test.ts`.

**Build.**

- [ ] Change `selectTags(scores, labels, thresholds)` to read `thresholds[label.category]`. The character default is 85 and general stays at 35.
- [ ] Show two sliders in the tagging settings, labelled General and Character.

**You see.**

- [ ] A character tag scoring 0.6 is dropped and a general tag scoring 0.6 is kept.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/server/src/tagger.test.ts` gains "selectTags applies the character threshold to character labels" with literal scores and expected names. Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/tagger.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Tag the same 50 synthetic images at trunk and head with defaults. Save `t02-regression.png`. Pass when head has no more character tags than trunk and the same general tags.
- [ ] Lane 2. Set the character slider to 50 and re-tag. Save `t02-lower.png`. Pass when character tag count rises compared with lane 1.
- [ ] Lane 3. Set the general slider to 90 and re-tag. Save `t02-general.png`. Pass when general tag count falls and character tags are unchanged.
- [ ] Lane 4. Move a slider with the arrow keys only and reload. Save `t02-keyboard.png`. Pass when the new value persisted.
- [ ] Lane 5. Upgrade a scratch database from trunk. Save `t02-upgrade.png`. Pass when the general threshold keeps its old value and the character one reads 85.
- [ ] Lane 6. Check that rating tags are still picked. Save `t02-rating.png`. Pass when each item still has exactly one rating tag.
- [ ] Lane 7. Set both sliders to 0. Save `t02-zero.png`. Pass when tagging finishes and the item count with tags equals the item count.
- [ ] Lane 8. Set both sliders to 100. Save `t02-hundred.png`. Pass when items get only a rating tag.
- [ ] Lane 9. Repeat lane 4 with `ui_style` set to `glass`. Save `t02-glass.png`. Pass when the same result shows with no clipped text and no overlapping controls.
- [ ] Lane 10. Repeat lane 4 at 390px wide. Save `t02-phone.png`. Pass when nothing scrolls sideways and every control stays reachable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Tag job items per second on 2,000 synthetic images.
- [ ] Probe. Three runs each at trunk and head, interleaved.
- [ ] Baseline. Record trunk items per second first.
- [ ] Rule. Fail if head is more than 3% slower than trunk.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 and lane 2 screenshots into `docs/plans/media/t02-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane worktree. Save it as `docs/plans/media/t02-review.mp4`.
- [ ] Post the screenshots and the video to the operator in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends T02 to the phase 2 stack and the operator lands that stack bottom-up.

## Show tags under display names (T03)

**Depends on.** T02 in the phase 2 stack.

**Files.**

- [ ] Edit `apps/server/src/db/index.ts` to add a migration for `tags.display_name`.
- [ ] Edit `apps/server/src/db/schema.ts`.
- [ ] Edit `packages/shared/src/index.ts` to add `displayName` to `TagCount` and `MediaTag`, and export `tagLabel` and `prettifyTag`.
- [ ] Edit `apps/server/src/routes/tags.ts` to match `display_name` in autocomplete and add `PATCH /api/tags/:name`.
- [ ] Edit the tag render sites in `apps/web/src/components/TagSidebar.tsx`, `MediaViewer.tsx`, `FilterToolbar.tsx`, `BulkTagDialog.tsx`, `TagSearchInput.tsx`, `SelectionBar.tsx` and `Navbar.tsx`.
- [ ] Edit `packages/shared/src/index.test.ts`.

**Build.**

- [ ] Add `prettifyTag(name)`, which turns `uraraka_ochako` into `Uraraka Ochako` and splits `asuna_(sao)` into the name `Asuna` and the subtitle `sao`.
- [ ] Add `tagLabel(tag)`, which returns `displayName ?? prettifyTag(name)`, and use it at every render site.
- [ ] Add a rename control to the tag menu in the viewer. URLs, saved searches and `media_fts` keep the canonical name.

**You see.**

- [ ] The sidebar shows `Uraraka Ochako`, and after a rename it shows `Uraraka`, while the URL still reads `tags=uraraka_ochako`.
- [ ] Typing `Urar` in the search box suggests the renamed tag.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `packages/shared/src/index.test.ts` gains literal cases for `prettifyTag`, including `asuna_(sao)` and `1girl`. Run `flock /tmp/sakuya-test.lock bun test --isolate packages/shared/src/index.test.ts`.
- [ ] `apps/server/src/search.test.ts` gains "autocomplete matches a display name and returns the canonical name". Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/search.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Open Explore on a library tagged `uraraka_ochako` at trunk and head. Save `t03-regression.png`. Pass when trunk shows `uraraka_ochako` and head shows `Uraraka Ochako`.
- [ ] Lane 2. Rename the tag to `Uraraka` from the viewer. Save `t03-rename.png`. Pass when the sidebar, viewer and filter chip all read `Uraraka`.
- [ ] Lane 3. Type `Urar` in the tag search. Save `t03-autocomplete.png`. Pass when the suggestion reads `Uraraka` and choosing it filters to the right items.
- [ ] Lane 4. Re-tag the item after the rename. Save `t03-retag.png`. Pass when the display name survives.
- [ ] Lane 5. Replay a saved search made before the rename. Save `t03-saved.png`. Pass when it returns the same items.
- [ ] Lane 6. Clear the display name. Save `t03-clear.png`. Pass when the label falls back to `Uraraka Ochako`.
- [ ] Lane 7. Open the bulk tag dialog on items with the renamed tag. Save `t03-bulk.png`. Pass when the dialog shows `Uraraka` and removing it works.
- [ ] Lane 8. Rename a tag to a name that another tag uses as its display name. Save `t03-collision.png`. Pass when the API answers 409 with a message and nothing changes.
- [ ] Lane 9. Repeat lane 2 with `ui_style` set to `glass`. Save `t03-glass.png`. Pass when the same result shows with no clipped text and no overlapping controls.
- [ ] Lane 10. Repeat lane 2 at 390px wide. Save `t03-phone.png`. Pass when nothing scrolls sideways and every control stays reachable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `/api/tags?q=` latency on a synthetic 30k-item, 8k-tag library.
- [ ] Probe. 200 autocomplete requests each at trunk and head, interleaved, with random two-letter prefixes.
- [ ] Baseline. Record trunk p95 first.
- [ ] Rule. Fail if head p95 exceeds trunk p95 by more than 10%.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 and lane 2 screenshots into `docs/plans/media/t03-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane worktree. Save it as `docs/plans/media/t03-review.mp4`.
- [ ] Post the screenshots and the video to the operator in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends T03 to the phase 2 stack and the operator lands that stack bottom-up.

## Rebuild settings on one registry (S01)

**Depends on.** T03 in the phase 2 stack.

**Files.**

- [ ] Create `apps/web/src/routes/settings/registry.tsx`.
- [ ] Create `apps/web/src/routes/settings/SettingRow.tsx`.
- [ ] Edit `apps/web/src/routes/settings/index.tsx`.
- [ ] Edit `apps/web/src/routes/settings/MiscTabs.tsx`, `TaggingTab.tsx`, `LibrariesTab.tsx` and `JobsTab.tsx`.
- [ ] Edit `apps/web/src/routes/Discover.tsx` for the settings link.
- [ ] Create `apps/web/src/routes/settings/registry.test.ts`.

**Build.**

- [ ] Declare every setting once in `registry.tsx` with `section`, `group`, `label`, `description`, `keywords` and `kind`, where `kind` is toggle, select, slider, action or custom.
- [ ] Render rows with one `SettingRow`, grouped into one panel per group with dividers. Sections are General, Playback, Libraries, AI Tagging, Media processing, Jobs, Storage and About.
- [ ] Make `ToggleSwitch` a `button` with `role="switch"`, save the slider on `onChange` with a debounce, render sidebar tabs as buttons, and drop the toast on toggles.
- [ ] Add an exported `settingHref(id)` and use it for the Discover-off link instead of `?tab=behavior`.

**You see.**

- [ ] Settings shows the eight sections in three groups and every old setting is present.
- [ ] Tab moves through every switch and Space toggles it.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/web/src/routes/settings/registry.test.ts` gains "every Settings key appears in exactly one registry entry" and "ids are unique". Run `flock /tmp/sakuya-test.lock bun test --isolate apps/web/src/routes/settings/registry.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Toggle every setting at trunk and head, reload, and read `/api/settings`. Save `s01-regression.png`. Pass when head persists every value trunk persists.
- [ ] Lane 2. Walk all eight sections. Save `s01-sections.png`. Pass when every setting from trunk appears once.
- [ ] Lane 3. Use only the keyboard to change the confidence slider and reload. Save `s01-slider-keys.png`. Pass when the new value persisted.
- [ ] Lane 4. Tab through Playback and press Space on each switch. Save `s01-switch-keys.png`. Pass when each switch flips and has a visible focus ring.
- [ ] Lane 5. Toggle three settings quickly. Save `s01-no-toast.png`. Pass when no toast appears and all three persisted.
- [ ] Lane 6. Turn Discover off and open `/discover`. Save `s01-discover-link.png`. Pass when the link lands on the Discover setting in General.
- [ ] Lane 7. Open `/settings?tab=behavior` from an old bookmark. Save `s01-old-tab.png`. Pass when it opens General.
- [ ] Lane 8. Compare row spacing across sections. Save `s01-spacing.png`. Pass when every row has the same padding and every group has the same gap.
- [ ] Lane 9. Repeat lane 2 with `ui_style` set to `glass`. Save `s01-glass.png`. Pass when the same result shows with no clipped text and no overlapping controls.
- [ ] Lane 10. Repeat lane 2 at 390px wide. Save `s01-phone.png`. Pass when nothing scrolls sideways and every control stays reachable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from clicking a settings section to its content painted.
- [ ] Probe. 50 section switches each at trunk and head, interleaved, timed with `performance.now()` around the click and the next paint.
- [ ] Baseline. Record trunk p95 first.
- [ ] Rule. Fail if head p95 is over 50 ms or more than 20% slower than trunk.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 and lane 2 screenshots into `docs/plans/media/s01-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane worktree. Save it as `docs/plans/media/s01-review.mp4`.
- [ ] Post the screenshots and the video to the operator in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends S01 to the phase 2 stack and the operator lands that stack bottom-up.

## Search settings (S02)

**Depends on.** S01 in the phase 2 stack.

**Files.**

- [ ] Create `apps/web/src/routes/settings/SettingsSearch.tsx`.
- [ ] Edit `apps/web/src/routes/settings/index.tsx`.
- [ ] Edit `apps/web/src/routes/settings/registry.tsx` to fill `keywords`.
- [ ] Edit `apps/web/src/routes/settings/registry.test.ts`.

**Build.**

- [ ] Add a search box above the section list. Words match with AND across label, description, keywords, group and section.
- [ ] While searching, show matches grouped by section with a breadcrumb, highlight the matched words, and show a count per section in the sidebar.
- [ ] Enter opens the first match, Escape clears, `/` focuses the box, and each match links to `?tab=<section>#<id>`, which scrolls to the row and flashes it.

**You see.**

- [ ] Typing `hevc` shows Video transcoding under Media processing.
- [ ] Opening `/settings?tab=processing#thumbnail-cache` scrolls to that row and flashes it.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/web/src/routes/settings/registry.test.ts` gains literal search cases, `gif` gives two ids and `video hevc` gives two ids. Run `flock /tmp/sakuya-test.lock bun test --isolate apps/web/src/routes/settings/registry.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no settings search, so record that, then at head type `thumb`. Save `s02-regression.png`. Pass when head lists the thumbnail rows under Media processing and the cleanup row under Storage.
- [ ] Lane 2. Type `video hevc`. Save `s02-and.png`. Pass when only rows matching both words show.
- [ ] Lane 3. Type `zzz`. Save `s02-empty.png`. Pass when an empty state with example queries shows.
- [ ] Lane 4. Press `/` from anywhere on the page, type `volume`, and press Enter. Save `s02-enter.png`. Pass when Playback opens and the volume row flashes.
- [ ] Lane 5. Click a breadcrumb in the results. Save `s02-crumb.png`. Pass when that section opens scrolled to the row.
- [ ] Lane 6. Toggle a switch inside the results. Save `s02-toggle.png`. Pass when the value persists and the results stay open.
- [ ] Lane 7. Open a deep link in a new tab. Save `s02-deeplink.png`. Pass when the row is scrolled into view and flashes.
- [ ] Lane 8. Press Escape. Save `s02-escape.png`. Pass when the query clears and the previous section returns.
- [ ] Lane 9. Repeat lane 4 with `ui_style` set to `glass`. Save `s02-glass.png`. Pass when the same result shows with no clipped text and no overlapping controls.
- [ ] Lane 10. Repeat lane 4 at 390px wide. Save `s02-phone.png`. Pass when nothing scrolls sideways and every control stays reachable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Keystroke to results painted in settings search.
- [ ] Probe. Type a 12-character query 20 times at head. Trunk lacks the feature, so measure section-switch paint at both as a control.
- [ ] Baseline. Record the trunk section-switch p95 first.
- [ ] Rule. Fail if head keystroke-to-paint p95 exceeds 16 ms, or the head control is more than 10% slower than trunk.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 and lane 2 screenshots into `docs/plans/media/s02-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane worktree. Save it as `docs/plans/media/s02-review.mp4`.
- [ ] Post the screenshots and the video to the operator in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends S02 to the phase 2 stack and the operator lands that stack bottom-up.

## Move uploads and duplicates out of settings (S03)

**Depends on.** S02 in the phase 2 stack.

**Files.**

- [ ] Create `apps/web/src/components/UploadButton.tsx` from the upload logic in `apps/web/src/routes/settings/UploadsTab.tsx`.
- [ ] Create `apps/web/src/routes/Duplicates.tsx` from `apps/web/src/routes/settings/DuplicatesTab.tsx`.
- [ ] Delete `apps/web/src/routes/settings/UploadsTab.tsx` and `DuplicatesTab.tsx`.
- [ ] Edit `apps/web/src/App.tsx`, `apps/web/src/components/Navbar.tsx` and the library page.

**Build.**

- [ ] Add an Upload button to each library page that opens the file picker and accepts drops onto the grid.
- [ ] Serve Duplicates at `/duplicates`, linked from the Explore toolbar menu. Old `?tab=uploads` and `?tab=duplicates` links redirect.

**You see.**

- [ ] Dropping two images onto a library grid uploads them into that library with progress shown.
- [ ] `/settings?tab=duplicates` redirects to `/duplicates`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bun run typecheck` and `bun run lint` and record clean results. Server upload behavior is unchanged and `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/removal.test.ts` stays green.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Upload two files at trunk from Settings and at head from the library page. Save `s03-regression.png`. Pass when both land in the same library with the same count.
- [ ] Lane 2. Drop five images onto a library grid. Save `s03-drop.png`. Pass when all five appear without a reload.
- [ ] Lane 3. Upload a non-image file. Save `s03-reject.png`. Pass when a toast names the file and nothing is added.
- [ ] Lane 4. Open `/duplicates` and delete one of a pair. Save `s03-duplicates.png`. Pass when the pair disappears and the file is gone.
- [ ] Lane 5. Open `/settings?tab=uploads`. Save `s03-redirect-uploads.png`. Pass when it lands on the first library page.
- [ ] Lane 6. Open `/settings?tab=duplicates`. Save `s03-redirect-dupes.png`. Pass when it lands on `/duplicates`.
- [ ] Lane 7. Search settings for `upload`. Save `s03-search.png`. Pass when the result explains uploads moved and links to a library.
- [ ] Lane 8. Upload with no library. Save `s03-no-library.png`. Pass when the button is disabled with a hint to create one.
- [ ] Lane 9. Repeat lane 2 with `ui_style` set to `glass`. Save `s03-glass.png`. Pass when the same result shows with no clipped text and no overlapping controls.
- [ ] Lane 10. Repeat lane 2 at 390px wide. Save `s03-phone.png`. Pass when nothing scrolls sideways and every control stays reachable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Upload throughput in MB per second for 50 synthetic 2 MB images.
- [ ] Probe. Three uploads each at trunk and head, interleaved.
- [ ] Baseline. Record trunk MB per second first.
- [ ] Rule. Fail if head is more than 5% slower than trunk.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 and lane 2 screenshots into `docs/plans/media/s03-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane worktree. Save it as `docs/plans/media/s03-review.mp4`.
- [ ] Post the screenshots and the video to the operator in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends S03 to the phase 2 stack and the operator lands that stack bottom-up.

## Show updates inside the app by install kind (D03)

**Depends on.** D02 for the updater and S01 for the About section.

**Files.**

- [ ] Create `desktop/preload.js`.
- [ ] Edit `desktop/main.js` to load the preload and answer `update:state`, `update:check`, `update:install` and `update:mode`.
- [ ] Edit `apps/web/src/components/UpdateToast.tsx`.
- [ ] Edit `apps/server/src/routes/settings.ts` to report `installKind` as desktop, docker or source.
- [ ] Edit `apps/web/src/routes/settings/registry.tsx` for the About rows.

**Build.**

- [ ] Expose `window.sakuyaDesktop` through `contextBridge` with the four update calls.
- [ ] Branch `UpdateToast` on `installKind`. Desktop shows `Restart to update`, Docker shows `docker compose pull && docker compose up -d`, and source shows `./update.sh`.
- [ ] Add About rows for the version, a Check now button, and the update mode select on desktop.

**You see.**

- [ ] In the desktop app with an update ready, the toast reads `Sakuya 1.8.0 is ready` with a `Restart to update` button.
- [ ] In the browser on a source install, the toast still says `Run ./update.sh to upgrade`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/server/src/version.test.ts` gains "installKind reads docker when `/.dockerenv` exists and source otherwise". Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/version.test.ts`.
- [ ] `desktop/test/updates.spec.js` gains "the renderer sees ready through the bridge". Run `npx playwright test` in `desktop/`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Open a source install in the browser at trunk and head with a newer release on the feed. Save `d03-regression.png`. Pass when both show the toast with `./update.sh`.
- [ ] Lane 2. Open the desktop app with an update ready. Save `d03-desktop-toast.png`. Pass when the toast shows `Restart to update` and clicking it restarts into the new version.
- [ ] Lane 3. Run the Docker image with a newer release. Save `d03-docker.png`. Pass when the toast shows the compose command.
- [ ] Lane 4. Click Check now in About on desktop with no update. Save `d03-check-none.png`. Pass when About reads `Up to date`.
- [ ] Lane 5. Change the update mode in About to off. Save `d03-mode.png`. Pass when `~/.sakuya/desktop.json` reads `off` and the tray agrees.
- [ ] Lane 6. Open the desktop UI from Open in Browser. Save `d03-browser-from-desktop.png`. Pass when the browser tab shows the source-style message, not a broken button.
- [ ] Lane 7. Dismiss the toast and reload. Save `d03-dismiss.png`. Pass when it stays hidden for that version.
- [ ] Lane 8. Search settings for `update`. Save `d03-search.png`. Pass when the About rows appear.
- [ ] Lane 9. Repeat lane 2 with `ui_style` set to `glass`. Save `d03-glass.png`. Pass when the same result shows with no clipped text and no overlapping controls.
- [ ] Lane 10. Repeat lane 2 at 390px wide. Save `d03-phone.png`. Pass when nothing scrolls sideways and every control stays reachable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Dashboard first paint in the desktop window.
- [ ] Probe. Ten cold starts each of trunk and head builds, interleaved.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Fail if head is more than 50 ms slower than trunk.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 and lane 2 screenshots into `docs/plans/media/d03-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane worktree. Save it as `docs/plans/media/d03-review.mp4`.
- [ ] Post the screenshots and the video to the operator in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends D03 to the phase 2 stack and the operator lands that stack bottom-up.

## Send deleted media to a trash folder (P02)

**Depends on.** D03 in the phase 2 stack, and S01 for the Storage section.

**Files.**

- [ ] Create `apps/server/src/services/trash.ts`.
- [ ] Edit `apps/server/src/routes/media.ts` at lines 282 and 581 to call `moveToTrash` instead of `fs.unlink`.
- [ ] Edit `apps/server/src/db/index.ts` to add a migration for `trash(id, original_path, trashed_path, trashed_at, media_json)`.
- [ ] Edit `apps/server/src/services/cleanup.ts` to purge items older than 30 days.
- [ ] Edit `apps/web/src/routes/settings/registry.tsx` for a Trash row in Storage.
- [ ] Create `apps/server/src/trash.test.ts`.

**Build.**

- [ ] Move a deleted file to `<dataDir>/trash/<id>` with a rename, or a copy then unlink across devices, and keep its media row and tags as JSON.
- [ ] Add `GET /api/trash`, `POST /api/trash/:id/restore` and `DELETE /api/trash`. Restore puts the file back and re-inserts the row with its tags.
- [ ] Show the Trash in Storage with its size, a Restore action per item and Empty trash.

**You see.**

- [ ] Deleting an image leaves it in Trash, and Restore brings it back with its tags and likes.
- [ ] Items older than 30 days are gone after the cleanup job.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/server/src/trash.test.ts` gains "delete moves the file and restore brings back tags" and "purge removes only items older than 30 days". Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/trash.test.ts`.
- [ ] `apps/server/src/removal.test.ts` stays green. Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/removal.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Delete a synthetic image at trunk and head. Save `p02-regression.png`. Pass when trunk removes the file for good and head lists it in Trash.
- [ ] Lane 2. Restore the item. Save `p02-restore.png`. Pass when it returns to its library with its tags, like and board membership.
- [ ] Lane 3. Bulk delete 100 items, then Empty trash. Save `p02-bulk.png`. Pass when Trash lists 100 items, then 0, and disk usage drops.
- [ ] Lane 4. Restore an item whose original folder was removed. Save `p02-missing-folder.png`. Pass when the API answers 409 with the path and the item stays in Trash.
- [ ] Lane 5. Delete across devices with the trash on another mount. Save `p02-cross-device.png`. Pass when the file is copied and the original is unlinked.
- [ ] Lane 6. Set the clock forward 31 days and run cleanup. Save `p02-purge.png`. Pass when the old item is gone and a newer one stays.
- [ ] Lane 7. Delete a video with a transcode. Save `p02-video.png`. Pass when restore plays the video again.
- [ ] Lane 8. Rescan the library after a delete. Save `p02-rescan.png`. Pass when the scan does not re-add the trashed file.
- [ ] Lane 9. Repeat lane 2 with `ui_style` set to `glass`. Save `p02-glass.png`. Pass when the same result shows with no clipped text and no overlapping controls.
- [ ] Lane 10. Repeat lane 2 at 390px wide. Save `p02-phone.png`. Pass when nothing scrolls sideways and every control stays reachable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Bulk delete time for 500 synthetic items.
- [ ] Probe. Three bulk deletes each at trunk and head, interleaved, on the same device.
- [ ] Baseline. Record trunk wall time first.
- [ ] Rule. Fail if head takes more than 1.5 times trunk, or more than 3 s.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 and lane 2 screenshots into `docs/plans/media/p02-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane worktree. Save it as `docs/plans/media/p02-review.mp4`.
- [ ] Post the screenshots and the video to the operator in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends P02 to the phase 2 stack and the operator lands that stack bottom-up.

## Fix Discover scoring (R01)

**Depends on.** None. R01 is the root of phase 3 and branches from `master` after phase 2 lands.

**Files.**

- [ ] Edit `apps/server/src/routes/discover.ts`.
- [ ] Edit `apps/server/src/routes/media.ts` near line 766.
- [ ] Edit `apps/server/src/discover.test.ts`.

**Build.**

- [ ] Score an item by the sum of its five best profile weights instead of `SUM(p.weight)` over every tag.
- [ ] Weight each item in `buildProfile` by a 60-day half-life from `liked_at` and `last_viewed_at`.
- [ ] Count a view only when the client reports at least 2 s open, through the existing progress call.

**You see.**

- [ ] An item with five strongly liked tags ranks above one with 40 weak matches.
- [ ] A like from a year ago moves the feed less than a like from today.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/server/src/discover.test.ts` gains "five strong tags beat forty weak ones", "a fresh like outweighs an old one" and "a 1 s open does not count as a view", each asserting literal ids in order. Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/discover.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Seed the 40-weak versus 5-strong fixture and read the first page at trunk and head. Save `r01-regression.png`. Pass when trunk ranks the 40-tag item first and head ranks the 5-tag item first.
- [ ] Lane 2. Like 10 items tagged `rain` today and 10 tagged `snow` a year ago. Save `r01-decay.png`. Pass when the first page has more `rain` than `snow`.
- [ ] Lane 3. Open and close 30 items within 1 s each. Save `r01-quickskip.png`. Pass when their view counts stay 0.
- [ ] Lane 4. Keep an item open for 5 s. Save `r01-view.png`. Pass when its view count is 1.
- [ ] Lane 5. Page through 600 items. Save `r01-pagination.png`. Pass when no id repeats and none is skipped.
- [ ] Lane 6. Read the feed on an empty profile. Save `r01-cold.png`. Pass when the feed is random and has 60 items.
- [ ] Lane 7. Like an item mid-scroll. Save `r01-snapshot.png`. Pass when the next page keeps the old ordering.
- [ ] Lane 8. Set surprise to 1. Save `r01-random.png`. Pass when the order matches trunk for the same seed.
- [ ] Lane 9. Read the reason tag on the top 20 cards. Save `r01-reason.png`. Pass when each reason is one of that item's tags.
- [ ] Lane 10. Run with the type filter set to video. Save `r01-video.png`. Pass when only videos return.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Discover first-page latency and snapshot build time on a synthetic 30k-item library.
- [ ] Probe. 30 first-page requests each at trunk and head, interleaved, with a forced snapshot rebuild every tenth request.
- [ ] Baseline. Record trunk p95 and snapshot build time first.
- [ ] Rule. Fail if head p95 or build time exceeds trunk by more than 15%.

**Review gate.** None. R01 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends R01 to the phase 3 stack and the operator lands that stack bottom-up.

## Spread similar items through the Discover feed (R02)

**Depends on.** R01 in the phase 3 stack.

**Files.**

- [ ] Edit `apps/server/src/routes/discover.ts`.
- [ ] Create `apps/server/src/lib/diversify.ts`.
- [ ] Edit `apps/server/src/discover.test.ts`.

**Build.**

- [ ] Add `diversify(items, window)` in `diversify.ts`. In each window of 20 it allows at most 4 items from one folder and 5 with one reason tag, and keeps only one of a group within dHash distance 6.
- [ ] Apply it to each page after ranking, before the cursor is taken, so pagination stays stable.

**You see.**

- [ ] A 50-image batch from one folder shows at most 4 per 20 cards.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/server/src/discover.test.ts` gains "one folder never fills a window" and "near-duplicates collapse to one" with literal ids. Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/discover.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Seed a 50-image single-folder batch that matches taste and read page one at trunk and head. Save `r02-regression.png`. Pass when trunk shows over 4 from that folder in the first 20 and head shows at most 4.
- [ ] Lane 2. Seed 10 near-identical images. Save `r02-dupes.png`. Pass when one of them appears in the first page.
- [ ] Lane 3. Page through 600 items. Save `r02-pagination.png`. Pass when no id repeats and none is skipped.
- [ ] Lane 4. Seed a library with one folder only. Save `r02-one-folder.png`. Pass when the feed still fills 60 items.
- [ ] Lane 5. Count reason tags in the first 20. Save `r02-reasons.png`. Pass when no reason appears more than 5 times.
- [ ] Lane 6. Set surprise to 0. Save `r02-familiar.png`. Pass when the caps still hold.
- [ ] Lane 7. Read with the type filter set to image. Save `r02-images.png`. Pass when the caps hold and only images return.
- [ ] Lane 8. Open the viewer from the feed and page to the end. Save `r02-viewer.png`. Pass when the viewer order matches the grid.
- [ ] Lane 9. Seed items with no perceptual hash. Save `r02-no-hash.png`. Pass when they rank without errors.
- [ ] Lane 10. Reshuffle three times. Save `r02-reshuffle.png`. Pass when each page obeys the caps.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Discover page latency on a synthetic 30k-item library.
- [ ] Probe. 30 page requests each at trunk and head, interleaved.
- [ ] Baseline. Record trunk p95 first.
- [ ] Rule. Fail if head p95 is more than 20 ms above trunk.

**Review gate.** None. R02 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends R02 to the phase 3 stack and the operator lands that stack bottom-up.

## Let users steer Discover (R03)

**Depends on.** R02 in the phase 3 stack, and T03 for display names.

**Files.**

- [ ] Edit `apps/server/src/db/index.ts` to add migrations for `tag_preferences(tag_id, mode)` and `media_feedback(media_id, kind, at)`.
- [ ] Edit `apps/server/src/routes/discover.ts` to apply them and add `GET /api/discover/profile`, `PUT /api/discover/tags/:name` and `POST /api/discover/feedback`.
- [ ] Create `apps/web/src/components/TastePanel.tsx`.
- [ ] Edit `apps/web/src/components/MediaCard.tsx` for the card menu.
- [ ] Edit `apps/web/src/routes/Discover.tsx`.
- [ ] Edit `apps/server/src/discover.test.ts`.

**Build.**

- [ ] Boost doubles a tag weight. Mute removes every item carrying the tag from the feed. Both writes call `bumpTasteVersion()`.
- [ ] Not interested hides the item and lowers its tags by a small fixed amount. Less of X halves that tag weight without hiding anything.
- [ ] Show the taste panel with the top profile tags under their display names, and an Undo toast after each card action.

**You see.**

- [ ] Muting `Rain` removes every rain item from the feed at once.
- [ ] Not interested hides the card, and Undo brings it back.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/server/src/discover.test.ts` gains "a muted tag removes its items", "boost raises an item above an unboosted peer" and "hidden items never return". Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/discover.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no feedback, so record that, then at head mute the top taste tag. Save `r03-regression.png`. Pass when no item with that tag is in the first 200.
- [ ] Lane 2. Boost a mid-ranked tag. Save `r03-boost.png`. Pass when its items move into the first 20.
- [ ] Lane 3. Choose Not interested on a card. Save `r03-hide.png`. Pass when the card fades out and does not return after reload.
- [ ] Lane 4. Press Undo after hiding. Save `r03-undo.png`. Pass when the card is back in the same place.
- [ ] Lane 5. Choose Less of X on a card. Save `r03-less.png`. Pass when that tag shows less in the first page but its items still appear.
- [ ] Lane 6. Open the taste panel. Save `r03-panel.png`. Pass when tags show display names and weight bars.
- [ ] Lane 7. Click a taste chip three times. Save `r03-cycle.png`. Pass when it goes boost, mute, normal, and the feed follows each step.
- [ ] Lane 8. Mute every taste tag. Save `r03-all-muted.png`. Pass when the feed falls back to random with an explanation.
- [ ] Lane 9. Repeat lane 3 with `ui_style` set to `glass`. Save `r03-glass.png`. Pass when the same result shows with no clipped text and no overlapping controls.
- [ ] Lane 10. Repeat lane 3 at 390px wide. Save `r03-phone.png`. Pass when nothing scrolls sideways and every control stays reachable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from a mute click to the refreshed first page painted.
- [ ] Probe. 20 mute and unmute cycles at head. Trunk lacks the feature, so measure first-page latency at both as a control.
- [ ] Baseline. Record trunk first-page p95 first.
- [ ] Rule. Fail if mute-to-paint p95 exceeds 600 ms, or head first-page p95 exceeds trunk by more than 15%.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 and lane 2 screenshots into `docs/plans/media/r03-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane worktree. Save it as `docs/plans/media/r03-review.mp4`.
- [ ] Post the screenshots and the video to the operator in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends R03 to the phase 3 stack and the operator lands that stack bottom-up.

## Add Discover shelves and presets (R04)

**Depends on.** R03 in the phase 3 stack.

**Files.**

- [ ] Create `apps/server/src/lib/discoverShelves.ts`.
- [ ] Edit `apps/server/src/routes/discover.ts` to add `GET /api/discover/shelves` and a `shelf` query parameter.
- [ ] Create `apps/web/src/components/Shelf.tsx`.
- [ ] Edit `apps/web/src/routes/Discover.tsx`.
- [ ] Edit `apps/server/src/discover.test.ts`.

**Build.**

- [ ] Declare shelves in `discoverShelves.ts` as `{ id, title, where }`, filtered from the current snapshot. The shelves are because-you-like for the top two tags, new since last visit, rediscover, and off the beaten path from `discover_scores.related`.
- [ ] Store `discover_last_visit` when the page opens.
- [ ] Replace the slider with Familiar, Balanced and Adventurous at 0.1, 0.3 and 0.6, and rename I'm feeling lucky to Surprise me. Old `surprise=` URLs map to the nearest preset.
- [ ] Show the shelves above the existing infinite grid. See all opens the grid with `?shelf=<id>`.

**You see.**

- [ ] Discover opens with four shelves above the grid, and each shelf title explains its rows.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/server/src/discover.test.ts` gains one literal case per shelf, such as "rediscover returns items liked over 60 days ago and unopened for 30". Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/discover.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Open Discover at trunk and head on the same seeded library. Save `r04-regression.png`. Pass when trunk shows the slider and head shows the presets and four shelves.
- [ ] Lane 2. Click See all on a shelf. Save `r04-see-all.png`. Pass when the grid shows only that shelf and paginates.
- [ ] Lane 3. Add 20 items and reopen Discover. Save `r04-new.png`. Pass when New since your last visit shows them.
- [ ] Lane 4. Open with no likes. Save `r04-cold.png`. Pass when the shelves that need taste are hidden and the grid shows.
- [ ] Lane 5. Switch presets. Save `r04-presets.png`. Pass when the grid reorders and the URL records the preset.
- [ ] Lane 6. Open an old `?surprise=0.25` URL. Save `r04-old-url.png`. Pass when Balanced is selected.
- [ ] Lane 7. Mute the top tag. Save `r04-mute.png`. Pass when its because-you-like shelf is replaced by the next tag.
- [ ] Lane 8. Click Surprise me. Save `r04-surprise.png`. Pass when the viewer opens on a random item.
- [ ] Lane 9. Repeat lane 1 with `ui_style` set to `glass`. Save `r04-glass.png`. Pass when the same result shows with no clipped text and no overlapping controls.
- [ ] Lane 10. Repeat lane 1 at 390px wide. Save `r04-phone.png`. Pass when nothing scrolls sideways and every control stays reachable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Discover time to first shelf painted on a synthetic 30k-item library.
- [ ] Probe. 20 page loads each at trunk and head, interleaved. Trunk has no shelves, so compare the head shelf paint against the trunk first grid paint.
- [ ] Baseline. Record the trunk first grid paint p95 first.
- [ ] Rule. Fail if the head first shelf p95 exceeds 800 ms, or the head grid paint is more than 15% slower than trunk.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 and lane 2 screenshots into `docs/plans/media/r04-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane worktree. Save it as `docs/plans/media/r04-review.mp4`.
- [ ] Post the screenshots and the video to the operator in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends R04 to the phase 3 stack and the operator lands that stack bottom-up.

## Rank more like this by shared tags (R05)

**Depends on.** R04 in the phase 3 stack.

**Files.**

- [ ] Edit `apps/server/src/routes/discover.ts` to add `GET /api/discover/like/:id`.
- [ ] Edit `apps/server/src/discover.test.ts`.

**Build.**

- [ ] Score candidates by the sum of `log(N / usage)` over tags shared with the source item, exclude rating tags, and return 60 items.

**You see.**

- [ ] More like this on an item tagged `rain` and `umbrella` returns items sharing both before items sharing one.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/server/src/discover.test.ts` gains "a rare shared tag outranks a common one" with literal ids. Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/discover.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no endpoint, so record the 404, then at head call it on a seeded item. Save `r05-regression.png`. Pass when head returns 60 items with the two-tag matches first.
- [ ] Lane 2. Call it on an item with no tags. Save `r05-untagged.png`. Pass when it returns an empty list with 200.
- [ ] Lane 3. Call it on a missing id. Save `r05-missing.png`. Pass when it returns 404.
- [ ] Lane 4. Check that the source item is excluded. Save `r05-self.png`. Pass when the source id is absent.
- [ ] Lane 5. Check that hidden items are excluded. Save `r05-hidden.png`. Pass when no hidden id appears.
- [ ] Lane 6. Check that muted tags are respected. Save `r05-muted.png`. Pass when no item carries a muted tag.
- [ ] Lane 7. Call it on a video. Save `r05-video.png`. Pass when videos and images both return, ranked by shared tags.
- [ ] Lane 8. Call it with auth on and no session. Save `r05-auth.png`. Pass when it returns 401.
- [ ] Lane 9. Call it on an item tagged only `1girl`. Save `r05-common.png`. Pass when results are ranked and the call finishes.
- [ ] Lane 10. Call it 50 times in parallel. Save `r05-parallel.png`. Pass when every call returns 200.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. More-like-this latency on a synthetic 30k-item library.
- [ ] Probe. 100 calls on random items at head. Trunk lacks the endpoint, so measure `/api/media/:id/similar` at both as a control.
- [ ] Baseline. Record the trunk control p95 first.
- [ ] Rule. Fail if head p95 exceeds 150 ms, or the head control is more than 10% slower than trunk.

**Review gate.** None. R05 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends R05 to the phase 3 stack and the operator lands that stack bottom-up.

## Read gallery-dl metadata into tags (M01)

**Depends on.** None. M01 is the root of phase 4 and branches from `master` after phase 3 lands.

**Files.**

- [ ] Edit `apps/server/src/services/downloader.ts` near line 171 to pass `--write-metadata`.
- [ ] Edit `packages/shared/src/index.ts` to add `artist` and `copyright` to `TAG_CATEGORIES`.
- [ ] Edit `apps/server/src/services/scanner.ts` to read `<file>.json` sidecars.
- [ ] Edit `apps/server/src/db/index.ts` to add a migration for `media.source_url`.
- [ ] Edit `apps/web/src/components/TagSidebar.tsx` and `MediaViewer.tsx`.
- [ ] Edit `apps/server/src/downloader.test.ts` and `apps/server/src/scan.test.ts`.

**Build.**

- [ ] Map known sidecar fields to artist and copyright tags with `source` `user`, and store the post URL in `source_url`.
- [ ] Show Artists and Series sections in the sidebar and a View source link in the viewer.

**You see.**

- [ ] A downloaded post shows its artist under Artists and a View source link that opens the post.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/server/src/scan.test.ts` gains "a sidecar adds artist and copyright tags and the source URL" with a literal JSON fixture. Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/scan.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Scan a folder of synthetic images with sidecar JSON at trunk and head. Save `m01-regression.png`. Pass when trunk ignores the sidecars and head shows the artist tags.
- [ ] Lane 2. Open the viewer and click View source. Save `m01-source.png`. Pass when the URL from the sidecar opens externally.
- [ ] Lane 3. Scan a sidecar with unknown fields. Save `m01-unknown.png`. Pass when the scan finishes and only known fields map.
- [ ] Lane 4. Scan a malformed sidecar. Save `m01-malformed.png`. Pass when the scan logs the file and continues.
- [ ] Lane 5. Filter Explore by an artist. Save `m01-filter.png`. Pass when only that artist's items show.
- [ ] Lane 6. Re-tag an item with metadata tags. Save `m01-retag.png`. Pass when the artist tags stay.
- [ ] Lane 7. Run a download batch with the new flag. Save `m01-download.png`. Pass when sidecars appear next to the files.
- [ ] Lane 8. Check that sidecars are not indexed as media. Save `m01-no-index.png`. Pass when the media count equals the image count.
- [ ] Lane 9. Repeat lane 1 with `ui_style` set to `glass`. Save `m01-glass.png`. Pass when the same result shows with no clipped text and no overlapping controls.
- [ ] Lane 10. Repeat lane 1 at 390px wide. Save `m01-phone.png`. Pass when nothing scrolls sideways and every control stays reachable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Scan time for 5,000 synthetic images with sidecars.
- [ ] Probe. Three scans each at trunk and head, interleaved.
- [ ] Baseline. Record trunk scan time first.
- [ ] Rule. Fail if head is more than 15% slower than trunk.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 and lane 2 screenshots into `docs/plans/media/m01-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane worktree. Save it as `docs/plans/media/m01-review.mp4`.
- [ ] Post the screenshots and the video to the operator in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends M01 to the phase 4 stack and the operator lands that stack bottom-up.

## Merge and imply tags (M02)

**Depends on.** M01 in the phase 4 stack, and T03 for display names.

**Files.**

- [ ] Edit `apps/server/src/db/index.ts` to add migrations for `tag_siblings(from_tag_id, to_tag_id)` and `tag_implications(tag_id, implies_tag_id)`.
- [ ] Create `apps/server/src/services/tagRelations.ts`.
- [ ] Edit `apps/server/src/routes/tags.ts`.
- [ ] Edit `apps/server/src/services/tagger.ts` to apply siblings and implications after `selectTags`.
- [ ] Create `apps/web/src/routes/settings/TagRelations.tsx` registered as a custom row.
- [ ] Create `apps/server/src/tagRelations.test.ts`.

**Build.**

- [ ] A sibling rewrites every link from one tag to another in one transaction and points future writes at the target.
- [ ] An implication adds the implied tag with `source` `implied` whenever the source tag is added. Cycles are rejected.

**You see.**

- [ ] Making `uraraka_ochako` imply `boku_no_hero_academia` tags every Uraraka item with the series.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/server/src/tagRelations.test.ts` gains "a sibling moves links", "an implication adds the series" and "a cycle is rejected". Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/tagRelations.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no relations, so record that, then at head add an implication. Save `m02-regression.png`. Pass when every source-tag item gains the implied tag.
- [ ] Lane 2. Merge a user tag into an AI tag. Save `m02-sibling.png`. Pass when the user tag is gone and its items carry the target.
- [ ] Lane 3. Add an implication cycle. Save `m02-cycle.png`. Pass when the API answers 400 and nothing changes.
- [ ] Lane 4. Remove an implication. Save `m02-remove.png`. Pass when only `implied` links are removed.
- [ ] Lane 5. Re-tag after a sibling. Save `m02-retag.png`. Pass when new AI tags land on the target.
- [ ] Lane 6. Search for the old sibling name. Save `m02-search.png`. Pass when results come from the target.
- [ ] Lane 7. Chain two implications. Save `m02-chain.png`. Pass when both implied tags are added.
- [ ] Lane 8. Search settings for `implication`. Save `m02-settings.png`. Pass when the relations row appears.
- [ ] Lane 9. Repeat lane 1 with `ui_style` set to `glass`. Save `m02-glass.png`. Pass when the same result shows with no clipped text and no overlapping controls.
- [ ] Lane 10. Repeat lane 1 at 390px wide. Save `m02-phone.png`. Pass when nothing scrolls sideways and every control stays reachable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time to apply one implication to 5,000 items.
- [ ] Probe. Five runs at head. Trunk lacks the feature, so measure bulk tag add of 5,000 items at both as a control.
- [ ] Baseline. Record the trunk control first.
- [ ] Rule. Fail if one implication takes over 2 s, or the head control is more than 10% slower than trunk.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 and lane 2 screenshots into `docs/plans/media/m02-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane worktree. Save it as `docs/plans/media/m02-review.mp4`.
- [ ] Post the screenshots and the video to the operator in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends M02 to the phase 4 stack and the operator lands that stack bottom-up.

## Share one model session lifecycle (ML01)

**Depends on.** None. ML01 is the root of phase 5 and branches from `master` after phase 4 lands.

**Files.**

- [ ] Create `apps/server/src/lib/modelSession.ts`.
- [ ] Edit `apps/server/src/services/tagger.ts` at lines 29 to 71.
- [ ] Edit `apps/server/src/tagger.test.ts`.

**Build.**

- [ ] Move load sharing, the idle release timer, the in-flight count and `trimNativeHeap` into `createModelSession(path, options)`. The tagger calls it and behaves as before.

**You see.**

- [ ] Tagging still frees the model 60 s after the last item, shown by RSS dropping in the server log.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/server/src/tagger.test.ts` keeps its cases and gains "two sessions from one module load and release independently". Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/tagger.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Tag 200 synthetic images at trunk and head and read the tag sets. Save `ml01-regression.png`. Pass when both produce identical tag sets.
- [ ] Lane 2. Wait 70 s after tagging. Save `ml01-release.png`. Pass when RSS falls by at least 500 MB.
- [ ] Lane 3. Start two tag jobs at once. Save `ml01-concurrent.png`. Pass when one session loads and RSS never doubles.
- [ ] Lane 4. Switch models during idle. Save `ml01-switch.png`. Pass when the old session is released.
- [ ] Lane 5. Corrupt the model file and tag. Save `ml01-bad-model.png`. Pass when the job errors and the next run with a good file works.
- [ ] Lane 6. Tag one item every 30 s for 5 minutes. Save `ml01-trickle.png`. Pass when the session is not reloaded between items.
- [ ] Lane 7. Run on a host without glibc trim available. Save `ml01-no-trim.png`. Pass when release still runs without error.
- [ ] Lane 8. Stop the server mid-tag. Save `ml01-shutdown.png`. Pass when it exits within 5 s.
- [ ] Lane 9. Read `/api/tagger/status` during tagging. Save `ml01-status.png`. Pass when it reports ready.
- [ ] Lane 10. Tag a video. Save `ml01-video.png`. Pass when it tags from the thumbnail as before.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Tag job items per second and peak RSS on 2,000 synthetic images.
- [ ] Probe. Three runs each at trunk and head, interleaved.
- [ ] Baseline. Record trunk items per second and peak RSS first.
- [ ] Rule. Fail if head is more than 2% slower or uses more than 30 MB more peak RSS.

**Review gate.** None. ML01 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends ML01 to the phase 5 stack and the operator lands that stack bottom-up.

## Tag videos from several frames (V01)

**Depends on.** ML01 in the phase 5 stack.

**Files.**

- [ ] Edit `apps/server/src/services/tagger.ts` in `tagOneMedia`.
- [ ] Edit `apps/server/src/services/thumbnailer.ts` to extract frames at 10, 30, 50, 70 and 90 percent.
- [ ] Edit `apps/server/src/tagger.test.ts`.

**Build.**

- [ ] For videos, tag five frames and keep each tag at its highest confidence. Frames go to a temp folder and are removed after.

**You see.**

- [ ] A synthetic video whose second half is a different scene gains tags from both halves.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/server/src/tagger.test.ts` gains "max confidence across frames wins" with literal frame scores. Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/tagger.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Tag a two-scene synthetic video at trunk and head. Save `v01-regression.png`. Pass when trunk has tags from one scene and head from both.
- [ ] Lane 2. Tag a 2 s video. Save `v01-short.png`. Pass when it tags without error.
- [ ] Lane 3. Tag a video FFmpeg cannot seek. Save `v01-unseekable.png`. Pass when it falls back to the thumbnail frame.
- [ ] Lane 4. Check the temp folder after tagging 20 videos. Save `v01-cleanup.png`. Pass when no frame files remain.
- [ ] Lane 5. Tag an image. Save `v01-image.png`. Pass when tags match trunk.
- [ ] Lane 6. Tag a GIF classified as video. Save `v01-gif.png`. Pass when it tags from frames.
- [ ] Lane 7. Re-tag a video with a veto. Save `v01-veto.png`. Pass when the vetoed tag stays gone.
- [ ] Lane 8. Tag with transcoding on. Save `v01-transcode.png`. Pass when frames come from the original.
- [ ] Lane 9. Stop the server mid-video. Save `v01-stop.png`. Pass when no frame files remain after restart.
- [ ] Lane 10. Tag 50 videos in a job. Save `v01-job.png`. Pass when the job ends `done` with 50 tagged.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Video tag time per item on 50 synthetic 30 s videos.
- [ ] Probe. Two runs each at trunk and head, interleaved.
- [ ] Baseline. Record trunk seconds per video first.
- [ ] Rule. Fail if head exceeds 6 times trunk per video, or 4 s per video.

**Review gate.** None. V01 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends V01 to the phase 5 stack and the operator lands that stack bottom-up.

## Detect characters and embed them (ML02)

**Depends on.** V01 in the phase 5 stack, ML01 for sessions and T02 for the character threshold.

**Files.**

- [ ] Create `apps/server/src/services/characters.ts`.
- [ ] Create `apps/server/src/lib/vectors.ts` for float16 packing and brute-force cosine search.
- [ ] Edit `apps/server/src/db/index.ts` to add migrations for `character_detections` and `characters`.
- [ ] Edit `packages/shared/src/index.ts` to add a `characters` job type and the `character` media tag source.
- [ ] Edit `apps/server/src/lib/config.ts` to register the detector and CCIP models.
- [ ] Create `apps/server/src/characters.test.ts`.

**Build.**

- [ ] Detect characters with an anime person detector, crop each box, and embed it with CCIP into a 768-value vector stored as float16.
- [ ] Assign each detection to the nearest named character under the model's published threshold, else to an unnamed cluster.
- [ ] Seed named characters from images tagged `solo` with exactly one character tag. Assigned detections write `media_tags` rows with `source` `character`.

**You see.**

- [ ] After the job, `/api/characters` lists seeded characters with counts and some unnamed clusters.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/server/src/characters.test.ts` gains "float16 round trip within 1e-3", "nearest neighbour picks the closer centroid" and "retag keeps `character` links". Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/characters.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no character job, so record that, then at head run it on 300 public-domain test illustrations. Save `ml02-regression.png`. Pass when the job ends `done` and every image has a detection row or a logged no-detection.
- [ ] Lane 2. Seed from `solo` images. Save `ml02-seed.png`. Pass when each single-character tag with 3 or more solo images becomes a named character.
- [ ] Lane 3. Run on a group image of two seeded characters. Save `ml02-group.png`. Pass when both are assigned.
- [ ] Lane 4. Re-run the job. Save `ml02-idempotent.png`. Pass when detection count is unchanged.
- [ ] Lane 5. Delete a media item. Save `ml02-delete.png`. Pass when its detections are removed.
- [ ] Lane 6. Run with the models absent. Save `ml02-absent.png`. Pass when the job ends `error` naming the download step.
- [ ] Lane 7. Run on a landscape with no characters. Save `ml02-empty.png`. Pass when no detection is written.
- [ ] Lane 8. Wait 70 s after the job. Save `ml02-release.png`. Pass when both model sessions are released.
- [ ] Lane 9. Run during a tag job. Save `ml02-concurrent.png`. Pass when both finish and peak RSS stays under the configured memory limit.
- [ ] Lane 10. Filter Explore by a character tag. Save `ml02-filter.png`. Pass when items assigned only by CCIP appear.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Character job items per second and peak RSS on 1,000 synthetic illustrations.
- [ ] Probe. Two runs at head. Trunk lacks the job, so run the tag job at both as a control.
- [ ] Baseline. Record the trunk tag job items per second first.
- [ ] Rule. Fail if the character job is under 2 items per second on 2 cores, peak RSS exceeds 1.5 GB, or the control is more than 5% slower than trunk.

**Review gate.** None. ML02 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends ML02 to the phase 5 stack and the operator lands that stack bottom-up.

## Add the Characters tab (ML03)

**Depends on.** ML02 in the phase 5 stack, and T03 for names.

**Files.**

- [ ] Create `apps/web/src/routes/Characters.tsx` and `apps/web/src/routes/Character.tsx`.
- [ ] Edit `apps/server/src/routes/characters.ts` for list, name, merge, reject and cover.
- [ ] Edit `apps/web/src/components/MediaViewer.tsx` for box overlays.
- [ ] Edit `apps/web/src/components/Navbar.tsx` with a monochrome icon.
- [ ] Edit `apps/server/src/characters.test.ts`.

**Build.**

- [ ] List characters in three groups, named, suggested and unnamed. Naming an unnamed cluster creates a character-category tag.
- [ ] A suggestion reads `Is this <display name>?` when most of a cluster carries one WD character tag, with a one-click confirm.
- [ ] The character page supports merge, not this character per face, set cover and hide. The viewer draws boxes with names and lets you assign a box.

**You see.**

- [ ] Naming a cluster `Mira` creates the tag, and Explore filtered by `Mira` shows those items.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/server/src/characters.test.ts` gains "naming creates a character tag", "merge moves detections" and "reject keeps the detection off that character after a re-run". Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/characters.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no Characters tab, so record that, then at head open it after ML02 ran. Save `ml03-regression.png`. Pass when named, suggested and unnamed groups each show cards with cover crops.
- [ ] Lane 2. Name an unnamed cluster. Save `ml03-name.png`. Pass when it moves to named and the tag exists.
- [ ] Lane 3. Confirm a suggestion. Save `ml03-confirm.png`. Pass when it becomes named under the WD tag display name.
- [ ] Lane 4. Merge two characters. Save `ml03-merge.png`. Pass when one remains with the combined count.
- [ ] Lane 5. Mark a face as not this character. Save `ml03-reject.png`. Pass when it leaves the character and stays out after a re-run.
- [ ] Lane 6. Open the viewer on a group image. Save `ml03-overlay.png`. Pass when boxes show names and clicking one opens the character.
- [ ] Lane 7. Set a cover. Save `ml03-cover.png`. Pass when the card shows the chosen crop.
- [ ] Lane 8. Hide a character. Save `ml03-hide.png`. Pass when it leaves the list and its tag stays.
- [ ] Lane 9. Repeat lane 1 with `ui_style` set to `glass`. Save `ml03-glass.png`. Pass when the same result shows with no clipped text and no overlapping controls.
- [ ] Lane 10. Repeat lane 1 at 390px wide. Save `ml03-phone.png`. Pass when nothing scrolls sideways and every control stays reachable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Characters tab first paint with 500 characters.
- [ ] Probe. 20 loads at head. Trunk lacks the tab, so measure the dashboard first paint at both as a control.
- [ ] Baseline. Record the trunk dashboard p95 first.
- [ ] Rule. Fail if the tab p95 exceeds 700 ms, or the head dashboard is more than 10% slower than trunk.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 and lane 2 screenshots into `docs/plans/media/ml03-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane worktree. Save it as `docs/plans/media/ml03-review.mp4`.
- [ ] Post the screenshots and the video to the operator in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends ML03 to the phase 5 stack and the operator lands that stack bottom-up.

## Search by description with image embeddings (ML04)

**Depends on.** ML03 in the phase 5 stack, and ML02 for `vectors.ts`.

**Files.**

- [ ] Create `apps/server/src/services/semantic.ts`.
- [ ] Edit `apps/server/src/db/index.ts` to add a migration for `media_embeddings`.
- [ ] Edit `apps/server/src/routes/media.ts` to accept `q` in semantic mode.
- [ ] Edit `apps/web/src/components/FilterToolbar.tsx` for a semantic toggle.
- [ ] Create `apps/server/src/semantic.test.ts`.

**Build.**

- [ ] Embed images with a SigLIP-class ONNX image encoder in an `embed` job, embed queries with its text encoder, and rank by cosine using `vectors.ts`.
- [ ] Add a Describe toggle in the Explore search box.

**You see.**

- [ ] Searching `red umbrella in the rain` ranks synthetic images with those shapes and colors first.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/server/src/semantic.test.ts` gains "query ranking follows cosine order" with literal fixture vectors. Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/semantic.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Search `red umbrella` at trunk and head in Describe mode. Save `ml04-regression.png`. Pass when trunk falls back to tag search and head ranks the red-umbrella fixtures first.
- [ ] Lane 2. Search with Describe off. Save `ml04-off.png`. Pass when results match trunk.
- [ ] Lane 3. Search before the embed job ran. Save `ml04-not-ready.png`. Pass when a message offers to run it.
- [ ] Lane 4. Combine Describe with a tag filter. Save `ml04-combined.png`. Pass when only filtered items rank.
- [ ] Lane 5. Search an empty string. Save `ml04-empty.png`. Pass when the normal grid shows.
- [ ] Lane 6. Search in Japanese text. Save `ml04-cjk.png`. Pass when the call returns ranked results without error.
- [ ] Lane 7. Run the embed job twice. Save `ml04-idempotent.png`. Pass when the embedding count is unchanged.
- [ ] Lane 8. Wait 70 s after a search. Save `ml04-release.png`. Pass when the text model is released.
- [ ] Lane 9. Repeat lane 1 with `ui_style` set to `glass`. Save `ml04-glass.png`. Pass when the same result shows with no clipped text and no overlapping controls.
- [ ] Lane 10. Repeat lane 1 at 390px wide. Save `ml04-phone.png`. Pass when nothing scrolls sideways and every control stays reachable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Describe search latency on 30k synthetic embeddings.
- [ ] Probe. 50 queries at head. Trunk lacks the mode, so measure tag search at both as a control.
- [ ] Baseline. Record the trunk tag search p95 first.
- [ ] Rule. Fail if warm Describe p95 exceeds 400 ms, or head tag search is more than 10% slower than trunk.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 and lane 2 screenshots into `docs/plans/media/ml04-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane worktree. Save it as `docs/plans/media/ml04-review.mp4`.
- [ ] Post the screenshots and the video to the operator in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends ML04 to the phase 5 stack and the operator lands that stack bottom-up.

## Scrub videos on hover (V02)

**Depends on.** ML04 in the phase 5 stack.

**Files.**

- [ ] Edit `apps/server/src/services/thumbnailer.ts` to write a 10-frame sprite per video.
- [ ] Edit `apps/server/src/routes/media.ts` to serve `/api/media/:id/sprite`.
- [ ] Edit `apps/web/src/components/MediaCard.tsx`.
- [ ] Edit `apps/server/src/transcode.test.ts`.

**Build.**

- [ ] Generate a 10-frame horizontal sprite with FFmpeg after the thumbnail, and on card hover map the pointer x to a frame.

**You see.**

- [ ] Moving the pointer across a video card steps through ten frames.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `apps/server/src/transcode.test.ts` gains "a sprite is ten frames wide" checking the sprite width. Run `flock /tmp/sakuya-test.lock bun test --isolate apps/server/src/transcode.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Hover a video card at trunk and head. Save `v02-regression.png`. Pass when trunk shows a still and head steps through frames.
- [ ] Lane 2. Hover before the sprite exists. Save `v02-pending.png`. Pass when the still shows with no broken image.
- [ ] Lane 3. Hover an image card. Save `v02-image.png`. Pass when nothing changes.
- [ ] Lane 4. Regenerate thumbnails. Save `v02-regen.png`. Pass when sprites are rebuilt.
- [ ] Lane 5. Delete a video. Save `v02-delete.png`. Pass when its sprite file is removed.
- [ ] Lane 6. Turn the thumbnail cache off. Save `v02-cache-off.png`. Pass when hover falls back to the still.
- [ ] Lane 7. Touch a card on a phone. Save `v02-touch.png`. Pass when a tap opens the viewer as before.
- [ ] Lane 8. Scroll a grid of 200 videos. Save `v02-scroll.png`. Pass when no sprite loads until hover.
- [ ] Lane 9. Repeat lane 1 with `ui_style` set to `glass`. Save `v02-glass.png`. Pass when the same result shows with no clipped text and no overlapping controls.
- [ ] Lane 10. Repeat lane 1 at 390px wide. Save `v02-phone.png`. Pass when nothing scrolls sideways and every control stays reachable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Thumbnail job time per video, and grid scroll frame time.
- [ ] Probe. Thumbnail 100 synthetic videos at trunk and head, interleaved, then record a 10 s scroll trace at both.
- [ ] Baseline. Record trunk seconds per video and p95 frame time first.
- [ ] Rule. Fail if head adds more than 0.5 s per video or p95 frame time rises above 16.7 ms.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1 and lane 2 screenshots into `docs/plans/media/v02-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane worktree. Save it as `docs/plans/media/v02-review.mp4`.
- [ ] Post the screenshots and the video to the operator in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `master` after the verdict, patch-id unchanged.
- [ ] The root appends V02 to the phase 5 stack and the operator lands that stack bottom-up.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the autopilot-stack report, links to each phase stack root and tip, a one-line verdict per PR, and anything parked with the reason.

## Appendix A. Prototype evidence

The settings mockup is `docs/plans/mockups/settings-mockup.html`. Its search logic was exercised with node, where `thumb` returned five rows, `gif` two, `volume` one, `zzz` none and `video hevc` two, and a breadcrumb jump flashed the target row. It settles the S01 and S02 layout and search behavior. No branch or SHA exists because it is a throwaway file.

The Discover mockup is `docs/plans/mockups/discover-mockup.html`. Node runs showed four shelves, muting the top tag swapped the first shelf, hiding a card dropped the tile count from 24 to 23, and Undo restored it. It settles the R03 and R04 layout.

Both mockups were shown inline in chat. The T3 preview browser could not start on this host, so neither was screenshotted in a browser here.

These stay unproven until their PR runs. CCIP accuracy on this library, which ML02 lane 2 and lane 3 measure. electron-updater on an AppImage end to end, which D02 lane 2 proves. NSIS differential updates through blockmaps on Windows, which D02 lane 3 proves.

## Appendix B. Alternatives rejected

These defaults were chosen without the operator. Each needs a yes before its PR starts.

- Mute in Discover hides items fully. Down-ranking only was rejected because "mute" reads as gone. Less of X covers soft down-ranking.
- Discover keeps the infinite grid below the shelves. A shelves-only page was rejected because the grid is the long-scroll view people already use.
- Uploads and Duplicates leave Settings. A Tools group in the settings sidebar was the alternative, and it keeps non-settings inside Settings.
- Danger actions stay inline in red. A Danger zone group per section was the alternative and adds a group to most sections for one or two rows.
- A named character cluster becomes a character-category tag. An Immich-style person entity was rejected because tags already drive search, filters and Discover.
- Desktop updates default to automatic download and install on quit, with a Restart to update prompt. Notify-only was the alternative and stays one setting away.
- No Windows code signing. The SmartScreen warning stays on first install. Azure Trusted Signing is the cheapest way to remove it later.
- macOS is out of scope. Squirrel.Mac only applies updates to a signed app, which needs an Apple developer account.
- InsightFace from Immich was rejected for ML02. It is built for photographs of real people, and CCIP is trained to tell anime characters apart.
- sqlite-vec was rejected for now. Brute-force cosine over float16 vectors is about 77 MB at 50k detections and needs no native extension.

## Appendix C. Risks

- The live database and its backup folder hold real data that must never be used for tests or benchmarks. Every PR uses synthetic fixtures. The boot recipe enforces this and the audit lane checks lane logs for the live path.
- There is no `control-ui` skill and no cloud VM here. Lanes run locally in worktrees on unique ports, driven by Playwright. Port clashes are the watch item, so each lane offsets its ports by its number and every test run holds `/tmp/sakuya-test.lock`.
- The T3 preview browser lacks system libraries on this host. Screenshots come from a headless Chrome shell with its libraries in a local folder, per the dev-environment notes. `/tmp` may be wiped on reboot, so the owner of the first web PR rebuilds that setup and records where it lives.
- The checker wants lanes on `grok-4.6-fast-xhigh`. This environment serves Claude models, so lanes run on whatever `/setup-pstack` configures, and the parent model if nothing is configured.
- This host is Linux only. D02 lane 3 and every other Windows lane run on a Windows machine the operator provides, or on a `windows-latest` GitHub Actions runner through `workflow_dispatch`. A lane with neither stays unchecked and blocks merge.
- D02 and D03 touch the update path. A bad release could strand desktop users on a broken version. D02 lane 6 and lane 7 cover a bad hash and an offline feed, and the P01 backup runs before every install.
- ML02 adds two models and hundreds of MB while it runs. ML01 releases sessions when idle, and ML02 lane 9 checks peak memory against the configured limit.
- R01 changes ranking for everyone. The literal-order tests in `apps/server/src/discover.test.ts` make the change reviewable, and lane 5 guards pagination.
- P02 changes delete from permanent to recoverable. Disk usage grows for 30 days. The Storage section shows the trash size and Empty trash.
- The operator approves UI screenshots before any commit or push. Every review-gated PR stops for that.

## Appendix D. Links and reading list

- [deepghs/ccip_onnx on Hugging Face](https://huggingface.co/deepghs/ccip_onnx/tree/main/ccip-v2-caformer_s36-10) for ML02 model files and thresholds.
- [imgutils CCIP docs](https://deepghs.github.io/imgutils/main/api_doc/metrics/ccip.html) for the 768-value features and the per-model threshold warning.
- [Immich facial recognition docs](https://docs.immich.app/features/facial-recognition) for the incremental DBSCAN-style clustering ML02 borrows.
- `docs/SETUP.md` and `docs/API.md` in this repo before any server PR.
- `~/.claude/skills/how/SKILL.md` before ML01, ML02 and D02. `~/.claude/skills/interrogate/SKILL.md` before R01 and ML02, whose designs are contested.
- Each owner keeps a `decisions.tsv` trail per `~/.claude/skills/show-me-your-work/SKILL.md`, uncommitted, returned with its report.
