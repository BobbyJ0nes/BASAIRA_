// ═══════════════════════════════════════════════════════════
// BASIRA_ Configuration
// ═══════════════════════════════════════════════════════════
//
// Central configuration for all BASIRA_ domains, server settings,
// and arXiv API parameters.
//
// To add a new research domain:
//   1. Add an entry to DOMAINS below
//   2. Add its arXiv categories to mapDomains() in src/server/arxiv.js
//   3. Add its color to DOMAIN_COLORS in src/client/js/graph.js
//   4. Add its label to DOMAIN_LABELS in src/client/js/app.js
//
// ═══════════════════════════════════════════════════════════
export const DOMAINS = {
  neuroscience: {
    label: 'Neuroscience',
    color: '#00f0ff',
    colorRGB: '0, 240, 255',
    queries: ['cat:q-bio.NC'],
    keywords: ['neural', 'brain', 'cortex', 'synapse', 'neuron', 'hippocampus', 'fMRI', 'EEG', 'dopamine', 'serotonin', 'neuroplasticity', 'connectome'],
    maxResults: 40
  },
  ai: {
    label: 'Artificial Intelligence',
    color: '#ff00aa',
    colorRGB: '255, 0, 170',
    queries: ['cat:cs.AI', 'cat:cs.LG'],
    keywords: ['transformer', 'LLM', 'reinforcement learning', 'attention', 'neural network', 'deep learning', 'agent', 'GPT', 'diffusion', 'generative'],
    maxResults: 40
  },
  cybernetics: {
    label: 'Cybernetics & Systems',
    color: '#ffaa00',
    colorRGB: '255, 170, 0',
    queries: ['cat:cs.SY', 'cat:eess.SY'],
    keywords: ['feedback', 'control', 'dynamical system', 'homeostasis', 'regulation', 'adaptive', 'self-organizing', 'stability', 'observer', 'robustness'],
    maxResults: 40
  },
  cognition: {
    label: 'Cognition',
    color: '#00ff88',
    colorRGB: '0, 255, 136',
    queries: ['cat:q-bio.NC+AND+all:cognition', 'cat:cs.HC'],
    keywords: ['cognition', 'perception', 'attention', 'memory', 'decision making', 'consciousness', 'metacognition', 'embodied', 'situated', 'cognitive load'],
    maxResults: 40
  },
  biomimetics: {
    label: 'Biomimetics',
    color: '#aa44ff',
    colorRGB: '170, 68, 255',
    queries: ['cat:cs.NE', 'all:bio-inspired+AND+cat:cs.RO'],
    keywords: ['bio-inspired', 'swarm', 'evolutionary', 'genetic algorithm', 'morphogenesis', 'self-assembly', 'emergence', 'artificial life', 'cellular automata', 'stigmergy'],
    maxResults: 40
  }
};

export const SERVER_PORT = 3000;
export const CACHE_FILE = 'src/data/papers-cache.json';
export const CACHE_MAX_AGE_HOURS = 24;
export const ARXIV_API_BASE = 'https://export.arxiv.org/api/query';
export const ARXIV_DELAY_MS = 3500; // Be polite to arXiv
