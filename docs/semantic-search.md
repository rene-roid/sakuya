# Search by description (ML04)

Explore and the top search box have a **Describe** switch. With it on, the text is embedded with
CLIP's text encoder and every indexed picture is ranked by cosine similarity to it, inside whatever
library, type, tag and filename filters are active. "More like this" in the viewer blends image
neighbours into its shared-tag ranking once files are indexed.

Off by default: Settings > AI Tagging > Search by description turns it on, downloads the model
(about 155 MB) and indexes files, then indexes new files after every scan.

## The model

OpenAI CLIP ViT-B/32 (MIT licence), the ONNX export in
[Xenova/clip-vit-base-patch32](https://huggingface.co/Xenova/clip-vit-base-patch32): separate
`vision_model` and `text_model` graphs with the projection heads, so images and text are encoded
independently, and the original `vocab.json` / `merges.txt`, so the tokenizer is ~90 lines of
TypeScript (`apps/server/src/lib/clipTokenizer.ts`) with no new dependency.

Candidates compared (sizes from the Hugging Face API):

| export | download | RSS once loaded (vision + text) | agrees with fp32 |
|---|---|---|---|
| fp32 (`vision_model` + `text_model`) | 606 MB | — | reference |
| fp16 | 303 MB | 421 + 413 MB (onnxruntime upcasts to fp32 on CPU) | cosine 1.0000 |
| **int8 (`*_quantized`)**, picked | **153 MB** | **184 + 139 MB** | image cosine mean 0.929 (min 0.754), text mean 0.940 |

SigLIP 2 (immich-app/ViT-B-16-SigLIP2__webli) was ruled out by size: its text model alone is 1.1 GB.
MobileCLIP S0 is smaller but under Apple's sample-code licence.

int8 moves the vectors measurably (the top five for a query overlaps fp32's in 2 to 5 places on the
fixtures) but the results stay sensible (below) at half the download and 40% of the memory of fp16,
and it ran about 30% faster than fp32 per image here. Both models load on first use through
`lib/modelSession.ts` and are freed after 60 s idle.

### Checking the implementation

- Tokenizer: `a photo of a cat` gives `[49406, 320, 1125, 539, 320, 2368, 49407]`, the ids the
  Hugging Face CLIPTokenizer documents. Unit tests cover merges, lowercasing, punctuation, byte
  encoding of non-ASCII text and the 77-token cut.
- Preprocessing (shortest side to 224 bicubic, centre crop, CLIP mean/std) and the text path were
  checked against the fp32 export: the fp16 export reproduces fp32 to cosine 1.0000 for all 163
  fixtures and 10 queries through the same code, so the pipeline feeds the graphs what they expect.
- No Python reference is available on this machine; matching pairs score highest (below).

## Quality on the fixtures (int8, 163 images: 102 Pepper&Carrot pages, 61 Lorem Picsum photos)

`bun apps/server/src/scripts/semanticEval.ts --models <dir> --images <dirs> --sheet out.png`.
Top five, judged by looking at each picture:

| query | top 5 | fits |
|---|---|---|
| a cat | E08P01, E13P05, E18P01, E02P02, photo-40 | 5/5 (Carrot the cat on four pages, a cat's nose) |
| a dragon | E14P03, E14P06, E20P04, E06P06, E14P04 | 4/5 (dragons on four; E06P06 a potion monster) |
| the sea | photo-27, photo-50, photo-37, photo-16, photo-14 | 5/5 |
| a forest path | photo-17, photo-70, E07P01, photo-10, E07P03 | 4/5 (a path through trees first; E07P03 a crystal cave) |
| a book | photo-24, E08P01, E03P03, E14P06, E16P02 | 1/5 (the open book first; the rest have scrolls or shelves at most) |
| a city at night | photo-43, photo-56, photo-57, photo-49, E01P03 | 2/5 (a skyline at night first, city lights bokeh; then daytime streets) |
| a witch flying on a broom | E01P03, photo-53, E16P02, E06P02, E04P02 | 2/5 (Pepper on her broom first; a sky photo, witches indoors) |
| a red umbrella in the rain | E08P05, E08P04, photo-41, E16P05, photo-70 | 3/5 (the two rain pages, water drops; no fixture has an umbrella) |

The exact match leads every query; the tail is weaker where the fixtures hold only one or two
fitting pictures.

## Latency

`bun apps/server/src/scripts/semanticEval.ts --bench 30000`: 30,000 random 512-d unit vectors stored
as float16, ranked through the same code as the API (the filter's ids, every cosine, the best 60), 50
queries each, on this 4-core machine shared with other jobs:

| | load ~4 (two runs) | load ~17 (other agents building) |
|---|---|---|
| index load from SQLite + first page | 271-304 ms | 842 ms |
| warm first page, no filter | p50 64-75 ms, p95 82-89 ms | p50 422 ms, p95 862 ms |
| warm first page, videos only | p50 44-45 ms, p95 66-67 ms | p50 262 ms, p95 586 ms |

Encoding the description adds 11-25 ms warm, or about 1.2 s when the text model has to load (it is
freed after 60 s idle: the demo server went 300 MB to 453 MB after a search, back to 207 MB 75 s
later). Later pages of the same search reuse its scores and only select the next 60.

What made it fast enough: the index is held as float16 bits (1 KB per item, about 30 MB at 30k)
and decoded by table lookup with four accumulators; a page is a bounded top-60 selection instead of
a sort of everything (a full sort of 30k objects cost 70-115 ms under load); the scores of the last
four searches are kept so infinite scroll does not re-rank. A float32 copy of the index would have
been a little faster again (28 vs 34 ms for the dot products in a micro-benchmark) at twice the
memory, which did not seem worth it. The index is dropped after 5 minutes unused.

The plain tag/filename listing only gained an `if (describe)` branch in front of it, so it was not
re-measured.

## More like this

With files indexed, the viewer's More like this fuses two lists by weighted reciprocal rank,
`weight / (k + rank)`: the existing shared-tag ranking and the nearest image embeddings (hidden and
muted items left out of both). Without embeddings for the item, or with the feature off, it is the
tag ranking as before.

Measured with `semanticEval.ts --like` on the demo instance (102 Pepper&Carrot pages tagged by the
WD tagger and indexed): the share of each page's top ten that come from the same episode, the
nearest thing the fixtures have to ground truth (chance is about 5%):

| ranking | same-episode share of top 10 |
|---|---|
| tags only (before) | 15.8% |
| images only | 16.2% |
| blend, image weight 0.5 (k 20 or 60) | 15.8% |
| blend, image weight 0.5, k 5 | 17.3% |
| **blend, image weight 1 (k 5, 20 or 60)**, picked | **18.3%** |
| blend, image weight 2, k 20 | 16.2% |

Example: for E08P04 (a rainy night) the other rain page of that episode, E08P05, moves from 12th to
2nd.
