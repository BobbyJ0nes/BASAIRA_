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
  const paperId = req.query.id;
  if (!paperId) return res.status(400).json({ error: 'Missing ID' });

  try {
    // Check cache
    const { data: cached } = await supabase.from('paper_concepts').select('concepts').eq('paper_id', paperId).single();
    if (cached?.concepts?.length > 0) return res.json({ concepts: cached.concepts });

    // Get paper content
    const { data: content } = await supabase.from('paper_content').select('sections').eq('paper_id', paperId).single();
    const { data: paper } = await supabase.from('papers').select('abstract').eq('id', paperId).single();

    let text = paper?.abstract || '';
    if (content?.sections) text = content.sections.map(s => `## ${s.title}\n${s.paragraphs ? s.paragraphs.join('\n') : s.content || ''}`).join('\n\n');
    text = text.slice(0, 12000);

    const prompt = `You are analyzing a research paper. Extract 8-12 key concepts, themes, or ideas.\n\nFor each: short concept name (2-5 words, lowercase) and one-sentence description.\n\nReturn ONLY a JSON array:\n[{"concept": "name", "description": "sentence"}]\n\nPaper text:\n${text}`;

    const response = await callGemini(prompt);
    const concepts = parseJSON(response);

    // Cache
    await supabase.from('paper_concepts').upsert({ paper_id: paperId, concepts });

    res.json({ concepts });
  } catch (err) {
    res.status(500).json({ error: err.message, concepts: [] });
  }
}
