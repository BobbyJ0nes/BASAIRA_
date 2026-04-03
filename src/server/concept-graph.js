// ═══════════════════════════════════════════════════════════
// BASIRA_ Concept Graph — Build concept-level knowledge graph
// ═══════════════════════════════════════════════════════════
//
// Transforms paper-level data into a concept graph where:
//   - Nodes = concepts (extracted from paper tags/keywords)
//   - Edges = co-occurrence (concepts sharing papers)
//   - Each node carries its paper list for hover previews
//
// ═══════════════════════════════════════════════════════════

export function buildConceptGraph(papers, minPapers = 3, minShared = 2) {
  // Step 1: Build concept → papers mapping
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
      // Track which domains this concept appears in
      (p.domains || []).forEach(d => {
        conceptDomains[tag][d] = (conceptDomains[tag][d] || 0) + 1;
      });
    });
  });

  // Step 2: Filter to concepts with enough papers
  const activeConcepts = Object.entries(conceptPapers)
    .filter(([_, pList]) => pList.length >= minPapers)
    .sort((a, b) => b[1].length - a[1].length);

  // Step 3: Build concept nodes
  const nodes = activeConcepts.map(([concept, pList]) => {
    // Primary domain = most common domain among its papers
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

  // Step 4: Build concept-to-concept edges (co-occurrence)
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

  // Cap edges to keep graph readable
  edges.sort((a, b) => b.weight - a.weight);
  const cappedEdges = edges.slice(0, 200);

  return { nodes, edges: cappedEdges };
}
