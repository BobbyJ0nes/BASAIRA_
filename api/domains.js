import { supabase } from './_lib/supabase.js';

export default async function handler(req, res) {
  try {
    const { data } = await supabase.from('papers').select('domains');

    const DOMAIN_META = {
      neuroscience: { label: 'Neuroscience', color: '#00f0ff' },
      ai: { label: 'Artificial Intelligence', color: '#ff00aa' },
      cybernetics: { label: 'Cybernetics & Systems', color: '#ffaa00' },
      cognition: { label: 'Cognition', color: '#00ff88' },
      biomimetics: { label: 'Biomimetics', color: '#aa44ff' },
    };

    const counts = {};
    (data || []).forEach(p => {
      (p.domains || []).forEach(d => { counts[d] = (counts[d] || 0) + 1; });
    });

    const result = Object.entries(DOMAIN_META).map(([key, meta]) => ({
      key, label: meta.label, color: meta.color, count: counts[key] || 0,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
