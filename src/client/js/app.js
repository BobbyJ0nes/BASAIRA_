// ═══════════════════════════════════════════════════════════
// SCAN — Main Application Controller
// ═══════════════════════════════════════════════════════════
//
// Orchestrates the entire frontend. On DOMContentLoaded:
//   1. Initializes BgCanvas (particle background)
//   2. Initializes GraphEngine (D3 force graph)
//   3. Fetches all data from /api endpoints in parallel
//   4. Renders sidebar (domains, tags, queue)
//   5. Feeds data to graph engine
//   6. Wires all event listeners
//   7. Hides loading overlay
//
// Key responsibilities:
//   • Data loading and sidebar rendering
//   • Domain/tag/search filtering delegation
//   • Detail panel construction and interaction wiring
//   • List view card grid rendering
//   • Export to Markdown (single + bulk)
//   • View switching (graph ↔ list)
//   • Notification toasts
//   • Keyboard shortcuts (/ and Esc)
//
// DOMAIN_COLORS defined in graph.js (shared global scope)
// ═══════════════════════════════════════════════════════════

const DOMAIN_LABELS = {
  neuroscience: 'Neuroscience',
  ai: 'Artificial Intelligence',
  cybernetics: 'Cybernetics & Systems',
  cognition: 'Cognition',
  biomimetics: 'Biomimetics',
};

let allPapers = [];
let allEdges = [];
let domainStats = {};
let currentView = 'graph';

// ─── INITIALIZATION ───
async function init() {
  BgCanvas.init();
  GraphEngine.init('#graph-container');

  await loadData();
  setupEventListeners();
  hideLoading();
}

async function loadData() {
  try {
    const [papersRes, domainsRes, tagsRes, statsRes] = await Promise.all([
      fetch('/api/papers').then(r => r.json()),
      fetch('/api/domains').then(r => r.json()),
      fetch('/api/tags').then(r => r.json()),
      fetch('/api/stats').then(r => r.json()),
    ]);

    allPapers = papersRes.papers;
    allEdges = papersRes.edges;
    domainStats = domainsRes;

    // Update stats
    document.getElementById('stat-papers').textContent = statsRes.totalPapers;
    document.getElementById('stat-edges').textContent = statsRes.totalEdges;
    document.getElementById('stat-overlap').textContent = statsRes.overlapPapers;

    // Render sidebar
    renderDomainFilters(statsRes.domains);
    renderTagCloud(tagsRes);
    renderQueue();

    // Render graph
    GraphEngine.setData(allPapers, allEdges);

    // Zoom to fit after simulation settles
    setTimeout(() => GraphEngine.zoomToFit(), 2000);

  } catch (err) {
    console.error('Failed to load data:', err);
    notify('Failed to load data. Is the server running?', 'warning');
  }
}

// ─── SIDEBAR RENDERING ───
function renderDomainFilters(domains) {
  const container = document.getElementById('domain-filters');
  container.innerHTML = '';

  // Add "All" toggle
  const allEl = createDomainFilterEl('all', 'All Domains', '#ffffff', allPapers.length);
  allEl.classList.add('active');
  allEl.addEventListener('click', () => {
    Store.set('activeDomains', []);
    updateDomainFilterUI();
    applyFilters();
  });
  container.appendChild(allEl);

  domains.forEach(d => {
    const el = createDomainFilterEl(d.key, d.label, d.color, d.count);
    el.addEventListener('click', () => {
      Store.toggleDomain(d.key);
      updateDomainFilterUI();
      applyFilters();
    });
    container.appendChild(el);
  });
}

function createDomainFilterEl(key, label, color, count) {
  const el = document.createElement('div');
  el.className = 'domain-filter';
  el.dataset.domain = key;
  el.innerHTML = `
    <div class="domain-filter__dot" style="background:${color};color:${color}"></div>
    <span class="domain-filter__label">${label}</span>
    <span class="domain-filter__count">${count}</span>
  `;
  return el;
}

function updateDomainFilterUI() {
  const active = Store.get('activeDomains');
  document.querySelectorAll('.domain-filter').forEach(el => {
    const d = el.dataset.domain;
    if (d === 'all') {
      el.classList.toggle('active', active.length === 0);
    } else {
      el.classList.toggle('active', Store.isDomainActive(d));
    }
  });
}

function renderTagCloud(tags) {
  const container = document.getElementById('tag-cloud');
  container.innerHTML = '';
  tags.slice(0, 30).forEach(t => {
    const el = document.createElement('span');
    el.className = 'tag-pill';
    el.textContent = t.tag;
    el.title = `${t.count} papers`;
    el.addEventListener('click', () => {
      const isActive = el.classList.contains('active');
      document.querySelectorAll('.tag-pill').forEach(p => p.classList.remove('active'));
      if (!isActive) {
        el.classList.add('active');
        Store.set('activeTag', t.tag);
      } else {
        Store.set('activeTag', null);
      }
      applyFilters();
    });
    container.appendChild(el);
  });
}

function renderQueue() {
  const container = document.getElementById('queue-list');
  const queueIds = Store.get('readLater');
  const countEl = document.getElementById('queue-count');
  countEl.textContent = `(${queueIds.length})`;

  if (queueIds.length === 0) {
    container.innerHTML = '<li class="queue-empty">No papers saved yet</li>';
    return;
  }

  container.innerHTML = '';
  queueIds.forEach(id => {
    const paper = allPapers.find(p => p.id === id);
    if (!paper) return;

    const li = document.createElement('li');
    li.className = 'queue-item';
    const color = DOMAIN_COLORS[paper.domains[0]] || '#888';
    li.innerHTML = `
      <div class="queue-item__dot" style="background:${color}"></div>
      <span class="queue-item__title">${paper.title}</span>
    `;
    li.addEventListener('click', () => openPaperPanel(paper));
    container.appendChild(li);
  });
}

// ─── FILTERING ───
function applyFilters() {
  const domains = Store.get('activeDomains');
  const tag = Store.get('activeTag');
  const search = Store.get('searchQuery');

  if (currentView === 'graph') {
    GraphEngine.filterByAll(domains, tag, search);
  } else {
    renderListView();
  }

  // Update overlap indicator when multiple domains selected
  updateOverlapIndicator(domains);
}

function updateOverlapIndicator(domains) {
  let indicator = document.getElementById('overlap-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'overlap-indicator';
    indicator.className = 'overlap-indicator';
    document.querySelector('.sidebar__section')?.appendChild(indicator);
  }

  if (domains.length > 1) {
    const overlapCount = allPapers.filter(p =>
      p.domains.filter(d => domains.includes(d)).length > 1
    ).length;
    indicator.textContent = `${overlapCount} overlap paper${overlapCount !== 1 ? 's' : ''} across selected domains`;
    indicator.style.display = 'block';
  } else {
    indicator.style.display = 'none';
  }
}

// ─── LIST VIEW ───
function renderListView() {
  const container = document.getElementById('list-container');
  let papers = filterPapers();

  const grid = document.createElement('div');
  grid.className = 'list-grid';

  papers.forEach(p => {
    const card = document.createElement('div');
    card.className = 'paper-card';
    const primaryColor = DOMAIN_COLORS[p.domains[0]] || '#888';
    card.style.setProperty('--card-color', primaryColor);
    card.querySelector?.('::before')?.style?.background;
    card.innerHTML = `
      <div style="position:absolute;top:0;left:0;width:3px;height:100%;background:${primaryColor}"></div>
      <div class="paper-card__domains">
        ${p.domains.map(d => `<div class="paper-card__domain-dot" style="background:${DOMAIN_COLORS[d]};color:${DOMAIN_COLORS[d]}" title="${DOMAIN_LABELS[d] || d}"></div>`).join('')}
      </div>
      <div class="paper-card__title">${p.title}</div>
      <div class="paper-card__authors">${p.authors.slice(0, 3).join(', ')}${p.authors.length > 3 ? ' et al.' : ''}</div>
      <div class="paper-card__abstract">${p.abstract}</div>
      <div class="paper-card__tags">
        ${p.tags.slice(0, 5).map(t => `<span class="paper-card__tag">${t}</span>`).join('')}
      </div>
      <div class="paper-card__actions">
        <button class="btn btn--icon" title="Read Later">${Store.isReadLater(p.id) ? '★' : '☆'}</button>
      </div>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.paper-card__actions')) {
        Store.toggleReadLater(p.id);
        renderQueue();
        renderListView();
        return;
      }
      openPaperPanel(p);
    });
    grid.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(grid);
}

function renderListViewFiltered(papers) {
  const container = document.getElementById('list-container');
  const grid = document.createElement('div');
  grid.className = 'list-grid';

  papers.forEach(p => {
    const card = document.createElement('div');
    card.className = 'paper-card';
    const primaryColor = DOMAIN_COLORS[p.domains[0]] || '#888';
    const scoreHtml = p._searchScore ? `<span class="paper-card__tag" style="color:var(--ai)">relevance: ${(p._searchScore * 100).toFixed(0)}%</span>` : '';
    card.innerHTML = `
      <div style="position:absolute;top:0;left:0;width:3px;height:100%;background:${primaryColor}"></div>
      <div class="paper-card__domains">
        ${p.domains.map(d => `<div class="paper-card__domain-dot" style="background:${DOMAIN_COLORS[d]};color:${DOMAIN_COLORS[d]}" title="${DOMAIN_LABELS[d] || d}"></div>`).join('')}
      </div>
      <div class="paper-card__title">${p.title}</div>
      <div class="paper-card__authors">${p.authors.slice(0, 3).join(', ')}${p.authors.length > 3 ? ' et al.' : ''}</div>
      <div class="paper-card__abstract">${p.abstract}</div>
      <div class="paper-card__tags">
        ${scoreHtml}
        ${p.tags.slice(0, 4).map(t => `<span class="paper-card__tag">${t}</span>`).join('')}
      </div>
      <div class="paper-card__actions">
        <button class="btn btn--icon" title="Read Later">${Store.isReadLater(p.id) ? '★' : '☆'}</button>
      </div>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.paper-card__actions')) {
        Store.toggleReadLater(p.id);
        renderQueue();
        return;
      }
      openPaperPanel(p);
    });
    grid.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(grid);
}

function filterPapers() {
  let papers = [...allPapers];
  const domains = Store.get('activeDomains');
  const tag = Store.get('activeTag');
  const search = Store.get('searchQuery');

  if (domains.length > 0) {
    papers = papers.filter(p => p.domains.some(d => domains.includes(d)));
  }
  if (tag) {
    papers = papers.filter(p => p.tags.includes(tag));
  }
  if (search) {
    const q = search.toLowerCase();
    papers = papers.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.abstract.toLowerCase().includes(q) ||
      p.authors.some(a => a.toLowerCase().includes(q))
    );
  }
  return papers;
}

// ─── DETAIL PANEL ───
function openPaperPanel(paper) {
  const panel = document.getElementById('detail-panel');
  const body = document.getElementById('panel-body');

  // Connected papers
  const connected = [];
  allEdges.forEach(e => {
    if (e.source === paper.id || (e.source && e.source.id === paper.id)) {
      const tid = typeof e.target === 'object' ? e.target.id : e.target;
      const p = allPapers.find(pp => pp.id === tid);
      if (p) connected.push({ paper: p, weight: e.weight, sharedTags: e.sharedTags });
    }
    if (e.target === paper.id || (e.target && e.target.id === paper.id)) {
      const sid = typeof e.source === 'object' ? e.source.id : e.source;
      const p = allPapers.find(pp => pp.id === sid);
      if (p) connected.push({ paper: p, weight: e.weight, sharedTags: e.sharedTags });
    }
  });
  connected.sort((a, b) => b.weight - a.weight);

  const isQueued = Store.isReadLater(paper.id);
  const note = Store.getNote(paper.id);

  body.innerHTML = `
    <div class="detail-panel__domain-bar">
      ${paper.domains.map(d => `
        <span class="detail-panel__domain-tag" style="color:${DOMAIN_COLORS[d]};border-color:${DOMAIN_COLORS[d]}30;background:${DOMAIN_COLORS[d]}10">
          ${DOMAIN_LABELS[d] || d}
        </span>
      `).join('')}
      ${paper.isOverlap ? '<span class="detail-panel__domain-tag" style="color:#fff;border-color:#fff3;background:#fff1">OVERLAP</span>' : ''}
    </div>

    <h2 class="detail-panel__title">${paper.title}</h2>

    <div class="detail-panel__meta">
      📅 ${new Date(paper.published).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
      · <a href="${paper.arxivUrl}" target="_blank">arXiv:${paper.id}</a>
    </div>

    <div class="detail-panel__authors">
      ${paper.authors.join(', ')}
    </div>

    <div class="detail-panel__section-label">Abstract</div>
    <div class="detail-panel__abstract" id="panel-abstract">${paper.abstract}</div>

    <div class="detail-panel__section-label">Keywords</div>
    <div class="detail-panel__tags">
      ${paper.tags.map(t => `<span class="detail-panel__tag" data-tag="${t}">${t}</span>`).join('')}
    </div>

    <div class="detail-panel__section-label">Categories</div>
    <div class="detail-panel__categories">${paper.categories.join(' · ')}</div>

    <div class="detail-panel__section-label">Notes</div>
    <div class="detail-panel__notes">
      <textarea id="panel-notes" placeholder="Add your notes here...">${note}</textarea>
    </div>

    ${connected.length > 0 ? `
      <div class="detail-panel__section-label">Connected Papers (${connected.length})</div>
      <div class="detail-panel__connected">
        ${connected.slice(0, 15).map(c => `
          <div class="connected-paper" data-id="${c.paper.id}">
            <div class="connected-paper__dot" style="background:${DOMAIN_COLORS[c.paper.domains[0]]}"></div>
            <span class="connected-paper__title">${c.paper.title}</span>
            <span class="connected-paper__weight">${c.weight.toFixed(1)}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;

  // Update panel action buttons
  document.getElementById('panel-save').textContent = isQueued ? '★' : '☆';
  document.getElementById('panel-save').onclick = () => {
    const now = Store.toggleReadLater(paper.id);
    document.getElementById('panel-save').textContent = now ? '★' : '☆';
    renderQueue();
    notify(now ? 'Added to Read Later' : 'Removed from Read Later', 'success');
  };

  document.getElementById('panel-pdf').onclick = () => window.open(paper.pdfUrl, '_blank');
  document.getElementById('panel-arxiv').onclick = () => window.open(paper.arxivUrl, '_blank');
  document.getElementById('panel-vault').onclick = () => saveToVault(paper);
  document.getElementById('panel-read').onclick = () => window.open(`/reader.html?id=${encodeURIComponent(paper.id)}`, '_blank');

  // Notes auto-save
  const notesEl = document.getElementById('panel-notes');
  let noteTimer;
  notesEl.addEventListener('input', () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      Store.setNote(paper.id, notesEl.value);
    }, 500);
  });

  // Tag click → filter
  body.querySelectorAll('.detail-panel__tag').forEach(el => {
    el.addEventListener('click', () => {
      const tag = el.dataset.tag;
      Store.set('activeTag', tag);
      applyFilters();
      // Update sidebar
      document.querySelectorAll('.tag-pill').forEach(p => p.classList.toggle('active', p.textContent === tag));
    });
  });

  // Connected paper click → navigate
  body.querySelectorAll('.connected-paper').forEach(el => {
    el.addEventListener('click', () => {
      const p = allPapers.find(pp => pp.id === el.dataset.id);
      if (p) openPaperPanel(p);
    });
  });

  // Highlight on text selection
  const abstractEl = document.getElementById('panel-abstract');
  abstractEl.addEventListener('mouseup', () => {
    const selection = window.getSelection().toString().trim();
    if (selection.length > 5) {
      Store.addHighlight(paper.id, selection);
      notify('Text highlighted & saved', 'info');
    }
  });

  panel.classList.add('open');
  panel._currentPaper = paper;
}

function closePaperPanel() {
  document.getElementById('detail-panel').classList.remove('open');
}

// ─── EXPORT ───
async function saveToVault(paper) {
  try {
    const annotations = JSON.parse(localStorage.getItem(`scan_annotations_${paper.id}`) || '[]');
    const notes = Store.getNote(paper.id);

    const res = await fetch('/api/vault/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paper, annotations, notes }),
    });
    const data = await res.json();
    if (data.success) {
      notify(`Saved to Obsidian vault: ${data.filename}`, 'success');
    } else {
      notify('Vault save failed', 'warning');
    }
  } catch (err) {
    notify('Vault save failed', 'warning');
  }
}

async function exportSinglePaper(paper) {
  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paperIds: [paper.id] }),
    });
    const data = await res.json();
    if (data.files && data.files.length > 0) {
      downloadFile(data.files[0].filename, data.files[0].content);
      notify('Exported to Markdown', 'success');
    }
  } catch (err) {
    notify('Export failed', 'warning');
  }
}

async function exportQueue() {
  const ids = Store.get('readLater');
  if (ids.length === 0) {
    notify('No papers in queue', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paperIds: ids }),
    });
    const data = await res.json();
    data.files.forEach(f => downloadFile(f.filename, f.content));
    notify(`Exported ${data.files.length} papers`, 'success');
  } catch (err) {
    notify('Export failed', 'warning');
  }
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── NOTIFICATIONS ───
function notify(message, type = 'info') {
  const el = document.getElementById('notification');
  el.textContent = message;
  el.className = `notification notification--${type} show`;
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ─── VIEW SWITCHING ───
function switchView(view) {
  currentView = view;
  Store.set('view', view);

  const graphBtn = document.getElementById('btn-view-graph');
  const listBtn = document.getElementById('btn-view-list');
  const graphContainer = document.getElementById('graph-container');
  const listContainer = document.getElementById('list-container');

  if (view === 'graph') {
    graphBtn.classList.add('btn--active');
    listBtn.classList.remove('btn--active');
    graphContainer.style.display = '';
    listContainer.classList.remove('active');
  } else {
    graphBtn.classList.remove('btn--active');
    listBtn.classList.add('btn--active');
    graphContainer.style.display = 'none';
    listContainer.classList.add('active');
    renderListView();
  }
}

// ─── LOADING ───
function hideLoading() {
  setTimeout(() => {
    document.getElementById('loading').classList.add('hidden');
  }, 800);
}

// ─── EVENT LISTENERS ───
function setupEventListeners() {
  // Search — conceptual search via API
  const searchInput = document.getElementById('search-input');
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const query = searchInput.value.trim();
      Store.set('searchQuery', query);

      if (query.length >= 3) {
        // Use conceptual search API
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=50`);
          const results = await res.json();
          if (results.length > 0) {
            const resultIds = new Set(results.map(r => r.id));
            // Filter graph to show only conceptual matches
            if (currentView === 'graph') {
              GraphEngine.filterByIds(resultIds);
            } else {
              renderListViewFiltered(results);
            }
            return;
          }
        } catch (e) {
          console.warn('Conceptual search failed, falling back:', e);
        }
      }
      applyFilters();
    }, 400);
  });

  // Keyboard shortcut
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
    if (e.key === 'Escape') {
      closePaperPanel();
      searchInput.blur();
    }
  });

  // View toggles
  document.getElementById('btn-view-graph').addEventListener('click', () => switchView('graph'));
  document.getElementById('btn-view-list').addEventListener('click', () => switchView('list'));

  // Panel close
  document.getElementById('panel-close').addEventListener('click', closePaperPanel);

  // Paper selection from graph
  window.addEventListener('scan:paper-select', (e) => {
    const paper = allPapers.find(p => p.id === e.detail.id);
    if (paper) openPaperPanel(paper);
  });

  // Refresh
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    notify('Refreshing data from arXiv...', 'info');
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        notify(`Refreshed: ${data.papers} papers, ${data.edges} edges`, 'success');
        await loadData();
      }
    } catch (err) {
      notify('Refresh failed', 'warning');
    }
  });

  // Export modal
  document.getElementById('btn-export').addEventListener('click', () => {
    const count = Store.get('readLater').length;
    document.getElementById('export-count').textContent = `${count} papers in queue`;
    document.getElementById('export-modal').classList.add('open');
  });

  document.getElementById('export-cancel').addEventListener('click', () => {
    document.getElementById('export-modal').classList.remove('open');
  });

  document.getElementById('export-confirm').addEventListener('click', () => {
    document.getElementById('export-modal').classList.remove('open');
    exportQueue();
  });

  // Close modal on backdrop click
  document.getElementById('export-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      e.currentTarget.classList.remove('open');
    }
  });

  // Store changes
  Store.on((key) => {
    if (key === 'readLater') renderQueue();
  });
}

// ─── BOOT ───
document.addEventListener('DOMContentLoaded', init);
