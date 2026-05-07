// POST /api/refresh — disabled in serverless.
//
// The local Express implementation re-fetches all 200+ papers from arXiv,
// honouring a 3.5s rate-limit delay between queries (ARXIV_DELAY_MS in
// scan.config.js). End-to-end that's ~10+ minutes, well past Vercel's
// hard 60s function timeout (and far past the 25s default we set on
// other functions).
//
// Returning 503 makes the failure explicit to the client. The notify()
// path in app.js will surface the error string.
//
// Future fix paths:
//   - Vercel Cron job that hits a chunked endpoint (1 domain/query at a
//     time, persists progress) — feasible but needs a cursor table.
//   - Move ingestion to a long-running worker (Render/Fly/Railway) that
//     writes to the same Supabase. Cleanest split, but extra infra.
// For now, single-paper additions go through /api/papers/from-arxiv.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  res.status(503).json({
    success: false,
    error: 'Refresh runs too long for serverless. Run locally with npm start, or use the from-arxiv endpoint to add papers individually.',
  });
}
