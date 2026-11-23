# What the roadmap branch could not do on this machine

This lists everything from [the roadmap plan](plans/sakuya-roadmap-plan.md) that was skipped, could not be proven here, or still has a known gap. The branch was built and tested on one Linux machine (Intel N95, 4 cores, about 6 GB free memory, no display, no Windows, no Mac), with only safe test images and videos (see [Test data](#test-data)).

## Needs a machine this one is not

| What | Why it was not done | How to do it |
|---|---|---|
| Windows installer update (NSIS, differential download through `.blockmap`) | No Windows machine | Install the previous release on Windows, publish a newer `v*` tag, start the app and wait for the update toast. Check that only part of the installer downloads. |
| A real update from GitHub Releases | Only a local `generic` update feed was used | Tag a pre-release, let CI attach the installers and `latest*.yml`, then run the previous AppImage and `.exe`. |
| The tray menu items (update item, "Update Automatically") | Xvfb has no system tray | Open the tray menu on a desktop session. |
| AppImage through FUSE | No `libfuse2` here, so tests ran with `--appimage-extract-and-run` | Run the AppImage normally on a desktop with FUSE. |
| macOS build and updates | No Mac, and the user does not want a macOS build | Not planned. Squirrel.Mac also needs a signed app. |
| Windows code signing | The user cannot pay for a certificate now | Azure Trusted Signing is the cheapest option later. Until then Windows shows a SmartScreen warning on first install. |
| A real phone | Touch was emulated in headless Chrome at 390 px | Open the web UI on a phone and check video cards, the Characters page, Discover shelves and Settings. |

## Plan verification steps that were replaced

The plan asks for ten live test lanes per PR on cloud VMs, a 30 to 60 second review video per PR, and copies of review screenshots in `docs/plans/media/`. None of that tooling exists here. Instead each change has behavior tests through the HTTP API, a walk-through on a seeded demo instance with screenshots, and the perf numbers below. No review videos were recorded.

## Performance targets that were not met or not measured

| PR | Target in the plan | What was measured |
|---|---|---|
| ML02 character detection | 2 files per second | 0.07 files per second on this CPU while other work ran. The detector takes about 1 s per image and CCIP about 2.6 s per crop. Detection is off by default for this reason. |
| V02 video sprites | under 0.5 s added per video | 0.47 to 5 s per video, in its own background job, so scans are not slower. "Regenerate thumbnails" takes longer. |
| P02 trash | delete-batch within 1.5x of trunk | 85 to 380 ms for 500 items against 37 to 148 ms. Under the 3 s limit, sometimes over 1.5x. |
| R01 Discover | first page p50 | p50 rose about 35 ms under heavy load; p95 and profile rebuild improved. Not separable from load noise here. |
| D02 desktop | cold start against trunk | Not measured. |
| P01 backups | request latency during a backup against trunk | Only the head side was measured. |
| V02 | 100-video run and scroll frame-time trace | Not run. |
| ML03 Characters | first paint with 500 characters | Not measured. |
| ML04 describe search | p95 under 400 ms on 30k vectors | 82 to 89 ms at normal load, 862 ms while other builds ran. The first search after the model unloads adds about 1.2 s. |
| V01 multi-frame video tagging | at most 6x the single-frame time and 4 s per video | A video whose scenes change costs 5 model runs: 20 to 26 s against 3.6 to 4.5 s for one frame at load 4 (5.5 to 6.5x). The old single-frame path alone is already 3.6 s here. A still video costs one run (frames that look alike are skipped), but a slow pan over one photo still costs five. A tag job over a video library takes about 5.5 times as long as before. `VIDEO_TAG_FRAMES` in `apps/server/src/services/tagger.ts` is the lever; it is not a setting. See [video-tagging.md](video-tagging.md). |

## Quality that the safe test data cannot show

- **Character tag threshold (T02).** The WD tagger has no labels for the Pepper&Carrot characters, so no correct character prediction exists in the test data and character recall cannot be measured. The default stays at 85%.
- **Character name suggestions (ML02).** Suggestions come from WD character tags on `solo` images. The test data has none, so suggestions are covered by tests only.
- **Character clustering (ML02).** Pepper, Saffron and Coriander cluster cleanly. The three mentors share one cluster, and Carrot shares one with other animals. This looks like a limit of CCIP on painterly and non-human figures.
- **Search by description (ML04).** CLIP ViT-B/32 int8 got 5/5 for "a cat" and "the sea", 4/5 for "a dragon" and "a forest path", but 1/5 to 2/5 for "a book", "a city at night" and "a witch flying on a broom" (the right picture is first). The int8 export drifts a little from fp32 (image cosine 0.93). No Python was available to compare embeddings against the reference implementation, so preprocessing was checked by matching the fp16 export to fp32 (cosine 1.0000 on all fixtures).
- **Character suggestions in the demo (ML03).** To show a suggestion on screen, AI `solo` and character tags were written straight into the throwaway demo database, because the tagger does not know these characters.
- **Multi-frame video tags (V01).** On one five-page comic video about 16 of the 26 new tags were right, about 7 wrong (`crown`, `fairy`, `1boy` and others) and 3 unclear, and one `sensitive`-looking frame rates the whole video `sensitive`. Rules that would drop one-frame tags removed more correct tags than wrong ones, so none was adopted. Checked by eye on three of the nine fixture videos only.
- **Discover "Off the beaten path" shelf (R04).** It never appears on a 163-item library. It is covered by tests and the eval script.

## Known gaps and edge cases

- Creating an implication for a tag that does not exist yet creates it as a general tag, and naming a character with that name is then refused (409). Naming the character first and then adding "Implies..." from its tag menu works.
- Removing a tag merge leaves the links that were already moved on the target tag.
- The AI tagger still rewrites an item's search-index row once per tag. Doing it once per item, as the sidecar import does, would speed up tagging.
- A trashed and restored item loses its character detections. The character job finds them again on its next run.
- Deleting a whole library deletes its uploads permanently, since nothing could be restored without the library.
- While a modal is open (style picker, What's new), the update toast's Restart button cannot be clicked until the modal closes.
- An AppImage with the version in its file name is renamed on update, so a hand-made desktop shortcut to the old file breaks. The autostart entry is re-pointed.
- If ffprobe reports a longer duration than a video really has, the last frames of a short clip's sprite are black.
- On phones the Explore sidebar's rename pencil needs hover, so rename from the viewer's tag menu instead.
- The Discover folder cap cannot hold on a library with fewer than 5 folders.
- A database whose characters already point at a tag that was merged away before the review fixes is not repaired. The fix only stops new cases; renaming the character onto the merge target repairs one by hand.
- No test covers restoring a gallery-dl sidecar when its file comes back under a "(restored)" name.
- Folders that a removed download's files came from are kept even when empty, so a restore from the trash still has a folder to go back to.
- After a failed desktop update install, the code that restarts the server in `desktop/main.js` passed a syntax check but never ran under Electron; only `desktop/updates.js` is under test.
- No live gallery-dl run (gallery-dl is not installed here). A fake gallery-dl in the tests writes the sidecar.

## Test data

Only safe content was used. Nothing from the live database (`apps/server/data/`) or its backups was read.

- 102 Pepper&Carrot comic pages by David Revoy (CC-BY 4.0, peppercarrot.com).
- 61 Lorem Picsum stock photos (picsum.photos).
- 9 short videos made locally with ffmpeg as pan/zoom slideshows over those images, plus one `testsrc2` clip.

The fixtures and the tools used to test (a seeded demo instance script and a headless screenshot tool) live outside the repo in `/mnt/data/apps/sakuya-tools/`.
