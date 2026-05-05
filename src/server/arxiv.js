// ═══════════════════════════════════════════════════════════
// BASAIRA_ Data Pipeline — arXiv Fetcher, Parser & Edge Computer
// ═══════════════════════════════════════════════════════════
//
// This module is the core data engine. It:
//
//   1. FETCH   — Queries arXiv's Atom API for each configured domain
//   2. PARSE   — Converts XML entries into normalized paper objects
//   3. EXTRACT — Pulls keywords from title+abstract via term frequency
//   4. MAP     — Assigns BASAIRA_ domains based on arXiv category codes
//   5. LINK    — Computes weighted edges between papers sharing
//                keywords, authors, categories, or domains
//
// Exported functions:
//   fetchPapersForQuery(query, maxResults) → Paper[]
//   fetchAllPapers() → { papers: Paper[], edges: Edge[] }
//
// Rate limiting: 3.5s delay between arXiv requests (configurable
// via ARXIV_DELAY_MS in scan.config.js)
//
// ═══════════════════════════════════════════════════════════
import https from 'https';
import { parseStringPromise } from 'xml2js';
import { DOMAINS, ARXIV_API_BASE, ARXIV_DELAY_MS } from '../../scan.config.js';

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'BASAIRA/1.0 (research-tool)' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchURL(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Extract keywords from title + abstract using simple TF approach
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
    'compared', 'performance', 'model', 'models', 'data', 'given', 'can', 'different'
  ]);

  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopwords.has(w));

  const freq = {};
  words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });

  // Also extract bigrams
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    if (!stopwords.has(words[i]) && !stopwords.has(words[i + 1])) {
      freq[bigram] = (freq[bigram] || 0) + 1.5; // Boost bigrams
    }
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([word]) => word);
}

// Map arXiv categories to BASAIRA_ domains
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
  categories.forEach(cat => {
    (domainMap[cat] || []).forEach(d => domains.add(d));
  });
  return [...domains];
}

function parseEntry(entry) {
  const id = entry.id[0].split('/abs/')[1] || entry.id[0];
  const categories = (entry.category || []).map(c => c.$.term);
  const authors = (entry.author || []).map(a => a.name[0]);
  const title = (entry.title || [''])[0].replace(/\s+/g, ' ').trim();
  const abstract = (entry.summary || [''])[0].replace(/\s+/g, ' ').trim();
  const tags = extractKeywords(title + ' ' + abstract);
  const domains = mapDomains(categories);

  const links = (entry.link || []);
  const pdfLink = links.find(l => l.$.title === 'pdf');
  const htmlLink = links.find(l => l.$.type === 'text/html');

  return {
    id,
    title,
    authors,
    abstract,
    categories,
    domains: domains.length > 0 ? domains : ['ai'], // fallback
    tags,
    published: entry.published ? entry.published[0] : null,
    updated: entry.updated ? entry.updated[0] : null,
    pdfUrl: pdfLink ? pdfLink.$.href : `https://arxiv.org/pdf/${id}`,
    arxivUrl: htmlLink ? htmlLink.$.href : `https://arxiv.org/abs/${id}`,
    primaryCategory: entry['arxiv:primary_category'] ? entry['arxiv:primary_category'][0].$.term : categories[0],
  };
}

export async function fetchPapersForQuery(query, maxResults = 40) {
  const url = `${ARXIV_API_BASE}?search_query=${encodeURIComponent(query)}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;
  console.log(`  → Fetching: ${query} (max ${maxResults})`);

  try {
    const xml = await fetchURL(url);
    const parsed = await parseStringPromise(xml);

    if (!parsed.feed || !parsed.feed.entry) {
      console.log(`    No entries found for: ${query}`);
      return [];
    }

    const papers = parsed.feed.entry.map(parseEntry);
    console.log(`    Found ${papers.length} papers`);
    return papers;
  } catch (err) {
    console.error(`    Error fetching ${query}:`, err.message);
    return [];
  }
}

export async function fetchAllPapers() {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║   BASAIRA_ — Fetching papers from arXiv  ║');
  console.log('╚══════════════════════════════════════╝\n');

  const allPapers = new Map(); // Deduplicate by ID

  for (const [domainKey, domain] of Object.entries(DOMAINS)) {
    console.log(`\n▸ Domain: ${domain.label}`);

    for (const query of domain.queries) {
      const papers = await fetchPapersForQuery(query, domain.maxResults);

      papers.forEach(paper => {
        if (allPapers.has(paper.id)) {
          // Merge domains
          const existing = allPapers.get(paper.id);
          const merged = new Set([...existing.domains, ...paper.domains]);
          existing.domains = [...merged];
          existing.isOverlap = existing.domains.length > 1;
        } else {
          paper.isOverlap = paper.domains.length > 1;
          allPapers.set(paper.id, paper);
        }
      });

      await delay(ARXIV_DELAY_MS);
    }
  }

  const papers = [...allPapers.values()];
  console.log(`\n✓ Total unique papers: ${papers.length}`);

  // Compute edges
  const edges = computeEdges(papers);
  console.log(`✓ Computed ${edges.length} edges\n`);

  return { papers, edges };
}

function computeEdges(papers) {
  const edges = [];

  for (let i = 0; i < papers.length; i++) {
    for (let j = i + 1; j < papers.length; j++) {
      const a = papers[i];
      const b = papers[j];
      let weight = 0;

      // Shared tags
      const sharedTags = a.tags.filter(t => b.tags.includes(t));
      if (sharedTags.length >= 2) weight += sharedTags.length * 0.5;

      // Shared authors
      const sharedAuthors = a.authors.filter(au => b.authors.includes(au));
      if (sharedAuthors.length > 0) weight += sharedAuthors.length * 3;

      // Shared categories
      const sharedCats = a.categories.filter(c => b.categories.includes(c));
      if (sharedCats.length > 0) weight += sharedCats.length * 0.8;

      // Same domain (weak link)
      const sharedDomains = a.domains.filter(d => b.domains.includes(d));
      if (sharedDomains.length > 0) weight += 0.3;

      if (weight >= 1.5) {
        edges.push({
          source: a.id,
          target: b.id,
          weight: Math.min(weight, 10),
          sharedTags: sharedTags.slice(0, 5),
          sharedAuthors,
          sharedDomains
        });
      }
    }
  }

  // Keep top edges to avoid visual clutter — max ~500
  edges.sort((a, b) => b.weight - a.weight);
  return edges.slice(0, 600);
}
