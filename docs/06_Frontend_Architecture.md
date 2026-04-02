# Frontend Architecture

> *Back to [[00_Index]] · See also [[01_System_Architecture]]*

## Module Structure

All client-side JavaScript is vanilla ES — no imports, no modules, just `<script>` tags loaded in order. Each file defines a global object or set of functions.

### Load Order (index.html)
```html
<script src="js/store.js"></script>      <!-- 1. State manager (no deps) -->
<script src="js/background.js"></script> <!-- 2. Particle canvas (no deps) -->
<script src="js/graph.js"></script>      <!-- 3. D3 graph engine (needs D3 CDN) -->
<script src="js/app.js"></script>        <!-- 4. Controller (needs Store, GraphEngine, BgCanvas) -->
```

### Load Order (reader.html)
```html
<script src="js/store.js"></script>      <!-- 1. State manager -->
<script src="js/reader.js"></script>     <!-- 2. Reader controller (needs Store) -->
```

D3.js v7 is loaded from CDN (`https://d3js.org/d3.v7.min.js`).

---

## Store (`store.js`)

A minimal reactive state manager backed by localStorage.

### Persisted State
```javascript
{
  readLater: [],       // Array of arXiv paper IDs
  highlights: {},      // { paperId: [text strings] }
  notes: {},           // { paperId: "note text" }
  activeDomains: []    // Currently filtered domains ([] = all)
}
```

### Ephemeral State (resets on reload)
```javascript
{
  activeTag: null,     // Currently selected tag pill
  searchQuery: '',     // Current search text
  view: 'graph',       // 'graph' or 'list'
  selectedPaper: null  // Currently open paper in detail panel
}
```

### API
```javascript
Store.get('readLater')                    // → string[]
Store.set('activeTag', 'neural')          // Set + trigger listeners
Store.toggleReadLater('2603.30004v1')     // → boolean (new state)
Store.isDomainActive('neuroscience')      // → boolean
Store.toggleDomain('ai')                  // Add/remove from activeDomains
Store.getNote('2603.30004v1')             // → string
Store.setNote('2603.30004v1', 'text...')  // Persist note
Store.isReadLater('2603.30004v1')         // → boolean
```

### Annotation Storage
Annotations (highlights with comments) for the reader are stored separately from the Store, keyed per paper:
```
localStorage key: scan_annotations_{paperId}
Value: JSON array of annotation objects
```

This separation exists because annotations can be large and are paper-specific, while the Store holds lightweight cross-paper state.

---

## Graph Engine (`graph.js`)

A D3.js v7 force simulation exposed as the global `GraphEngine` object.

### Initialisation
```javascript
GraphEngine.init('#graph-container')  // Creates SVG, zoom behaviour, simulation
GraphEngine.setData(papers, edges)    // Feeds data, starts simulation
```

### Force Configuration
```javascript
d3.forceSimulation(papers)
  .force('link', d3.forceLink(edges).id(d => d.id).distance(80))
  .force('charge', d3.forceManyBody().strength(-50))
  .force('center', d3.forceCenter(width/2, height/2))
  .force('collision', d3.forceCollide().radius(10))
```

### Node Rendering
Each node is an SVG `<g>` group containing:
- A `<circle>` coloured by primary domain, sized 4-8px based on edge count
- Hover: radius increases, tooltip appears, connected edges brighten

### Combined Filtering (`filterByAll`)
The critical method that enables domain + tag + search to compose:

```javascript
filterByAll(domains, tag, search) {
  // For each node:
  //   visible = matchesDomains AND matchesTag AND matchesSearch
  //   if multiple domains active and node matches 2+: white ring outline
  // For each edge:
  //   visible = both source and target are visible
}
```

This replaced earlier single-purpose `filterByDomains()`, `filterByTag()`, `filterBySearch()` methods that could only be used one at a time.

### Events
The graph emits a custom event on node click:
```javascript
window.dispatchEvent(new CustomEvent('scan:paper-select', { detail: paper }))
```
`app.js` listens for this to open the detail panel.

---

## Background Canvas (`background.js`)

Pure cosmetic. 80 dots drift on a `<canvas>` behind the main content.

### Behaviour
- **Drift**: Each dot moves at a random angle with speed 0.1-0.4 px/frame
- **Wrap**: Dots that leave one edge re-enter from the opposite
- **Connect**: Dots within 120px of each other draw a faint line (opacity scaled by distance)
- **Mouse repulsion**: Dots within 100px of the cursor are pushed away

### Performance
- Canvas renders at `requestAnimationFrame` rate
- Only draws circles and lines — no images, no text
- Minimal impact (~1ms per frame on modern hardware)

---

## App Controller (`app.js`)

The orchestrator for `index.html`. Key responsibilities:

### Data Loading
Fetches four endpoints in parallel on init:
```javascript
const [papersRes, domainsRes, tagsRes, statsRes] = await Promise.all([...]);
```

### Sidebar Rendering
- **Domain filters**: Clickable domain list with colour dots and counts. Multi-select (toggle). "All Domains" resets.
- **Tag cloud**: Top 30 tags as clickable pills. Single-select (click same tag to deselect).
- **Read Later queue**: Papers starred by the user. Click to open detail panel.

### View Switching
Two views share the same page:
- **Graph**: SVG overlay, D3 force simulation, `display: block/none` toggle
- **List**: CSS grid of paper cards, rendered by `renderListView()`

### Detail Panel
Slides in from the right when a paper is selected. Contains:
- Domain tags, title, date, authors
- Full abstract
- **Read** button → opens `reader.html?id={id}`
- **⤓ Vault** button → saves to Obsidian vault
- Connected papers list
- Notes textarea
- Read Later toggle

### Overlap Indicator
When multiple domains are selected, a green badge appears: "15 overlap papers across selected domains". This counts papers whose domains intersect with 2+ active filter domains.

---

## Reader Controller (`reader.js`)

The largest single file (~1,060 lines). Manages the entire reader view:

1. **`initReader()`** — Fetch paper content + all papers (for edges), load annotations, render
2. **`renderPaper()`** — Build section nav, render full text, apply highlights, bind interactions
3. **`setupEventListeners()`** — Text selection → popup, colour pick → preview, save/cancel, click-to-pin
4. **`applyHighlights()`** — Strip existing → re-walk text nodes → wrap matches (see [[07_Highlight_System]])
5. **`renderAnnotationList()`** — Sidebar annotation cards with scroll-to-highlight
6. **`setupConceptExplorer()`** — Concept input, suggestion loading, passage finding, highlight-all
7. **`scrollToPassage()`** — Find and pin a passage in the document
8. **`saveToVault()`** — POST annotations + notes to vault endpoint
