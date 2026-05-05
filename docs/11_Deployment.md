# Deployment — Vercel + Supabase

> *Back to [[00_Index]] · See also [[01_System_Architecture]], [[10_Configuration_Guide]]*

## Overview

BASAIRA_ runs in two modes:

| Mode | Frontend | API | Database | Use |
|------|----------|-----|----------|-----|
| **Production** | Vercel static hosting | Vercel serverless functions (`/api`) | Supabase Postgres | [basaira.vercel.app](https://basaira.vercel.app) |
| **Development** | Express static serving | Express routes (`/api`) | Filesystem (`papers-cache.json`) | `localhost:3000` |

The frontend code is identical in both modes — it calls `/api/papers`, `/api/stats`, etc. The backend is either Express (dev) or Vercel functions (prod), but they return the same JSON shapes.

---

## Production Architecture

```
Browser (basaira.vercel.app)
    │
    ├── Static files (src/client/*) ← Vercel CDN
    │
    └── /api/* requests ← Vercel Serverless Functions
            │
            ├── api/papers.js         → Supabase: SELECT from papers + edges
            ├── api/stats.js          → Supabase: COUNT queries
            ├── api/domains.js        → Supabase: aggregate domains
            ├── api/tags.js           → Supabase: aggregate tags
            ├── api/search.js         → Supabase: load all → TF-IDF in-function
            │
            ├── api/papers/[id]/content.js
            │       ├── Check Supabase paper_content cache
            │       ├── If miss: fetch arxiv.org/html/{id}
            │       ├── Parse HTML → sections with math/figures
            │       └── Cache result in Supabase paper_content
            │
            ├── api/papers/[id]/concepts.js
            │       ├── Check Supabase paper_concepts cache
            │       ├── If miss: call Gemini 2.5 Flash
            │       └── Cache result in Supabase paper_concepts
            │
            └── api/papers/[id]/explore.js
                    ├── Load sections from Supabase paper_content
                    ├── Call Gemini 2.5 Flash (passage finding)
                    └── Verify passages, return results
```

---

## Supabase Schema

Four tables, all with Row Level Security enabled:

### `papers` — 226 rows
```sql
id TEXT PRIMARY KEY           -- arXiv ID (e.g., "2603.30004v1")
title TEXT
authors TEXT[]                -- Postgres array
abstract TEXT
published TIMESTAMPTZ
categories TEXT[]             -- arXiv categories
domains TEXT[]                -- BASAIRA_ domain keys
tags TEXT[]                   -- Extracted keywords
is_overlap BOOLEAN
arxiv_url TEXT
pdf_url TEXT
```

### `edges` — 600 rows
```sql
id BIGINT (auto)
source TEXT → papers(id)
target TEXT → papers(id)
weight REAL                   -- Edge strength (1.5+ threshold)
shared_tags TEXT[]
UNIQUE(source, target)
```

### `paper_content` — cached on first read
```sql
paper_id TEXT → papers(id)
sections JSONB                -- [{id, title, paragraphs[], isSubsection}]
source TEXT                   -- 'html' or 'abstract'
total_chars INTEGER
fetched_at TIMESTAMPTZ
```

### `paper_concepts` — cached on first extraction
```sql
paper_id TEXT → papers(id)
concepts JSONB                -- [{concept, description}]
extracted_at TIMESTAMPTZ
```

### RLS Policies
- **Public read** (`anon` role): SELECT on all four tables — the app has no auth, all data is public
- **Service write** (full access): ALL operations — used by serverless functions via the secret key

### Indexes
- GIN indexes on `papers.domains` and `papers.tags` for array containment queries
- B-tree indexes on `edges.source` and `edges.target` for join performance

---

## Vercel Configuration (`vercel.json`)

```json
{
  "outputDirectory": "src/client",
  "rewrites": [
    { "source": "/api/papers/:id/content", "destination": "/api/papers/[id]/content" },
    { "source": "/api/papers/:id/concepts", "destination": "/api/papers/[id]/concepts" },
    { "source": "/api/papers/:id/explore", "destination": "/api/papers/[id]/explore" },
    ...
  ]
}
```

- **`outputDirectory: src/client`** — Vercel serves static files from here (index.html, reader.html, CSS, JS)
- **Rewrites** — map Express-style `:id` params to Vercel's `[id]` file convention
- **Cache headers** — API responses cached for 60s at edge, stale-while-revalidate for 300s

### Function Timeouts
Vercel Hobby plan: 10s default, extended to 25s for content/concepts/explore:
```javascript
export const config = { maxDuration: 25 };
```

This covers:
- arXiv HTML fetch: 1-3s
- Gemini API call: 2-5s (occasionally up to 15s for large papers)

---

## Environment Variables

Set in Vercel dashboard (**Settings → Environment Variables**):

| Variable | Value | Used by |
|----------|-------|---------|
| `GEMINI_API_KEY` | Google AI Studio API key | concepts.js, explore.js |
| `SUPABASE_URL` | `https://wljgxssahxsiwxciocjc.supabase.co` | All API functions |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` | All API functions (write access) |

### Key Types
BASAIRA_ uses Supabase's **new-style keys** (not legacy JWT):
- **Publishable** (`sb_publishable_...`): Not used server-side. Could be used client-side in future.
- **Secret** (`sb_secret_...`): Used in all serverless functions. Bypasses RLS. Never exposed to client.

---

## Deployment Flow

```
Developer pushes to main
    → GitHub triggers Vercel webhook
    → Vercel builds:
        1. Detects api/ directory → builds serverless functions
        2. Copies src/client/ → serves as static
        3. Applies vercel.json rewrites
    → Deploys to basaira.vercel.app
    → Functions connect to Supabase at runtime
```

No build step for the frontend. No bundling. Functions are Node.js 18+ with ES modules.

---

## Data Seeding

The initial 226 papers + 600 edges were seeded from the localhost `papers-cache.json` using a one-time script:

```javascript
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

// Batch upsert papers (50 at a time)
for (let i = 0; i < papers.length; i += 50) {
  await supabase.from('papers').upsert(papers.slice(i, i + 50));
}

// Batch upsert edges (100 at a time)
for (let i = 0; i < edges.length; i += 100) {
  await supabase.from('edges').upsert(edges.slice(i, i + 100));
}
```

To refresh papers from arXiv in production, a refresh endpoint would need to be added (not yet implemented for Vercel — the localhost Express server has `POST /api/refresh`).

---

## Localhost vs Production Differences

| Feature | Localhost (Express) | Production (Vercel) |
|---------|-------------------|-------------------|
| Paper cache | `papers-cache.json` (filesystem) | `papers` + `edges` tables (Supabase) |
| Full text cache | In-memory `Map` | `paper_content` table |
| Concept cache | In-memory `Map` | `paper_concepts` table |
| Vault export | Writes `.md` files to disk | Not available (no filesystem) |
| Data refresh | `POST /api/refresh` | Not yet implemented |
| arXiv fetch | Direct from server | Via serverless function (25s timeout) |
| Startup time | ~5s (load cache) | Instant (cold start ~1-2s per function) |

---

## Cost

All services are on free tiers:

| Service | Tier | Limit | BASAIRA_ Usage |
|---------|------|-------|---------------|
| Vercel | Hobby (free) | 100GB bandwidth, 10s default timeout | ~500MB/month |
| Supabase | Free | 500MB database, 50K rows | ~5MB, ~1100 rows |
| Gemini | Free | 1M tokens/day | ~50K tokens/session |
| arXiv | Free | Rate-limited (3.5s between requests) | ~200 requests/refresh |
