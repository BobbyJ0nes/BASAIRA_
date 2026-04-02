# Reader UX — The Paper Reading Experience

> *Back to [[00_Index]] · See also [[04_Design_Philosophy]], [[07_Highlight_System]]*

## Overview

The reader (`reader.html` + `reader.js`) is a dedicated view for reading, annotating, and exploring a single paper. It fetches the full text from arXiv's HTML rendering service and displays it in a purpose-built reading environment — not a PDF viewer, not an iframe, but native HTML styled to match BASIRA_'s aesthetic.

---

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│  ← BASIRA_                              ☆  ⤓ VAULT  PDF  arXiv │  ← header (sticky)
├──┬──────────────────────────────────────────┬───────────────┤
│  │                                          │ ANNOTATIONS   │
│ 1│  [Domain Tags]  [OVERLAP]                │ "quoted text" │
│ 2│                                          │  comment      │
│ 3│  Paper Title                             │  × remove     │
│ ·│  Date · arXiv link · categories          │               │
│ ·│  Authors                                 │ NOTES         │
│ 5│                                          │ [textarea]    │
│ 6│  FULL TEXT · 11 SECTIONS                 │               │
│ ·│                                          │ CONCEPT       │
│ ·│  Abstract                                │ EXPLORER      │
│ 8│  ─────────────────────────               │ [input] [⟳]   │
│ ·│  This study examines the evolution...    │ [tag] [tag]   │
│10│                                          │ 5 passages    │
│11│  1 Introduction                          │ [result]      │
│  │  ─────────────────────────               │ [result]      │
│  │  Intelligent and secure smart...         │               │
│  │                                          │ CONNECTED     │
│  │  ...                                     │ PAPERS        │
├──┴──────────────────────────────────────────┤               │
│  [tags]                                      │               │
└──────────────────────────────────────────────┴──────[◀]──────┘
                                                 sidebar toggle
```

### Left Rail — Section Navigation
A fixed panel on the left edge, 28px wide when collapsed. Shows section numbers (1, 2, 3... with `·` for subsections). On hover, expands to 240px showing full section titles. Click any item to smooth-scroll to that section. The active section updates on scroll.

**Design rationale**: Traditional TOCs at the top of the document take up valuable reading space and require scrolling back to navigate. The left rail is always accessible without leaving the current reading position. Collapsed state keeps it minimal; expanded state gives full context.

### Main Content
Full paper text rendered in structured sections with proper headings (`<h2>` for sections, smaller for subsections). Text is justified with hyphenation, 16px at 1.85 line height. Paragraphs are split on double newlines from the source text, or into 3-sentence chunks from single-block abstracts.

A source badge at top indicates: `FULL TEXT · 11 SECTIONS` (green) or `Abstract only · Open PDF for full paper` (amber).

### Math Rendering
LaTeX equations are rendered client-side by [KaTeX](https://katex.org/) (loaded from CDN, ~200KB):

- **Inline math** flows seamlessly with body text — variables like *w*ᵢⱼ, *p*(*w*), Greek letters *α*, *ε*, *μ* render at text size
- **Display math** (block equations) renders centred with a subtle left border accent and horizontal scroll for wide equations
- The LaTeX source comes from arXiv's `<math alttext="...">` attribute — every equation in the HTML carries its original LaTeX
- If KaTeX fails to render a particular expression (rare), the raw LaTeX string is shown as fallback with an amber tint
- Math re-renders after every highlight operation since DOM manipulation can destroy KaTeX output

### Figures
Paper diagrams and plots are extracted from arXiv's HTML and rendered as images:

- Images load directly from arXiv's servers (e.g., `https://arxiv.org/html/2603.29597v1/fig1.jpg`) — no proxy needed, arXiv sets `Access-Control-Allow-Origin: *`
- Figures appear in a dedicated **Figures** section at the end of the paper (arXiv HTML typically places figures after the main text, not inline)
- Each figure has its caption rendered below in mono font
- Images are lazy-loaded and scale to fit the reader's max-width
- Not all papers have figures in their HTML version — depends on the LaTeX source

### Right Sidebar (collapsible)
Four sections stacked vertically:
1. **Annotations** — saved highlights with quoted text, comments, and remove buttons
2. **Notes** — freeform textarea, auto-saves to localStorage
3. **Concept Explorer** — AI-powered concept search (see [[03_AI_Integration]])
4. **Connected Papers** — papers linked by edges in the graph

The `◀` toggle button collapses the sidebar to give full-width reading. State persists in localStorage.

---

## Highlight System (Manual)

The manual highlight flow is a three-step interaction:

### Step 1: Select Text
User drags to select text anywhere in the paper content. On `mouseup`, if selection is ≥3 characters, a colour picker popup appears (position: fixed, viewport coordinates).

### Step 2: Pick Colour
Three pastel circles: pink (`#ffb3ba`), blue (`#bae1ff`), yellow (`#ffffba`). Clicking one:
1. **Immediately wraps** the selected text in a coloured `<span>` (`.scan-highlight--pending`) so the user sees what they've highlighted
2. Shows a comment input textarea below the selection

This "highlight before comment" behaviour was a deliberate design choice — the user requested being able to see which text they're commenting on while typing the comment.

### Step 3: Save or Cancel
- **Save**: Creates an annotation object, stores in localStorage, calls `applyHighlights()` to re-render all highlights cleanly, shows toast
- **Cancel**: Removes the pending highlight span, restores original text

---

## Highlight System (Concept Explorer)

Concept highlights are created by the AI pipeline (see [[03_AI_Integration]]) and rendered differently:

| Property | Manual Highlights | Concept Highlights |
|----------|------------------|--------------------|
| Colour | Pink / Blue / Yellow (pastel) | Green (cognition colour, `rgba(0,255,136,0.18)`) |
| Border | None | Dashed bottom border |
| Comment | User-written | AI explanation + optional user comment |
| Sidebar label | Colour emoji | Concept name in uppercase |
| Vault export section | "Annotations" | "Concept Explorations" (grouped by concept) |

---

## Click-to-Pin Previews

Hover previews show on mouseover with a 150ms transition. But they disappear when the mouse leaves — making the "comment" button inside the preview unreachable. The solution: **click-to-pin**.

- **Click** a highlight → adds `.pinned` class → preview stays visible regardless of mouse position
- **Click** another highlight → unpins the first, pins the new one
- **Click** anywhere else → unpins all

The preview box has:
- Concept name (uppercase, green for concepts)
- Short explanation (truncated to ~100 chars)
- User comment (if added)
- **"comment"** / **"edit"** button — opens an inline textarea below the highlight in the document

A CSS `::after` pseudo-element creates an invisible bridge between the highlight and the preview, so the mouse can travel between them without the preview disappearing on hover.

---

## Inline Comment Input

When the user clicks "comment" from a hover preview or sidebar annotation, a textarea appears directly below the highlight in the document flow:

```
[highlighted text in the paper]
┌─────────────────────────────────────────┐
│ Add your thoughts on this passage…      │ ← green left border
│                                         │
│                                         │
│                          [Cancel] [Save]│
└─────────────────────────────────────────┘
```

- 80px minimum height, resizable
- `Ctrl+Enter` to save
- Cancel removes the input without saving
- Styled with the same green left-border accent as the hover preview

---

## Passage Navigation (Concept Results)

When concept results appear in the sidebar, clicking a result:
1. Scrolls the paper to that passage
2. **Pins** the highlight with a green outline (stays visible until clicking a different result)
3. Marks the clicked result as active in the sidebar (green border)

This is distinct from the 2-second flash that was the original behaviour — the pin persists until the user navigates elsewhere. This allows reading the passage in context, adding a comment, then clicking the next result.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Escape` | Close highlight popup, comment input, or unpin highlights |
| `Ctrl+Enter` | Save inline comment |
