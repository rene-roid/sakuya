# Tagging videos from several frames

A video used to be tagged from its thumbnail, one frame 30% of the way in. Now the tagger scores
**5 frames** spread evenly across the video and keeps each tag at its **highest confidence in any
frame**; the per-category thresholds, vetoes, siblings and implications then apply exactly as for
an image.

- Frames sit in the middle of equal slices of the video, skipping the first and last second (black
  intros, title cards and fade-outs). A video shorter than 3 s is sampled across its whole length,
  with frames at least 0.5 s apart, so a 2 s clip gets 4 frames and a 0.4 s one gets 1.
- A video with no known duration (ffprobe could not read it), or whose frames ffmpeg cannot
  extract, falls back to the thumbnail frame as before.
- Frames are extracted one at a time with one ffmpeg thread, as PNGs no wider or taller than 640 px,
  into `<data dir>/video-frames/`. Each video's folder is removed when it is done, and the whole
  folder is cleared at boot in case the server died mid-video.
- Nothing new is stored.

Measured with `bun apps/server/src/scripts/videoTagEval.ts` over the nine fixture videos (pan and
zoom slideshows of Pepper&Carrot pages and stock photos, plus an ffmpeg test pattern), with the
default thresholds (general 0.35, character 0.85) and `limits.cpus` 2.

## Tags per video

Each cell is the number of general and character tags (the rating is left out), with how many are
new and how many are lost compared with the single thumbnail frame. "max" keeps every tag at its
highest confidence across frames. "two-frame" also requires a general tag to clear the threshold in
at least two frames.

| Video                        | Length | 1 frame | 3 max         | 3 two-frame   | 5 max         | 5 two-frame  | 8 max         | 8 two-frame   |
| ---------------------------- | ------ | ------- | ------------- | ------------- | ------------- | ------------ | ------------- | ------------- |
| photos-square-600.mp4        | 8 s    | 14      | 30 (+16 / -0) | 5 (+3 / -12)  | 33 (+20 / -1) | 6 (+4 / -12) | 41 (+28 / -1) | 18 (+5 / -1)  |
| pepper-portrait-720x1280.mp4 | 20 s   | 11      | 39 (+28 / -0) | 13 (+6 / -4)  | 54 (+43 / -0) | 18 (+9 / -2) | 51 (+40 / -0) | 27 (+16 / -0) |
| pepper-long-540p.mp4         | 40 s   | 7       | 36 (+33 / -4) | 8 (+5 / -4)   | 51 (+45 / -1) | 11 (+8 / -4) | 63 (+57 / -1) | 21 (+18 / -4) |
| photos-short-240p.mp4        | 5 s    | 6       | 25 (+21 / -2) | 2 (+0 / -4)   | 27 (+23 / -2) | 13 (+9 / -2) | 28 (+23 / -1) | 22 (+18 / -2) |
| pepper-pan-720p.mp4          | 24 s   | 7       | 33 (+29 / -3) | 10 (+10 / -7) | 31 (+26 / -2) | 10 (+7 / -4) | 71 (+65 / -1) | 21 (+16 / -2) |
| photos-zoom-1080p.mp4        | 30 s   | 12      | 22 (+15 / -5) | 11 (+4 / -5)  | 31 (+20 / -1) | 17 (+7 / -2) | 31 (+20 / -1) | 18 (+7 / -1)  |
| photos-mix-480p.webm         | 15 s   | 7       | 33 (+26 / -0) | 5 (+1 / -3)   | 41 (+35 / -1) | 6 (+2 / -3)  | 43 (+37 / -1) | 28 (+22 / -1) |
| pepper-mix-576p.mkv          | 12 s   | 13      | 28 (+21 / -6) | 13 (+7 / -7)  | 38 (+25 / -0) | 10 (+3 / -6) | 48 (+36 / -1) | 25 (+13 / -1) |
| testsrc-360p.mp4             | 12 s   | 6       | 9 (+4 / -1)   | 6 (+2 / -2)   | 8 (+3 / -1)   | 7 (+3 / -2)  | 10 (+5 / -1)  | 9 (+4 / -1)   |

Totals over the nine videos (83 tags from the thumbnail frame):

| Frames | max              | two-frame        |
| ------ | ---------------- | ---------------- |
| 3      | 255 (+193 / -21) | 73 (+38 / -48)   |
| 5      | 314 (+240 / -9)  | 98 (+52 / -37)   |
| 8      | 386 (+311 / -8)  | 189 (+119 / -13) |

## Are the extra tags right?

Checked by looking at the five sampled frames of three videos next to the tags each frame produced.

- **pepper-pan-720p** (five comic pages panned in turn). Of the 26 new tags, about 16 are clearly
  right and come from scenes the thumbnail never showed: `cauldron`, `broom`, `witch_hat`, `fire`
  (the witch's kitchen), `tree`, `scenery` (the house page), `bottle`, `stairs` (the potion shelf),
  `simple_background`, `negative_space` (a frame that landed on a page's white margin). About 7 are
  wrong (`crown`, `torn_clothes`, `fairy`, `1boy`, `multiple_girls`, `monochrome`,
  `transparent_background`), and three are unclear.
- **photos-mix-480p** (desk, shoes, a man walking, forks, a book). The 35 new tags are nearly all
  right: `1boy`, `suit`, `walking`, `road`, `black_pants` for the street photo; `book`,
  `open_book` for the last one; `pencil`, `notebook`, `cellphone` for the desk. Wrong: `1girl` on
  the forks, and arguably `locker`.
- **pepper-long-540p** (ten comic pages). New tags such as `fairy`, `wings`, `wand` (the fairy
  cave), `goggles`, `brown_hair` (Pepper's first panel), `old_man`, `facial_hair`, `speech_bubble`,
  `potion` all match a sampled frame.

The tags the single frame had and max-combine loses are mostly the thumbnail's own noise, since the
30% frame is not one of the samples: `pokemon_(creature)` on two photo videos, `red_background` on
the test pattern; plus `rain`, `glasses`, `sparkle`.

**The two-frame rule was rejected.** In a video whose scenes change, most real content is visible in
only one sampled frame, so the rule removes the very tags multi-frame sampling is for (`tree`,
`bottle`, `stairs`, `broom` above) and ends up with fewer tags than the single frame on six of the
nine videos (`photos-square-600` drops from 14 to 6, losing the whole close-up of feet that the
thumbnail showed). A softer variant, letting a one-frame tag through only at 0.5 or higher, would
have dropped six of the seven wrong tags on pepper-pan but also most of the correct sub-0.5 tags on
the photo and comic videos (`standing`, `notebook`, `cellphone`, `jacket`, `speech_bubble`,
`old_man`), so it was not adopted either.

## Frame count and time

Seconds per video, two interleaved runs, on the 4-core development machine with `limits.cpus` 2.
Other jobs were running on the machine, so the first three videos (system load 8 to 11) are slow
and noisy; the last three ran at load about 4. "1 frame" is the old path: one inference on the
existing thumbnail. The multi-frame columns include extracting the frames, shown in brackets.

| Video                               | 1 frame     | 3 frames          | 5 frames          | 8 frames                    |
| ----------------------------------- | ----------- | ----------------- | ----------------- | --------------------------- |
| photos-square-600 (load ~10)        | 15.7 / 13.1 | 43.2 / 44.2 (1.1) | 67.8 / 78.1 (2.1) | 88.3 / 100.8 (2.9)          |
| pepper-portrait-720x1280 (load ~11) | 12.7 / 11.5 | 28.6 / 39.3 (1.5) | 43.1 / 70.2 (2.5) | 102.0 / 94.5 (4.0)          |
| pepper-long-540p (load ~8)          | 10.3 / 8.0  | 39.4 / 28.6 (1.2) | 43.6 / 48.9 (2.3) | 121.0 / 61.0 (3.2)          |
| photos-short-240p (load ~5)         | 6.4 / 6.0   | 21.5 / 14.3 (0.5) | 35.8 / 21.5 (1.0) | 35.7 / 22.6 (0.8, 6 frames) |
| pepper-pan-720p (load ~4)           | 3.6 / 3.7   | 12.2 / 13.1 (0.5) | 20.3 / 23.1 (0.7) | 34.5 / 34.6 (1.2)           |
| photos-zoom-1080p (load ~4)         | 3.7 / 4.5   | 14.9 / 13.0 (0.9) | 26.2 / 26.4 (2.2) | 44.5 / 35.8 (3.8)           |

The cost is the model, not ffmpeg: about 3.6 to 4.5 s per inference at load 4, so five frames take
5.5 to 6.5 times the single frame (20 to 26 s against 3.6 to 4.5 s), of which extraction is 0.7 s
for 720p and 2.2 s for 1080p. The roadmap's perf rule (at most 6 times the old time and 4 s per
video) cannot hold on this machine: the old single-frame path alone is 3.6 s here. A tag job over a
video library will take about 5.5 times as long as before.

**Five frames.** Three frames find 193 new tags and lose 21 of the thumbnail's; five find 240 and
lose 9. Eight frames find 311 (+30% over five, most of it on the 24 to 40 s slideshows, where five
frames still skip some pages) for about 70% more time. Five is the plan's number and where the
tags gained per second spent starts to fall off; it is `VIDEO_TAG_FRAMES` in
`apps/server/src/services/tagger.ts`.
