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

Surprise 0.25 (the default), scoring at topK 5 / 60 days.

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
