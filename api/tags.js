import { supabase } from './_lib/supabase.js';

export default async function handler(req, res) {
  try {
    const { data } = await supabase.from('papers').select('tags');

    const counts = {};
    (data || []).forEach(p => {
      (p.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    });

    const sorted = Object.entries(counts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);

    res.json(sorted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
