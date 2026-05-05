// ═══════════════════════════════════════════════════════════
// BASAIRA_ Server — Entry Point
// ═══════════════════════════════════════════════════════════
//
// Express server that:
//   1. Serves the static frontend from src/client/
//   2. Mounts REST API routes under /api
//   3. Falls back to index.html for SPA routing
//   4. Initializes paper data (from cache or arXiv) before binding
//
// Start: npm start  |  npm run dev (with --watch)
// Port:  Configured in scan.config.js (default 3000)
//
// ═══════════════════════════════════════════════════════════
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRoutes, { initData } from './routes.js';
import { SERVER_PORT } from '../../scan.config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

// Serve static frontend
app.use(express.static(path.join(__dirname, '..', 'client')));

// API routes
app.use('/api', apiRoutes);

// Reader page
app.get('/reader.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'reader.html'));
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// Prevent crashes from unhandled errors
process.on('unhandledRejection', (err) => {
  console.error('  Unhandled rejection:', err.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('  Uncaught exception:', err.message || err);
});
// Ignore SIGPIPE (broken pipe from closed connections)
process.on('SIGPIPE', () => {});

async function start() {
  console.log('');
  console.log('  ██████╗  █████╗ ███████╗██╗██████╗  █████╗');
  console.log('  ██╔══██╗██╔══██╗██╔════╝██║██╔══██╗██╔══██╗');
  console.log('  ██████╔╝███████║███████╗██║██████╔╝███████║');
  console.log('  ██╔══██╗██╔══██║╚════██║██║██╔══██╗██╔══██║');
  console.log('  ██████╔╝██║  ██║███████║██║██║  ██║██║  ██║');
  console.log('  ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝╚═╝  ╚═╝╚═╝  ╚═╝');
  console.log('');
  console.log('  Research Discovery Engine');
  console.log('  ─────────────────────────');
  console.log('');

  await initData();

  app.listen(SERVER_PORT, () => {
    console.log(`\n  ▸ BASAIRA_ running at http://localhost:${SERVER_PORT}\n`);
  });
}

start().catch(err => {
  console.error('Failed to start BASAIRA_:', err);
  process.exit(1);
});
