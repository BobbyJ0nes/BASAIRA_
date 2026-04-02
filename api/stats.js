import { supabase } from './_lib/supabase.js';

export default async function handler(req, res) {
  try {
    const { count: totalPapers } = await supabase.from('papers').select('*', { count: 'exact', head: true });
    const { count: totalEdges } = await supabase.from('edges').select('*', { count: 'exact', head: true });
    const { count: overlapPapers } = await supabase.from('papers').select('*', { count: 'exact', head: true }).eq('is_overlap', true);

    const { data: domainData } = await supabase.from('papers').select('domains');

    // Count per domain
    const domainCounts = {};
    const DOMAIN_META = {
      neuroscience: { label: 'Neuroscience', color: '#00f0ff' },
      ai: { label: 'Artificial Intelligence', color: '#ff00aa' },
      cybernetics: { label: 'Cybernetics & Systems', color: '#ffaa00' },
      cognition: { label: 'Cognition', color: '#00ff88' },
      biomimetics: { label: 'Biomimetics', color: '#aa44ff' },
    };

    (domainData || []).forEach(p => {
      (p.domains || []).forEach(d => { domainCounts[d] = (domainCounts[d] || 0) + 1; });
    });

    const domains = Object.entries(DOMAIN_META).map(([key, meta]) => ({
      key,
      label: meta.label,
      color: meta.color,
      count: domainCounts[key] || 0,
    }));

    res.json({ totalPapers, totalEdges, overlapPapers, domains });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
