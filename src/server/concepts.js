// ═══════════════════════════════════════════════════════════
// SCAN Concept Explorer — AI-powered in-paper concept search
// ═══════════════════════════════════════════════════════════
//
// Uses Gemini 2.5 Flash to:
//   1. Extract key concepts/themes from a paper
//   2. Find exact passages related to a user query concept
//
// The concept explorer finds passages within the paper itself,
// auto-highlights them, and links them to the searched concept.
// ═══════════════════════════════════════════════════════════

import https from 'https';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// In-memory cache for extracted concepts per paper
const conceptCache = new Map();

// Robust JSON parser — handles markdown fences, trailing commas, truncated output
function parseJSON(text) {
  let cleaned = text.trim();

  // Remove markdown fences
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
  }

  // Try direct parse first
  try { return JSON.parse(cleaned); } catch (e) { /* continue */ }

  // Extract the JSON array from the text
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    let arr = arrayMatch[0];

    // Fix trailing commas before ]
    arr = arr.replace(/,\s*\]/g, ']');

    // Fix unterminated strings — find incomplete last object and remove it
    try { return JSON.parse(arr); } catch (e) {
      // Try removing the last incomplete object
      const lastComplete = arr.lastIndexOf('},');
      if (lastComplete > 0) {
        const truncated = arr.slice(0, lastComplete + 1) + ']';
        try { return JSON.parse(truncated); } catch (e2) { /* continue */ }
      }
      // Try removing last object after last complete }
      const lastBrace = arr.lastIndexOf('}');
      if (lastBrace > 0) {
        const truncated = arr.slice(0, lastBrace + 1) + ']';
        try { return JSON.parse(truncated); } catch (e2) { /* continue */ }
      }
    }
  }

  throw new Error('Could not parse JSON from response');
}

function callGemini(prompt, maxTokens = 4096) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.3,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const url = new URL(GEMINI_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.candidates && json.candidates[0]?.content?.parts?.[0]?.text) {
            resolve(json.candidates[0].content.parts[0].text);
          } else if (json.error) {
            reject(new Error(json.error.message));
          } else {
            reject(new Error('No response from Gemini'));
          }
        } catch (e) {
          reject(new Error('Failed to parse Gemini response'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Gemini request timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * Extract key concepts from a paper's full text.
 * Returns an array of { concept, description } objects.
 */
export async function extractConcepts(paperId, sections) {
  if (conceptCache.has(paperId)) {
    return conceptCache.get(paperId);
  }

  // Build a condensed version of the paper for the prompt
  const text = sections.map(s => `## ${s.title}\n${s.content}`).join('\n\n');
  // Truncate to ~12K chars to stay within token limits
  const truncated = text.slice(0, 12000);

  const prompt = `You are analyzing a research paper. Extract 8-12 key concepts, themes, or ideas from this paper.

For each concept, provide:
- A short concept name (2-5 words, lowercase)
- A one-sentence description of how it appears in this paper

Return ONLY a JSON array, no markdown fences, no explanation:
[{"concept": "name here", "description": "one sentence description"}]

Paper text:
${truncated}`;

  try {
    console.log(`  🔍 Extracting concepts for ${paperId}...`);
    const response = await callGemini(prompt, 1024);

    const concepts = parseJSON(response);
    conceptCache.set(paperId, concepts);
    console.log(`    ✓ Found ${concepts.length} concepts`);
    return concepts;
  } catch (err) {
    console.log(`    ✗ Concept extraction failed: ${err.message}`);
    return [];
  }
}

// Cache for per-section concepts
const sectionConceptCache = new Map();

/**
 * Extract concepts from a single section of the paper.
 * Returns an array of { concept, description } objects.
 */
export async function extractSectionConcepts(paperId, sectionId, sectionTitle, sectionContent) {
  const cacheKey = `${paperId}:${sectionId}`;
  if (sectionConceptCache.has(cacheKey)) {
    return sectionConceptCache.get(cacheKey);
  }

  const truncated = sectionContent.slice(0, 6000);

  const prompt = `You are analyzing a specific section of a research paper.

Section: "${sectionTitle}"
Text:
${truncated}

Extract 4-8 core concepts from THIS section only. Each concept should be specific to what this section discusses.

For each concept:
- A short concept name (2-5 words, lowercase)
- A one-sentence description

Return ONLY a JSON array, no markdown fences:
[{"concept": "name here", "description": "one sentence"}]`;

  try {
    console.log(`  🔍 Extracting concepts for section "${sectionTitle}"...`);
    const response = await callGemini(prompt, 768);
    const concepts = parseJSON(response);
    sectionConceptCache.set(cacheKey, concepts);
    console.log(`    ✓ Found ${concepts.length} concepts for "${sectionTitle}"`);
    return concepts;
  } catch (err) {
    console.log(`    ✗ Section concept extraction failed: ${err.message}`);
    return [];
  }
}

/**
 * Find exact passages in the paper related to a concept query.
 * Returns an array of { passage, section, explanation } objects.
 * Each passage is an EXACT substring from the paper text.
 */
export async function findConceptPassages(concept, sections) {
  // Build full text with section markers
  const sectionTexts = sections.map(s => ({
    id: s.id,
    title: s.title,
    content: s.content || s.paragraphs?.join('\n\n') || '',
  }));

  const fullText = sectionTexts.map(s => `[SECTION: ${s.title}]\n${s.content}`).join('\n\n');
  // Truncate to ~15K chars
  const truncated = fullText.slice(0, 15000);

  const prompt = `You are a research paper analyst. The user wants to explore the concept: "${concept}"

Find 3-6 passages in the paper text below that are most relevant to this concept. Each passage must be:
1. An EXACT substring from the paper (copy it character-for-character, including punctuation)
2. Between 20 and 150 words long (one or two sentences)
3. Directly relevant to "${concept}"

For each passage, also provide:
- Which section it's from
- A brief explanation of how it relates to "${concept}" (1 sentence)

Return ONLY a JSON array, no markdown fences:
[{"passage": "exact text from paper", "section": "section title", "explanation": "how this relates to the concept"}]

IMPORTANT: The "passage" field must be an EXACT copy from the text below. Do not paraphrase or modify it.

Paper text:
${truncated}`;

  try {
    console.log(`  🔍 Finding passages for concept: "${concept}"`);
    const response = await callGemini(prompt, 2048);

    const passages = parseJSON(response);

    // Verify each passage actually exists in the paper text
    const verified = passages.filter(p => {
      // Try exact match first
      if (fullText.includes(p.passage)) return true;

      // Try with normalized whitespace
      const normalized = p.passage.replace(/\s+/g, ' ').trim();
      const fullNormalized = fullText.replace(/\s+/g, ' ');
      if (fullNormalized.includes(normalized)) {
        p.passage = normalized; // Use the normalized version
        return true;
      }

      // Try finding a close match (first 60 chars)
      const prefix = normalized.slice(0, 60);
      if (fullNormalized.includes(prefix)) {
        // Find the actual text starting from that prefix
        const idx = fullNormalized.indexOf(prefix);
        // Extract roughly the same length
        const actual = fullNormalized.slice(idx, idx + normalized.length + 20);
        // Find a sentence boundary
        const sentEnd = actual.indexOf('. ');
        if (sentEnd > normalized.length * 0.5) {
          p.passage = actual.slice(0, sentEnd + 1).trim();
          return true;
        }
        p.passage = actual.trim();
        return true;
      }

      console.log(`    ✗ Passage not found in text: "${p.passage.slice(0, 50)}..."`);
      return false;
    });

    console.log(`    ✓ Found ${verified.length}/${passages.length} verified passages`);
    return verified;
  } catch (err) {
    console.log(`    ✗ Passage finding failed: ${err.message}`);
    return [];
  }
}
