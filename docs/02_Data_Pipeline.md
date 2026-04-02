# Data Pipeline

> *Back to [[00_Index]] · See also [[01_System_Architecture]]*

## Overview

SCAN's data pipeline has four stages: **fetch → parse → compute → cache**. Papers are harvested from the arXiv API, parsed from XML into structured objects, connected through edge computation, and cached to disk. A separate pipeline handles **full-text extraction** from arXiv's HTML rendering service for the reader view.

---

## Stage 1: arXiv Fetch (`arxiv.js`)

### API Interaction
- **Endpoint**: `https://export.arxiv.org/api/query`
- **Protocol**: Must use HTTPS (HTTP returns 301)
- **Rate limiting**: 3.5 second delay between requests (`ARXIV_DELAY_MS` in config)
- **User-Agent**: `SCAN/1.0 (research-tool; mailto:scan@research)`

### Query Strategy
Each domain in `scan.config.js` defines one or more arXiv query strings:

```
neuroscience:  cat:q-bio.NC
ai:            cat:cs.AI, cat:cs.LG
cybernetics:   cat:cs.SY, cat:eess.SY
cognition:     cat:q-bio.NC+AND+all:cognition, cat:cs.HC
biomimetics:   cat:cs.NE, all:bio-inspired+AND+cat:cs.RO
```

Queries are sorted by `submittedDate` descending with `max_results: 40` per query. Total potential: ~400 papers per fetch (duplicates removed).

### Domain Assignment
After fetching, each paper is assigned to domains based on its arXiv categories using `mapDomains()`. A paper in `q-bio.NC` gets `neuroscience`. A paper in both `q-bio.NC` and `cs.HC` gets both `neuroscience` and `cognition` — becoming an **overlap** paper.

### Tag Extraction
Keywords are extracted from the title by splitting on common stop words and filtering to significant terms. These power the tag cloud and tag-based filtering.

---

## Stage 2: Edge Computation

Edges represent relationships between papers. They're computed pairwise with a weighted formula:

```
score = (sharedKeywords × 0.5) + (sharedAuthors × 3.0) + (sharedCategories × 0.8) + (sharedDomains × 0.3)
```

| Factor | Weight | Rationale |
|--------|--------|-----------|
| Shared keywords | ×0.5 | Common but meaningful signal |
| Shared authors | ×3.0 | Strongest signal — same lab, same research programme |
| Shared categories | ×0.8 | Moderate — papers in same arXiv category are related |
| Shared domains | ×0.3 | Weakest — same broad domain doesn't mean closely related |

**Threshold**: Only edges with score ≥ 1.5 are kept.
**Cap**: Maximum 600 edges total (sorted by weight, top 600). This prevents the graph from becoming a dense hairball.

### Why These Weights

Shared authors at ×3.0 is deliberately strong. Two papers by the same author(s) are almost certainly related. Shared keywords at ×0.5 is weak because keyword extraction is noisy — many papers share "neural" or "system" without being meaningfully related. The threshold of 1.5 means a paper needs either 3+ shared keywords, or 1 shared author, or a combination to form an edge.

---

## Stage 3: Cache (`papers-cache.json`)

The full dataset (papers array + edges array) is serialised to JSON and written to `src/data/papers-cache.json`. On startup, the server checks:

1. Does the cache file exist?
2. Is it less than 24 hours old? (`CACHE_MAX_AGE_HOURS`)

If both yes, it loads from cache (instant startup). Otherwise, it re-fetches from arXiv (takes ~60 seconds due to rate limiting).

Cache structure:
```json
{
  "papers": [
    {
      "id": "2603.30004v1",
      "title": "From Patterns to Policy...",
      "authors": ["Adi Wijaya", ...],
      "abstract": "...",
      "published": "2026-03-31T16:58:15Z",
      "categories": ["q-bio.NC", "cs.CY"],
      "domains": ["neuroscience", "cognition"],
      "tags": ["smart-hospital", "analysis", ...],
      "isOverlap": true,
      "arxivUrl": "https://arxiv.org/abs/2603.30004v1",
      "pdfUrl": "https://arxiv.org/pdf/2603.30004v1"
    }
  ],
  "edges": [
    { "source": "2603.30004v1", "target": "2603.29176v1", "weight": 2.3, "sharedTags": ["analysis", "neural"] }
  ]
}
```

---

## Stage 4: Full-Text Extraction (`paper-parser.js`)

When a user opens the reader view, the server fetches the full paper text from arXiv's HTML service.

### Source
arXiv provides LaTeXML-rendered HTML versions at `https://arxiv.org/html/{id}`. Not all papers have HTML versions (some return 404, particularly older papers or those with complex LaTeX). Coverage is expanding — most recent papers have it.

### Parsing Strategy
The HTML uses standardised CSS classes from the LaTeXML toolchain:

| Class | Meaning |
|-------|---------|
| `.ltx_section` | Top-level section (Introduction, Method, etc.) |
| `.ltx_subsection` | Subsection (2.1, 2.2, etc.) |
| `.ltx_title` | Section heading |
| `.ltx_para`, `.ltx_p` | Paragraphs |
| `.ltx_Math` | Inline or display math (contains MathML + LaTeX source) |
| `.ltx_figure` | Figures with images and captions |
| `.ltx_abstract` | Abstract block |
| `.ltx_bibliography` | References (excluded) |

The parser performs **rich content conversion** rather than plain text stripping:

1. Extracts the abstract from `.ltx_abstract`
2. Walks `<section>` elements with IDs like `S1`, `S2.SS1`, etc.
3. For each section, extracts the heading and all paragraphs
4. **Math preservation**: `<math alttext="w_{ij}" display="inline">` → `<scan-math latex="w_{ij}">` placeholder. The LaTeX source is taken from the `alttext` attribute (every arXiv math element has this). Both inline and display (block) modes are preserved.
5. **Figure extraction**: `<figure>` elements are collected from the full article HTML (they often sit between or after sections, not inside them). Image `src` attributes are rewritten to absolute arXiv URLs (`https://arxiv.org/html/{id}/fig1.jpg`). Captions are extracted from `<figcaption>`. Figures are appended as a dedicated "Figures" section.
6. Remaining HTML tags are stripped, entities decoded, whitespace normalised
7. Returns structured `{ sections: [{ id, title, paragraphs, isSubsection }] }` where paragraph content may contain `<scan-math>` and `<scan-figure>` placeholders

### Client-Side Rendering
The reader (`reader.js`) processes these placeholders:
- **`<scan-math>`** → rendered by [KaTeX](https://katex.org/) (loaded from CDN) into properly typeset mathematical notation. Inline math flows with text; display math is centred with a left border accent.
- **`<scan-figure>`** → rendered as `<figure>` with `<img>` (loading from arXiv) and `<figcaption>`. Images are lazy-loaded and fit within the reader's max-width.

KaTeX re-renders after every `applyHighlights()` call since highlight DOM manipulation can destroy rendered math elements. See [[07_Highlight_System]] for details.

### Fallback Chain
```
Try: arxiv.org/html/{id}v1
  ↓ 404
Try: arxiv.org/html/{id}  (without version)
  ↓ 404
Return: null (reader falls back to abstract only)
```

### In-Memory Cache
Fetched full-text is cached in a `Map` keyed by paper ID. This persists for the server's lifetime — a paper is fetched from arXiv HTML at most once per server run.

---

## Conceptual Search Engine (`search.js`)

The search endpoint (`/api/search?q=...`) uses TF-IDF cosine similarity rather than substring matching. This means a query like "brain interfaces" finds papers about BCIs, neural prosthetics, and EEG interfaces — not just papers containing the exact string.

### Concept Expansion
Before computing similarity, the query is expanded using a concept map:

```javascript
'brain interface' → ['brain-computer interface', 'bci', 'neural interface', 'neuroprosthetic', ...]
'movement' → ['motor control', 'locomotion', 'gait', 'kinematics', 'exoskeleton', ...]
```

20+ concept families are defined, covering the core vocabulary of all five domains.

### TF-IDF Pipeline
1. **Tokenise** each paper's title + abstract into terms
2. **Compute TF** (term frequency) for each term in each document
3. **Compute IDF** (inverse document frequency) across the corpus
4. **Build query vector** from expanded query terms
5. **Cosine similarity** between query vector and each document vector
6. **Rank** by score, return top results
