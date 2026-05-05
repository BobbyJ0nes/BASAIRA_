# BASAIRA_ — Documentation Index

> *Research Discovery Engine*
> *A research paper discovery engine rendered as a living knowledge graph.*
> *V1 · April 2026*

BASAIRA_ harvests recent research papers from arXiv across five interdisciplinary domains, maps them into a force-directed knowledge graph, and provides an in-app reading experience with AI-powered concept exploration. The aesthetic is deliberately computational — net art particle fields, neon domain colours, terminal typography on near-black. A practical research tool wrapped in generative visual texture.

**Live**: [basaira.vercel.app](https://basaira.vercel.app)
**Repo**: [github.com/BobbyJ0nes/BASAIRA_](https://github.com/BobbyJ0nes/BASAIRA_)

---

## Documentation Map

### Architecture & System
- [[01_System_Architecture]] — Full system overview: dual deployment (localhost Express + Vercel serverless), data flow, component diagram, API surface
- [[02_Data_Pipeline]] — arXiv fetching, paper parsing, edge computation, full-text extraction with math/figure preservation, Supabase caching
- [[03_AI_Integration]] — Gemini 2.5 Flash integration: concept extraction, passage finding, prompt engineering, JSON parsing

### Design & Philosophy
- [[04_Design_Philosophy]] — Net art aesthetic, domain colour system, typography, visual hierarchy, why it looks the way it does
- [[05_Reader_UX]] — The paper reading experience: section navigation, highlight system, hover previews, inline comments, click-to-pin, math rendering, figures

### Technical Reference
- [[06_Frontend_Architecture]] — Vanilla JS module structure, D3 graph engine, particle background, state management, no-build-step rationale
- [[07_Highlight_System]] — Deep dive into the annotation engine: text matching, preview rendering, persistence, the double-highlight bug and its fix
- [[08_Vault_Integration]] — Obsidian export: frontmatter schema, concept vs manual annotations, filename conventions

### Deployment & Infrastructure
- [[09_Bug_Chronicle]] — Every significant bug encountered and how it was resolved, in chronological order
- [[10_Configuration_Guide]] — Environment variables, domain configuration, adding new research areas, deployment options
- [[11_Deployment]] — Vercel + Supabase production deployment: architecture, serverless functions, database schema, migration guide

---

## Quick Orientation

```
BASAIRA_/
├── docs/                  ← you are here
├── api/                   ← Vercel serverless functions
│   ├── _lib/supabase.js   # Shared Supabase client
│   ├── papers.js           # GET /api/papers (full graph data)
│   ├── stats.js            # GET /api/stats
│   ├── domains.js          # GET /api/domains
│   ├── tags.js             # GET /api/tags
│   ├── search.js           # GET /api/search?q=
│   └── papers/[id]/
│       ├── content.js      # GET /api/papers/:id/content (arXiv HTML → sections)
│       ├── concepts.js     # GET /api/papers/:id/concepts (Gemini extraction)
│       └── explore.js      # POST /api/papers/:id/explore (Gemini passages)
├── src/
│   ├── client/             ← Static frontend (served by Vercel)
│   │   ├── index.html      # Main SPA shell (graph + list view)
│   │   ├── reader.html     # Paper reading view (KaTeX, figures)
│   │   ├── css/
│   │   │   ├── scan.css    # Main app styles (~1000 lines)
│   │   │   └── reader.css  # Reader view styles (~1000 lines)
│   │   └── js/
│   │       ├── app.js      # Main controller: data loading, filtering, panels
│   │       ├── graph.js    # D3 force graph engine
│   │       ├── background.js  # Particle drift background
│   │       ├── store.js    # localStorage state manager
│   │       └── reader.js   # Reader controller + highlight system (~1100 lines)
│   └── server/             ← Express server (localhost development)
│       ├── index.js        # Express entry point
│       ├── routes.js       # All API endpoints (localhost version)
│       ├── arxiv.js        # arXiv API fetcher + XML parser
│       ├── paper-parser.js # Full-text extractor from arXiv HTML
│       ├── search.js       # TF-IDF concept search engine
│       └── concepts.js     # Gemini AI concept explorer
├── supabase/
│   └── migration.sql       # Database schema (tables, RLS, indexes)
├── scan.config.js          # Domain definitions, server port, arXiv settings
├── vercel.json             # Vercel deployment config (rewrites, headers)
├── .env                    # API keys (gitignored)
├── .env.example            # Template for .env
└── package.json
```

## Related Context
- [[../../README]] — BASAIRA vault root
- This project sits within the broader BASAIRA research infrastructure alongside [[../../01-Projects/DIALEK/DIALEK_v2.5/docs/00_Index|DIALEK]] (voice-first language tutor) and [[../../01-Projects/ANIMUS/README|ANIMUS]] (journal system)

---

## Key Numbers (V1)
| Metric | Value |
|--------|-------|
| Papers in Supabase | 226 |
| Computed edges | 600 |
| Overlap papers | 93 |
| Research domains | 5 |
| Source files | 25 (client 10, server 6, api 9) |
| Total LOC | ~7,800 |
| npm dependencies | 4 (`express`, `xml2js`, `dotenv`, `@supabase/supabase-js`) |
| CDN dependencies | 2 (D3.js v7, KaTeX v0.16) |
| External APIs | arXiv, Gemini 2.5 Flash |
| Infrastructure | Vercel (serverless) + Supabase (Postgres) |
| Production URL | [basaira.vercel.app](https://basaira.vercel.app) |
