// ═══════════════════════════════════════════════════════════
// SCAN Reader — Paper reading & annotation controller
// ═══════════════════════════════════════════════════════════

const DOMAIN_COLORS = {
  neuroscience: '#00f0ff', ai: '#ff00aa', cybernetics: '#ffaa00',
  cognition: '#00ff88', biomimetics: '#aa44ff',
};
const DOMAIN_LABELS = {
  neuroscience: 'Neuroscience', ai: 'Artificial Intelligence',
  cybernetics: 'Cybernetics & Systems', cognition: 'Cognition', biomimetics: 'Biomimetics',
};

let paperData = null;
let annotations = []; // { id, text, color, comment, charStart, charEnd }
let pendingHighlight = null; // Holds selection data before color pick

// ─── INIT ───
async function initReader() {
  const params = new URLSearchParams(window.location.search);
  const paperId = params.get('id');
  if (!paperId) {
    document.getElementById('reader-article').innerHTML = '<p style="color:var(--text-muted);padding:48px;">No paper ID specified.</p>';
    return;
  }

  try {
    const [contentRes, papersRes] = await Promise.all([
      fetch(`/api/papers/${encodeURIComponent(paperId)}/content`).then(r => r.json()),
      fetch('/api/papers').then(r => r.json()),
    ]);

    paperData = contentRes;
    loadAnnotations();
    renderPaper();
    renderAnnotationList();
    setupConnectedPapers(papersRes.edges);
    setupEventListeners();
    setupSidebarToggle();
  } catch (err) {
    console.error('Failed to load paper:', err);
  }
}

function setupSidebarToggle() {
  const btn = document.getElementById('sidebar-toggle');
  const layout = document.querySelector('.reader-layout');
  // Restore state
  if (localStorage.getItem('scan_sidebar_collapsed') === '1') {
    layout.classList.add('sidebar-collapsed');
    btn.textContent = '▶';
  }
  btn.addEventListener('click', () => {
    layout.classList.toggle('sidebar-collapsed');
    const collapsed = layout.classList.contains('sidebar-collapsed');
    btn.textContent = collapsed ? '▶' : '◀';
    localStorage.setItem('scan_sidebar_collapsed', collapsed ? '1' : '0');
  });
}

// ─── RENDER PAPER ───
function renderPaper() {
  const p = paperData;

  // Domains
  document.getElementById('reader-domains').innerHTML = p.domains.map(d => `
    <span class="detail-panel__domain-tag" style="color:${DOMAIN_COLORS[d]};border-color:${DOMAIN_COLORS[d]}30;background:${DOMAIN_COLORS[d]}10">
      ${DOMAIN_LABELS[d] || d}
    </span>
  `).join('') + (p.isOverlap ? '<span class="detail-panel__domain-tag" style="color:#fff;border-color:#fff3;background:#fff1">OVERLAP</span>' : '');

  // Title
  document.getElementById('reader-title').textContent = p.title;

  // Meta
  document.getElementById('reader-meta').innerHTML = `
    📅 ${new Date(p.published).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
    · <a href="${p.arxivUrl}" target="_blank">arXiv:${p.id}</a>
    · ${p.categories.join(' · ')}
  `;

  // Authors
  document.getElementById('reader-authors').textContent = p.authors.join(', ');

  // Content sections
  const contentEl = document.getElementById('reader-content');
  contentEl.innerHTML = '';

  // Source indicator
  if (p.source && p.source !== 'abstract') {
    const srcEl = document.createElement('div');
    srcEl.className = 'reader-source-badge';
    srcEl.textContent = `Full text · ${p.sections.length} sections`;
    contentEl.appendChild(srcEl);
  } else {
    const srcEl = document.createElement('div');
    srcEl.className = 'reader-source-badge reader-source-badge--abstract';
    srcEl.innerHTML = `Abstract only · <a href="${p.pdfUrl}" target="_blank" style="color:var(--ai)">Open PDF for full paper</a>`;
    contentEl.appendChild(srcEl);
  }

  // Build left-rail section nav (collapsed numbers, expand on hover)
  if (p.sections.length > 1) {
    // Remove old nav if re-rendering
    document.querySelector('.reader-nav')?.remove();

    const navEl = document.createElement('nav');
    navEl.className = 'reader-nav';
    let sectionNum = 0;
    navEl.innerHTML = p.sections.map(s => {
      sectionNum++;
      const isSub = s.isSubsection;
      const label = isSub ? '·' : sectionNum;
      return `<div class="reader-nav__item ${isSub ? 'reader-nav__item--sub' : ''}" data-section-id="${s.id}">
        <span class="reader-nav__num">${label}</span>
        <span class="reader-nav__title">${escapeHTML(s.title)}</span>
      </div>`;
    }).join('');

    // Insert before the layout
    document.querySelector('.reader-layout').prepend(navEl);

    // Click → scroll
    navEl.querySelectorAll('.reader-nav__item').forEach(item => {
      item.addEventListener('click', () => {
        const target = document.getElementById('sec-' + item.dataset.sectionId);
        if (target) {
          const scrollContainer = document.querySelector('.reader-body') || document.documentElement;
          const headerH = 52;
          const top = target.getBoundingClientRect().top + scrollContainer.scrollTop - headerH;
          scrollContainer.scrollTo({ top, behavior: 'smooth' });
        }
        navEl.querySelectorAll('.reader-nav__item').forEach(l => l.classList.remove('active'));
        item.classList.add('active');
      });
    });

    // Update active item on scroll
    const scrollContainer = document.querySelector('.reader-body') || window;
    let scrollTimer;
    scrollContainer.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const sections = document.querySelectorAll('.reader-section');
        let activeId = null;
        sections.forEach(sec => {
          const rect = sec.getBoundingClientRect();
          if (rect.top < 200) activeId = sec.dataset.sectionId;
        });
        if (activeId) {
          navEl.querySelectorAll('.reader-nav__item').forEach(l => l.classList.remove('active'));
          const activeItem = navEl.querySelector(`[data-section-id="${activeId}"]`);
          if (activeItem) activeItem.classList.add('active');
        }
      }, 100);
    });
  }

  p.sections.forEach(section => {
    const sectionEl = document.createElement('div');
    sectionEl.className = 'reader-section' + (section.isSubsection ? ' reader-section--sub' : '');
    sectionEl.dataset.sectionId = section.id;
    sectionEl.id = `sec-${section.id}`;

    // Split content into paragraphs on double newlines, or sentence-chunk if single block
    let paragraphs;
    if (section.content.includes('\n\n')) {
      paragraphs = section.content.split('\n\n').map(p => p.trim()).filter(p => p.length > 5);
    } else {
      const sentences = section.content.match(/[^.!?]+[.!?]+/g) || [section.content];
      paragraphs = [];
      for (let i = 0; i < sentences.length; i += 3) {
        paragraphs.push(sentences.slice(i, i + 3).join(' ').trim());
      }
    }

    const titleTag = section.isSubsection ? 'reader-section__subtitle' : 'reader-section__title';

    sectionEl.innerHTML = `
      <div class="${titleTag}">${escapeHTML(section.title)}</div>
      <div class="reader-section__body" data-section="${section.id}">
        ${paragraphs.map(para => `<p>${para}</p>`).join('')}
      </div>
    `;
    contentEl.appendChild(sectionEl);
  });

  // Apply existing highlights
  applyHighlights();

  // Tags
  document.getElementById('reader-tags').innerHTML = p.tags
    .map(t => `<span class="reader-tag">${t}</span>`).join('');

  // Notes
  document.getElementById('reader-notes').value = Store.getNote(p.id);

  // Header buttons
  document.getElementById('reader-save').textContent = Store.isReadLater(p.id) ? '★' : '☆';
  document.getElementById('reader-pdf').onclick = () => window.open(p.pdfUrl, '_blank');
  document.getElementById('reader-arxiv').onclick = () => window.open(p.arxivUrl, '_blank');
}

// ─── HIGHLIGHT SYSTEM ───
function setupEventListeners() {
  const contentEl = document.getElementById('reader-content');
  const popup = document.getElementById('highlight-popup');
  const annotInput = document.getElementById('annotation-input');

  // Click-to-pin highlights: click a highlight to keep its preview open
  contentEl.addEventListener('click', (e) => {
    const hl = e.target.closest('.scan-highlight');
    // If clicking a pinned highlight's preview button, don't unpin
    if (e.target.closest('.highlight-preview')) return;

    // Unpin all
    document.querySelectorAll('.scan-highlight.pinned').forEach(el => el.classList.remove('pinned'));

    // Pin the clicked one
    if (hl) {
      hl.classList.add('pinned');
      e.stopPropagation();
    }
  });

  // Click anywhere else → unpin
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.scan-highlight') && !e.target.closest('.highlight-preview') && !e.target.closest('.inline-comment-input')) {
      document.querySelectorAll('.scan-highlight.pinned').forEach(el => el.classList.remove('pinned'));
      document.getElementById('inline-comment-input')?.remove();
    }
  });

  // Text selection → show color picker
  contentEl.addEventListener('mouseup', (e) => {
    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (text.length < 3) {
      popup.classList.remove('visible');
      return;
    }

    // Get selection range info
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const article = contentEl.closest('.reader-article');
    const articleRect = article.getBoundingClientRect();
    pendingHighlight = {
      text,
      range: range.cloneRange(),
    };

    // position: fixed → use viewport coordinates directly
    popup.style.left = Math.max(10, rect.left + rect.width / 2 - 40) + 'px';
    popup.style.top = (rect.top - 44) + 'px';
    popup.classList.add('visible');
  });

  // Click elsewhere hides popup
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.highlight-popup') && !e.target.closest('.annotation-input')) {
      popup.classList.remove('visible');
      annotInput.classList.remove('visible');
    }
  });

  // Color pick
  popup.querySelectorAll('.highlight-popup__color').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const color = btn.dataset.color;
      popup.classList.remove('visible');

      if (!pendingHighlight) return;
      pendingHighlight.color = color;

      // Show comment input near the selection — position: fixed → viewport coords
      const selRange = pendingHighlight.range;
      const selRect = selRange.getBoundingClientRect();

      annotInput.style.left = Math.max(20, selRect.left) + 'px';
      annotInput.style.top = (selRect.bottom + 8) + 'px';
      annotInput.classList.add('visible');
      document.getElementById('annotation-comment').value = '';
      document.getElementById('annotation-comment').focus();
    });
  });

  // Save annotation
  document.getElementById('annotation-save').addEventListener('click', () => {
    if (!pendingHighlight) return;
    const comment = document.getElementById('annotation-comment').value.trim();

    const annotation = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text: pendingHighlight.text.replace(/\s+/g, ' ').trim(),
      color: pendingHighlight.color,
      comment: comment || '',
      timestamp: new Date().toISOString(),
    };

    annotations.push(annotation);
    saveAnnotations();
    applyHighlights();
    renderAnnotationList();

    annotInput.classList.remove('visible');
    pendingHighlight = null;
    window.getSelection().removeAllRanges();

    notify(comment ? 'Highlight + comment saved' : 'Highlight saved', 'success');
  });

  // Cancel annotation
  document.getElementById('annotation-cancel').addEventListener('click', () => {
    annotInput.classList.remove('visible');
    pendingHighlight = null;
  });

  // Enter to save
  document.getElementById('annotation-comment').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('annotation-save').click();
    }
  });

  // Notes auto-save
  const notesEl = document.getElementById('reader-notes');
  let noteTimer;
  notesEl.addEventListener('input', () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      Store.setNote(paperData.id, notesEl.value);
    }, 500);
  });

  // Read Later toggle
  document.getElementById('reader-save').addEventListener('click', () => {
    const now = Store.toggleReadLater(paperData.id);
    document.getElementById('reader-save').textContent = now ? '★' : '☆';
    notify(now ? 'Added to Read Later' : 'Removed from Read Later', 'success');
  });

  // Save to Vault
  document.getElementById('reader-vault').addEventListener('click', saveToVault);

  // Concept Explorer
  setupConceptExplorer();

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      popup.classList.remove('visible');
      annotInput.classList.remove('visible');
    }
  });
}

// ─── APPLY HIGHLIGHTS TO DOM ───
function applyHighlights() {
  if (!annotations.length) return;

  const bodyEls = document.querySelectorAll('.reader-section__body');
  // Process longest annotations first to avoid overlap issues
  const sorted = [...annotations].sort((a, b) => b.text.length - a.text.length);

  // Build hover preview HTML for an annotation
  function buildPreviewHTML(ann) {
    if (ann.type === 'concept') {
      let html = `<span class="highlight-preview">`;
      html += `<span class="highlight-preview__label" style="color:var(--cognition)">${escapeHTML(ann.concept)}</span>`;
      if (ann.explanation) {
        const short = ann.explanation.length > 100 ? ann.explanation.slice(0, 100) + '…' : ann.explanation;
        html += `<span class="highlight-preview__comment">${escapeHTML(short)}</span>`;
      }
      if (ann.userComment) {
        html += `<span class="highlight-preview__user-comment">${escapeHTML(ann.userComment)}</span>`;
      }
      html += `<button class="highlight-preview__add-comment" onclick="event.stopPropagation();window._addCommentToHighlight('${ann.id}')">${ann.userComment ? 'edit' : 'comment'}</button>`;
      html += `</span>`;
      return html;
    }
    if (ann.comment) {
      return `<span class="highlight-preview"><span class="highlight-preview__label">note</span><span class="highlight-preview__comment">${escapeHTML(ann.comment)}</span></span>`;
    }
    return `<span class="highlight-preview"><span class="highlight-preview__no-comment">No comment</span></span>`;
  }

  bodyEls.forEach(bodyEl => {
    sorted.forEach(ann => {
      // Walk text nodes to find the annotation text
      const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT, null);
      let node;
      let found = false;

      while ((node = walker.nextNode()) && !found) {
        // Skip if already inside a highlight
        if (node.parentElement.closest('.scan-highlight')) continue;

        const idx = node.textContent.indexOf(ann.text);
        if (idx === -1) continue;

        // Split the text node and wrap the match
        const before = node.textContent.slice(0, idx);
        const after = node.textContent.slice(idx + ann.text.length);

        const previewHTML = buildPreviewHTML(ann);

        const span = document.createElement('span');
        span.className = 'scan-highlight';
        span.dataset.color = ann.color;
        span.dataset.annotationId = ann.id;
        span.innerHTML = escapeHTML(ann.text) + previewHTML;

        const parent = node.parentNode;
        if (before) parent.insertBefore(document.createTextNode(before), node);
        parent.insertBefore(span, node);
        if (after) parent.insertBefore(document.createTextNode(after), node);
        parent.removeChild(node);

        found = true;
      }

      // Fallback: try normalized whitespace matching across <p> elements
      if (!found) {
        const annNorm = ann.text.replace(/\s+/g, ' ').trim();
        bodyEl.querySelectorAll('p').forEach(p => {
          if (found) return;
          const pNorm = p.textContent.replace(/\s+/g, ' ');
          if (pNorm.includes(annNorm) || pNorm.includes(annNorm.slice(0, 60))) {
            const escaped = annNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const normalized = escaped.replace(/ /g, '\\s+');
            const regex = new RegExp(normalized, 'i');

            const previewHTML = buildPreviewHTML(ann);
            const newHTML = p.innerHTML.replace(regex, (match) =>
              `<span class="scan-highlight" data-color="${ann.color}" data-annotation-id="${ann.id}">${match}${previewHTML}</span>`
            );
            if (newHTML !== p.innerHTML) {
              p.innerHTML = newHTML;
              found = true;
            }
          }
        });
      }

      // Last resort: prefix match (first 50 chars) + sentence boundary
      if (!found) {
        const prefix = ann.text.replace(/\s+/g, ' ').trim().slice(0, 50);
        bodyEl.querySelectorAll('p').forEach(p => {
          if (found) return;
          const pText = p.textContent.replace(/\s+/g, ' ');
          const idx = pText.indexOf(prefix);
          if (idx === -1) return;

          // Find the actual text from this point to approximate length
          const approxEnd = Math.min(idx + ann.text.length + 30, pText.length);
          let endIdx = pText.indexOf('. ', idx + ann.text.length - 10);
          if (endIdx === -1 || endIdx > approxEnd) endIdx = idx + ann.text.length;
          else endIdx += 1; // include the period

          const actualText = pText.slice(idx, endIdx).trim();
          const escaped = actualText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
          const regex = new RegExp(escaped, 'i');

          const previewHTML = buildPreviewHTML(ann);
          const newHTML = p.innerHTML.replace(regex, (match) =>
            `<span class="scan-highlight" data-color="${ann.color}" data-annotation-id="${ann.id}">${match}${previewHTML}</span>`
          );
          if (newHTML !== p.innerHTML) {
            p.innerHTML = newHTML;
            found = true;
          }
        });
      }
    });
  });
}

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Global handler for "add comment" from hover preview
window._addCommentToHighlight = function(annId) {
  const ann = annotations.find(a => a.id === annId);
  if (!ann) return;

  const hlEl = document.querySelector(`.scan-highlight[data-annotation-id="${annId}"]`);
  if (!hlEl) return;

  // Create inline comment input below the highlight
  const existing = document.getElementById('inline-comment-input');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.id = 'inline-comment-input';
  wrap.className = 'inline-comment-input';
  wrap.innerHTML = `
    <textarea placeholder="Add your thoughts on this passage…" rows="3">${ann.userComment ? escapeHTML(ann.userComment) : ''}</textarea>
    <div class="inline-comment-input__actions">
      <button class="inline-comment-cancel">Cancel</button>
      <button class="inline-comment-save">Save</button>
    </div>
  `;
  hlEl.parentNode.insertBefore(wrap, hlEl.nextSibling);

  const textarea = wrap.querySelector('textarea');
  textarea.focus();
  if (ann.userComment) textarea.select();

  const save = () => {
    const val = textarea.value.trim();
    if (val) {
      ann.userComment = val;
      saveAnnotations();
      wrap.remove();
      applyHighlights();
      renderAnnotationList();
      notify('Comment saved', 'success');
    }
  };

  wrap.querySelector('.inline-comment-save').onclick = save;
  textarea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) save(); });
  wrap.querySelector('.inline-comment-cancel').onclick = () => wrap.remove();
};

// ─── ANNOTATION LIST ───
function renderAnnotationList() {
  const container = document.getElementById('annotation-list');

  if (annotations.length === 0) {
    container.innerHTML = '<div class="reader-sidebar__empty">Select text to highlight</div>';
    return;
  }

  container.innerHTML = annotations.map(ann => {
    const isConcept = ann.type === 'concept';
    const borderColor = isConcept ? 'var(--cognition)' : ann.color;
    const conceptLabel = isConcept ? `<div class="annotation-item__concept">${escapeHTML(ann.concept)}</div>` : '';
    const explanationHTML = isConcept && ann.explanation ? `<div class="annotation-item__explanation">${escapeHTML(ann.explanation)}</div>` : '';
    const commentHTML = isConcept
      ? (ann.userComment ? `<div class="annotation-item__comment">${escapeHTML(ann.userComment)}</div>` : `<button class="annotation-item__add-comment" data-id="${ann.id}">+ add comment</button>`)
      : (ann.comment ? `<div class="annotation-item__comment">${escapeHTML(ann.comment)}</div>` : '');

    return `
      <div class="annotation-item" style="border-color:${borderColor}" data-id="${ann.id}">
        ${conceptLabel}
        <div class="annotation-item__text">"${escapeHTML(ann.text.slice(0, 120))}${ann.text.length > 120 ? '…' : ''}"</div>
        ${explanationHTML}
        ${commentHTML}
        <div class="annotation-item__actions">
          <button class="annotation-item__delete" data-id="${ann.id}" title="Delete">✕ remove</button>
        </div>
      </div>
    `;
  }).join('');

  // Click annotation → scroll to highlight in text
  container.querySelectorAll('.annotation-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.annotation-item__delete')) return;
      const id = el.dataset.id;
      const highlight = document.querySelector(`.scan-highlight[data-annotation-id="${id}"]`);
      if (highlight) {
        highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlight.style.outline = '2px solid #fff';
        setTimeout(() => { highlight.style.outline = ''; }, 2000);
      }
    });
  });

  // Delete annotation
  container.querySelectorAll('.annotation-item__delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      annotations = annotations.filter(a => a.id !== id);
      saveAnnotations();

      // Re-render content without that highlight
      renderPaper();
      renderAnnotationList();
      notify('Annotation removed', 'info');
    });
  });

  // Add comment to concept highlight
  container.querySelectorAll('.annotation-item__add-comment').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const ann = annotations.find(a => a.id === id);
      if (!ann) return;

      // Replace the button with a textarea
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-top:6px;';
      wrap.innerHTML = `
        <textarea placeholder="Your thoughts…" rows="2" style="width:100%;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:3px;padding:8px;font-size:11px;line-height:1.5;color:var(--text-primary);outline:none;font-family:var(--font-mono);resize:vertical;margin-bottom:4px;"></textarea>
        <div style="display:flex;gap:6px;justify-content:flex-end;">
          <button class="sc-cancel" style="background:none;border:1px solid var(--border);border-radius:3px;padding:3px 10px;font-size:9px;color:var(--text-muted);cursor:pointer;font-family:var(--font-mono);">Cancel</button>
          <button class="sc-save" style="background:var(--cognition);color:var(--bg-primary);border:none;border-radius:3px;padding:3px 10px;font-size:9px;cursor:pointer;font-family:var(--font-mono);">Save</button>
        </div>
      `;
      btn.replaceWith(wrap);

      const textarea = wrap.querySelector('textarea');
      const saveBtn = wrap.querySelector('.sc-save');
      const cancelBtn = wrap.querySelector('.sc-cancel');
      textarea.focus();

      const save = () => {
        const val = textarea.value.trim();
        if (val) {
          ann.userComment = val;
          saveAnnotations();
          applyHighlights();
          renderAnnotationList();
          notify('Comment added', 'success');
        }
      };

      saveBtn.addEventListener('click', save);
      cancelBtn.addEventListener('click', () => { wrap.remove(); renderAnnotationList(); });
      textarea.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && ev.ctrlKey) save();
      });
    });
  });
}

// ─── CONCEPT EXPLORER ───
let paperConcepts = null; // cached concept list

function setupConceptExplorer() {
  const input = document.getElementById('concept-input');
  const goBtn = document.getElementById('concept-go');
  const suggestionsEl = document.getElementById('concept-suggestions');
  const statusEl = document.getElementById('concept-status');

  // On focus, load concept suggestions if not loaded
  input.addEventListener('focus', async () => {
    if (paperConcepts) return; // Already loaded
    await loadConceptSuggestions();
  });

  // Enter key triggers explore
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      exploreConcept(input.value.trim());
    }
  });

  // Go button
  goBtn.addEventListener('click', () => {
    exploreConcept(input.value.trim());
  });
}

async function loadConceptSuggestions() {
  const suggestionsEl = document.getElementById('concept-suggestions');
  const statusEl = document.getElementById('concept-status');

  statusEl.textContent = 'Analyzing paper…';
  statusEl.className = 'concept-explorer__status processing';

  try {
    const res = await fetch(`/api/papers/${encodeURIComponent(paperData.id)}/concepts`);
    const data = await res.json();
    paperConcepts = data.concepts || [];

    if (paperConcepts.length === 0) {
      statusEl.textContent = 'No concepts extracted';
      statusEl.className = 'concept-explorer__status error';
      return;
    }

    statusEl.textContent = '';
    statusEl.className = 'concept-explorer__status';

    suggestionsEl.innerHTML = paperConcepts.map(c =>
      `<button class="concept-suggestion" title="${escapeHTML(c.description)}">${escapeHTML(c.concept)}</button>`
    ).join('');

    // Click suggestion → fill input and explore
    suggestionsEl.querySelectorAll('.concept-suggestion').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('concept-input').value = btn.textContent;
        exploreConcept(btn.textContent);
      });
    });
  } catch (err) {
    statusEl.textContent = 'Failed to analyze paper';
    statusEl.className = 'concept-explorer__status error';
  }
}

async function exploreConcept(concept) {
  if (!concept || concept.length < 2) return;

  const statusEl = document.getElementById('concept-status');
  const resultsEl = document.getElementById('concept-results');
  const goBtn = document.getElementById('concept-go');

  statusEl.textContent = `Finding "${concept}"…`;
  statusEl.className = 'concept-explorer__status processing';
  goBtn.classList.add('loading');
  resultsEl.innerHTML = '';

  try {
    const res = await fetch(`/api/papers/${encodeURIComponent(paperData.id)}/explore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concept }),
    });
    const data = await res.json();
    const passages = data.passages || [];

    goBtn.classList.remove('loading');

    if (passages.length === 0) {
      statusEl.textContent = 'No passages found for this concept';
      statusEl.className = 'concept-explorer__status error';
      return;
    }

    statusEl.textContent = `${passages.length} passage${passages.length > 1 ? 's' : ''} found`;
    statusEl.className = 'concept-explorer__status done';

    resultsEl.innerHTML = passages.map((p, i) => `
      <div class="concept-result" data-index="${i}">
        <div class="concept-result__passage">"${escapeHTML(p.passage.slice(0, 200))}${p.passage.length > 200 ? '…' : ''}"</div>
        <div class="concept-result__explanation">${escapeHTML(p.explanation)}</div>
        <div class="concept-result__section">${escapeHTML(p.section)}</div>
        <div class="concept-result__actions">
          <button class="concept-result__btn concept-apply" data-index="${i}">⊕ Highlight</button>
          <button class="concept-result__btn concept-apply-all" data-index="${i}" style="display:${i === 0 ? 'inline-block' : 'none'}">⊕ Highlight all</button>
        </div>
      </div>
    `).join('');

    // Show "highlight all" only on the first result
    if (passages.length > 1) {
      resultsEl.querySelector('.concept-apply-all').style.display = 'inline-block';
    }

    // Individual highlight
    resultsEl.querySelectorAll('.concept-apply').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index);
        applyConceptHighlight(concept, passages[idx]);
        btn.textContent = '✓ Applied';
        btn.classList.add('concept-result__btn--applied');
        btn.disabled = true;
      });
    });

    // Highlight all
    resultsEl.querySelectorAll('.concept-apply-all').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        passages.forEach(p => applyConceptHighlight(concept, p));
        // Mark all as applied
        resultsEl.querySelectorAll('.concept-apply').forEach(b => {
          b.textContent = '✓ Applied';
          b.classList.add('concept-result__btn--applied');
          b.disabled = true;
        });
        btn.textContent = '✓ All applied';
        btn.classList.add('concept-result__btn--applied');
        btn.disabled = true;
        notify(`${passages.length} passages highlighted for "${concept}"`, 'success');
      });
    });

    // Click result → scroll to passage in text
    resultsEl.querySelectorAll('.concept-result').forEach((el, i) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.concept-result__btn')) return;
        scrollToPassage(passages[i].passage);
      });
    });

  } catch (err) {
    goBtn.classList.remove('loading');
    statusEl.textContent = 'Exploration failed';
    statusEl.className = 'concept-explorer__status error';
  }
}

// ─── PER-SECTION CONCEPT ANALYSIS ───
async function analyzeSection(sectionId) {
  const container = document.getElementById(`concepts-${sectionId}`);
  const btn = document.querySelector(`.section-analyze-btn[data-section-id="${sectionId}"]`);
  if (!container) return;

  // Toggle off if already showing
  if (container.classList.contains('active')) {
    container.classList.remove('active');
    container.innerHTML = '';
    if (btn) { btn.textContent = '◉ analyze'; btn.classList.remove('active'); }
    return;
  }

  if (btn) { btn.textContent = '⟳ analyzing…'; btn.classList.add('loading'); }
  container.innerHTML = '<div class="section-concepts__loading">Extracting concepts…</div>';
  container.classList.add('active');

  try {
    const res = await fetch(`/api/papers/${encodeURIComponent(paperData.id)}/sections/${encodeURIComponent(sectionId)}/concepts`);
    const data = await res.json();
    const concepts = data.concepts || [];

    if (concepts.length === 0) {
      container.innerHTML = '<div class="section-concepts__empty">No concepts found</div>';
      if (btn) { btn.textContent = '◉ analyze'; btn.classList.remove('loading'); }
      return;
    }

    if (btn) { btn.textContent = '◉ analyzed'; btn.classList.remove('loading'); btn.classList.add('active'); }

    container.innerHTML = `
      <div class="section-concepts__list">
        ${concepts.map(c => `
          <button class="section-concept-tag" title="${escapeHTML(c.description)}" data-concept="${escapeHTML(c.concept)}">
            ${escapeHTML(c.concept)}
          </button>
        `).join('')}
      </div>
    `;

    // Click a section concept → explore it (fills the sidebar concept explorer and triggers explore)
    container.querySelectorAll('.section-concept-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        const concept = tag.dataset.concept;
        document.getElementById('concept-input').value = concept;
        exploreConcept(concept);
        // Scroll sidebar into view
        document.getElementById('concept-explorer').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  } catch (err) {
    container.innerHTML = '<div class="section-concepts__empty">Analysis failed</div>';
    if (btn) { btn.textContent = '◉ analyze'; btn.classList.remove('loading'); }
  }
}

function applyConceptHighlight(concept, passage) {
  // Check if already annotated
  if (annotations.find(a => a.text === passage.passage && a.concept === concept)) return;

  const annotation = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text: passage.passage.replace(/\s+/g, ' ').trim(),
    color: 'concept',
    type: 'concept',
    concept: concept,
    explanation: passage.explanation,
    comment: concept,
    userComment: '',
    timestamp: new Date().toISOString(),
  };

  annotations.push(annotation);
  saveAnnotations();
  applyHighlights();
  renderAnnotationList();
}

function scrollToPassage(text) {
  // Find the text in the DOM
  const bodyEls = document.querySelectorAll('.reader-section__body');
  for (const bodyEl of bodyEls) {
    // Check if this section contains the text
    if (!bodyEl.textContent.includes(text.slice(0, 50))) continue;

    // Check for existing highlight
    const existing = bodyEl.querySelector(`.scan-highlight`);
    if (existing && existing.textContent.includes(text.slice(0, 30))) {
      existing.scrollIntoView({ behavior: 'smooth', block: 'center' });
      existing.style.outline = '2px solid var(--cognition)';
      setTimeout(() => { existing.style.outline = ''; }, 2000);
      return;
    }

    // Find the paragraph containing this text
    const paras = bodyEl.querySelectorAll('p');
    for (const p of paras) {
      if (p.textContent.includes(text.slice(0, 50))) {
        p.scrollIntoView({ behavior: 'smooth', block: 'center' });
        p.style.outline = '1px solid var(--cognition)';
        p.style.outlineOffset = '4px';
        setTimeout(() => { p.style.outline = ''; p.style.outlineOffset = ''; }, 2000);
        return;
      }
    }
  }
}

// ─── CONNECTED PAPERS ───
function setupConnectedPapers(edges) {
  const container = document.getElementById('reader-connected');
  const connected = [];

  edges.forEach(e => {
    const sourceId = typeof e.source === 'object' ? e.source.id : e.source;
    const targetId = typeof e.target === 'object' ? e.target.id : e.target;

    if (sourceId === paperData.id || targetId === paperData.id) {
      const otherId = sourceId === paperData.id ? targetId : sourceId;
      connected.push({ id: otherId, weight: e.weight });
    }
  });

  connected.sort((a, b) => b.weight - a.weight);

  if (connected.length === 0) {
    container.innerHTML = '<div class="reader-sidebar__empty">No connections found</div>';
    return;
  }

  // Fetch paper titles
  fetch('/api/papers').then(r => r.json()).then(data => {
    const paperMap = {};
    data.papers.forEach(p => { paperMap[p.id] = p; });

    container.innerHTML = connected.slice(0, 12).map(c => {
      const p = paperMap[c.id];
      if (!p) return '';
      return `
        <a href="/reader.html?id=${encodeURIComponent(c.id)}" class="connected-paper" style="text-decoration:none;color:inherit">
          <div class="connected-paper__dot" style="background:${DOMAIN_COLORS[p.domains[0]] || '#888'}"></div>
          <span class="connected-paper__title">${escapeHTML(p.title)}</span>
          <span class="connected-paper__weight">${c.weight.toFixed(1)}</span>
        </a>
      `;
    }).join('');
  });
}

// ─── VAULT SAVE ───
async function saveToVault() {
  try {
    const res = await fetch('/api/vault/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paper: paperData,
        annotations: annotations,
        notes: Store.getNote(paperData.id) || '',
      }),
    });
    const data = await res.json();
    if (data.success) {
      notify(`Saved to vault: ${data.filename}`, 'success');
    } else {
      notify('Vault save failed: ' + (data.error || 'Unknown error'), 'warning');
    }
  } catch (err) {
    notify('Vault save failed', 'warning');
  }
}

// ─── PERSISTENCE ───
function getAnnotationKey() {
  return `scan_annotations_${paperData.id}`;
}

function loadAnnotations() {
  const saved = localStorage.getItem(getAnnotationKey());
  if (saved) {
    try { annotations = JSON.parse(saved); } catch (e) { annotations = []; }
  }
}

function saveAnnotations() {
  localStorage.setItem(getAnnotationKey(), JSON.stringify(annotations));
}

// ─── NOTIFICATIONS ───
function notify(message, type = 'info') {
  const el = document.getElementById('notification');
  el.textContent = message;
  el.className = `notification notification--${type} show`;
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ─── BOOT ───
document.addEventListener('DOMContentLoaded', initReader);
