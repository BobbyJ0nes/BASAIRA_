// POST /api/papers/upload — multipart PDF upload, parse via Gemini, store in Supabase.
//
// Returns: { success, paper: { id, title, authors, domains, tags, edgesAdded, sections } }
//
// Storage decision:
//   pdf_url is set to '' — we don't persist the binary. Vercel has no
//   persistent FS, and adding Supabase Storage adds setup cost. The reader
//   reads from `paper_content.sections` (JSONB) which we *do* populate.
//
// Multipart parsing decision:
//   We avoid adding `formidable` or `multer` as a dependency. The request
//   contains a single field ('pdf') with binary bytes — we read the raw body
//   from req (Vercel disables bodyParser via the config below) and slice out
//   the PDF using the multipart boundary. ~50 lines of code, no extra deps.
//
// Inlined Gemini upload + parse pipeline from src/server/pdf-parser.js,
// inlined edge computation from src/server/routes.js.
import { supabase } from '../_lib/supabase.js';
import https from 'https';

export const config = {
  maxDuration: 60, // PDF parse via Gemini takes 30-60s
  api: { bodyParser: false }, // we need the raw multipart bytes
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// ── Multipart parser ──────────────────────────────────────────
// Reads the raw request body, finds the PDF part by Content-Type,
// returns { buffer, filename }. Throws if no PDF part is found.
async function readPdfFromRequest(req) {
  // 1. Read raw body
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const body = Buffer.concat(chunks);

  // 2. Extract boundary
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error('No multipart boundary in Content-Type');
  const boundary = '--' + (boundaryMatch[1] || boundaryMatch[2]).trim();
  const boundaryBuf = Buffer.from(boundary);

  // 3. Walk parts
  let pos = body.indexOf(boundaryBuf);
  while (pos !== -1) {
    const partStart = pos + boundaryBuf.length;
    // skip CRLF after boundary
    let headerStart = partStart;
    if (body[headerStart] === 0x0d && body[headerStart + 1] === 0x0a) headerStart += 2;
    else if (body[headerStart] === 0x2d && body[headerStart + 1] === 0x2d) break; // closing --

    // headers end at the first \r\n\r\n
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;
    const headers = body.slice(headerStart, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    const nextBoundary = body.indexOf(boundaryBuf, dataStart);
    if (nextBoundary === -1) break;
    // strip trailing CRLF before the next boundary
    const dataEnd = nextBoundary - 2;

    const isPdf = /content-type:\s*application\/pdf/i.test(headers)
      || /name="pdf"/i.test(headers);
    if (isPdf) {
      const filenameMatch = headers.match(/filename="([^"]+)"/i);
      return {
        buffer: body.slice(dataStart, dataEnd),
        filename: filenameMatch ? filenameMatch[1] : 'upload.pdf',
      };
    }
    pos = nextBoundary;
  }
  throw new Error('No PDF part found in multipart body');
}

// ── Gemini Files API helpers (mirrors src/server/pdf-parser.js) ─
function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ headers: res.headers, statusCode: res.statusCode, body: data }));
    });
    r.on('error', reject);
    r.setTimeout(120000, () => { r.destroy(); reject(new Error('Request timeout')); });
    if (body) r.write(body);
    r.end();
  });
}

async function uploadToGemini(pdfBuffer, filename) {
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
    },
  }, JSON.stringify({ file: { display_name: filename } }));

  const uploadUrl = startRes.headers['x-goog-upload-url'];
  if (!uploadUrl) throw new Error('Failed to get Gemini upload URL');

  const upUrl = new URL(uploadUrl);
  const uploadRes = await httpsRequest({
    hostname: upUrl.hostname,
    path: upUrl.pathname + upUrl.search,
    method: 'PUT',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Length': pdfBuffer.length,
    },
  }, pdfBuffer);

  const fileData = JSON.parse(uploadRes.body);
  if (!fileData.file?.uri) throw new Error('Gemini upload failed: ' + uploadRes.body.slice(0, 200));
  return fileData.file;
}

async function deleteFromGemini(fileName) {
  try {
    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_API_KEY}`);
    await httpsRequest({ hostname: url.hostname, path: url.pathname + url.search, method: 'DELETE' });
  } catch (e) { /* ignore cleanup errors */ }
}

async function callGeminiWithFile(fileUri, prompt, maxTokens = 4096) {
  const body = JSON.stringify({
    contents: [{
      parts: [
        { fileData: { mimeType: 'application/pdf', fileUri } },
        { text: prompt },
      ],
    }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.1,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`);
  const res = await httpsRequest({
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, body);

  const json = JSON.parse(res.body);
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No response from Gemini: ' + res.body.slice(0, 200));
  return text;
}

function parseJSON(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
  try { return JSON.parse(cleaned); } catch (e) {}
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch (e) {
      const fixed = objMatch[0].replace(/,\s*([}\]])/g, '$1');
      try { return JSON.parse(fixed); } catch (e2) {}
    }
  }
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch (e) {
      const fixed = arrMatch[0].replace(/,\s*([}\]])/g, '$1');
      try { return JSON.parse(fixed); } catch (e2) {}
    }
  }
  throw new Error('Could not parse JSON from Gemini response');
}

// ── Tag fallback (from src/server/pdf-parser.js extractTags) ────
function extractFallbackTags(title, abstract) {
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
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t]) => t);
}

// ── Domain guesser (from src/server/routes.js guessDomains) ─────
function guessDomains(title, abstract, tags) {
  const text = (title + ' ' + abstract + ' ' + tags.join(' ')).toLowerCase();
  const out = [];
  const KW = {
    neuroscience: ['neural', 'brain', 'cortex', 'neuron', 'eeg', 'fmri', 'synapse', 'hippocampus', 'neuroplasticity', 'dopamine', 'serotonin'],
    ai: ['machine learning', 'deep learning', 'transformer', 'llm', 'reinforcement learning', 'neural network', 'generative', 'gpt', 'diffusion', 'agent'],
    cybernetics: ['control', 'feedback', 'dynamical system', 'stability', 'adaptive', 'self-organizing', 'homeostasis', 'regulation', 'observer'],
    cognition: ['cognition', 'cognitive', 'perception', 'attention', 'memory', 'decision making', 'consciousness', 'metacognition', 'embodied', 'human-computer', 'hci', 'interaction', 'user', 'affective', 'emotion', 'social', 'conversational', 'interface', 'usability'],
    biomimetics: ['bio-inspired', 'swarm', 'evolutionary', 'genetic algorithm', 'artificial life', 'cellular automata', 'morphogenesis', 'emergence'],
  };
  for (const [d, kws] of Object.entries(KW)) {
    if (kws.some(k => text.includes(k))) out.push(d);
  }
  if (out.length === 0) out.push('ai');
  return out;
}

// ── Edge computation (from src/server/routes.js) ────────────────
function computeEdgesForPaper(newPaper, allPapers) {
  const edges = [];
  const newTags = new Set(newPaper.tags);
  const newAuthors = new Set(newPaper.authors.map(a => a.toLowerCase()));
  const newDomains = new Set(newPaper.domains);
  const newText = (newPaper.title + ' ' + newPaper.abstract).toLowerCase();

  for (const other of allPapers) {
    if (other.id === newPaper.id) continue;
    const otherTags = new Set(other.tags || []);
    const otherAuthors = new Set((other.authors || []).map(a => a.toLowerCase()));
    const otherDomains = new Set(other.domains || []);

    const sharedTags = [...newTags].filter(t => otherTags.has(t));

    let fuzzy = 0;
    for (const nt of newTags) {
      for (const ot of otherTags) {
        if (nt !== ot && nt.length > 3 && ot.length > 3 && (nt.includes(ot) || ot.includes(nt))) fuzzy++;
      }
    }

    const otherText = (other.title + ' ' + (other.abstract || '')).toLowerCase();
    const newWords = new Set(newText.match(/\b[a-z]{4,}\b/g) || []);
    const otherWords = new Set(otherText.match(/\b[a-z]{4,}\b/g) || []);
    const commonWords = [...newWords].filter(w => otherWords.has(w)).length;
    const sim = commonWords / Math.max(1, Math.sqrt(newWords.size * otherWords.size));

    const sharedAuthors = [...newAuthors].filter(a => otherAuthors.has(a));
    const sharedDomains = [...newDomains].filter(d => otherDomains.has(d));

    const score = (sharedTags.length * 0.5) + (fuzzy * 0.3) + (sharedAuthors.length * 3.0) + (sharedDomains.length * 0.3) + (sim * 8.0);

    if (score >= 1.2) {
      edges.push({
        source: newPaper.id,
        target: other.id,
        weight: Math.round(score * 10) / 10,
        sharedTags: sharedTags.length > 0 ? sharedTags : [`~${commonWords} common terms`],
      });
    }
  }

  edges.sort((a, b) => b.weight - a.weight);
  return edges.slice(0, 20);
}

// ── Handler ─────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let geminiFile = null;
  try {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

    // 1. Parse multipart, extract PDF
    const { buffer, filename } = await readPdfFromRequest(req);
    if (buffer.length === 0) throw new Error('Empty PDF');
    if (buffer.length > 20 * 1024 * 1024) throw new Error('PDF too large (max 20MB)');

    // 2. Upload to Gemini
    geminiFile = await uploadToGemini(buffer, filename.replace(/\.pdf$/i, ''));

    // 3. Extract metadata
    const metaPrompt = `Extract this academic paper's metadata. Return JSON only, no fences:
{"title": "paper title", "authors": ["name1", "name2"], "abstract": "full abstract text", "keywords": ["concept1", "concept2", ...]}

For keywords: extract 10-20 specific research concepts (lowercase, 1-3 words each) like "reinforcement learning", "feedback control", "embodied cognition". Not generic words.`;
    const metaRaw = await callGeminiWithFile(geminiFile.uri, metaPrompt, 2048);
    const meta = parseJSON(metaRaw);

    // 4. Extract sections (single attempt — tighter timing on serverless)
    const sectionsPrompt = `Extract ALL sections from this academic paper. Return a JSON array of sections, no fences:
[{"id": "S1", "title": "1 Introduction", "content": "full section text here...", "isSubsection": false}, ...]

Rules:
- Include EVERY section with its FULL text content
- Use ids like S1, S2, S2.SS1 for subsections
- Preserve math as LaTeX (e.g., $w_{ij}$)
- Skip references/bibliography
- Return ONLY the JSON array`;

    let sections = [];
    try {
      const sectionsRaw = await callGeminiWithFile(geminiFile.uri, sectionsPrompt, 32768);
      const parsed = parseJSON(sectionsRaw);
      sections = (Array.isArray(parsed) ? parsed : (parsed.sections || [])).map((s, i) => ({
        id: s.id || `S${i + 1}`,
        title: s.title || `Section ${i + 1}`,
        paragraphs: (s.content || '').split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 10),
        isSubsection: !!s.isSubsection,
      }));
    } catch (e) {
      // section extraction failure is non-fatal — fall through with abstract only
    }

    // Always lead with abstract section
    if (meta.abstract && (!sections[0] || sections[0].title.toLowerCase() !== 'abstract')) {
      sections.unshift({
        id: 'abstract',
        title: 'Abstract',
        paragraphs: meta.abstract.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 10),
        isSubsection: false,
      });
    }

    // 5. Tags — Gemini's keywords first, supplemented by title-based extraction
    let tags = (meta.keywords || []).map(t => String(t).toLowerCase());
    if (tags.length < 5) {
      tags = [...tags, ...extractFallbackTags(meta.title || filename, meta.abstract || '')];
    }
    tags = [...new Set(tags.map(t => t.toLowerCase()))].slice(0, 20);

    // 6. Build paper object
    const paperId = 'pdf-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const title = meta.title || filename.replace(/\.pdf$/i, '');
    const authors = meta.authors || [];
    const abstract = meta.abstract || '';
    const domains = guessDomains(title, abstract, tags);
    const isOverlap = domains.length > 1;

    // 7. Insert into Supabase: papers + paper_content
    const { error: pErr } = await supabase
      .from('papers')
      .insert({
        id: paperId,
        title,
        authors,
        abstract,
        published: new Date().toISOString(),
        categories: ['pdf-upload'],
        domains,
        tags,
        is_overlap: isOverlap,
        arxiv_url: '',
        pdf_url: '', // see file-level note: no binary persistence
      });
    if (pErr) throw pErr;

    if (sections.length > 0) {
      const totalChars = sections.reduce((sum, s) => sum + (s.paragraphs || []).join('').length, 0);
      await supabase.from('paper_content').upsert({
        paper_id: paperId,
        sections, // JSONB; matches shape consumed by api/papers/[id]/content.js
        source: 'pdf',
        total_chars: totalChars,
      });
    }

    // 8. Compute & insert edges (upsert against UNIQUE(source, target))
    const { data: allPapers } = await supabase
      .from('papers')
      .select('id, title, abstract, authors, tags, domains');

    const newPaperForEdges = { id: paperId, title, abstract, authors, tags, domains };
    const newEdges = computeEdgesForPaper(newPaperForEdges, allPapers || []);
    if (newEdges.length > 0) {
      const rows = newEdges.map(e => ({
        source: e.source,
        target: e.target,
        weight: e.weight,
        shared_tags: e.sharedTags,
      }));
      await supabase.from('edges').upsert(rows, { onConflict: 'source,target' });
    }

    res.json({
      success: true,
      paper: {
        id: paperId,
        title,
        authors,
        domains,
        tags,
        edgesAdded: newEdges.length,
        sections: sections.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (geminiFile?.name) await deleteFromGemini(geminiFile.name);
  }
}
