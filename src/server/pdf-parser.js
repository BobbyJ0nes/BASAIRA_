// ═══════════════════════════════════════════════════════════
// BASIRA_ PDF Parser — Extract structured content from PDFs
// ═══════════════════════════════════════════════════════════
//
// Uses Gemini 2.5 Flash's document understanding to extract
// structured sections from academic PDFs. The PDF is uploaded
// via the Gemini Files API, then processed in a generateContent
// call that returns title, authors, abstract, and sections.
//
// Produces the same section shape as paper-parser.js:
//   { title, authors, abstract, sections: [{id, title, paragraphs}] }
//
// ═══════════════════════════════════════════════════════════

import https from 'https';
import fs from 'fs';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ headers: res.headers, statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// Upload PDF to Gemini Files API
async function uploadToGemini(pdfBuffer, filename) {
  // Step 1: Start resumable upload
  const startUrl = new URL(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`);
  const startRes = await httpsRequest({
    hostname: startUrl.hostname,
    path: startUrl.pathname + startUrl.search,
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Type': 'application/pdf',
      'X-Goog-Upload-Header-Content-Length': pdfBuffer.length,
      'Content-Type': 'application/json',
    }
  }, JSON.stringify({ file: { display_name: filename } }));

  const uploadUrl = startRes.headers['x-goog-upload-url'];
  if (!uploadUrl) throw new Error('Failed to get upload URL');

  // Step 2: Upload bytes
  const upUrl = new URL(uploadUrl);
  const uploadRes = await httpsRequest({
    hostname: upUrl.hostname,
    path: upUrl.pathname + upUrl.search,
    method: 'PUT',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Length': pdfBuffer.length,
    }
  }, pdfBuffer);

  const fileData = JSON.parse(uploadRes.body);
  if (!fileData.file?.uri) throw new Error('Upload failed: ' + uploadRes.body.slice(0, 200));

  console.log(`    ✓ Uploaded to Gemini: ${fileData.file.name} (${fileData.file.state})`);
  return fileData.file;
}

// Delete file from Gemini after processing
async function deleteFromGemini(fileName) {
  try {
    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_API_KEY}`);
    await httpsRequest({ hostname: url.hostname, path: url.pathname + url.search, method: 'DELETE' });
  } catch (e) { /* ignore cleanup errors */ }
}

// Extract structured content from the uploaded PDF
async function extractFromPDF(fileUri) {
  const prompt = `You are extracting the full structured content of an academic research paper from a PDF.

Return a JSON object with:
1. "title": the paper's title
2. "authors": array of author names
3. "abstract": the full abstract text
4. "sections": array of ALL sections, each with:
   - "id": section identifier (e.g., "S1", "S2", "S2.SS1")
   - "title": section heading (e.g., "1 Introduction", "2.1 Data Collection")
   - "content": the FULL text content of that section (every paragraph, complete)
   - "isSubsection": true if it's a subsection (e.g., 2.1, 3.2)

IMPORTANT:
- Include ALL text from every section — do not summarize or truncate
- Preserve mathematical notation in LaTeX format (e.g., $w_{ij}$, $\\alpha$)
- Do not include references/bibliography section
- Return ONLY valid JSON, no markdown fences

The sections array should capture the complete paper text.`;

  const body = JSON.stringify({
    contents: [{ parts: [
      { fileData: { mimeType: 'application/pdf', fileUri } },
      { text: prompt }
    ]}],
    generationConfig: {
      maxOutputTokens: 65536,
      temperature: 0.1,
      thinkingConfig: { thinkingBudget: 0 }
    }
  });

  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`);
  const res = await httpsRequest({
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);

  const json = JSON.parse(res.body);
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No response from Gemini: ' + res.body.slice(0, 200));

  return text;
}

// Robust JSON parser
function parseJSON(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
  try { return JSON.parse(cleaned); } catch (e) {}

  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch (e) {
      // Try fixing trailing commas
      const fixed = objMatch[0].replace(/,\s*([}\]])/g, '$1');
      try { return JSON.parse(fixed); } catch (e2) {}
    }
  }
  throw new Error('Could not parse JSON from Gemini response');
}

// Extract keywords from title (same logic as arxiv.js)
function extractTags(title, abstract) {
  const stopWords = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'that', 'this', 'these', 'those', 'it', 'its', 'as', 'up', 'out', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'over', 'via', 'using', 'based', 'new', 'novel', 'approach', 'method', 'towards', 'toward']);

  const text = (title + ' ' + (abstract || '').slice(0, 200)).toLowerCase();
  const words = text.match(/\b[a-z]{3,}\b/g) || [];
  const bigrams = [];
  for (let i = 0; i < words.length - 1; i++) {
    if (!stopWords.has(words[i]) && !stopWords.has(words[i + 1])) {
      bigrams.push(words[i] + ' ' + words[i + 1]);
    }
  }

  const filtered = words.filter(w => !stopWords.has(w));
  const freq = {};
  [...filtered, ...bigrams].forEach(w => { freq[w] = (freq[w] || 0) + 1; });

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag]) => tag);
}

// Main export: parse a PDF file into the unified section structure
export async function parsePDF(pdfPath) {
  const pdfBuffer = fs.readFileSync(pdfPath);
  const filename = pdfPath.split('/').pop().replace('.pdf', '');

  console.log(`  → Parsing PDF: ${filename} (${Math.round(pdfBuffer.length / 1024)}KB)`);

  // Upload to Gemini
  const file = await uploadToGemini(pdfBuffer, filename);

  try {
    // Extract structure
    console.log(`    → Extracting structure via Gemini...`);
    const rawResponse = await extractFromPDF(file.uri);
    const result = parseJSON(rawResponse);

    console.log(`    ✓ Extracted: "${result.title}" — ${result.sections?.length || 0} sections`);

    // Normalise into the same shape as paper-parser
    const sections = (result.sections || []).map((s, i) => ({
      id: s.id || `S${i + 1}`,
      title: s.title || `Section ${i + 1}`,
      paragraphs: (s.content || '').split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 10),
      isSubsection: s.isSubsection || false,
    }));

    // Add abstract as first section if not already there
    if (result.abstract && (!sections[0] || sections[0].title.toLowerCase() !== 'abstract')) {
      sections.unshift({
        id: 'abstract',
        title: 'Abstract',
        paragraphs: result.abstract.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 10),
      });
    }

    const tags = extractTags(result.title || '', result.abstract || '');

    return {
      title: result.title || filename,
      authors: result.authors || [],
      abstract: result.abstract || '',
      sections,
      tags,
      source: 'pdf',
    };
  } finally {
    // Clean up uploaded file
    await deleteFromGemini(file.name);
  }
}
