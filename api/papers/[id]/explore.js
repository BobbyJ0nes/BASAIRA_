import { supabase } from '../../_lib/supabase.js';
import https from 'https';

export const config = { maxDuration: 25 };

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 4096, temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } } });
    const url = new URL(GEMINI_URL);
    const req = https.request({ hostname: url.hostname, path: url.pathname + url.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.candidates?.[0]?.content?.parts?.[0]?.text) resolve(j.candidates[0].content.parts[0].text);
          else reject(new Error(j.error?.message || 'No response'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

function parseJSON(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
  try { return JSON.parse(cleaned); } catch (e) {}
  const m = cleaned.match(/\[[\s\S]*\]/);
  if (m) {
    let arr = m[0].replace(/,\s*\]/g, ']');
    try { return JSON.parse(arr); } catch (e) {
      const last = arr.lastIndexOf('},');
      if (last > 0) try { return JSON.parse(arr.slice(0, last + 1) + ']'); } catch (e2) {}
    }
  }
  throw new Error('Could not parse JSON');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const paperId = req.query.id;
  const { concept } = req.body || {};
  if (!paperId || !concept) return res.status(400).json({ error: 'Missing ID or concept' });

  try {
    const { data: content } = await supabase.from('paper_content').select('sections').eq('paper_id', paperId).single();
    const { data: paper } = await supabase.from('papers').select('abstract').eq('id', paperId).single();

    let fullText = paper?.abstract || '';
    if (content?.sections) {
      fullText = content.sections.map(s => `[SECTION: ${s.title}]\n${s.paragraphs ? s.paragraphs.join('\n\n') : s.content || ''}`).join('\n\n');
    }
    const truncated = fullText.slice(0, 15000);

    const prompt = `You are a research paper analyst. The user wants to explore: "${concept}"\n\nFind 3-6 EXACT passages (20-150 words, character-for-character from text) relevant to "${concept}".\n\nReturn ONLY JSON array:\n[{"passage": "exact text", "section": "section title", "explanation": "how it relates"}]\n\nIMPORTANT: "passage" must be EXACT copy from text below.\n\nPaper:\n${truncated}`;

    const response = await callGemini(prompt);
    const passages = parseJSON(response);

    // Verify passages exist in text
    const normalizedFull = fullText.replace(/\s+/g, ' ');
    const verified = passages.filter(p => {
      const norm = p.passage.replace(/\s+/g, ' ').trim();
      if (normalizedFull.includes(norm)) return true;
      if (normalizedFull.includes(norm.slice(0, 60))) { p.passage = norm; return true; }
      return false;
    });

    res.json({ concept, passages: verified });
  } catch (err) {
    res.status(500).json({ error: err.message, passages: [] });
  }
}
