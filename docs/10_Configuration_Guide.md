# Configuration Guide

> *Back to [[00_Index]]*

## Environment Variables (`.env`)

Copy `.env.example` to `.env` and configure:

```bash
# Required for Concept Explorer
GEMINI_API_KEY=your_gemini_api_key_here

# Optional: Obsidian vault integration
VAULT_PATH=/path/to/your/obsidian/vault
VAULT_SCAN_FOLDER=scan
```

### Getting a Gemini API Key
1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Create or select a project
3. Generate an API key
4. Copy to `.env`

The free tier is sufficient for BASIRA_'s usage. See [[03_AI_Integration#Cost and Rate Considerations]].

### Vault Path
Set `VAULT_PATH` to the **root** of your Obsidian vault. `VAULT_SCAN_FOLDER` is the subfolder within it. Example:
```
VAULT_PATH=/Users/you/Documents/MyVault
VAULT_SCAN_FOLDER=Research/BASIRA_
→ Files saved to: /Users/you/Documents/MyVault/Research/BASIRA_/
```

---

## Domain Configuration (`scan.config.js`)

Each domain is defined with:

```javascript
domainKey: {
  label: 'Display Name',              // Shown in sidebar, detail panel
  color: '#hex',                       // Neon colour for graph/UI
  colorRGB: 'r, g, b',                // For rgba() usage in CSS
  queries: ['cat:cs.AI', 'cat:cs.LG'], // arXiv API query strings
  keywords: ['term1', 'term2', ...],   // For tag extraction matching
  maxResults: 40                        // Papers per query
}
```

### Adding a New Domain

1. **Add to `scan.config.js`**:
   ```javascript
   newdomain: {
     label: 'New Domain',
     color: '#ff6600',
     colorRGB: '255, 102, 0',
     queries: ['cat:cs.XX'],
     keywords: ['keyword1', 'keyword2'],
     maxResults: 40
   }
   ```

2. **Add colour to `graph.js`** (in `DOMAIN_COLORS`):
   ```javascript
   newdomain: '#ff6600'
   ```

3. **Add label to `app.js`** (in `DOMAIN_LABELS`):
   ```javascript
   newdomain: 'New Domain'
   ```

4. **Add label to `reader.js`** (in `DOMAIN_LABELS`):
   ```javascript
   newdomain: 'New Domain'
   ```

5. **Add domain mapping to `arxiv.js`** (in `mapDomains()`):
   ```javascript
   if (categories.includes('cs.XX')) domains.push('newdomain');
   ```

6. **Delete `papers-cache.json`** to force a re-fetch with the new domain.

7. **Add concept expansion terms** to `search.js` if relevant.

### arXiv Category Reference
Full list: [arxiv.org/category_taxonomy](https://arxiv.org/category_taxonomy)

Common categories used in BASIRA_:
- `q-bio.NC` — Quantitative Biology: Neurons and Cognition
- `cs.AI` — Computer Science: Artificial Intelligence
- `cs.LG` — Computer Science: Machine Learning
- `cs.SY` — Computer Science: Systems and Control
- `eess.SY` — Electrical Engineering: Systems and Control
- `cs.HC` — Computer Science: Human-Computer Interaction
- `cs.NE` — Computer Science: Neural and Evolutionary Computing
- `cs.RO` — Computer Science: Robotics

---

## Server Settings

```javascript
// scan.config.js
export const SERVER_PORT = 3000;
export const CACHE_FILE = 'src/data/papers-cache.json';
export const CACHE_MAX_AGE_HOURS = 24;
export const ARXIV_API_BASE = 'https://export.arxiv.org/api/query';
export const ARXIV_DELAY_MS = 3500; // Rate limit politeness
```

### Adjusting Cache Freshness
`CACHE_MAX_AGE_HOURS` controls how often papers are re-fetched from arXiv. Set to `0` to always fetch fresh data. Set to `168` (1 week) to reduce arXiv API calls.

### Rate Limiting
`ARXIV_DELAY_MS` is the delay between successive arXiv API calls. The arXiv API docs recommend 3+ seconds between requests. Setting this below 3000ms risks temporary IP blocking.

---

## Deployment Options

### Local Development (default)
```bash
npm install
cp .env.example .env  # Configure API key
npm start             # → http://localhost:3000
```

### Railway (recommended for hosting)
1. Push repo to GitHub
2. Create a Railway project, connect the repo
3. Add environment variables in Railway dashboard (`GEMINI_API_KEY`, optionally `VAULT_PATH`)
4. Railway auto-detects Node.js, runs `npm start`
5. Free tier: 500 hours/month, persistent filesystem (cache works)

### Render
1. Create a Web Service, connect repo
2. Build command: `npm install`
3. Start command: `npm start`
4. Add environment variables
5. Free tier: spins down after 15min inactivity (~30s cold start)

### Vercel
Requires refactoring — Express needs to be split into serverless functions. Not recommended for V1 unless persistence layer is also migrated. See [[01_System_Architecture#Why No Build Step]] for context.

### GitHub Pages
**Not supported.** BASIRA_ requires a Node.js server for the API layer (arXiv fetching, Gemini integration, vault writing). GitHub Pages only serves static files.

---

## Troubleshooting

### Server won't start: `EADDRINUSE`
Another process is using port 3000.
```bash
fuser -k 3000/tcp    # Linux
lsof -ti:3000 | xargs kill  # macOS
```

### No papers load
- Check `papers-cache.json` exists and isn't empty
- Delete it and restart to force a fresh fetch
- Check arXiv API is accessible: `curl https://export.arxiv.org/api/query?search_query=cat:cs.AI&max_results=1`

### Concept Explorer not working
- Verify `GEMINI_API_KEY` is set in `.env`
- Test the key: `curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=YOUR_KEY" -H 'Content-Type: application/json' -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'`
- Check server logs for Gemini error messages

### Vault save fails
- Verify `VAULT_PATH` is set and the directory exists
- Check file permissions on the vault directory
- Check server logs for the specific error
