// GET /api/concept-graph?min=N
// Builds a concept-level knowledge graph from all papers.
// Inlined buildConceptGraph from src/server/concept-graph.js — keeps the
// serverless function dep-tree small (no pull-in of express/dotenv via routes.js).
import { supabase } from './_lib/supabase.js';

export const config = { maxDuration: 25 };

function buildConceptGraph(papers, minPapers = 3, minShared = 2) {
  // Step 1: concept → papers mapping
  const conceptPapers = {};
  const conceptDomains = {};

  papers.forEach(p => {
    (p.tags || []).forEach(tag => {
      if (!conceptPapers[tag]) {
        conceptPapers[tag] = [];
        conceptDomains[tag] = {};
      }
      conceptPapers[tag].push({
        id: p.id,
        title: p.title,
        domains: p.domains,
      });
      (p.domains || []).forEach(d => {
        conceptDomains[tag][d] = (conceptDomains[tag][d] || 0) + 1;
      });
    });
  });

  // Step 2: filter
  const activeConcepts = Object.entries(conceptPapers)
    .filter(([_, pList]) => pList.length >= minPapers)
    .sort((a, b) => b[1].length - a[1].length);

  // Step 3: nodes
  const nodes = activeConcepts.map(([concept, pList]) => {
    const domainCounts = conceptDomains[concept];
    const primaryDomain = Object.entries(domainCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'ai';
    const allDomains = Object.keys(domainCounts);
    return {
      id: `concept:${concept}`,
      label: concept,
      type: 'concept',
      paperCount: pList.length,
      papers: pList,
      primaryDomain,
      domains: allDomains,
      isMultiDomain: allDomains.length > 1,
    };
  });

  // Step 4: edges
  const edges = [];
  const conceptMap = {};
  activeConcepts.forEach(([concept, pList]) => {
    conceptMap[concept] = new Set(pList.map(p => p.id));
  });

  const conceptKeys = activeConcepts.map(([c]) => c);
  for (let i = 0; i < conceptKeys.length; i++) {
    for (let j = i + 1; j < conceptKeys.length; j++) {
      const c1 = conceptKeys[i];
      const c2 = conceptKeys[j];
      const shared = [...conceptMap[c1]].filter(id => conceptMap[c2].has(id));
      if (shared.length >= minShared) {
        edges.push({
          source: `concept:${c1}`,
          target: `concept:${c2}`,
          weight: shared.length,
          sharedPapers: shared.length,
        });
      }
    }
  }

  edges.sort((a, b) => b.weight - a.weight);
  return { nodes, edges: edges.slice(0, 200) };
}

export default async function handler(req, res) {
  try {
    const minPapers = parseInt(req.query?.min) || 3;

    const { data: papers, error } = await supabase
      .from('papers')
      .select('id, title, tags, domains');

    if (error) throw error;

    // Snake → camel not needed here: we only consume id/title/tags/domains, all lowercase.
    const result = buildConceptGraph(papers || [], minPapers, 2);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
