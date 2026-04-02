# Bug Chronicle

> *Back to [[00_Index]]*

Every significant bug encountered during development, in roughly chronological order. Each entry documents what broke, why, and how it was fixed. This is both a debugging reference and a design history — many of BASIRA_'s architectural decisions were shaped by these bugs.

---

## Duplicate DOMAIN_COLORS Declaration

**Symptom**: App crashed on load with `SyntaxError: Identifier 'DOMAIN_COLORS' has already been declared`.

**Cause**: `DOMAIN_COLORS` was defined in both `graph.js` and `app.js`. Since both scripts load into the same global scope (no modules), the second declaration threw.

**Fix**: Kept the definition in `graph.js` only. `app.js` references the same global variable. This established the convention: shared constants live in the file that first needs them.

---

## arXiv HTTP vs HTTPS

**Symptom**: arXiv API requests returned empty responses.

**Cause**: Using `http://export.arxiv.org/...` returned a 301 redirect to HTTPS. The Node.js `http` module doesn't follow redirects automatically.

**Fix**: Switched to `https://export.arxiv.org/...`. Added a redirect-following wrapper in the fetch utility.

---

## Server Process Dies on Shell Exit

**Symptom**: The Express server, started with `node src/server/index.js &`, would die when the parent bash process exited.

**Cause**: Background processes receive SIGHUP when the controlling terminal closes. Additionally, the process was reading from stdin — when stdin closed (terminal exit), Node.js would exit.

**Fix**: Start with `node src/server/index.js < /dev/null > /tmp/scan.log 2>&1 &`. Redirecting stdin from `/dev/null` prevents the stdin-close exit. `nohup` alone was insufficient because the process was still attached to the terminal's process group.

---

## Gemini Thinking Budget

**Symptom**: Concept extraction returned truncated JSON — responses cut off mid-string.

**Cause**: Gemini 2.5 Flash has a "thinking" mode enabled by default. Internal reasoning tokens consumed most of the `maxOutputTokens` budget (set to 512), leaving only ~100 tokens for the actual response.

**Fix**: Added `thinkingConfig: { thinkingBudget: 0 }` to the generation config, disabling internal reasoning. Increased `maxOutputTokens` to 4096. The model produces correct JSON without thinking tokens for these structured extraction tasks.

---

## JSON Parsing Failures

**Symptom**: Concept extraction threw `SyntaxError: Unterminated string in JSON` intermittently.

**Cause**: Gemini sometimes wraps JSON in markdown fences (`` ```json ... ``` ``), includes trailing commas, or truncates the response mid-object. Standard `JSON.parse()` fails on all of these.

**Fix**: Built a robust `parseJSON()` function that:
1. Strips markdown fences
2. Extracts the array with regex
3. Fixes trailing commas
4. Removes incomplete last objects
5. Retries with progressively more aggressive truncation

This reduced concept extraction failures from ~30% to <2%.

---

## Double Preview Cards

**Symptom**: After adding a comment to a concept highlight, hovering showed two preview cards stacked on top of each other.

**Cause**: `applyHighlights()` was called after updating an annotation's comment. The function used `p.innerHTML.replace(regex, ...)` as a fallback, which matched text *inside* existing `<span class="scan-highlight">` elements. This created nested highlights, each with their own preview card.

**Fix**: Two changes:
1. **Strip-and-reapply**: `applyHighlights()` now removes ALL existing highlight spans before re-applying. See [[07_Highlight_System#Step 1 Strip All Existing Highlights]].
2. **Text-node-only matching**: Eliminated the innerHTML regex fallback entirely. All matching uses `TreeWalker` over text nodes, which never sees HTML markup.

---

## Highlight Popup Positioning

**Symptom**: The colour picker popup appeared in the wrong position (off-screen or overlapping the header) when selecting text in sections deep in the paper.

**Cause**: The popup used `position: absolute` relative to `.reader-article`, but coordinate calculations used `getBoundingClientRect()` which returns viewport-relative values. The mismatch between absolute positioning (relative to parent) and viewport coordinates caused incorrect placement.

**Fix**: Changed popup and annotation input to `position: fixed`, which uses viewport coordinates directly. `getBoundingClientRect()` values can be used as-is. No scroll offset calculations needed.

---

## Manual Highlight Broken After Concept Highlights

**Symptom**: After applying concept highlights, manual text selection and highlighting stopped working.

**Cause**: The `contentEl.addEventListener('click')` handler for click-to-pin was calling `e.stopPropagation()` when clicking a highlight. This prevented the `mouseup` event from reaching the text selection handler in some browsers. Additionally, the `document.addEventListener('mousedown')` handler was clearing the popup and annotation input during the highlight flow.

**Fix**: 
1. Made the mousedown handler smarter: it now checks for `.scan-highlight--pending` and `pendingHighlight` before clearing.
2. The annotation input is only hidden if there's no active pending highlight.

---

## surroundContents Failure

**Symptom**: Manual highlight preview (colour shown before comment) failed when the selection spanned across paragraph boundaries.

**Cause**: `Range.surroundContents()` throws if the range contains a partial element (e.g., selection starts in one `<p>` and ends in another).

**Fix**: Replaced `surroundContents()` with `extractContents()` + `appendChild()`:
```javascript
const fragment = range.extractContents();
const span = document.createElement('span');
span.appendChild(fragment);
range.insertNode(span);
```
This handles cross-element selections by extracting the full fragment and wrapping it.

---

## Sidebar Scroll-to-Highlight Fails

**Symptom**: Clicking an annotation in the sidebar didn't scroll to the highlight, or scrolled to the wrong position.

**Cause**: `element.scrollIntoView()` scrolls the *viewport*, but the reader page's scroll container is `.reader-body` (the `<body>` element with `overflow: auto; height: 100vh`). The browser was trying to scroll `document.documentElement` which wasn't the actual scrolling ancestor.

**Fix**: Calculate the target position manually using the scroll container:
```javascript
const scrollContainer = document.querySelector('.reader-body');
const top = hl.getBoundingClientRect().top + scrollContainer.scrollTop - headerHeight - (viewportHeight / 3);
scrollContainer.scrollTo({ top, behavior: 'smooth' });
```
The `viewportHeight / 3` offset places the highlight in the upper third of the screen rather than the very top.

---

## Passage Pin Disappears After 2 Seconds

**Symptom**: Clicking a concept result in the sidebar scrolled to the passage but the green outline disappeared after 2 seconds.

**Cause**: The original `scrollToPassage()` used `setTimeout(() => { highlight.style.outline = ''; }, 2000)`. This was a temporary flash, not a persistent pin.

**Fix**: Replaced with a tracked `pinnedPassageEl` variable. The outline and `.pinned` class persist until the user clicks a different result (which calls `scrollToPassage()` again, unpinning the previous one) or clicks away.
