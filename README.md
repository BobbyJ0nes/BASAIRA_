# SCAN — Systematic Curation & Analysis Network

> A research paper discovery engine rendered as a living knowledge graph.  
> V1 · April 2026

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/YOUR_USER/SCAN.git
cd SCAN
npm install

# Configure
cp .env.example .env
# Edit .env — add your Gemini API key and (optionally) Obsidian vault path

# Run
npm start
# → http://localhost:3000
```

**Requirements:** Node.js 18+  
**Optional:** [Gemini API key](https://aistudio.google.com/apikey) for the Concept Explorer  
**Optional:** Obsidian vault path for paper exports

> **Note:** SCAN requires a Node.js server (Express) for the arXiv API, full-text parser, and Gemini integration. It cannot run as a static site on GitHub Pages alone. For hosting, use [Render](https://render.com), [Railway](https://railway.app), or [Vercel](https://vercel.com) (serverless).

### 📖 Full Documentation
See [`docs/00_Index.md`](docs/00_Index.md) for the complete documentation — architecture, design philosophy, AI integration, highlight system internals, bug chronicle, and configuration guide.

---

## What This Is

SCAN harvests the latest research papers from arXiv, maps them into an interconnected knowledge graph, and serves the whole thing as a localhost web application. You explore papers the way you explore an Obsidian vault — by navigating connections, not by scrolling lists.

Papers are **nodes**. Shared keywords, authors, and arXiv categories form **edges**. The graph self-organizes by relatedness. You click into any node to read the abstract, save it for later, take notes, or export it as Obsidian-compatible Markdown.

The aesthetic is deliberately computational — net art particle fields, monospace typography, scanline overlays, terminal cursor blinks, neon domain colors on near-black backgrounds. Practical information density wrapped in generative visual texture.

---

## Domains

SCAN tracks five research areas. Each has a dedicated color throughout the interface.

| Domain | Color | arXiv Source | What It Covers |
|--------|-------|-------------|----------------|
| **Neuroscience** | Cyan `#00f0ff` | `q-bio.NC` | Computational & quantitative neuroscience — brain networks, connectomics, EEG/fMRI, neural coding, synaptic dynamics |
| **Artificial Intelligence** | Magenta `#ff00aa` | `cs.AI` `cs.LG` | Machine learning, LLMs, transformers, reinforcement learning, agents, generative models |
| **Cybernetics & Systems** | Amber `#ffaa00` | `cs.SY` `eess.SY` | Control theory, dynamical systems, feedback, stability, adaptive systems, MPC |
| **Cognition** | Lime `#00ff88` | `cs.HC` + overlap from `q-bio.NC` | Human-computer interaction, cognitive science, perception, decision making, metacognition |
| **Biomimetics** | Violet `#aa44ff` | `cs.NE` + bio-inspired robotics | Neuroevolution, swarm intelligence, evolutionary algorithms, artificial life, cellular automata |

Papers that span multiple domains appear as **white nodes** and are tagged `OVERLAP` in the detail panel.

---

## Quick Start

```bash
cd /home/BASE/BSR/BASAIRA/01-Projects/SCAN

# Install dependencies (first time only)
npm install

# Start the server
npm start

# Open in browser
# → http://localhost:3000
```

On first launch, the server fetches ~200+ papers from arXiv (takes ~60 seconds due to rate limiting). Subsequent launches load from the JSON cache in under a second.

---

## Features

### Graph View
The default view. A D3.js force-directed graph where every paper is a circle, colored by its primary domain, sized larger if it spans multiple domains. Edges connect papers that share keywords, authors, or categories. The layout self-organizes — tightly related papers cluster together.

**Interactions:**
- **Pan & zoom** — scroll wheel or pinch, drag to pan
- **Hover a node** — tooltip shows title + domains; all unrelated nodes dim; connected neighbors highlight
- **Click a node** — opens the detail panel; node gets a selected glow + visible label
- **Drag a node** — manually reposition it in the force layout

### List View
Toggle via the sidebar. A responsive card grid showing every paper with its domain dots, title, authors, 3-line abstract preview, and keyword tags. Hover reveals a star button to add to Read Later.

### Detail Panel
Slides in from the right when you click any paper (graph node or list card). Contains:

- **Domain bar** — colored tags for each domain the paper belongs to, plus an OVERLAP badge
- **Title** — full paper title
- **Date + arXiv link** — published date and clickable `arXiv:ID` link
- **Authors** — full author list
- **Abstract** — complete abstract text; selecting text auto-saves it as a highlight
- **Keywords** — extracted keywords, clickable to filter the graph/list by that term
- **Categories** — raw arXiv category codes
- **Notes** — a textarea that auto-saves to localStorage on a 500ms debounce
- **Connected Papers** — list of linked papers ranked by edge weight, clickable to navigate

**Action buttons** in the panel header:
- ☆ / ★ — toggle Read Later
- PDF — opens the arXiv PDF in a new tab
- arXiv — opens the arXiv abstract page in a new tab
- ⤓ — exports this paper as a Markdown file

### Sidebar

| Section | What It Does |
|---------|-------------|
| **View** | Toggle between Graph and List views |
| **Domains** | Click to filter. "All Domains" resets. Multiple domains can be active simultaneously |
| **Top Tags** | The 30 most frequent extracted keywords across all papers. Click to filter; click again to clear |
| **Read Later** | Your saved queue. Shows paper titles with domain-colored dots. Click any to open its detail panel |

### Search
The search bar in the header (also activated by pressing `/`) does real-time filtering across paper titles, abstracts, author names, and tags. Works in both graph and list views. Press `Esc` to clear and close.

### Read Later Queue
Star any paper via the detail panel or list card. Starred paper IDs persist in `localStorage` under the key `scan_state`. The queue appears in the sidebar and survives page reloads.

### Text Highlighting
Select any text in the abstract within the detail panel. Selections longer than 5 characters are automatically saved to `localStorage` under the paper's ID. A notification confirms the save.

### Notes
Each paper has a dedicated notes textarea in the detail panel. Content auto-saves to `localStorage` 500ms after you stop typing.

### Export to Vault
Two export paths:

1. **Single paper** — click the ⤓ button in a paper's detail panel. Downloads one `.md` file.
2. **Bulk export** — click the ⤓ button in the header. Opens a modal showing how many papers are in your queue. Click "Export All" to download them all as individual `.md` files.

Exported Markdown includes YAML frontmatter compatible with Obsidian:

```yaml
---
title: "Paper Title"
authors: ["Author One", "Author Two"]
published: 2026-03-31T17:54:27Z
domains: [neuroscience, cognition]
tags: [neural, brain, cortex]
arxiv: https://arxiv.org/abs/2603.30004v1
pdf: https://arxiv.org/pdf/2603.30004v1
source: SCAN
---
```

Plus a body with the full abstract, links, hashtags, and a notes section.

### Data Refresh
Click the ⟳ button in the header to re-fetch all papers from arXiv. This takes ~60 seconds. The cache is also automatically refreshed if it's older than 24 hours.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus search bar |
| `Esc` | Close detail panel / blur search |

---

## Visual Design

The aesthetic draws from three traditions:

**Net art** — The interface treats data as a living organism. Particles drift, pulse, and repel the cursor. The graph breathes. Connections appear and dissolve.

**Terminal culture** — JetBrains Mono everywhere for data. 9px uppercase section labels with 3px letter-spacing. A blinking cursor in the logo. Scanline overlay across the entire viewport.

**Computational color** — Five neon accent colors on a near-black (`#050508`) background. White for overlap nodes. Magenta selection highlights. Glow effects on hover via SVG `feGaussianBlur` filters.

The generative background is a canvas-based particle system: ~100 particles in the five domain colors drift, pulse sinusoidally, and form faint inter-particle connections when close. The cursor repels nearby particles.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Server | Node.js + Express | Minimal, no-opinion, fast to build |
| Data source | arXiv Atom API | Open, no auth needed, comprehensive coverage |
| XML parsing | xml2js | Reliable Atom → JSON |
| Frontend | Vanilla JS | No framework overhead, full control |
| Graph | D3.js v7 | Industry standard for force-directed layouts |
| Styling | CSS custom properties + Grid | Zero dependencies, full design control |
| State | localStorage | No database needed for personal tool |
| Build step | None | ES modules served directly, no bundler |

---

## Project Structure

```
SCAN/
├── docs/
│   ├── README.md              ← You are here
│   ├── ARCHITECTURE.md        ← System design, data flow, edge logic
│   └── PLAN.md                ← Feature checklist, data stats, V2 backlog
├── src/
│   ├── server/
│   │   ├── index.js           ← Express entry point, static serving, startup
│   │   ├── arxiv.js           ← arXiv fetcher, XML parser, keyword extractor, edge computer
│   │   └── routes.js          ← REST API endpoints, cache management, Markdown export
│   ├── client/
│   │   ├── index.html         ← SPA shell — header, sidebar, main area, modals
│   │   ├── css/
│   │   │   └── scan.css       ← Complete stylesheet (~800 lines)
│   │   └── js/
│   │       ├── store.js       ← localStorage-backed reactive state manager
│   │       ├── graph.js       ← D3.js force graph engine
│   │       ├── background.js  ← Generative particle canvas
│   │       └── app.js         ← Main controller — data loading, UI wiring, interactions
│   └── data/
│       └── papers-cache.json  ← Cached paper + edge data (auto-generated)
├── scan.config.js             ← Domain definitions, colors, arXiv queries, constants
├── package.json               ← Dependencies: express, xml2js
└── serve.sh                   ← Shell wrapper for persistent background runs
```

---

## Configuration

All domain and server settings live in `scan.config.js`:

```javascript
// Add a new domain
export const DOMAINS = {
  your_domain: {
    label: 'Your Domain',
    color: '#hex',
    colorRGB: 'r, g, b',
    queries: ['cat:cs.XX'],        // arXiv query strings
    keywords: ['term1', 'term2'],  // Domain-specific keywords (for reference)
    maxResults: 40                 // Papers to fetch per query
  }
};

// Server
export const SERVER_PORT = 3000;
export const CACHE_MAX_AGE_HOURS = 24;
export const ARXIV_DELAY_MS = 3500;  // Delay between API calls (rate limiting)
```

To add the new domain to the graph, you also need to add its category mapping in `src/server/arxiv.js` → `mapDomains()` and its color in `src/client/js/graph.js` → `DOMAIN_COLORS`.

---

*Built with obsessive intentionality. Papers as constellations.*
