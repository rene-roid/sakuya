# Discover tuning

The ranking and variety knobs in `discoverTuning` (`apps/server/src/routes/discover.ts`) were
picked from the numbers below. Re-run them after changing the ranking:

```sh
bun apps/server/scripts/discover-eval.ts metrics --items 8000 --seeds 3
```

The script builds synthetic libraries (`apps/server/scripts/discover-synth.ts`) whose taste is
known: 40 themes, each with a signature tag on 40% of its items and eight motif tags drawn from a
shared pool, power-law background tags, a few tags on most items, 4 to 70 tags per item, folders
of 20 to 150 items, and batches of 40 near-identical images (40% of each saved into other
folders). The user liked and viewed two "past" themes 5 to 12 months ago, more heavily, and three
"current" themes in the last two months, plus random noise. It then runs the real Discover code
on each library.

- **p@20**: share of the first 20 cards that are unseen items in a current theme (held-out taste).
- **novel p@20**: the same, counting each near-identical batch once.
- **p@60**, **past@60**: share of the first page in a current / past theme.
- **top folder /60**: share of the first page taken by its largest folder.
- **max folder /20**: most items from one folder in any 20 consecutive cards.
- **reasons@60**: distinct reason tags on the first page.
- **dupes@60**: first-page items within dHash 6 of an earlier one.

Measured on 2026-11-23, 3 libraries of 8,000 items, averaged.

## Scoring (R01)

Surprise 0, variety rules off. "topK all, half-life none" is the old ranking.

| topK  | half-life |      p@20 | novel p@20 |      p@60 |   past@60 | top folder /60 | dupes@60 |
| ----- | --------- | --------: | ---------: | --------: | --------: | -------------: | -------: |
| 3     | 30 d      |     1.000 |       1.00 |     0.978 |     0.000 |           0.48 |      9.3 |
| 3     | 60 d      |     1.000 |       1.00 |     0.994 |     0.000 |           0.47 |      7.7 |
| 3     | 120 d     |     0.833 |       0.83 |     0.928 |     0.072 |           0.42 |      4.7 |
| 3     | none      |     0.000 |       0.00 |     0.067 |     0.928 |           0.50 |      0.0 |
| **5** | **60 d**  | **1.000** |   **1.00** | **1.000** | **0.000** |       **0.39** | **16.7** |
| 5     | 30 d      |     1.000 |       0.95 |     0.978 |     0.000 |           0.38 |     20.7 |
| 5     | 120 d     |     0.917 |       0.92 |     0.906 |     0.089 |           0.39 |      9.7 |
| 5     | none      |     0.000 |       0.00 |     0.044 |     0.944 |           0.53 |      0.0 |
| 8     | 30 d      |     0.983 |       0.60 |     0.956 |     0.000 |           0.39 |     23.0 |
| 8     | 60 d      |     0.983 |       0.82 |     0.989 |     0.000 |           0.38 |     21.0 |
| 8     | 120 d     |     0.950 |       0.90 |     0.922 |     0.072 |           0.37 |     18.3 |
| 8     | none      |     0.000 |       0.00 |     0.044 |     0.944 |           0.54 |      0.0 |
| all   | 30 d      |     0.983 |       0.42 |     0.944 |     0.000 |           0.40 |     26.0 |
| all   | 60 d      |     1.000 |       0.53 |     0.978 |     0.000 |           0.41 |     24.0 |
| all   | 120 d     |     0.983 |       0.58 |     0.939 |     0.044 |           0.38 |     23.3 |
| all   | none      |     0.000 |       0.00 |     0.044 |     0.944 |           0.53 |      0.0 |

Without decay the feed is the old taste: 93-94% of the first page comes from themes last touched
months ago. 120 days still lets 4-9% through; 30 and 60 days both remove it, and 60 keeps p@60
higher. Summing every tag (or the best 8) lets near-identical batches, which carry the same long
tag list, crowd the top 20 (novel p@20 0.53 and 0.82); with the best 3 or 5 it stays at 1.00.
The duplicates that remain further down the page are what the variety rules below remove. 5 was picked over 3 for the higher p@60 and
the wider set of reason tags it credits (4.0 against 2.7 distinct reasons in the first 60).

## Variety (R02)

Surprise 0.25 (the default then; R04's Balanced preset is 0.3), scoring at topK 5 / 60 days.

| folder cap | reason cap | dHash |      p@20 | novel p@20 |      p@60 | top folder /60 | max folder /20 | reasons@60 | dupes@60 |
| ---------: | ---------: | ----: | --------: | ---------: | --------: | -------------: | -------------: | ---------: | -------: |
|        off |        off |   off |     1.000 |       0.85 |     0.978 |           0.38 |           11.3 |        6.3 |     13.7 |
|          3 |          4 |     6 |     0.867 |       0.87 |     0.783 |           0.15 |              3 |       17.7 |      0.0 |
|          3 |          5 |     6 |     0.883 |       0.88 |     0.817 |           0.15 |              3 |       15.7 |      0.0 |
|          3 |          8 |     6 |     0.883 |       0.88 |     0.850 |           0.15 |              3 |       14.3 |      0.0 |
|          4 |          4 |     6 |     0.883 |       0.88 |     0.817 |           0.19 |              4 |       17.0 |      0.0 |
|          4 |          5 |     4 |     0.900 |       0.90 |     0.867 |           0.19 |              4 |       14.0 |      0.7 |
|      **4** |      **5** | **6** | **0.900** |   **0.90** | **0.867** |       **0.19** |          **4** |   **14.0** |  **0.0** |
|          4 |          5 |     8 |     0.900 |       0.90 |     0.867 |           0.19 |              4 |       14.0 |      0.0 |
|          4 |          8 |     6 |     0.917 |       0.92 |     0.889 |           0.20 |              4 |       11.7 |      0.0 |
|          6 |          4 |     6 |     0.883 |       0.88 |     0.872 |           0.26 |            5.5 |       14.0 |      0.0 |
|          6 |          5 |     6 |     0.900 |       0.90 |     0.906 |           0.27 |              6 |       12.3 |      0.0 |
|          6 |          8 |     6 |     0.950 |       0.95 |     0.928 |           0.29 |              6 |        9.7 |      0.0 |

The full 27-row sweep is in the script's output; rows not shown follow the same pattern (dHash 4
always leaves 0.7-2.3 duplicates on the first page, 6 and 8 never do).

Variety costs raw precision (1.00 to 0.90) but raises novel p@20 (0.85 to 0.90): the cards it
removes were copies of the same shot. A folder cap of 4 keeps the same precision as 6 while
cutting the largest folder from 27% to 19% of the first page. Reason cap 5 more than doubles the
distinct reasons (6.3 to 14.0) for 1.7 points of precision against 8. dHash 6 is the smallest
distance that catches every synthetic near-duplicate; 8 adds nothing and moves toward the
"similar" range (10) used by the viewer.

## Steering (R03)

`discover-eval.ts metrics --no-sweeps` (the R01/R02 grids skipped), same 3 libraries of 8,000
items, Balanced preset (surprise 0.3). For the tag credited most often on the first page ("top")
and one credited about half as often ("mid"), the share of the first 60 cards carrying it:

|  boost | boosted reason cap |      less |  top | muted top @200 | top, less |  mid | mid, boost | mid, less | hidden back @200 |
| -----: | -----------------: | --------: | ---: | -------------: | --------: | ---: | ---------: | --------: | ---------------: |
|     x2 |                  5 |      x0.5 | 0.25 |           0.00 |      0.29 | 0.12 |       0.11 |      0.07 |                0 |
|     x2 |                 10 |      x0.5 | 0.25 |           0.00 |      0.29 | 0.12 |       0.18 |      0.07 |                0 |
| **x2** |             **10** | **x0.25** | 0.25 |       **0.00** |  **0.16** | 0.12 |   **0.18** |  **0.06** |            **0** |
|     x3 |                 10 |     x0.25 | 0.25 |           0.00 |      0.16 | 0.12 |       0.21 |      0.06 |                0 |
|     x2 |                 10 |      x0.1 | 0.25 |           0.00 |      0.16 | 0.12 |       0.18 |      0.06 |                0 |
|     x3 |                 15 |      x0.1 | 0.25 |           0.00 |      0.16 | 0.12 |       0.27 |      0.06 |                0 |

The variety rules fought both knobs at first. The top tag sits exactly at the reason cap (5 in
20 = 0.25). Boosting a tag makes it the credited reason on more cards, so the plain cap held a
boosted tag flat or lower (0.12 to 0.11); a cap of 10 for boosted reasons lets the boost show
(0.18). Halving a tag for "Less of" took the credit off it, the cap stopped applying, and the tag
showed _more_ (0.25 to 0.29); a quarter brings it down to 0.16, and a tenth changes nothing more.
Boost stays at the doubling the user asked for. Muted tags never appear in the first 200, and
"Not interested" on the first ten cards brings none of them back and moves the top tag's share
only from 0.25 to 0.24, the "slightly" it is meant to be.

## Shelves (R04)

Rediscover pool (liked items that qualify) by threshold, and which part of the synthetic taste
they come from. Past themes are the old taste a rediscover shelf should bring back; current ones
are already all over the feed.

| liked over | not opened for | pool | of all liked | past theme | current theme |
| ---------: | -------------: | ---: | -----------: | ---------: | ------------: |
|       30 d |           14 d | 60.7 |         0.74 |       0.68 |          0.22 |
|   **60 d** |       **30 d** | 46.7 |         0.57 |   **0.88** |      **0.01** |
|       90 d |           30 d | 46.3 |         0.56 |       0.89 |          0.01 |
|      120 d |           60 d | 46.0 |         0.56 |       0.89 |          0.01 |
|      180 d |           60 d | 39.7 |         0.48 |       0.92 |          0.01 |

30/14 lets a fifth of the shelf be things you like right now. 60/30 is the shortest window that
keeps it to old taste; longer windows only shrink the pool. The synthetic library has almost no
likes between 60 and 150 days old, so 60 against 90 is not separated here; 60 matches the
scoring half-life.

The shelves at the defaults, totals over the 3 libraries (a last visit 14 days back):

| shelf               | shown | items | current theme | past theme | already engaged |
| ------------------- | ----: | ----: | ------------: | ---------: | --------------: |
| because you like    |     9 |   103 |            80 |          0 |               0 |
| new                 |     3 |    36 |            25 |          0 |               3 |
| rediscover          |     3 |    36 |             1 |         32 |              36 |
| off the beaten path |     3 |    36 |             0 |          0 |               0 |

"Because you like" is 78% current taste and never repeats what you've opened; "off the beaten
path" is entirely outside both tastes, which is its point.

## More like this (R05)

Items are ranked by the sum of `log(N / usage)` over the tags they share with the source, rating
tags left out. Summing every shared tag's postings took 1-2 s on the 30k library for items that
carry many common tags, so candidates come from the distinctive tags first and the leaders are
re-ranked with every shared tag. Against the full sum, 40 items in each of the 3 libraries:

| distinctive = on at most | re-rank | overlap@60 | overlap@10 | same top-10 order | full p50 / p95 | shortcut p50 / p95 |
| -----------------------: | ------: | ---------: | ---------: | ----------------: | -------------: | -----------------: |
|                     1/20 |      x3 |      0.804 |      0.944 |              0.71 |    95 / 267 ms |         19 / 58 ms |
|                     1/20 |     x10 |      0.943 |      0.991 |              0.93 |    90 / 234 ms |         25 / 75 ms |
|                     1/10 |      x3 |      0.931 |      0.998 |              0.98 |   112 / 363 ms |        22 / 105 ms |
|                 **1/10** | **x10** |  **0.993** |  **1.000** |          **1.00** |   100 / 322 ms |    **34 / 117 ms** |
|                      1/5 |      x5 |      0.999 |      1.000 |              1.00 |   117 / 426 ms |        47 / 167 ms |

1/10 with a x10 re-rank returns the same top ten as the full sum on every sample and 99.3% of the
same 60, at a third of the cost.

## Latency

Synthetic 30,000-item library (643k tag rows), `discover-eval.ts seed` then `perf`, 60 first-page
requests per server interleaved, a forced profile rebuild before every tenth, on a 4-core machine
under a load average of about 15 from other work, so absolute numbers are noisy.

|                  | first page p50 | first page p95 | rebuild p50 | rebuild p95 |
| ---------------- | -------------: | -------------: | ----------: | ----------: |
| before (bdf5072) |          95 ms |         281 ms |    6,656 ms |    7,862 ms |
| after            |         131 ms |         247 ms |    1,087 ms |    1,596 ms |

The rebuild was dominated by the profile aggregate walking every `media_tags` row in tag order;
starting it from the engaged media makes it about six times faster.

R03-R05, the same 30k library on the same machine (load average about 7), base a7f80cc against
this branch, 60 requests each interleaved, two runs with the order swapped:

|               | first page p50 / p95 | rebuild p50 / p95 |
| ------------- | -------------------: | ----------------: |
| base, run 1   |         51.5 / 87 ms |      574 / 644 ms |
| branch, run 1 |         51.4 / 91 ms |      539 / 596 ms |
| base, run 2   |         31.8 / 39 ms |      370 / 434 ms |
| branch, run 2 |         31.7 / 41 ms |      387 / 395 ms |

Branch only, 20 requests each: shelves 18 / 27 ms, taste profile 1 / 4 ms, a mute followed by the
refreshed first page (profile rebuild included) 397 / 499 ms, more like this on 100 random items
30 / 79 ms (the `/api/media/:id/similar` control 16 / 23 ms), and 50 parallel more-like-this calls
all return 200.
