# Design Philosophy

> *Back to [[00_Index]] · See also [[05_Reader_UX]]*

## The Aesthetic Premise

SCAN is built at the intersection of two ideas: **practical research tooling** and **net art / algorithmic art aesthetics**. The interface should feel like a living computational artefact — something that emerged from a generative system — while being genuinely useful for navigating research literature.

This isn't decoration. The aesthetic serves a purpose: it makes spending time with papers feel like operating an instrument, not reading a spreadsheet. It borrows from the traditions of:

- **Net art** — early web experiments in computational visual form
- **Algorithmic art** — code-generated visual patterns, particle systems, emergent behaviour
- **Terminal culture** — monospace typography, cursor blinks, status indicators
- **Data visualisation** — force-directed graphs as genuine analytical tools, not just pretty pictures

---

## The Five-Domain Colour System

Each research domain has a dedicated neon colour that appears everywhere: graph nodes, sidebar filters, detail panels, reader domain tags, vault exports.

| Domain | Hex | CSS Variable | Character |
|--------|-----|-------------|-----------|
| Neuroscience | `#00f0ff` | `--neuroscience` | Cyan — clinical, electric, neural |
| AI | `#ff00aa` | `--ai` | Magenta — synthetic, computational |
| Cybernetics | `#ffaa00` | `--cybernetics` | Amber — signal, feedback, warmth |
| Cognition | `#00ff88` | `--cognition` | Lime — organic, alive, mental |
| Biomimetics | `#aa44ff` | `--biomimetics` | Violet — hybrid, evolved, strange |

### Why These Colours
They were chosen for **maximum perceptual separation on dark backgrounds**. On the near-black `#0a0a0f` base, all five colours are instantly distinguishable. They also encode a loose metaphorical mapping: cyan for the biological substrate of the brain, magenta for the synthetic intelligence layer, amber for the feedback systems between them, lime for the cognitive processes that emerge, violet for the bio-inspired synthesis.

### Overlap Papers
Papers that belong to multiple domains appear as **white nodes** in the graph. White signals "this paper bridges domains" — it doesn't belong to any single colour, it belongs to the intersections. The overlap indicator ("15 overlap papers across selected domains") appears when multiple domains are selected.

---

## Typography

Three typefaces serve distinct visual roles:

| Typeface | CSS Variable | Usage |
|----------|-------------|-------|
| `SF Mono, Consolas, monospace` | `--font-mono` | Labels, section headers, status text, tags, navigation, annotations |
| `Inter, system-ui, sans-serif` | `--font-sans` | Paper titles, body text, author names |
| (serif, implied) | — | Not used in V1, reserved for future paper content |

Monospace dominates the interface chrome. This is intentional — it creates the "instrument panel" feel. Body text (paper abstracts, full paper content) uses sans-serif for readability at length.

### Letter Spacing
Section labels use `letter-spacing: 3px` with `text-transform: uppercase` — e.g., `A N N O T A T I O N S`, `C O N C E P T   E X P L O R E R`. This is a direct borrowing from terminal and net art conventions. It makes labels feel like status readouts rather than headings.

---

## Visual Layers

The interface is built in three depth layers:

### Layer 1: Particle Field (background)
`background.js` renders 80 drifting dots on a canvas behind everything. They drift slowly, form faint connections when close, and repel from the mouse cursor. This creates a subtle sense of life — the background is never static, never the same twice. It's algorithmically generated ambiance.

### Layer 2: Content (midground)
The graph, the list cards, the paper text, the sidebar — all the functional content. Dark card backgrounds (`#12121a`) float over the particle field with subtle borders.

### Layer 3: Overlays (foreground)
Detail panel (slides in from right), highlight popups, toast notifications, the colour picker. These use `z-index` stacking and backdrop blur to feel like they're floating above the content.

### Scanline Overlay
The `body::after` pseudo-element renders faint horizontal scanlines (1px transparent lines every 4px) at very low opacity. This is pure aesthetic — it adds texture that evokes CRT monitors. Disabled in the reader view where it would interfere with reading.

---

## The Graph as Primary Interface

The force-directed graph isn't a gimmick. It's the primary way to discover papers. The spatial layout encodes real information:

- **Clusters** = papers that share many keywords/authors/categories. A dense cluster is a cohesive research area.
- **Bridges** = papers with edges spanning two clusters. These are the interdisciplinary connections SCAN exists to surface.
- **Isolates** = papers with few or no edges. These are either unique or from an under-represented area.
- **Colour mixing** = when you see cyan and magenta nodes clustered together, that's neuroscience and AI converging.

### Combined Filtering
Domain filters, tag filters, and search all compose. Selecting "Neuroscience" + "AI" + tag "neural" shows only papers that match ALL three criteria. On the graph, papers belonging to multiple active domains get a white ring outline to indicate overlap.

---

## The Reader as Analytical Tool

The reader view (see [[05_Reader_UX]]) follows a different aesthetic logic: it's designed for sustained reading and annotation, not for discovery. The dark theme persists but the typography shifts to prioritise readability:

- Larger font size (16px, 1.85 line height)
- Justified text with hyphenation
- Section headings in sans-serif
- Wider line length (max-width 800px)

The left-rail navigation (collapsed numbers that expand to section titles on hover) borrows from academic PDF readers but executed in the net art style — minimal chrome, information on demand.

---

## Intentional Constraints

Several design constraints are deliberate:

### Mathematical Notation
LaTeX equations are rendered by KaTeX in the reader, styled to match the dark theme:

- **Inline math** inherits `var(--text-primary)` colour, flowing seamlessly with body text
- **Display math** is centred in a subtly tinted block with a left border accent — the same accent pattern used by hover previews and inline comment inputs, creating visual consistency across interactive elements
- KaTeX's default sizing is used — equations feel part of the paper, not overlaid decoration
- If rendering fails, raw LaTeX is shown in amber (`var(--cybernetics)` colour) — clearly a fallback, not a broken state

### Paper Figures
Figures load directly from arXiv's servers and are styled to sit within the reading flow:

- Bordered with `var(--border)` and a subtle white-tint background to contrast with the dark page
- Captions in mono font below, matching the annotation/label style
- Figures are collected into a "Figures" section at the end — this mirrors how many academic papers present figures, and avoids layout complexity of inline figure placement

---

## Intentional Constraints

| Constraint | Rationale |
|-----------|-----------|
| Dark mode only | The neon colours only work on dark. Light mode would require a completely different palette. |
| No PDF embedding | PDFs break the aesthetic and UX. Full text is extracted and rendered natively via arXiv HTML. |
| No user accounts | This is a personal tool. localStorage is the only persistence layer. |
| No real-time updates | Papers refresh on load or button click, not via WebSocket. Simplicity over liveness. |
| Maximum 600 edges | More edges make the graph unreadable. The cap forces the system to show only meaningful connections. |
| Figures at end, not inline | arXiv HTML places figures after sections. Attempting to reflow them inline would require cross-referencing figure citations — complexity not justified for V1. |
