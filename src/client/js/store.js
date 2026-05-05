// ═══════════════════════════════════════════════════════════
// BASAIRA_ State Manager
// ═══════════════════════════════════════════════════════════
//
// localStorage-backed reactive store for all user state.
//
// Persisted (survives reload):
//   readLater    — Array of arXiv paper IDs starred by user
//   highlights   — { paperId: [selected text snippets] }
//   notes        — { paperId: "note text" }
//   activeDomains — Currently filtered domain keys ([] = all)
//
// Ephemeral (resets on reload):
//   activeTag, searchQuery, view, selectedPaper
//
// Usage:
//   Store.get('readLater')          → string[]
//   Store.set('activeTag', 'neural')
//   Store.toggleReadLater('2603.30004v1') → boolean (new state)
//   Store.on((key, value) => { ... })     → register listener
//
// localStorage key: 'basaira_state'
//
// ═══════════════════════════════════════════════════════════
const STORAGE_KEY = 'basaira_state';

const Store = {
  _state: {
    readLater: [],      // Array of paper IDs
    highlights: {},     // { paperId: [highlighted text strings] }
    notes: {},          // { paperId: note text }
    activeDomains: [],  // Empty = all active
    activeTag: null,
    searchQuery: '',
    view: 'graph',      // 'graph' | 'list'
    selectedPaper: null,
  },

  _listeners: [],

  init() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this._state = { ...this._state, ...parsed };
      } catch (e) {
        console.warn('Failed to parse stored state:', e);
      }
    }
  },

  get(key) {
    return this._state[key];
  },

  set(key, value) {
    this._state[key] = value;
    this._persist();
    this._notify(key, value);
  },

  // Read Later
  isReadLater(paperId) {
    return this._state.readLater.includes(paperId);
  },

  toggleReadLater(paperId) {
    const idx = this._state.readLater.indexOf(paperId);
    if (idx >= 0) {
      this._state.readLater.splice(idx, 1);
    } else {
      this._state.readLater.push(paperId);
    }
    this._persist();
    this._notify('readLater', this._state.readLater);
    return this.isReadLater(paperId);
  },

  // Notes
  getNote(paperId) {
    return this._state.notes[paperId] || '';
  },

  setNote(paperId, text) {
    this._state.notes[paperId] = text;
    this._persist();
  },

  // Highlights
  getHighlights(paperId) {
    return this._state.highlights[paperId] || [];
  },

  addHighlight(paperId, text) {
    if (!this._state.highlights[paperId]) this._state.highlights[paperId] = [];
    if (!this._state.highlights[paperId].includes(text)) {
      this._state.highlights[paperId].push(text);
      this._persist();
    }
  },

  removeHighlight(paperId, text) {
    if (this._state.highlights[paperId]) {
      this._state.highlights[paperId] = this._state.highlights[paperId].filter(h => h !== text);
      this._persist();
    }
  },

  // Domain filter
  toggleDomain(domain) {
    const idx = this._state.activeDomains.indexOf(domain);
    if (idx >= 0) {
      this._state.activeDomains.splice(idx, 1);
    } else {
      this._state.activeDomains.push(domain);
    }
    this._persist();
    this._notify('activeDomains', this._state.activeDomains);
  },

  isDomainActive(domain) {
    return this._state.activeDomains.length === 0 || this._state.activeDomains.includes(domain);
  },

  // Listeners
  on(callback) {
    this._listeners.push(callback);
  },

  _notify(key, value) {
    this._listeners.forEach(fn => fn(key, value));
  },

  _persist() {
    const toSave = {
      readLater: this._state.readLater,
      highlights: this._state.highlights,
      notes: this._state.notes,
      activeDomains: this._state.activeDomains,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }
};

Store.init();
