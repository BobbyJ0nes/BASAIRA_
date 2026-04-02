# SCAN Architecture

Technical reference for every layer of the system.

---

## System Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                        BROWSER                                │
│                                                               │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐  │
│  │ GraphEngine│  │  BgCanvas  │  │       App Controller   │  │
│  │  (D3.js)   │  │ (particles)│  │  (app.js)              │  │
│  │            │  │            │  │                         │  │
│  │ • Nodes    │  │ • Drift    │  │ • loadData()           │  │
│  │ • Edges    │  │ • Pulse    │  │ • renderDomainFilters() │  │
│  │ • Zoom     │  │ • Repel    │  │ • renderTagCloud()     │  │
│  │ • Drag     │  │ • Connect  │  │ • renderListView()     │  │
│  │ • Hover    │  │            │  │ • openPaperPanel()     │  │
│  │ • Filter   │  │            │  │ • applyFilters()       │  │
│  └─────┬──────┘  └────────────┘  │ • exportQueue()        │  │
│        │                          └───────────┬────────────┘  │
│        │ scan:paper-select event              │               │
│        └──────────────────────────────────────┤               │
│                                                │               │
│  ┌─────────────────────────────────────────────┴────────────┐ │
│  │                Store (store.js)                           │ │
│  │  localStorage ← { readLater, highlights, notes, domains }│ │
│  └──────────────────────────────────────────────────────────┘ │
│                           │ fetch()                           │
└───────────────────────────┼───────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────────┐
│                     EXPRESS SERVER (:3000)                     │
│                                                               │
│  Static file serving ─── src/client/**                        │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐   │
│  │                    REST API                            │   │
│  │                                                        │   │
│  │  GET  /api/papers          Full graph: {papers, edges} │   │
│  │       ?domain=ai           Filter by domain            │   │
│  │       ?search=transformer  Filter by search term       │   │
│  │       ?tag=neural          Filter by keyword           │   │
│  │                                                        │   │
│  │  GET  /api/papers/:id      Single paper by arXiv ID    │   │
│  │                                                        │   │
│  │  GET  /api/domains         Domain list with counts     │   │
│  │                                                        │   │
│  │  GET  /api/tags            Top 100 keywords + counts   │   │
│  │                                                        │   │
│  │  GET  /api/stats           Overview: totals, domains,  │   │
│  │                            last update timestamp       │   │
│  │                                                        │   │
│  │  POST /api/refresh         Re-fetch all from arXiv     │   │
│  │                            (~60s, rate-limited)        │   │
│  │                                                        │   │
│  │  POST /api/export          Body: {paperIds: [...]}     │   │
│  │                            Returns: {files: [{         │   │
│  │                              filename, content}]}      │   │
│  └────────────────────────────────┬───────────────────────┘   │
│                                   │                           │
│  ┌────────────────────────────────┴───────────────────────┐   │
│  │              arXiv Fetcher (arxiv.js)                   │   │
│  │                                                         │   │
│  │  fetchAllPapers()                                       │   │
│  │    → for each domain in scan.config.js                  │   │
│  │        → for each query in domain.queries               │   │
│  │            → GET arxiv.org/api/query?...                │   │
│  │            → XML → JSON (xml2js)                        │   │
│  │            → parseEntry() per result                    │   │
│  │            → 3.5s delay (rate limit courtesy)           │   │
│  │        → deduplicate by arXiv ID                        │   │
│  │        → merge domains for duplicates                   │   │
│  │    → extractKeywords() on each paper                    │   │
│  │    → mapDomains() via category→domain table             │   │
│  │    → computeEdges() across all papers                   │   │
│  │    → write cache JSON                                   │   │
│  └────────────────────────────────┬───────────────────────┘   │
│                                   │                           │
│  ┌────────────────────────────────┴───────────────────────┐   │
│  │         src/data/papers-cache.json                      │   │
│  │         { papers: [...], edges: [...] }                 │   │
│  │         Auto-refreshed when age > 24h                   │   │
│  └─────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────────┐
│                     arXiv API (external)                       │
│  https://export.arxiv.org/api/query                           │
│  Atom XML feed, sorted by submittedDate descending            │
│  Max 40 results per query                                     │
└───────────────────────────────────────────────────────────────┘
```

---

## Server Layer (`src/server/`)

### `index.js` — Entry Point

Responsibilities:
1. Create Express app with `express.json()` middleware
2. Serve `src/client/` as static files
3. Mount API routes under `/api`
4. SPA fallback — any unmatched GET returns `index.html`
5. Call `initData()` before binding the port (ensures data is ready)
6. ASCII art banner on startup

The `__dirname` is computed from `import.meta.url` (ESM convention) and all paths resolve from the `src/server/` directory.

### `arxiv.js` — Data Pipeline

Four stages:

**1. Fetch** (`fetchURL`, `fetchPapersForQuery`, `fetchAllPapers`)
- Raw HTTPS GET with redirect following (arXiv returns 301 from HTTP→HTTPS)
- Custom `User-Agent: SCAN/1.0`
- 3.5-second delay between requests to respect arXiv rate limits
- Iterates all queries across all domains from `scan.config.js`
- Deduplicates papers by arXiv ID; merges domain lists when a paper appears in multiple queries

**2. Parse** (`parseEntry`)
- Extracts from Atom XML entry: `id`, `title`, `summary`, `author`, `category`, `link`, `published`, `updated`, `arxiv:primary_category`
- Normalizes whitespace in titles and abstracts
- Constructs PDF and arXiv URLs from entry links

**3. Extract Keywords** (`extractKeywords`)
- Concatenates title + abstract
- Lowercases, strips non-alphanumeric characters
- Removes words ≤3 characters
- Removes a curated stopword list (~120 academic stopwords including "proposed", "demonstrate", "performance", etc.)
- Counts word frequencies (unigrams)
- Also counts bigrams with a 1.5× frequency boost (bigrams are often more meaningful)
- Returns the top 12 terms by frequency

**4. Compute Edges** (`computeEdges`)
- O(n²) pairwise comparison across all papers
- Weight accumulates from four signals:

| Signal | Threshold | Weight per Match |
|--------|-----------|-----------------|
| Shared keywords | ≥2 shared | +0.5 per shared keyword |
| Shared authors | ≥1 shared | +3.0 per shared author |
| Shared arXiv categories | ≥1 shared | +0.8 per shared category |
| Shared SCAN domains | ≥1 shared | +0.3 flat |

- Minimum weight to form an edge: **1.5**
- Maximum weight cap: **10**
- Edges sorted by weight descending, truncated to **top 600** to prevent visual clutter
- Each edge stores: `source`, `target`, `weight`, `sharedTags[]`, `sharedAuthors[]`, `sharedDomains[]`

**Domain Mapping** (`mapDomains`)

Maps arXiv category codes to SCAN domain keys:

```
q-bio.NC  → neuroscience, cognition
cs.AI     → ai
cs.LG     → ai
cs.SY     → cybernetics
eess.SY   → cybernetics
cs.HC     → cognition
cs.NE     → biomimetics
cs.RO     → biomimetics
q-bio.PE  → biomimetics
cs.CL     → ai
cs.CV     → ai
cs.MA     → cybernetics, ai
stat.ML   → ai
cs.IT     → cybernetics
math.OC   → cybernetics
```

Papers in categories like `q-bio.NC` or `cs.MA` get assigned to multiple domains, making them overlap nodes.

### `routes.js` — API Layer

**Cache logic** (`initData`, `refreshData`):
- On startup, checks if `papers-cache.json` exists and is younger than `CACHE_MAX_AGE_HOURS` (24h)
- If valid cache exists → loads into memory
- If stale or missing → calls `fetchAllPapers()` and writes result to disk
- `POST /api/refresh` forces a re-fetch regardless of cache age

**Filtering** (`GET /api/papers`):
- All three query params (`domain`, `search`, `tag`) are applied sequentially
- After filtering papers, edges are also filtered to only include edges between visible papers

**Export** (`POST /api/export`):
- Accepts `{paperIds: string[]}`
- Generates one Markdown file per paper
- Frontmatter includes: title, authors, published, domains, tags, arxiv URL, pdf URL, source
- Body includes: title as H1, author list, date, categories, domains, abstract, links, hashtag-formatted tags, notes section
- Filename: arXiv ID with `/` and `.` replaced by `-`

---

## Client Layer (`src/client/`)

### `index.html` — SPA Shell

The HTML defines all structural elements:
- **Header**: logo with gradient text + cursor blink, search input, stats counter, action buttons
- **Sidebar**: view toggle, domain filters container, tag cloud container, read later list
- **Main area**: stacked layers — canvas background (z:0), graph SVG, list container, detail panel (z:50), loading overlay (z:1000), tooltip (z:200)
- **Export modal**: backdrop with blur + centered dialog
- **Notification**: fixed bottom-right toast

Scripts load in dependency order: `store.js` → `graph.js` → `background.js` → `app.js`. D3.js loads from CDN.

### `store.js` — State Manager

A plain object (`Store`) with getter/setter pattern and listener system:

**Persisted state** (survives page reload via `localStorage` key `scan_state`):
- `readLater: string[]` — paper IDs in the queue
- `highlights: {paperId: string[]}` — selected abstract text per paper
- `notes: {paperId: string}` — note text per paper
- `activeDomains: string[]` — currently filtered domain keys

**Ephemeral state** (resets on reload):
- `activeTag: string|null`
- `searchQuery: string`
- `view: 'graph'|'list'`
- `selectedPaper: string|null`

**Methods:**
- `get(key)`, `set(key, value)` — generic access
- `isReadLater(id)`, `toggleReadLater(id)` — queue management
- `getNote(id)`, `setNote(id, text)` — per-paper notes
- `getHighlights(id)`, `addHighlight(id, text)`, `removeHighlight(id, text)` — per-paper highlights
- `toggleDomain(key)`, `isDomainActive(key)` — filter state
- `on(callback)` — register change listener; called with `(key, value)`
- `_persist()` — writes the persisted subset to localStorage
- `_notify(key, value)` — fires all registered listeners

### `graph.js` — D3 Force Graph Engine

The `GraphEngine` object manages the entire SVG graph:

**Initialization** (`init`):
- Creates SVG inside the given container selector
- Adds `<defs>` with a `#glow` filter (3px Gaussian blur merge for selected/hovered nodes)
- Sets up `d3.zoom` with scale extent `[0.1, 6]`
- Creates two child `<g>` groups: `links-group` (rendered first = behind) and `nodes-group`

**Data binding** (`setData`):
- Converts paper objects to node objects with `{id, title, domains, tags, authors, isOverlap, r}`
- Overlap nodes get `r: 6`, regular nodes `r: 4`
- Filters edge data to only include edges whose source and target exist in the node set

**Rendering** (`render`):
- **Links**: `<line>` elements, stroke `rgba(255,255,255,0.12)`, width proportional to weight (0.4–2.5px), opacity proportional to weight (0.05–0.35)
- **Nodes**: `<g>` groups, each containing a `<circle>` and a `<text>` label
  - Circle fill/stroke = domain color (or white for overlap), 70% fill opacity, 60% stroke opacity
  - Label: hidden by default (`opacity:0`), shown on hover/select via CSS transitions
  - Each group has drag behavior attached

**Force simulation** parameters:
- `forceLink`: distance `max(30, 120 - weight*8)`, strength `min(0.3, weight*0.03)`
- `forceManyBody`: strength `-25`, distanceMax `300`
- `forceCenter`: centered on viewport, strength `0.05`
- `forceCollide`: radius `r + 2`
- `forceX` / `forceY`: gentle centering force, strength `0.02`
- `alpha: 0.8`, `alphaDecay: 0.015` (slow settle for organic feel)

**Interactions:**
- **Hover** (`_onHover`): positions tooltip, computes connected IDs by scanning all links, applies `.dimmed` class to unconnected nodes/links and `.highlighted` to neighbors
- **Hover end** (`_onHoverEnd`): removes tooltip, clears all dim/highlight classes
- **Click** (`_onClick`): sets `.selected` class, dispatches `scan:paper-select` custom event on `window`
- **Drag**: standard D3 drag — sets `fx`/`fy` during drag, releases on end

**Filtering methods:**
- `filterByDomains(domains[])`: shows/hides nodes by domain membership, cascades to links
- `filterByTag(tag)`: shows/hides nodes by tag inclusion
- `filterBySearch(query)`: shows/hides by title/tag/author substring match

**`zoomToFit()`**: computes axis-aligned bounding box of all nodes, calculates scale to fit 85% of viewport, animates a 750ms zoom transition.

**Node color logic** (`_nodeColor`):
- `isOverlap: true` → white `#ffffff`
- Otherwise → `DOMAIN_COLORS[domains[0]]` or fallback `#888888`

### `background.js` — Generative Particle System

The `BgCanvas` object renders to a `<canvas>` element behind the graph:

**Particle creation:**
- Count: `floor(viewport_area / 12000)` — roughly 100 particles at 1440×900
- Each particle: random position, velocity (±0.15), radius (0.3–1.8px), one of five domain colors, random alpha (0.1–0.5), random pulse speed and phase offset

**Animation loop (60fps):**
1. Clear canvas
2. For each particle:
   - Apply velocity (drift)
   - Mouse repulsion: if within 120px of cursor, accelerate away with force proportional to distance
   - Dampen velocity (×0.99 per frame)
   - Wrap at viewport edges
   - Pulse alpha sinusoidally
   - Draw as filled circle
3. Draw inter-particle connections: for every pair within 63px (4000 squared distance), draw a `rgba(255,255,255,0.015)` line

**Event handling:**
- Window resize → recalculate dimensions, regenerate particles
- Mouse move on `.main` → update mouse position
- Mouse leave → reset mouse to off-screen

### `app.js` — Application Controller

The main orchestrator. On `DOMContentLoaded`:

1. `BgCanvas.init()` — start particle background
2. `GraphEngine.init('#graph-container')` — set up SVG
3. `loadData()` — parallel fetch of `/api/papers`, `/api/domains`, `/api/tags`, `/api/stats`
4. `setupEventListeners()` — wire all UI interactions
5. `hideLoading()` — fade out the loading overlay after 800ms

**Key functions:**

| Function | What It Does |
|----------|-------------|
| `loadData()` | Fetches all API endpoints, updates stats, renders sidebar, feeds data to GraphEngine, schedules `zoomToFit()` after 2s |
| `renderDomainFilters(domains)` | Creates domain filter rows with colored dots, labels, counts. Click handlers toggle Store domains and re-apply filters |
| `renderTagCloud(tags)` | Creates clickable tag pills from top 30 tags. Click toggles active tag |
| `renderQueue()` | Reads `Store.readLater`, renders queue items with titles and domain dots, or "No papers saved yet" |
| `applyFilters()` | Reads current domain/tag/search state from Store, delegates to GraphEngine filter methods or re-renders list view |
| `renderListView()` | Filters papers, generates card grid with domain dots, title, authors, abstract, tags, star button |
| `filterPapers()` | Returns paper array filtered by active domains, active tag, and search query |
| `openPaperPanel(paper)` | Builds panel HTML, wires action buttons (save/pdf/arxiv/vault), sets up notes auto-save, tag click navigation, connected paper navigation, abstract text selection highlighting |
| `closePaperPanel()` | Removes `.open` class from panel |
| `exportSinglePaper(paper)` | POSTs paper ID to `/api/export`, triggers file download |
| `exportQueue()` | POSTs all Read Later IDs to `/api/export`, downloads each file |
| `downloadFile(name, content)` | Creates a Blob URL, triggers download via ephemeral `<a>` click |
| `notify(message, type)` | Shows a toast notification (success/info/warning) for 3 seconds |
| `switchView(view)` | Toggles graph/list container visibility, updates button active states |

**Event wiring:**
- Search input: 300ms debounced, updates Store and calls `applyFilters()`
- Keyboard: `/` focuses search, `Esc` closes panel + blurs search
- Refresh button: POSTs `/api/refresh`, re-calls `loadData()` on success
- Export button: opens modal, shows queue count
- Modal: cancel/confirm/backdrop-click handlers
- Store listener: re-renders queue on `readLater` changes
- `scan:paper-select` window event: opens panel for clicked graph node

---

## CSS Architecture (`scan.css`)

~800 lines organized into labeled sections:

| Section | Lines | What It Covers |
|---------|-------|---------------|
| Reset & Base | Variables, box-sizing, fonts, body | 
| Scanline Overlay | `body::after` repeating gradient |
| Layout | CSS Grid — `sidebar | main` with header spanning |
| Header | Logo gradient, cursor blink, search glow, stats |
| Buttons | `.btn` base + `--accent`, `--active`, `--icon` modifiers |
| Sidebar | Sections, domain filters with dots, tag pills, queue items |
| Main Area | Relative positioned container for stacked layers |
| Graph | Node groups, circles, labels, hover/selected/dimmed states, links |
| List View | Card grid, paper cards with accent bar, domain dots, truncated text |
| Detail Panel | Slide-in transform, domain tags, section labels, notes textarea, connected papers |
| Tooltip | Absolute positioned, fade transition |
| Loading | Centered overlay, gradient slide animation |
| Background Canvas | Absolute positioned, 40% opacity, pointer-events none |
| Notification | Fixed toast, slide-up animation, type-colored left border |
| Modal | Backdrop blur, centered dialog |
| Glitch Effect | `clip-path` keyframe animation (available via `.glitch-hover`) |
| Responsive | <900px: sidebar hidden, panel full-width |
| Scrollbar | 6px thin, dark thumb |
| Selection | Magenta highlight |

**Design tokens** (CSS custom properties on `:root`):
- 5 background shades: `--bg-primary` (#050508) through `--bg-hover` (#12121e)
- 3 text levels: `--text-primary` (#e0e0e8), `--text-secondary` (#8888a0), `--text-muted` (#555566)
- 2 border levels: `--border` (#1a1a2e), `--border-active` (#2a2a44)
- 5 domain colors as custom properties
- 2 font families: `--font-mono` (JetBrains Mono), `--font-sans` (Space Grotesk)
- 3 layout dimensions: `--panel-width` (480px), `--header-height` (56px), `--sidebar-width` (260px)

---

## Data Model

### Paper Object

```javascript
{
  id: "2603.30004v1",                    // arXiv ID
  title: "Paper Title...",                // Whitespace-normalized
  authors: ["Name One", "Name Two"],      // Full author names
  abstract: "This study examines...",     // Full abstract text
  categories: ["q-bio.NC", "cs.AI"],      // Raw arXiv categories
  domains: ["neuroscience", "ai"],        // Mapped SCAN domains
  tags: ["neural", "brain", "cortex"],    // Extracted keywords (max 12)
  published: "2026-03-31T17:54:27Z",      // ISO date string
  updated: "2026-03-31T17:54:27Z",        // ISO date string
  pdfUrl: "https://arxiv.org/pdf/...",    // Direct PDF link
  arxivUrl: "https://arxiv.org/abs/...",  // Abstract page link
  primaryCategory: "q-bio.NC",            // arXiv primary category
  isOverlap: true                         // Belongs to 2+ domains
}
```

### Edge Object

```javascript
{
  source: "2603.30004v1",           // Source paper ID
  target: "2603.29876v1",           // Target paper ID
  weight: 4.3,                     // Composite weight (1.5–10)
  sharedTags: ["neural", "brain"], // Up to 5
  sharedAuthors: [],               // Full names
  sharedDomains: ["neuroscience"]  // SCAN domain keys
}
```

### localStorage State

Key: `scan_state`

```javascript
{
  readLater: ["2603.30004v1", "2603.29876v1"],
  highlights: {
    "2603.30004v1": ["selected text snippet"]
  },
  notes: {
    "2603.30004v1": "Interesting approach to..."
  },
  activeDomains: []  // Empty = all active
}
```
