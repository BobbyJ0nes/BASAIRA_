# AI Integration — Gemini 2.5 Flash

> *Back to [[00_Index]] · See also [[02_Data_Pipeline]]*

## Overview

SCAN uses Google's Gemini 2.5 Flash model for two operations within the paper reader:

1. **Concept Extraction** — Analyse a paper's text and extract 8-12 key concepts/themes
2. **Passage Finding** — Given a concept, find 3-6 exact passages in the paper that relate to it

Both operations happen server-side via `src/server/concepts.js`. The API key is stored in `.env` (`GEMINI_API_KEY`) and never exposed to the client.

---

## API Configuration

```
Model:    gemini-2.5-flash
Endpoint: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
Method:   POST with JSON body
Timeout:  30 seconds
```

### Generation Config
```json
{
  "maxOutputTokens": 4096,
  "temperature": 0.3,
  "thinkingConfig": { "thinkingBudget": 0 }
}
```

**Why `thinkingBudget: 0`**: Gemini 2.5 Flash has a "thinking" mode enabled by default that uses internal reasoning tokens. These count against `maxOutputTokens`, causing the actual response to be truncated. Setting the budget to 0 disables thinking and ensures the full token budget goes to the response. This was discovered after early responses were cut off mid-JSON — see [[09_Bug_Chronicle#Gemini Thinking Budget]].

**Why `temperature: 0.3`**: Low temperature for factual extraction. We want consistent, grounded concept identification, not creative interpretation.

---

## Concept Extraction

**Endpoint**: `GET /api/papers/:id/concepts`

### Prompt Structure
```
You are analyzing a research paper. Extract 8-12 key concepts, themes, or ideas from this paper.

For each concept, provide:
- A short concept name (2-5 words, lowercase)
- A one-sentence description of how it appears in this paper

Return ONLY a JSON array, no markdown fences, no explanation:
[{"concept": "name here", "description": "one sentence description"}]

Paper text:
{first 12,000 characters of the paper}
```

### Why 12K Characters
Gemini 2.5 Flash has a large context window, but sending full 40K+ papers would be slow and expensive. The first 12K characters typically covers the Abstract, Introduction, and Method — the sections where key concepts are most concentrated. This is a pragmatic trade-off between coverage and latency.

### Caching
Concepts are cached in a `Map` keyed by paper ID. A paper's concepts are extracted once and then served from memory for all subsequent requests.

---

## Passage Finding

**Endpoint**: `POST /api/papers/:id/explore`
**Body**: `{ "concept": "blockchain security" }`

### Prompt Structure
```
You are a research paper analyst. The user wants to explore the concept: "{concept}"

Find 3-6 passages in the paper text below that are most relevant to this concept. Each passage must be:
1. An EXACT substring from the paper (copy it character-for-character)
2. Between 20 and 150 words long
3. Directly relevant to "{concept}"

For each passage, also provide:
- Which section it's from
- A brief explanation of how it relates to "{concept}"

Return ONLY a JSON array, no markdown fences:
[{"passage": "exact text from paper", "section": "section title", "explanation": "how this relates"}]

IMPORTANT: The "passage" field must be an EXACT copy from the text below.

Paper text:
{first 15,000 characters}
```

### Passage Verification
The model doesn't always return exact copies. After receiving the response, the server verifies each passage:

1. **Exact match** — check if `fullText.includes(passage)` → keep as-is
2. **Normalised match** — normalise whitespace in both, re-check → update passage text
3. **Prefix match** — if first 60 characters match, extract the real text from that position → replace passage
4. **No match** — discard the passage entirely

This verification step typically retains 4-6 of 6 returned passages. The rejection rate is logged.

---

## Robust JSON Parsing

Gemini's responses sometimes arrive malformed — truncated strings, trailing commas, markdown fences wrapping the JSON. The `parseJSON()` function handles these:

```javascript
function parseJSON(text) {
  // 1. Strip markdown fences: ```json ... ```
  // 2. Try JSON.parse() directly
  // 3. Extract array with regex: /\[[\s\S]*\]/
  // 4. Fix trailing commas: ,] → ]
  // 5. Remove incomplete last object
  // 6. Try truncated version up to last complete }
}
```

This was necessary because early versions crashed on Gemini responses that included reasoning preamble before the JSON, or that hit the token limit mid-string. See [[09_Bug_Chronicle#JSON Parsing Failures]].

---

## Section-Specific Concepts

**Endpoint**: `GET /api/papers/:id/sections/:sectionId/concepts`

A lighter-weight version of concept extraction that analyses only a single section. Uses a smaller prompt (6K character limit) and returns 4-8 concepts. This was built for the per-section "◉ analyze" buttons (later removed for simplicity, but the endpoint remains functional).

---

## Cost and Rate Considerations

Gemini 2.5 Flash is free-tier eligible. At typical usage:
- **Concept extraction**: ~500 input tokens + ~300 output tokens per paper
- **Passage finding**: ~2,000 input tokens + ~500 output tokens per query

For a session reading 5-10 papers with 2-3 concept explorations each, total usage is roughly 20K-40K tokens — well within free tier limits.

Responses arrive in 2-5 seconds. The UI shows a "Finding [concept]…" spinner during this time.
