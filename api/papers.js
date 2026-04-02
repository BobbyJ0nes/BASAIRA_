import { supabase } from './_lib/supabase.js';

export default async function handler(req, res) {
  try {
    const { data: papers, error: pErr } = await supabase
      .from('papers')
      .select('*')
      .order('published', { ascending: false });

    if (pErr) throw pErr;

    const { data: edges, error: eErr } = await supabase
      .from('edges')
      .select('*');

    if (eErr) throw eErr;

    // Transform to match frontend expectations
    const transformedPapers = papers.map(p => ({
      id: p.id,
      title: p.title,
      authors: p.authors,
      abstract: p.abstract,
      published: p.published,
      categories: p.categories,
      domains: p.domains,
      tags: p.tags,
      isOverlap: p.is_overlap,
      arxivUrl: p.arxiv_url,
      pdfUrl: p.pdf_url,
    }));

    const transformedEdges = edges.map(e => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      sharedTags: e.shared_tags,
    }));

    res.json({ papers: transformedPapers, edges: transformedEdges });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
