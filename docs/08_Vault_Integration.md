# Vault Integration — Obsidian Export

> *Back to [[00_Index]] · See also [[05_Reader_UX]]*

## Overview

BASAIRA_ writes paper notes directly to an Obsidian vault as Markdown files. This creates a bidirectional workflow: discover papers in BASAIRA_'s graph → read and annotate → export to vault → connect with other knowledge in Obsidian.

The integration was modelled after the [[../../01-Projects/ANIMUS/README|ANIMUS]] journal project's vault-write pattern.

---

## Configuration

Set in `.env`:
```
VAULT_PATH=/home/BASE/BSR
VAULT_SCAN_FOLDER=98 - Journal/scan
```

Files are written to `{VAULT_PATH}/{VAULT_SCAN_FOLDER}/`. If the directory doesn't exist, it's created automatically.

If `VAULT_PATH` is not set, the vault save endpoint returns an error: "VAULT_PATH not configured in .env".

---

## Filename Convention

Files are named by **paper title** (sanitised for filesystem compatibility):

```
From Patterns to Policy - Smart Hospital Ecosystems.md
Predicting Neuromodulation Outcome for Parkinson's Disease with Generative Virtual Brain Model.md
```

Sanitisation:
- Remove `< > : " / \ | ? *`
- Normalise whitespace
- Cap at 120 characters

This was changed from arXiv ID-based naming (`2603-30004v1.md`) because paper titles are more recognisable when browsing the vault folder in Obsidian.

---

## Markdown Schema

```markdown
---
title: "Paper Title"
authors: ["Author A", "Author B"]
published: 2026-03-31T16:58:15Z
domains: [neuroscience, cognition]
tags: [keyword1, keyword2, keyword3]
arxiv: https://arxiv.org/abs/2603.30004v1
pdf: https://arxiv.org/pdf/2603.30004v1
source: BASAIRA_
saved: 2026-04-02
---

# Paper Title

**Authors:** Author A, Author B
**Published:** 31 March 2026
**Domains:** neuroscience, cognition
**Categories:** q-bio.NC · cs.CY

> [arXiv](https://arxiv.org/abs/...) · [PDF](https://arxiv.org/pdf/...)

## Abstract

Full abstract text here.

## Concept Explorations

### 🔍 blockchain security

> adopting blockchain technology for securing and protecting privacy

*Directly links blockchain to data security*

💬 Key finding for our review

> the emergence of intricate issues regarding security

*Highlights security challenges in fused tech*

## Annotations

### 🔴 Highlight 1

> 891 journal articles were analyzed

Large sample size

## Notes

User's freeform notes here.

## Tags

#keyword1 #keyword2 #keyword3 #scan

---
*Saved from BASAIRA_ — 2 April 2026*
```

---

## Annotation Separation

The export distinguishes two types of annotations:

### Concept Explorations
Grouped under `## Concept Explorations`, organised by concept name. Each concept gets a `### 🔍 concept name` heading with its passages as blockquotes, AI explanations in italics, and user comments prefixed with 💬.

### Manual Annotations
Listed under `## Annotations` with colour emoji labels:
- 🔴 = Pink (`#ffb3ba`)
- 🔵 = Blue (`#bae1ff`)
- 🟡 = Yellow (`#ffffba`)

Each includes the highlighted text as a blockquote and the user's comment below.

### Why Separate?
Concept explorations are AI-discovered with optional human commentary. Manual annotations are fully human-authored. Keeping them separate makes the vault note self-documenting — a reader can see which insights came from AI exploration vs. direct reading.

---

## Obsidian Compatibility

The exported Markdown is designed to work well in Obsidian:

- **YAML frontmatter** — Obsidian reads this for search, Dataview queries, and graph view
- **Hashtags** — `#keyword #scan` at the bottom, clickable in Obsidian
- **Wikilinks** — Not generated in V1, but the tags and domain names make papers discoverable via Obsidian's search and tag panes
- **Folder structure** — All BASAIRA_ exports go to a single subfolder, keeping them organised

### Dataview Query Example
In Obsidian, you could query all BASAIRA_ papers in a specific domain:
```dataview
TABLE authors, published, domains
FROM "98 - Journal/scan"
WHERE contains(domains, "neuroscience")
SORT published DESC
```

---

## API

### Save to Vault
```
POST /api/vault/save
Body: {
  paper: { id, title, authors, published, domains, categories, tags, arxivUrl, pdfUrl, abstract },
  annotations: [ { text, color, comment, type?, concept?, explanation?, userComment? } ],
  notes: "string"
}
Response: { success: true, filename: "Paper Title.md", path: "/full/path", bytes: 1234 }
```

### List Vault Files
```
GET /api/vault/list
Response: { files: [ { filename: "Paper Title.md", title: "...", saved: "2026-04-02" } ] }
```
