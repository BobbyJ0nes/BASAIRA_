# SCAN — Project Plan & Status

## V1 Status: ✅ Complete

Released: April 1, 2026

---

## V1 Feature Matrix

### Data Pipeline

| Feature | Status | Implementation |
|---------|--------|---------------|
| arXiv API integration | ✅ | HTTPS GET → Atom XML, redirect following, custom User-Agent |
| Multi-domain fetching | ✅ | Iterates `scan.config.js` domains × queries sequentially |
| Rate limit compliance | ✅ | 3.5s delay between API calls |
| XML → JSON parsing | ✅ | xml2js `parseStringPromise`, field extraction via `parseEntry()` |
| Paper deduplication | ✅ | Map keyed by arXiv ID; domains merged for duplicates |
| Keyword extraction | ✅ | Frequency-based with stopword filtering + bigram boosting |
| Domain mapping | ✅ | 15-entry category→domain lookup table |
| Edge computation | ✅ | O(n²) pairwise: shared tags, authors, categories, domains |
| JSON disk cache | ✅ | `src/data/papers-cache.json`, 24h TTL, auto-refresh |
| Manual refresh | ✅ | `POST /api/refresh` re-fetches everything |

### Visualization

| Feature | Status | Implementation |
|---------|--------|---------------|
| Force-directed graph | ✅ | D3 v7 with 6 force types (link, charge, center, collision, x, y) |
| Domain color coding | ✅ | 5 neon colors, white for overlap |
| Overlap detection | ✅ | Multi-domain papers get `isOverlap: true`, larger radius, white color |
| Node hover → tooltip | ✅ | Shows title + domain + author count |
| Node hover → neighbor highlight | ✅ | Connected nodes bright, rest dimmed to 15% opacity |
| Node click → detail panel | ✅ | Custom event dispatch `scan:paper-select` |
| Node drag | ✅ | D3 drag behavior with simulation alpha reheat |
| Zoom & pan | ✅ | D3 zoom, scale 0.1×–6×, zoom-to-fit on initial load |
| Edge visibility | ✅ | Width and opacity proportional to edge weight |
| Node labels | ✅ | Hidden by default, shown on hover/select (40-char truncation) |
| Glow filter | ✅ | SVG `feGaussianBlur` applied on hover/select |
| Generative background | ✅ | Canvas particle system, 5 domain colors, sinusoidal pulse, mouse repulsion, inter-particle connections |
| Scanline overlay | ✅ | `body::after` repeating gradient |

### Interface

| Feature | Status | Implementation |
|---------|--------|---------------|
| Graph view | ✅ | Default view, full-bleed SVG |
| List/card view | ✅ | CSS Grid, auto-fill columns (min 360px), 3-line abstract clamp |
| View toggle | ✅ | Sidebar buttons, state tracked in Store |
| Domain filtering | ✅ | Sidebar toggles, multi-select, "All Domains" reset |
| Tag filtering | ✅ | Tag cloud (top 30), single-select with toggle-off |
| Real-time search | ✅ | 300ms debounce, matches title/abstract/authors/tags |
| Detail panel | ✅ | Slide-in from right, 480px wide, scroll-internal |
| Connected papers list | ✅ | In panel, ranked by edge weight, clickable navigation |
| Panel actions | ✅ | Read Later toggle, open PDF, open arXiv, export to vault |
| Keyboard shortcuts | ✅ | `/` = focus search, `Esc` = close panel + blur |
| Notifications | ✅ | Toast system, 3 types (success/info/warning), 3s auto-dismiss |
| Loading state | ✅ | Centered overlay with gradient progress animation |

### Personal Knowledge Management

| Feature | Status | Implementation |
|---------|--------|---------------|
| Read Later queue | ✅ | Toggle star per paper, IDs stored in localStorage |
| Queue sidebar display | ✅ | Titles with domain-colored dots, clickable |
| Per-paper notes | ✅ | Textarea in panel, 500ms debounced auto-save to localStorage |
| Text highlighting | ✅ | Select abstract text → auto-saved to localStorage (min 5 chars) |
| Single paper export | ✅ | Downloads `.md` with YAML frontmatter + body |
| Bulk queue export | ✅ | Modal → downloads all queued papers as individual `.md` files |
| Obsidian compatibility | ✅ | Frontmatter format, hashtag-style tags, wiki-friendly filenames |

### Aesthetic

| Feature | Status | Implementation |
|---------|--------|---------------|
| Dark theme | ✅ | #050508 base, 5 background shades, 3 text levels |
| Monospace typography | ✅ | JetBrains Mono for data/labels, Space Grotesk for body |
| Neon domain palette | ✅ | Cyan, magenta, amber, lime, violet |
| Logo gradient + cursor blink | ✅ | CSS gradient clip + step-end blink animation |
| Particle background | ✅ | Canvas-rendered, 5 colors, drift + pulse + repel |
| Scanlines | ✅ | 2px repeating gradient overlay on body |
| Glow effects | ✅ | SVG filter on nodes, CSS box-shadow on buttons/inputs |
| Selection color | ✅ | Magenta highlight on text selection |
| Glitch animation | ✅ | `clip-path` keyframes (available via `.glitch-hover` class) |

---

## V1 Data Report

Fetched April 1, 2026, from arXiv (most recent submissions sorted by date):

| Domain | Queries | Papers Found | Notes |
|--------|---------|-------------|-------|
| Neuroscience | `cat:q-bio.NC` | 40 | Computational neuro, brain networks, EEG/fMRI |
| AI | `cat:cs.AI` + `cat:cs.LG` | 80 (40+40) | Transformers, LLMs, RL, attention, generative |
| Cybernetics | `cat:cs.SY` + `cat:eess.SY` | 40 | `cs.SY` returned 0 (inactive?), `eess.SY` returned 40 |
| Cognition | `cat:q-bio.NC+AND+all:cognition` + `cat:cs.HC` | 40 | Combined query returned 0, `cs.HC` returned 40 |
| Biomimetics | `cat:cs.NE` + `all:bio-inspired+AND+cat:cs.RO` | 40 | Combined query returned 0, `cs.NE` returned 40 |

**After deduplication and domain merging:**

| Metric | Value |
|--------|-------|
| Total unique papers | 226 |
| Overlap papers (2+ domains) | 105 (46%) |
| Computed edges (weight ≥ 1.5) | 600 (capped) |
| Top keywords | systems, framework, neural, control, learning, optimization |

The 46% overlap rate indicates strong interdisciplinary connectivity in the dataset — nearly half the papers bridge multiple domains.

---

## API Reference

### `GET /api/papers`

Returns the full graph dataset.

**Query parameters** (all optional, applied sequentially):
| Param | Type | Example | Effect |
|-------|------|---------|--------|
| `domain` | string | `ai` | Only papers containing this domain |
| `search` | string | `transformer` | Substring match on title, abstract, authors, tags |
| `tag` | string | `neural` | Exact match on extracted keywords |

**Response:**
```json
{
  "papers": [{ paper objects }],
  "edges": [{ edge objects }]
}
```

### `GET /api/papers/:id`

Single paper by arXiv ID (e.g., `2603.30004v1`).

### `GET /api/domains`

Domain metadata with live paper counts.
```json
{
  "neuroscience": { "label": "Neuroscience", "color": "#00f0ff", "count": 41 },
  ...
}
```

### `GET /api/tags`

Top 100 extracted keywords sorted by frequency.
```json
[{ "tag": "systems", "count": 42 }, ...]
```

### `GET /api/stats`

Overview statistics.
```json
{
  "totalPapers": 226,
  "totalEdges": 600,
  "overlapPapers": 105,
  "domains": [{ "key": "...", "label": "...", "color": "...", "count": 41 }],
  "lastUpdated": "2026-04-01T20:53:05.309Z"
}
```

### `POST /api/refresh`

Re-fetches all papers from arXiv. Takes ~60 seconds.
```json
{ "success": true, "papers": 226, "edges": 600 }
```

### `POST /api/export`

Generates Obsidian Markdown files.

**Request body:** `{ "paperIds": ["2603.30004v1", "2603.29876v1"] }`

**Response:**
```json
{
  "files": [
    { "filename": "2603-30004v1.md", "content": "---\ntitle: ..." }
  ]
}
```

---

## V2 Backlog

Ranked by impact and feasibility:

### High Priority
- [ ] **Semantic similarity edges** — Use sentence embeddings (e.g., `all-MiniLM-L6-v2` via ONNX) to compute abstract-to-abstract similarity. Would dramatically improve edge quality beyond keyword overlap.
- [ ] **Citation graph overlay** — Integrate Semantic Scholar API to add citation-based edges and display citation counts on nodes.
- [ ] **Scheduled auto-refresh** — Run arXiv fetch on a configurable interval (e.g., daily at midnight) without manual trigger.
- [ ] **Edge hover info** — Show shared keywords/authors between two papers when hovering an edge.

### Medium Priority
- [ ] **Agent-powered summaries** — Generate one-paragraph paper briefs via LLM API call (per-paper, cached).
- [ ] **Timeline view** — Alternative layout showing papers on a date axis, still with domain coloring.
- [ ] **Paper clustering** — UMAP or t-SNE projection as an alternative to force layout, revealing topical clusters.
- [ ] **Full-text PDF parsing** — Download and parse PDFs for richer keyword extraction and section-level search.
- [ ] **Custom domain UI** — Browser-based form to add/edit/remove domains and their arXiv query definitions.

### Lower Priority
- [ ] **RSS feed generation** — Generate RSS for each domain so external readers can subscribe.
- [ ] **Collaborative annotations** — Shared notes/highlights via a lightweight backend (SQLite or similar).
- [ ] **Mobile responsive** — Currently hides sidebar on <900px; could add a mobile-first navigation pattern.
- [ ] **Node size by citation count** — Requires citation data from Semantic Scholar.
- [ ] **Export to Notion/Roam** — Alternative export formats beyond Obsidian Markdown.
- [ ] **Saved filter presets** — Name and recall domain+tag+search combinations.
- [ ] **Reading progress tracking** — Mark papers as "read" vs "unread" vs "in progress".

---

## Known Limitations (V1)

1. **arXiv queries**: `cat:cs.SY` and some compound queries (`AND`) returned 0 results. The arXiv API has quirks with certain category codes and boolean operators. `eess.SY` works as the cybernetics fallback.
2. **Edge quality**: Keyword-based edges can be noisy. Two papers about completely different topics might share generic terms like "optimization" or "learning". Semantic embeddings (V2) would fix this.
3. **Static data**: Papers are fetched once and cached. The graph doesn't update in real-time as new papers appear on arXiv.
4. **No citation data**: Node importance is currently visual only (overlap = larger). Citation counts would add a meaningful size dimension.
5. **Single-user**: All state is in browser localStorage. No multi-device sync.
6. **No PDF content**: Only titles and abstracts are analyzed. Full paper text would yield much richer keywords and connections.

---

## File Size Reference

| File | Lines | Bytes | Role |
|------|-------|-------|------|
| `scan.config.js` | 55 | 1.9 KB | Configuration |
| `src/server/index.js` | 45 | 1.4 KB | Server entry |
| `src/server/arxiv.js` | 205 | 8.0 KB | Data pipeline |
| `src/server/routes.js` | 160 | 5.4 KB | API routes |
| `src/client/index.html` | 120 | 4.9 KB | SPA shell |
| `src/client/css/scan.css` | 810 | 19 KB | Stylesheet |
| `src/client/js/store.js` | 115 | 3.0 KB | State manager |
| `src/client/js/graph.js` | 310 | 10.8 KB | Graph engine |
| `src/client/js/background.js` | 120 | 3.8 KB | Particle system |
| `src/client/js/app.js` | 545 | 17.5 KB | App controller |
| **Total (source)** | **~2,485** | **~75 KB** | |
