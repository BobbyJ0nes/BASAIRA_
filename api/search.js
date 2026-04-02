import { supabase } from './_lib/supabase.js';

// Concept expansion map (condensed version for serverless)
const CONCEPT_MAP = {
  'brain interface': ['brain-computer interface', 'bci', 'neural interface', 'neuroprosthetic', 'brain-machine interface'],
  'movement': ['motor control', 'locomotion', 'gait', 'exoskeleton', 'prosthetic', 'rehabilitation'],
  'consciousness': ['awareness', 'subjective experience', 'qualia', 'metacognition', 'global workspace'],
  'emotion': ['affect', 'sentiment', 'valence', 'arousal', 'empathy'],
  'language': ['nlp', 'natural language', 'linguistic', 'llm', 'transformer', 'speech'],
  'vision': ['visual', 'image', 'object detection', 'segmentation', 'computer vision'],
  'memory': ['hippocampus', 'recall', 'working memory', 'episodic', 'consolidation'],
  'learning': ['plasticity', 'adaptation', 'reinforcement', 'supervised', 'transfer learning'],
  'robotics': ['robot', 'manipulation', 'navigation', 'autonomous', 'locomotion'],
  'attention': ['saliency', 'selective attention', 'executive function', 'transformer attention'],
  'decision making': ['choice', 'reward', 'uncertainty', 'bayesian decision', 'heuristic'],
};

function expandQuery(query) {
  const q = query.toLowerCase();
  let terms = q.split(/\s+/);
  for (const [concept, expansions] of Object.entries(CONCEPT_MAP)) {
    if (q.includes(concept)) terms = [...terms, ...expansions];
  }
  return [...new Set(terms)];
}

export default async function handler(req, res) {
  const query = req.query.q;
  const limit = parseInt(req.query.limit) || 20;
  if (!query) return res.json([]);

  try {
    const { data: papers } = await supabase.from('papers').select('*');
    if (!papers) return res.json([]);

    const terms = expandQuery(query);

    // Simple TF-IDF-like scoring
    const scored = papers.map(p => {
      const text = (p.title + ' ' + p.abstract + ' ' + (p.tags || []).join(' ')).toLowerCase();
      let score = 0;
      terms.forEach(t => {
        const count = (text.match(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
        score += count;
      });
      return { ...p, _searchScore: score };
    })
    .filter(p => p._searchScore > 0)
    .sort((a, b) => b._searchScore - a._searchScore)
    .slice(0, limit)
    .map(p => ({
      id: p.id, title: p.title, authors: p.authors, abstract: p.abstract,
      published: p.published, categories: p.categories, domains: p.domains,
      tags: p.tags, isOverlap: p.is_overlap, arxivUrl: p.arxiv_url, pdfUrl: p.pdf_url,
      _searchScore: p._searchScore / terms.length,
    }));

    res.json(scored);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
