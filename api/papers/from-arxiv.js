// POST /api/papers/from-arxiv
// Body: { url?: string, arxivId?: string }   — accept either form
// Resolves the input to a canonical arXiv ID, fetches its Atom feed, parses,
// inserts a paper row + recomputed edges into Supabase.
//
// Inlined helpers (extractKeywords, mapDomains, parseEntry, computeEdgesForPaper)
// from src/server/arxiv.js + src/server/routes.js — keeps the function lean.
import { supabase } from '../_lib/supabase.js';
import https from 'https';
import { parseStringPromise } from 'xml2js';

export const config = { maxDuration: 25 };

// ── HTTP fetch (mirrors src/server/arxiv.js) ───────────────────
function fetchURL(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'BASAIRA/1.0 (research-tool)' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchURL(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`arXiv HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── Resolve input → canonical arXiv ID ─────────────────────────
// Accepts: full URLs (abs/pdf), bare IDs, with or without version.
function resolveArxivId(input) {
  if (!input || typeof input !== 'string') return null;
  let s = input.trim();
  // Strip URL prefix to leave the path or ID
  s = s.replace(/^https?:\/\/(?:www\.)?arxiv\.org\//i, '');
  // Strip leading abs/ or pdf/ paths
  s = s.replace(/^(?:abs|pdf)\//i, '');
  // Strip trailing .pdf
  s = s.replace(/\.pdf$/i, '');
  // Strip trailing slash / fragments / query
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '');
  // What's left should be e.g. "2401.12345" or "2401.12345v2" or older "cs/0301001"
  if (!/^[a-z\-]*\/?\d{4,7}\.?\d{4,5}(v\d+)?$|^[a-z\-]+\/\d{7}(v\d+)?$/i.test(s)) {
    // Be lenient: accept anything that contains only safe chars and at least one digit.
    if (!/^[A-Za-z0-9./_\-]+$/.test(s) || !/\d/.test(s)) return null;
  }
  return s;
}

// ── Tag extraction (from src/server/arxiv.js) ──────────────────
function extractKeywords(text) {
  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall',
    'this', 'that', 'these', 'those', 'it', 'its', 'we', 'our', 'they', 'their', 'them',
    'which', 'what', 'who', 'whom', 'where', 'when', 'how', 'than', 'then', 'so', 'as',
    'if', 'not', 'no', 'nor', 'such', 'each', 'every', 'all', 'both', 'few', 'more',
    'most', 'other', 'some', 'any', 'only', 'own', 'same', 'into', 'over', 'after',
    'before', 'between', 'under', 'above', 'up', 'down', 'out', 'off', 'about', 'also',
    'just', 'very', 'still', 'even', 'here', 'there', 'while', 'during', 'through',
    'using', 'used', 'based', 'approach', 'method', 'propose', 'proposed', 'show',
    'shown', 'result', 'results', 'paper', 'work', 'study', 'new', 'however', 'well',
    'two', 'one', 'first', 'second', 'across', 'within', 'without', 'among', 'against',
    'along', 'rather', 'since', 'thus', 'hence', 'therefore', 'although', 'though',
    'whether', 'either', 'neither', 'yet', 'already', 'further', 'furthermore',
    'moreover', 'provides', 'provide', 'including', 'demonstrate', 'demonstrates',
    'significantly', 'particular', 'particularly', 'respectively', 'specifically',
    'compared', 'performance', 'model', 'models', 'data', 'given', 'different',
  ]);

  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopwords.has(w));

  const freq = {};
  words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  for (let i = 0; i < words.length - 1; i++) {
    if (!stopwords.has(words[i]) && !stopwords.has(words[i + 1])) {
      freq[`${words[i]} ${words[i + 1]}`] = (freq[`${words[i]} ${words[i + 1]}`] || 0) + 1.5;
    }
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([word]) => word);
}

// ── arXiv category → BASAIRA_ domain mapping ───────────────────
function mapDomains(categories) {
  const domainMap = {
    'q-bio.NC': ['neuroscience', 'cognition'],
    'cs.AI': ['ai'],
    'cs.LG': ['ai'],
    'cs.SY': ['cybernetics'],
    'eess.SY': ['cybernetics'],
    'cs.HC': ['cognition'],
    'cs.NE': ['biomimetics'],
    'cs.RO': ['biomimetics'],
    'q-bio.PE': ['biomimetics'],
    'cs.CL': ['ai'],
    'cs.CV': ['ai'],
    'cs.MA': ['cybernetics', 'ai'],
    'stat.ML': ['ai'],
    'cs.IT': ['cybernetics'],
    'math.OC': ['cybernetics'],
  };
  const domains = new Set();
  (categories || []).forEach(cat => (domainMap[cat] || []).forEach(d => domains.add(d)));
  return [...domains];
}

// ── Single-entry parser (mirrors src/server/arxiv.js parseEntry) ─
function parseEntry(entry) {
  const id = entry.id[0].split('/abs/')[1] || entry.id[0];
  const categories = (entry.category || []).map(c => c.$.term);
  const authors = (entry.author || []).map(a => a.name[0]);
  const title = (entry.title || [''])[0].replace(/\s+/g, ' ').trim();
  const abstract = (entry.summary || [''])[0].replace(/\s+/g, ' ').trim();
  const tags = extractKeywords(title + ' ' + abstract);
  const domains = mapDomains(categories);

  const links = entry.link || [];
  const pdfLink = links.find(l => l.$.title === 'pdf');
  const htmlLink = links.find(l => l.$.type === 'text/html');

  return {
    id,
    title,
    authors,
    abstract,
    categories,
    domains: domains.length > 0 ? domains : ['ai'],
    tags,
    published: entry.published ? entry.published[0] : null,
    pdfUrl: pdfLink ? pdfLink.$.href : `https://arxiv.org/pdf/${id}`,
    arxivUrl: htmlLink ? htmlLink.$.href : `https://arxiv.org/abs/${id}`,
  };
}

// ── Edge computation (from src/server/routes.js computeEdgesForPaper) ─
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

    let fuzzyMatches = 0;
    for (const nt of newTags) {
      for (const ot of otherTags) {
        if (nt !== ot && nt.length > 3 && ot.length > 3) {
          if (nt.includes(ot) || ot.includes(nt)) fuzzyMatches++;
        }
      }
    }

    const otherText = (other.title + ' ' + (other.abstract || '')).toLowerCase();
    const newWords = new Set(newText.match(/\b[a-z]{4,}\b/g) || []);
    const otherWords = new Set(otherText.match(/\b[a-z]{4,}\b/g) || []);
    const commonWords = [...newWords].filter(w => otherWords.has(w)).length;
    const abstractSim = commonWords / Math.max(1, Math.sqrt(newWords.size * otherWords.size));

    const sharedAuthors = [...newAuthors].filter(a => otherAuthors.has(a));
    const sharedDomains = [...newDomains].filter(d => otherDomains.has(d));

    const score = (sharedTags.length * 0.5)
      + (fuzzyMatches * 0.3)
      + (sharedAuthors.length * 3.0)
      + (sharedDomains.length * 0.3)
      + (abstractSim * 8.0);

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

// ── Handler ────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const rawInput = body.arxivId || body.url || body.id;
  const arxivId = resolveArxivId(rawInput);
  if (!arxivId) {
    return res.status(400).json({ error: 'Invalid or missing arXiv ID/URL. Provide { url } or { arxivId }.' });
  }

  try {
    // Avoid duplicate inserts — check if paper already exists
    const { data: existing } = await supabase
      .from('papers')
      .select('id, title, authors, domains, tags')
      .eq('id', arxivId)
      .maybeSingle();
    if (existing) {
      return res.json({
        success: true,
        alreadyExists: true,
        paper: {
          id: existing.id,
          title: existing.title,
          authors: existing.authors || [],
          domains: existing.domains || [],
          tags: existing.tags || [],
          edgesAdded: 0,
          sections: 0,
        },
      });
    }

    // Fetch from arXiv API
    const apiUrl = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;
    const xml = await fetchURL(apiUrl);
    const parsed = await parseStringPromise(xml);

    if (!parsed.feed || !parsed.feed.entry || parsed.feed.entry.length === 0) {
      return res.status(404).json({ error: `No arXiv entry found for "${arxivId}"` });
    }

    const paper = parseEntry(parsed.feed.entry[0]);
    paper.isOverlap = paper.domains.length > 1;

    // Insert paper row
    const { error: insertErr } = await supabase
      .from('papers')
      .insert({
        id: paper.id,
        title: paper.title,
        authors: paper.authors,
        abstract: paper.abstract,
        published: paper.published,
        categories: paper.categories,
        domains: paper.domains,
        tags: paper.tags,
        is_overlap: paper.isOverlap,
        arxiv_url: paper.arxivUrl,
        pdf_url: paper.pdfUrl,
      });
    if (insertErr) throw insertErr;

    // Compute edges against existing papers, then upsert (UNIQUE(source, target))
    const { data: allPapers } = await supabase
      .from('papers')
      .select('id, title, abstract, authors, tags, domains');

    const newEdges = computeEdgesForPaper(paper, allPapers || []);
    if (newEdges.length > 0) {
      const rows = newEdges.map(e => ({
        source: e.source,
        target: e.target,
        weight: e.weight,
        shared_tags: e.sharedTags,
      }));
      // upsert avoids hitting the UNIQUE(source, target) constraint
      await supabase.from('edges').upsert(rows, { onConflict: 'source,target' });
    }

    res.json({
      success: true,
      paper: {
        id: paper.id,
        title: paper.title,
        authors: paper.authors,
        domains: paper.domains,
        tags: paper.tags,
        edgesAdded: newEdges.length,
        sections: 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
