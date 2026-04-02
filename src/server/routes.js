// ═══════════════════════════════════════════════════════════
// BASIRA_ API Routes
// ═══════════════════════════════════════════════════════════
//
// REST endpoints served under /api:
//
//   GET  /api/papers          → Full graph data {papers, edges}
//        ?domain=ai              Filter by SCAN domain key
//        ?search=transformer     Substring match on title/abstract/authors/tags
//        ?tag=neural             Exact match on extracted keyword
//
//   GET  /api/papers/:id      → Single paper by arXiv ID
//   GET  /api/domains         → Domain metadata + live paper counts
//   GET  /api/tags            → Top 100 keywords by frequency
//   GET  /api/stats           → Overview: totals, domain breakdown, last update
//   POST /api/refresh         → Re-fetch all papers from arXiv (~60s)
//   POST /api/export          → Generate Obsidian Markdown files
//        body: { paperIds: string[] }
//
// Data lifecycle:
//   initData() runs on server startup — loads from JSON cache if
//   fresh (<24h), otherwise triggers a full arXiv re-fetch.
//
// ═══════════════════════════════════════════════════════════
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fetchAllPapers } from './arxiv.js';
import { conceptualSearch } from './search.js';
import { fetchFullPaper } from './paper-parser.js';
import { extractConcepts, extractSectionConcepts, findConceptPassages } from './concepts.js';
import { CACHE_FILE, CACHE_MAX_AGE_HOURS, DOMAINS } from '../../scan.config.js';

// In-memory cache for fetched full-text papers (avoid re-fetching)
const fullTextCache = new Map();

// Obsidian vault paths — matches animus-journal pattern
const VAULT_BASE = process.env.VAULT_PATH || '';
const VAULT_BASIRA_FOLDER = process.env.VAULT_BASIRA_FOLDER || 'scan';
const VAULT_BASIRA_PATH = VAULT_BASE ? path.join(VAULT_BASE, VAULT_BASIRA_FOLDER) : '';

function ensureVaultDir() {
  if (!VAULT_BASIRA_PATH) throw new Error('VAULT_PATH not configured in .env');
  if (!fs.existsSync(VAULT_BASIRA_PATH)) {
    fs.mkdirSync(VAULT_BASIRA_PATH, { recursive: true });
  }
}

const router = Router();
const cacheFilePath = path.resolve(CACHE_FILE);

let graphData = { papers: [], edges: [] };

// Load cache or fetch
export async function initData() {
  if (fs.existsSync(cacheFilePath)) {
    const stat = fs.statSync(cacheFilePath);
    const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);

    if (ageHours < CACHE_MAX_AGE_HOURS) {
      console.log('Loading papers from cache...');
      graphData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8'));
      console.log(`Loaded ${graphData.papers.length} papers, ${graphData.edges.length} edges from cache.`);
      return;
    }
  }

  await refreshData();
}

async function refreshData() {
  graphData = await fetchAllPapers();
  // Ensure directory
  const dir = path.dirname(cacheFilePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cacheFilePath, JSON.stringify(graphData, null, 2));
  console.log('Cache written.');
}

// GET /api/papers — full graph data
router.get('/papers', (req, res) => {
  const { domain, search, tag } = req.query;
  let papers = graphData.papers;
  let edges = graphData.edges;

  if (domain) {
    papers = papers.filter(p => p.domains.includes(domain));
    const ids = new Set(papers.map(p => p.id));
    edges = edges.filter(e => ids.has(e.source) && ids.has(e.target));
  }

  if (search) {
    const q = search.toLowerCase();
    papers = papers.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.abstract.toLowerCase().includes(q) ||
      p.authors.some(a => a.toLowerCase().includes(q)) ||
      p.tags.some(t => t.includes(q))
    );
    const ids = new Set(papers.map(p => p.id));
    edges = edges.filter(e => ids.has(e.source) && ids.has(e.target));
  }

  if (tag) {
    papers = papers.filter(p => p.tags.includes(tag.toLowerCase()));
    const ids = new Set(papers.map(p => p.id));
    edges = edges.filter(e => ids.has(e.source) && ids.has(e.target));
  }

  res.json({ papers, edges });
});

// GET /api/papers/:id
router.get('/papers/:id', (req, res) => {
  const paper = graphData.papers.find(p => p.id === req.params.id);
  if (!paper) return res.status(404).json({ error: 'Paper not found' });
  res.json(paper);
});

// GET /api/domains — domain stats
router.get('/domains', (req, res) => {
  const stats = {};
  for (const [key, domain] of Object.entries(DOMAINS)) {
    const count = graphData.papers.filter(p => p.domains.includes(key)).length;
    stats[key] = { ...domain, count, queries: undefined };
  }
  res.json(stats);
});

// GET /api/tags — tag frequency
router.get('/tags', (req, res) => {
  const freq = {};
  graphData.papers.forEach(p => {
    p.tags.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
  });
  const sorted = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100)
    .map(([tag, count]) => ({ tag, count }));
  res.json(sorted);
});

// GET /api/stats — overview
router.get('/stats', (req, res) => {
  res.json({
    totalPapers: graphData.papers.length,
    totalEdges: graphData.edges.length,
    overlapPapers: graphData.papers.filter(p => p.isOverlap).length,
    domains: Object.entries(DOMAINS).map(([key, d]) => ({
      key,
      label: d.label,
      color: d.color,
      count: graphData.papers.filter(p => p.domains.includes(key)).length
    })),
    lastUpdated: fs.existsSync(cacheFilePath) ? fs.statSync(cacheFilePath).mtime : null
  });
});

// POST /api/refresh
router.post('/refresh', async (req, res) => {
  try {
    await refreshData();
    res.json({ success: true, papers: graphData.papers.length, edges: graphData.edges.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/export — export papers as markdown
router.post('/export', (req, res) => {
  const { paperIds } = req.body;
  if (!paperIds || !Array.isArray(paperIds)) {
    return res.status(400).json({ error: 'paperIds array required' });
  }

  const papers = graphData.papers.filter(p => paperIds.includes(p.id));
  const markdownFiles = papers.map(p => {
    const frontmatter = [
      '---',
      `title: "${p.title.replace(/"/g, '\\"')}"`,
      `authors: [${p.authors.map(a => `"${a}"`).join(', ')}]`,
      `published: ${p.published}`,
      `domains: [${p.domains.join(', ')}]`,
      `tags: [${p.tags.join(', ')}]`,
      `arxiv: ${p.arxivUrl}`,
      `pdf: ${p.pdfUrl}`,
      `source: BASIRA_`,
      '---',
    ].join('\n');

    const body = [
      `# ${p.title}`,
      '',
      `**Authors:** ${p.authors.join(', ')}`,
      `**Published:** ${p.published}`,
      `**Categories:** ${p.categories.join(', ')}`,
      `**Domains:** ${p.domains.join(', ')}`,
      '',
      `## Abstract`,
      '',
      p.abstract,
      '',
      `## Links`,
      `- [arXiv](${p.arxivUrl})`,
      `- [PDF](${p.pdfUrl})`,
      '',
      `## Tags`,
      p.tags.map(t => `#${t.replace(/\s+/g, '-')}`).join(' '),
      '',
      `## Notes`,
      '',
      '<!-- Add your notes here -->',
      '',
    ].join('\n');

    return {
      filename: `${p.id.replace(/[/.]/g, '-')}.md`,
      content: frontmatter + '\n\n' + body
    };
  });

  res.json({ files: markdownFiles });
});

// ═══════════════════════════════════════════════════════════
// CONCEPTUAL SEARCH
// ═══════════════════════════════════════════════════════════

// GET /api/search?q=brain+interfaces — concept-based search
router.get('/search', (req, res) => {
  const { q, limit } = req.query;
  if (!q) return res.json([]);
  const results = conceptualSearch(graphData.papers, q, parseInt(limit) || 40);
  res.json(results);
});

// POST /api/search-annotations — search a concept across all papers + user annotations
router.post('/search-annotations', (req, res) => {
  const { query, annotations } = req.body;
  if (!query) return res.json({ papers: [], annotations: [] });

  // Search papers conceptually
  const paperResults = conceptualSearch(graphData.papers, query, 20);

  // Search through annotations (highlights + comments)
  const q = query.toLowerCase();
  const matchedAnnotations = (annotations || []).filter(a =>
    (a.text && a.text.toLowerCase().includes(q)) ||
    (a.comment && a.comment.toLowerCase().includes(q))
  );

  res.json({ papers: paperResults, annotations: matchedAnnotations });
});

// ═══════════════════════════════════════════════════════════
// PAPER CONTENT (for reader view)
// ═══════════════════════════════════════════════════════════

// GET /api/papers/:id/content — fetch full paper text from arXiv HTML
router.get('/papers/:id/content', async (req, res) => {
  const paper = graphData.papers.find(p => p.id === req.params.id);
  if (!paper) return res.status(404).json({ error: 'Paper not found' });

  const base = {
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    published: paper.published,
    categories: paper.categories,
    domains: paper.domains,
    tags: paper.tags,
    pdfUrl: paper.pdfUrl,
    arxivUrl: paper.arxivUrl,
    isOverlap: paper.isOverlap,
    fullAbstract: paper.abstract,
  };

  // Check cache first
  if (fullTextCache.has(paper.id)) {
    const cached = fullTextCache.get(paper.id);
    return res.json({ ...base, sections: cached.sections, source: cached.source });
  }

  // Fetch full text from arXiv HTML
  let result = null;
  try {
    result = await fetchFullPaper(paper.id);
  } catch (err) {
    console.log(`  Full text fetch error for ${paper.id}:`, err.message);
  }

  if (result && result.sections && result.sections.length > 0) {
    // Convert parser format (paragraphs array) to reader format (content string)
    const sections = result.sections.map(s => ({
      id: s.id,
      title: s.title,
      content: s.paragraphs.join('\n\n'),
      isSubsection: s.isSubsection || false,
    }));

    fullTextCache.set(paper.id, { sections, source: result.source });
    return res.json({ ...base, sections, source: result.source });
  }

  // Fallback: abstract only
  const fallbackSections = [
    { id: 'abstract', title: 'Abstract', content: paper.abstract },
  ];
  fullTextCache.set(paper.id, { sections: fallbackSections, source: 'abstract' });
  res.json({ ...base, sections: fallbackSections, source: 'abstract' });
});

// ═══════════════════════════════════════════════════════════
// CONCEPT EXPLORER — AI-powered in-paper concept discovery
// ═══════════════════════════════════════════════════════════

// GET /api/papers/:id/concepts — extract key concepts from a paper
router.get('/papers/:id/concepts', async (req, res) => {
  const paper = graphData.papers.find(p => p.id === req.params.id);
  if (!paper) return res.status(404).json({ error: 'Paper not found' });

  try {
    // Get the full text (from cache or fetch)
    let sections;
    if (fullTextCache.has(paper.id)) {
      sections = fullTextCache.get(paper.id).sections;
    } else {
      // Try fetching full text
      const result = await fetchFullPaper(paper.id);
      if (result && result.sections.length > 0) {
        sections = result.sections.map(s => ({
          id: s.id, title: s.title,
          content: s.paragraphs.join('\n\n'),
        }));
        fullTextCache.set(paper.id, { sections, source: result.source });
      } else {
        sections = [{ id: 'abstract', title: 'Abstract', content: paper.abstract }];
      }
    }

    const concepts = await extractConcepts(paper.id, sections);
    res.json({ concepts });
  } catch (err) {
    console.error('Concept extraction error:', err.message);
    res.status(500).json({ error: 'Failed to extract concepts' });
  }
});

// POST /api/papers/:id/explore — find passages related to a concept
router.post('/papers/:id/explore', async (req, res) => {
  const paper = graphData.papers.find(p => p.id === req.params.id);
  if (!paper) return res.status(404).json({ error: 'Paper not found' });

  const { concept } = req.body;
  if (!concept) return res.status(400).json({ error: 'Concept required' });

  try {
    let sections;
    if (fullTextCache.has(paper.id)) {
      sections = fullTextCache.get(paper.id).sections;
    } else {
      const result = await fetchFullPaper(paper.id);
      if (result && result.sections.length > 0) {
        sections = result.sections.map(s => ({
          id: s.id, title: s.title,
          content: s.paragraphs.join('\n\n'),
        }));
        fullTextCache.set(paper.id, { sections, source: result.source });
      } else {
        sections = [{ id: 'abstract', title: 'Abstract', content: paper.abstract }];
      }
    }

    const passages = await findConceptPassages(concept, sections);
    res.json({ concept, passages });
  } catch (err) {
    console.error('Concept explore error:', err.message);
    res.status(500).json({ error: 'Failed to find passages' });
  }
});

// GET /api/papers/:id/sections/:sectionId/concepts — extract concepts from a single section
router.get('/papers/:id/sections/:sectionId/concepts', async (req, res) => {
  const paper = graphData.papers.find(p => p.id === req.params.id);
  if (!paper) return res.status(404).json({ error: 'Paper not found' });

  try {
    let sections;
    if (fullTextCache.has(paper.id)) {
      sections = fullTextCache.get(paper.id).sections;
    } else {
      const result = await fetchFullPaper(paper.id);
      if (result && result.sections.length > 0) {
        sections = result.sections.map(s => ({
          id: s.id, title: s.title,
          content: s.paragraphs.join('\n\n'),
        }));
        fullTextCache.set(paper.id, { sections, source: result.source });
      } else {
        sections = [{ id: 'abstract', title: 'Abstract', content: paper.abstract }];
      }
    }

    const section = sections.find(s => s.id === req.params.sectionId);
    if (!section) return res.status(404).json({ error: 'Section not found' });

    const concepts = await extractSectionConcepts(paper.id, section.id, section.title, section.content);
    res.json({ sectionId: section.id, sectionTitle: section.title, concepts });
  } catch (err) {
    console.error('Section concept error:', err.message);
    res.status(500).json({ error: 'Failed to extract section concepts' });
  }
});

// ═══════════════════════════════════════════════════════════
// VAULT INTEGRATION — Write directly to Obsidian
// ═══════════════════════════════════════════════════════════

// POST /api/vault/save — save a paper + annotations to Obsidian vault
router.post('/vault/save', (req, res) => {
  try {
    ensureVaultDir();
    const { paper, annotations, notes } = req.body;
    if (!paper || !paper.id) return res.status(400).json({ error: 'Paper data required' });

    const p = paper;
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    // Build frontmatter
    const lines = [
      '---',
      `title: "${p.title.replace(/"/g, '\\"')}"`,
      `authors: [${p.authors.map(a => `"${a}"`).join(', ')}]`,
      `published: ${p.published}`,
      `domains: [${p.domains.join(', ')}]`,
      `tags: [${p.tags.map(t => t.replace(/\s+/g, '-')).join(', ')}]`,
      `arxiv: ${p.arxivUrl}`,
      `pdf: ${p.pdfUrl}`,
      `source: BASIRA_`,
      `saved: ${dateStr}`,
      '---',
      '',
      `# ${p.title}`,
      '',
      `**Authors:** ${p.authors.join(', ')}`,
      `**Published:** ${new Date(p.published).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      `**Domains:** ${p.domains.join(', ')}`,
      `**Categories:** ${p.categories.join(' · ')}`,
      '',
      `> [arXiv](${p.arxivUrl}) · [PDF](${p.pdfUrl})`,
      '',
      '## Abstract',
      '',
      p.abstract,
      '',
    ];

    // Add annotations (highlights with comments)
    if (annotations && annotations.length > 0) {
      // Separate concept-discovered highlights from manual highlights
      const conceptAnns = annotations.filter(a => a.type === 'concept');
      const manualAnns = annotations.filter(a => a.type !== 'concept');

      if (conceptAnns.length > 0) {
        lines.push('## Concept Explorations');
        lines.push('');
        // Group by concept
        const byConcept = {};
        conceptAnns.forEach(a => {
          const key = a.concept || 'Unknown';
          if (!byConcept[key]) byConcept[key] = [];
          byConcept[key].push(a);
        });
        Object.entries(byConcept).forEach(([concept, anns]) => {
          lines.push(`### 🔍 ${concept}`);
          lines.push('');
          anns.forEach(a => {
            lines.push(`> ${a.text}`);
            lines.push('');
            if (a.explanation) {
              lines.push(`*${a.explanation}*`);
              lines.push('');
            }
            if (a.userComment) {
              lines.push(`💬 ${a.userComment}`);
              lines.push('');
            }
          });
        });
      }

      if (manualAnns.length > 0) {
        lines.push('## Annotations');
        lines.push('');
        manualAnns.forEach((a, i) => {
          const colorLabel = a.color === '#ffb3ba' ? '🔴' : a.color === '#bae1ff' ? '🔵' : '🟡';
          lines.push(`### ${colorLabel} Highlight ${i + 1}`);
          lines.push('');
          lines.push(`> ${a.text}`);
          lines.push('');
          if (a.comment) {
            lines.push(a.comment);
            lines.push('');
          }
        });
      }
    }

    // Add notes
    if (notes && notes.trim()) {
      lines.push('## Notes');
      lines.push('');
      lines.push(notes.trim());
      lines.push('');
    }

    // Tags
    lines.push('## Tags');
    lines.push('');
    lines.push(p.tags.map(t => `#${t.replace(/\s+/g, '-')}`).join(' ') + ' #basira');
    lines.push('');
    lines.push('---');
    lines.push(`*Saved from BASIRA_ — ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}*`);
    lines.push('');

    // Use paper title as filename, sanitized for filesystem
    const safeTitle = p.title
      .replace(/[<>:"/\\|?*]/g, '')   // Remove illegal chars
      .replace(/\s+/g, ' ')           // Normalize spaces
      .trim()
      .slice(0, 120);                 // Cap length
    const filename = `${safeTitle}.md`;
    const fullContent = lines.join('\n');
    const filepath = path.join(VAULT_BASIRA_PATH, filename);

    fs.writeFileSync(filepath, fullContent, 'utf-8');

    console.log(`  ✓ Vault: ${filename} (${fullContent.length} bytes)`);

    res.json({
      success: true,
      filename,
      path: filepath,
      bytes: fullContent.length
    });
  } catch (err) {
    console.error('  ✗ Vault save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vault/list — list papers saved to vault
router.get('/vault/list', (req, res) => {
  try {
    ensureVaultDir();
    const files = fs.readdirSync(VAULT_BASIRA_PATH)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse();

    const entries = files.map(f => {
      const content = fs.readFileSync(path.join(VAULT_BASIRA_PATH, f), 'utf-8');
      const titleMatch = content.match(/^# (.+)$/m);
      return {
        filename: f,
        title: titleMatch ? titleMatch[1] : f,
        size: content.length,
      };
    });

    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
