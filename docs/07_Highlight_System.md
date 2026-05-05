# Highlight System — Deep Dive

> *Back to [[00_Index]] · See also [[05_Reader_UX]], [[09_Bug_Chronicle]]*

## Overview

The highlight system is the most complex piece of client-side logic in BASAIRA_. It handles creating, rendering, persisting, and interacting with text annotations across a full research paper. This document covers the technical implementation, the matching algorithm, and the specific bugs that shaped the current design.

---

## Data Model

Each annotation is a plain object stored in a JSON array in localStorage:

```javascript
// Manual highlight
{
  id: "mn4g8xk2fp",           // Unique ID (timestamp + random)
  text: "exact matched text",  // The highlighted text (whitespace-normalised)
  color: "#ffb3ba",            // Pink, blue, or yellow
  comment: "User's note",      // Optional comment
  timestamp: "2026-04-02T..."  // ISO timestamp
}

// Concept highlight
{
  id: "mn5h9yl3gq",
  text: "exact matched text",
  color: "concept",            // Special value → renders green
  type: "concept",             // Distinguishes from manual
  concept: "blockchain security",  // The searched concept
  explanation: "This passage...",   // AI-generated explanation
  comment: "blockchain security",   // Concept name as comment
  userComment: "",              // User's additional comment (initially empty)
  timestamp: "2026-04-02T..."
}
```

### Storage Key
```
localStorage key: scan_annotations_{paperId}
Example: scan_annotations_2603.30004v1
```

---

## The Apply Algorithm

`applyHighlights()` is called whenever annotations change. It's a **strip-and-reapply** approach:

### Step 1: Strip All Existing Highlights
```javascript
bodyEl.querySelectorAll('.scan-highlight').forEach(hl => {
  // Extract text content (before the preview span)
  let raw = '';
  for (const child of hl.childNodes) {
    if (child.nodeType === 3) raw += child.textContent;
    else if (!child.classList?.contains('highlight-preview')) raw += child.textContent;
    else break;
  }
  hl.replaceWith(document.createTextNode(raw));
});
bodyEl.normalize(); // Merge adjacent text nodes
```

**Why strip first?** The original implementation applied highlights incrementally, which caused the [[09_Bug_Chronicle#Double Preview Cards|double preview card bug]]. When `applyHighlights()` ran a second time (e.g., after adding a comment), the regex fallback would match text inside existing `<span class="scan-highlight">` elements, creating nested highlights with multiple preview cards. Stripping first guarantees a clean slate.

### Step 2: Sort by Length
```javascript
const sorted = [...annotations].sort((a, b) => b.text.length - a.text.length);
```
Longest annotations are applied first. This prevents a shorter annotation from consuming text that a longer one needs. For example, if both "blockchain" and "blockchain technology for securing and protecting privacy" are annotated, the longer one is applied first.

### Step 3: Walk Text Nodes
For each annotation, a `TreeWalker` iterates all text nodes in the section body:

```javascript
const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT, null);
while ((node = walker.nextNode()) && !found) {
  if (node.parentElement.closest('.scan-highlight')) continue; // Skip inside existing highlights
  
  // Try exact match
  let idx = nodeText.indexOf(ann.text);
  
  // Try normalised whitespace match
  if (idx === -1) idx = nodeNorm.indexOf(annNorm);
  
  // Try prefix match (first 50 chars)
  if (idx === -1 && annNorm.length > 50) { ... }
}
```

### Step 4: Wrap the Match
When found, the text node is split and a `<span class="scan-highlight">` is inserted:

```javascript
const before = nodeText.slice(0, idx);
const matched = nodeText.slice(idx, idx + matchText.length);
const after = nodeText.slice(idx + matchText.length);

const span = document.createElement('span');
span.className = 'scan-highlight';
span.dataset.color = ann.color;
span.dataset.annotationId = ann.id;
span.innerHTML = escapeHTML(matched) + buildPreviewHTML(ann);

parent.insertBefore(textNode(before), node);
parent.insertBefore(span, node);
parent.insertBefore(textNode(after), node);
parent.removeChild(node);
```

### Step 5: Retry with Normalisation
If the text-node walk fails (the text spans multiple nodes, or whitespace differs), the body is normalised (`.normalize()`) and the walk retries once. This handles cases where a previous highlight operation split a text node that this annotation needs.

---

## Why Text-Node Walking, Not innerHTML Regex

An earlier implementation used `p.innerHTML.replace(regex, ...)` as a fallback. This was **removed** because:

1. **Nesting risk**: innerHTML contains HTML tags. A regex matching "blockchain" could match inside an existing `<span data-color="concept">blockchain security</span>`, creating broken nested HTML.
2. **Attribute corruption**: If the matched text appears in an attribute value (e.g., `data-annotation-id`), the regex would corrupt the DOM.
3. **Preview duplication**: Each innerHTML replacement would insert a new preview span, even if one already existed.

The text-node walker is immune to all three problems because it only sees plain text content, never HTML markup.

---

## Preview HTML

Each highlight contains an invisible preview that becomes visible on hover/pin:

```html
<span class="scan-highlight" data-color="concept" data-annotation-id="mn5h">
  This study examines...
  <span class="highlight-preview">
    <span class="highlight-preview__label">SCOPING REVIEW BIBLIOMETRIC ANALYSIS</span>
    <span class="highlight-preview__comment">This passage introduces the core concept...</span>
    <button class="highlight-preview__add-comment">comment</button>
  </span>
</span>
```

The preview is positioned with `position: absolute; bottom: calc(100% + 4px)` relative to the highlight span, creating a floating card above the text.

---

## Text Normalisation

A critical detail: all annotation text is normalised on creation:
```javascript
text: pendingHighlight.text.replace(/\s+/g, ' ').trim()
```

This collapses multiple spaces, newlines, and tabs into single spaces. The matching algorithm also normalises the document text the same way before comparison. This handles:
- Line breaks within paragraphs (common in arXiv abstracts)
- Double spaces after periods
- Whitespace differences between the browser's `Selection.toString()` and the DOM text content
- Gemini returning passages with slightly different whitespace than the source

---

## Edge Cases Handled

| Scenario | Solution |
|----------|----------|
| Selected text spans two `<p>` elements | `extractContents()` + `appendChild()` wraps the fragment |
| Gemini returns passage with different whitespace | Normalised matching with `\s+` regex |
| Same text appears twice in paper | Only the first occurrence is highlighted (TreeWalker stops after first match) |
| User highlights text inside an existing concept highlight | Skipped — `if (node.parentElement.closest('.scan-highlight')) continue` |
| Very long passage (200+ words) | Prefix matching (first 50 chars) locates the start, then wraps the expected length |
| Paper has no HTML version (abstract only) | Highlights work on abstract text the same way |

---

## Interaction with Math Rendering

The highlight system and KaTeX math rendering share the same DOM. This creates an ordering dependency:

1. `applyHighlights()` strips all highlights, walks text nodes, wraps matches
2. This process destroys any KaTeX-rendered elements (since KaTeX replaces `.scan-math` spans with complex DOM trees)
3. Therefore, `renderMathElements()` is called at the end of every `applyHighlights()` invocation

The `renderRichContent()` function in the paragraph rendering pipeline uses a **placeholder swap** approach to coexist with `escapeHTML()`:
1. Replace all `<scan-math>` and `<scan-figure>` tags with `%%SCANMATH0%%` / `%%SCANFIG0%%` placeholders
2. Escape the remaining text with `escapeHTML()`
3. Swap the placeholders back with the original tags
4. Convert `<scan-math>` to `<span class="scan-math" data-latex="...">` and `<scan-figure>` to `<figure>` elements

This prevents the custom elements from being HTML-escaped while still protecting against XSS in paper text content.

The highlight text-node walker skips `.scan-math` and `.katex` elements — math content is not highlightable (it would break the KaTeX DOM tree). This means annotations containing mathematical notation may not find their exact text match if the match spans across a math element boundary.

---

## Performance Considerations

For a typical paper with 5-10 annotations and ~300 math elements:
- Strip highlights: ~1ms
- Sort + walk: ~2ms per annotation (TreeWalker is fast)
- KaTeX re-render: ~30-50ms for ~300 equations
- Total re-render: ~50-70ms

This is imperceptible. The system could handle 50+ annotations without noticeable lag.
