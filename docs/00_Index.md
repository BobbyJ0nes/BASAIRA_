# SCAN — Documentation Index

> *Systematic Curation & Analysis Network*
> *A research paper discovery engine rendered as a living knowledge graph.*
> *V1 · April 2026*

SCAN harvests recent research papers from arXiv across five interdisciplinary domains, maps them into a force-directed knowledge graph, and provides an in-app reading experience with AI-powered concept exploration. The aesthetic is deliberately computational — net art particle fields, neon domain colours, terminal typography on near-black. A practical research tool wrapped in generative visual texture.

---

## Documentation Map

### Architecture & System
- [[01_System_Architecture]] — Full system overview: client-server split, data flow, component diagram, API surface
- [[02_Data_Pipeline]] — arXiv fetching, paper parsing, edge computation, caching strategy, full-text extraction from arXiv HTML
- [[03_AI_Integration]] — Gemini 2.5 Flash integration: concept extraction, passage finding, prompt engineering, JSON parsing

### Design & Philosophy
- [[04_Design_Philosophy]] — Net art aesthetic, domain colour system, typography, visual hierarchy, why it looks the way it does
- [[05_Reader_UX]] — The paper reading experience: section navigation, highlight system, hover previews, inline comments, click-to-pin

### Technical Reference
- [[06_Frontend_Architecture]] — Vanilla JS module structure, D3 graph engine, particle background, state management, no-build-step rationale
- [[07_Highlight_System]] — Deep dive into the annotation engine: text matching, preview rendering, persistence, the double-highlight bug and its fix
- [[08_Vault_Integration]] — Obsidian export: frontmatter schema, concept vs manual annotations, filename conventions

### Project Context
- [[09_Bug_Chronicle]] — Every significant bug encountered and how it was resolved, in chronological order
- [[10_Configuration_Guide]] — Environment variables, domain configuration, adding new research areas, deployment options

---

## Quick Orientation

```
SCAN/
├── docs/                  ← you are here
├── src/
│   ├── client/
│   │   ├── index.html     # Main SPA shell (graph + list view)
│   │   ├── reader.html    # Paper reading view
│   │   ├── css/
│   │   │   ├── scan.css   # Main app styles (~1000 lines)
│   │   │   └── reader.css # Reader view styles (~900 lines)
│   │   └── js/
│   │       ├── app.js     # Main controller: data loading, filtering, panels
│   │       ├── graph.js   # D3 force graph engine
│   │       ├── background.js  # Particle drift background
│   │       ├── store.js   # localStorage state manager
│   │       └── reader.js  # Reader controller + highlight system (~1000 lines)
│   ├── server/
│   │   ├── index.js       # Express entry point
│   │   ├── routes.js      # All API endpoints
│   │   ├── arxiv.js       # arXiv API fetcher + XML parser
│   │   ├── paper-parser.js # Full-text extractor from arXiv HTML
│   │   ├── search.js      # TF-IDF concept search engine
│   │   └── concepts.js    # Gemini AI concept explorer
│   └── data/
│       └── papers-cache.json  # Cached paper + edge data (gitignored)
├── scan.config.js         # Domain definitions, server port, arXiv settings
├── .env                   # API keys + vault path (gitignored)
├── .env.example           # Template for .env
└── package.json
```

## Related Context
- [[../../README]] — BASAIRA vault root
- This project sits within the broader BASAIRA research infrastructure alongside [[../../01-Projects/DIALEK/DIALEK_v2.5/docs/00_Index|DIALEK]] (voice-first language tutor) and [[../../01-Projects/ANIMUS/README|ANIMUS]] (journal system)

---

## Key Numbers (V1)
| Metric | Value |
|--------|-------|
| Papers cached | ~226 |
| Computed edges | ~600 |
| Overlap papers | ~93–105 |
| Research domains | 5 |
| Source files | 16 |
| Total LOC | ~6,800 |
| Dependencies | 3 (`express`, `xml2js`, `dotenv`) |
| CDN dependencies | 2 (D3.js v7, KaTeX v0.16) |
| External APIs | arXiv, Gemini 2.5 Flash |
| Math elements/paper | ~100–300 (rendered by KaTeX) |
| Figures/paper | 0–10 (loaded from arXiv) |
