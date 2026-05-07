// POST /api/vault/save — graceful no-op for serverless deployments.
//
// The local Express version writes Markdown to the user's Obsidian vault on
// disk (process.env.VAULT_PATH). On Vercel there's no persistent filesystem
// and no shared NAS, so we return a clean failure the client can detect and
// fall back to the in-browser /api/export download path.
//
// HTTP 200 (not 4xx/5xx) because the request itself isn't malformed — the
// feature is just unavailable in this deployment context. The client checks
// `success === false` + `code === 'VAULT_NOT_AVAILABLE'` and handles fallback.
//
// Future work: if vault sync is wanted in production, route writes to
// Supabase Storage or an S3 bucket the user later mirrors locally. Out of
// scope for this pass.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  res.status(200).json({
    success: false,
    error: 'Vault save requires local install. Use Export instead.',
    code: 'VAULT_NOT_AVAILABLE',
  });
}
