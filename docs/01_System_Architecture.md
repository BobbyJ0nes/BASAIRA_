# System Architecture

> *Back to [[00_Index]]*

## Overview

BASIRA_ is a two-tier application: a Node.js Express server that fetches, parses, and caches research papers, and a vanilla JavaScript frontend that renders them as an interactive knowledge graph. There is no build step, no bundler, no framework — raw ES modules served as static files.

The server handles three categories of work:
1. **Data acquisition** — fetching from arXiv API, parsing XML, computing paper relationships
2. **Content extraction** — pulling full paper text from arXiv HTML pages (LaTeXML format)
3. **AI operations** — calling Gemini 2.5 Flash for concept extraction and passage finding

The client handles all rendering, state management, and user interaction without any server-side rendering.

---

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                           BROWSER                               │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ GraphEngine  │  │  BgCanvas    │  │   App Controller      │ │
│  │  (D3.js v7)  │  │  (particles) │  │   (app.js)            │ │
│  │              │  │              │  │                        │ │
│  │ • Force sim  │  │ • 80 dots   │  │ • Data loading         │ │
│  │ • SVG nodes  │  │ • Drift     │  │ • Domain/tag/search    │ │
│  │ • Zoom/pan   │  │ • Mouse     │  │ • Detail panel         │ │
│  │ • Combined   │  │   repulsion │  │ • List view            │ │
│  │   filtering  │  │ • Faint     │  │ • Read Later queue     │ │
│  │              │  │   lines     │  │ • View switching       │ │
│  └──────┬───────┘  └─────────────┘  └───────────┬────────────┘ │
│         │                                        │              │
│  ┌──────┴────────────────────────────────────────┴────────────┐ │
│  │                   Store (store.js)                          │ │
│  │  localStorage: readLater, notes, domains, highlights        │ │
│  │  Ephemeral: activeTag, searchQuery, selectedPaper           │ │
│  └────────────────────────────┬───────────────────────────────┘ │
│                               │                                 │
│  ┌────────────────────────────┴───────────────────────────────┐ │
│  │              Reader (reader.js + reader.html)               │ │
│  │  • Full-text paper display (arXiv HTML extraction)          │ │
│  │  • Highlight system (manual + AI concept highlights)        │ │
│  │  • Section navigation (left rail)                           │ │
│  │  • Concept Explorer (Gemini-powered)                        │ │
│  │  • Vault export                                             │ │
│  └────────────────────────────┬───────────────────────────────┘ │
│                               │ fetch()                         │
└───────────────────────────────┼─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXPRESS SERVER (:3000)                        │
│                                                                 │
│  Static serving ── src/client/**                                │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    API Routes (/api)                      │   │
│  │                                                           │   │
│  │  GET  /papers          → full graph (papers + edges)      │   │
│  │  GET  /papers/:id      → single paper                     │   │
│  │  GET  /papers/:id/content → full text (arXiv HTML parse)  │   │
│  │  GET  /papers/:id/concepts → AI concept extraction        │   │
│  │  POST /papers/:id/explore  → AI passage finding           │   │
│  │  GET  /search?q=       → conceptual TF-IDF search         │   │
│  │  GET  /domains         → domain statistics                │   │
│  │  GET  /tags            → tag frequency list               │   │
│  │  GET  /stats           → overview numbers                 │   │
│  │  POST /refresh         → re-fetch from arXiv              │   │
│  │  POST /vault/save      → write to Obsidian vault          │   │
│  │  GET  /vault/list      → list saved vault files           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐   │
│  │ arxiv.js │  │search.js │  │concepts. │  │paper-parser.  │   │
│  │          │  │          │  │   js     │  │    js         │   │
│  │ Fetch    │  │ TF-IDF   │  │ Gemini   │  │ arXiv HTML    │   │
│  │ Parse    │  │ Cosine   │  │ 2.5 Flash│  │ → structured  │   │
│  │ Edge     │  │ Concept  │  │ Concept  │  │   sections    │   │
│  │ compute  │  │ expand   │  │ extract  │  │              │   │
│  └──────────┘  └──────────┘  └──────────┘  └───────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │            papers-cache.json (filesystem)                 │   │
│  │  { papers: [...], edges: [...] }                          │   │
│  │  Refreshed on first run or when >24h old                  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Request Flow

### Graph View Load
1. Browser loads `index.html` → loads `scan.css`, `store.js`, `background.js`, `graph.js`, `app.js`
2. `app.js` calls `init()` → fetches `/api/papers`, `/api/domains`, `/api/tags`, `/api/stats` in parallel
3. Sidebar rendered: domain filters, tag cloud, read later queue
4. `GraphEngine.setData()` receives 226 papers + 600 edges → D3 force simulation starts
5. `BgCanvas.init()` spawns 80 drifting particles on a separate canvas

### Paper Reader Load
1. Browser loads `reader.html?id=2603.30004v1` (loads KaTeX CSS/JS from CDN)
2. `reader.js` calls `initReader()` → fetches `/api/papers/:id/content` and `/api/papers`
3. Content endpoint triggers `paper-parser.js` → fetches `https://arxiv.org/html/{id}` → parses LaTeXML HTML into structured sections, preserving math as `<scan-math>` placeholders and figures as `<scan-figure>` placeholders
4. Sections rendered with `renderRichContent()` converting placeholders to KaTeX-ready spans and `<figure>` elements. Left rail nav built.
5. `renderMathElements()` calls KaTeX on all `.scan-math` spans → LaTeX rendered to typeset notation
6. Existing annotations loaded from `localStorage`
7. `applyHighlights()` walks text nodes, wraps matched text, then re-renders math

### Concept Explorer Flow
1. User clicks concept input → focus triggers `GET /api/papers/:id/concepts`
2. Server sends paper text to Gemini → extracts 8-12 concept tags → returns JSON
3. User clicks a concept tag or types one → `POST /api/papers/:id/explore`
4. Server sends paper text + concept to Gemini → finds 3-6 exact passages → verifies each exists in text
5. User clicks "⊕ Highlight all" → annotations created in localStorage → `applyHighlights()` renders them

---

## Why No Build Step

V1 deliberately avoids React, Vue, bundlers, TypeScript, or any build tooling. The rationale:

1. **Speed of iteration** — Save file, refresh browser, see changes. No compile wait.
2. **Transparency** — Every file the browser loads is the file you wrote. No source maps needed.
3. **Minimal dependency surface** — Three npm packages (`express`, `xml2js`, `dotenv`). Nothing else.
4. **Appropriate complexity** — BASIRA_ is a personal research tool, not a team product. The codebase is ~6,300 LOC across 16 files. This is comfortably within vanilla JS territory.
5. **D3 works best raw** — D3's functional paradigm maps naturally to vanilla JS. Wrapping it in React creates more problems than it solves.

The trade-off is explicit: no type safety, no component reuse beyond copy-paste, no hot module replacement. For a tool this size, those trade-offs are acceptable.

---

## Server Lifecycle

```
start.sh / npm start
  → node src/server/index.js
    → import dotenv/config (loads .env)
    → import express, routes
    → initData()
      → check papers-cache.json age
      → if stale or missing: fetchAllPapers() from arXiv (5 domains × 40 papers)
      → compute edges (shared keywords, authors, categories)
      → write cache
    → app.listen(3000)
```

The server holds all paper data in memory after loading from cache. There is no database. The full text cache (`fullTextCache`) is a `Map` that lives for the duration of the server process — paper HTML is fetched once from arXiv and then served from memory on subsequent requests.

---

## Two-Page SPA

BASIRA_ has exactly two HTML pages:

| Page | URL | Purpose |
|------|-----|---------|
| `index.html` | `/` | Graph view + list view + sidebar + detail panel |
| `reader.html` | `/reader.html?id={arxivId}` | Full-text reader + highlights + concept explorer |

Navigation between them is standard `<a href>` links (the "Read" button in the detail panel). No client-side routing. This keeps the mental model simple and makes each page independently loadable.
