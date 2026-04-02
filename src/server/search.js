// ═══════════════════════════════════════════════════════════
// BASIRA_ Conceptual Search Engine
// ═══════════════════════════════════════════════════════════
//
// Concept-based search using TF-IDF cosine similarity.
// Instead of substring matching, this computes how conceptually
// close a query is to each paper's title + abstract.
//
// Also includes a synonym/concept expansion table so queries
// like "brain interfaces" match papers about BCIs, neural
// prosthetics, etc.
//
// ═══════════════════════════════════════════════════════════

// Concept expansion — maps broad concepts to related terms
const CONCEPT_MAP = {
  'brain interface': ['brain-computer interface', 'bci', 'neural interface', 'neuroprosthetic', 'brain-machine interface', 'neural prosthesis', 'eeg interface', 'invasive interface', 'implant', 'electrode', 'neural signal', 'decode', 'neuromodulation'],
  'brain interfaces': ['brain-computer interface', 'bci', 'neural interface', 'neuroprosthetic', 'brain-machine interface', 'neural prosthesis', 'eeg interface', 'implant', 'electrode', 'neural signal', 'decode'],
  'movement': ['motor control', 'locomotion', 'gait', 'kinematics', 'actuator', 'prosthetic', 'rehabilitation', 'motion planning', 'trajectory', 'bipedal', 'manipulation', 'exoskeleton', 'motor cortex', 'motor imagery'],
  'technology for movement': ['assistive technology', 'exoskeleton', 'prosthetic', 'rehabilitation', 'motor control', 'actuator', 'bipedal', 'locomotion', 'wearable', 'haptic'],
  'consciousness': ['awareness', 'subjective experience', 'qualia', 'sentience', 'self-awareness', 'phenomenal', 'metacognition', 'introspection', 'global workspace', 'integrated information'],
  'emotion': ['affect', 'sentiment', 'emotional', 'valence', 'arousal', 'mood', 'affective', 'empathy', 'anxiety', 'stress'],
  'language': ['nlp', 'natural language', 'linguistic', 'syntax', 'semantic', 'discourse', 'text', 'speech', 'llm', 'transformer', 'vocabulary', 'grammar'],
  'vision': ['visual', 'image', 'object detection', 'segmentation', 'recognition', 'perception', 'retina', 'visual cortex', 'scene', 'computer vision', 'convolutional'],
  'memory': ['hippocampus', 'recall', 'encoding', 'retrieval', 'working memory', 'episodic', 'semantic memory', 'forgetting', 'consolidation', 'long-term', 'short-term'],
  'learning': ['plasticity', 'adaptation', 'training', 'generalization', 'curriculum', 'reinforcement', 'supervised', 'unsupervised', 'representation learning', 'transfer learning'],
  'robotics': ['robot', 'manipulation', 'navigation', 'actuator', 'sensor', 'autonomous', 'embodied', 'locomotion', 'gripper', 'planning'],
  'attention': ['focus', 'saliency', 'selective attention', 'executive function', 'concentration', 'distraction', 'attentional', 'top-down', 'bottom-up', 'transformer attention'],
  'decision making': ['choice', 'preference', 'utility', 'reward', 'risk', 'uncertainty', 'rational', 'heuristic', 'bounded rationality', 'prospect theory', 'bayesian decision'],
  'perception': ['sensory', 'perceptual', 'stimulus', 'detection', 'discrimination', 'psychophysics', 'illusion', 'auditory', 'somatosensory', 'multisensory'],
  'evolution': ['evolutionary', 'natural selection', 'fitness', 'mutation', 'adaptation', 'genetic', 'population', 'speciation', 'phylogenetic', 'darwinian'],
  'self-organization': ['emergence', 'self-organizing', 'autopoiesis', 'stigmergy', 'swarm', 'decentralized', 'bottom-up', 'pattern formation', 'complex system'],
  'safety': ['alignment', 'safe ai', 'robustness', 'adversarial', 'fairness', 'bias', 'trustworthy', 'interpretability', 'explainability', 'guardrail'],
  'agent': ['agents', 'agentic', 'autonomous agent', 'multi-agent', 'agency', 'tool use', 'planning', 'reasoning', 'chain of thought'],
  'control': ['feedback', 'controller', 'regulation', 'stability', 'observer', 'mpc', 'pid', 'adaptive control', 'robust control', 'optimal control'],
  'network': ['graph', 'connectivity', 'topology', 'centrality', 'community', 'small-world', 'scale-free', 'neural network', 'complex network'],
  'generative': ['generation', 'generative model', 'diffusion', 'gan', 'vae', 'autoregressive', 'synthesis', 'creative ai', 'image generation'],
};

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can',
  'this', 'that', 'these', 'those', 'it', 'its', 'we', 'our', 'they', 'their',
  'which', 'what', 'who', 'where', 'when', 'how', 'than', 'then', 'so', 'as',
  'if', 'not', 'no', 'such', 'each', 'all', 'both', 'some', 'any', 'into',
  'about', 'also', 'just', 'very', 'using', 'used', 'based', 'show', 'shown',
  'paper', 'work', 'study', 'new', 'however', 'well', 'two', 'one', 'first',
]);

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function expandQuery(query) {
  const queryLower = query.toLowerCase().trim();
  const baseTokens = tokenize(queryLower);

  // Check concept map for full query and sub-phrases
  const expansions = new Set(baseTokens);

  for (const [concept, synonyms] of Object.entries(CONCEPT_MAP)) {
    if (queryLower.includes(concept) || concept.includes(queryLower)) {
      synonyms.forEach(s => {
        tokenize(s).forEach(t => expansions.add(t));
      });
    }
    // Also match if any query token matches a concept key word
    for (const token of baseTokens) {
      if (concept.split(/\s+/).includes(token)) {
        synonyms.forEach(s => {
          tokenize(s).forEach(t => expansions.add(t));
        });
      }
    }
  }

  return [...expansions];
}

// Build TF vector for a document
function buildTF(tokens) {
  const tf = {};
  tokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
  const max = Math.max(...Object.values(tf), 1);
  for (const t in tf) { tf[t] /= max; } // Normalize
  return tf;
}

// Compute IDF from a corpus of TF vectors
function buildIDF(tfVectors) {
  const df = {};
  const N = tfVectors.length;
  tfVectors.forEach(tf => {
    for (const term of Object.keys(tf)) {
      df[term] = (df[term] || 0) + 1;
    }
  });
  const idf = {};
  for (const term in df) {
    idf[term] = Math.log(N / (1 + df[term]));
  }
  return idf;
}

// Cosine similarity between two TF-IDF weighted vectors
function cosineSimilarity(queryTF, docTF, idf) {
  let dot = 0, magQ = 0, magD = 0;

  const allTerms = new Set([...Object.keys(queryTF), ...Object.keys(docTF)]);
  for (const term of allTerms) {
    const qVal = (queryTF[term] || 0) * (idf[term] || 0);
    const dVal = (docTF[term] || 0) * (idf[term] || 0);
    dot += qVal * dVal;
    magQ += qVal * qVal;
    magD += dVal * dVal;
  }

  const denom = Math.sqrt(magQ) * Math.sqrt(magD);
  return denom === 0 ? 0 : dot / denom;
}

export function conceptualSearch(papers, query, limit = 50) {
  if (!query || query.trim().length < 2) return [];

  // Expand query with concept synonyms
  const expandedTokens = expandQuery(query);

  // Build TF vectors for all papers (on their title + abstract + tags)
  const docTFs = papers.map(p => {
    const text = `${p.title} ${p.abstract} ${p.tags.join(' ')}`;
    return buildTF(tokenize(text));
  });

  // Build query TF — expanded terms all get equal weight
  const queryTF = {};
  expandedTokens.forEach(t => { queryTF[t] = 1; });

  // Compute IDF across corpus + query
  const allTFs = [...docTFs, queryTF];
  const idf = buildIDF(allTFs);

  // Score each paper
  const scored = papers.map((paper, i) => ({
    paper,
    score: cosineSimilarity(queryTF, docTFs[i], idf)
  }));

  // Sort by score, filter out zeros, take top N
  return scored
    .filter(s => s.score > 0.01)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => ({ ...s.paper, _searchScore: Math.round(s.score * 100) / 100 }));
}
