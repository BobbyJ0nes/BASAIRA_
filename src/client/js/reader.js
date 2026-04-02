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
        ${paragraphs.map(para => `<p>${renderRichContent(para)}</p>`).join('')}
      </div>
    `;
    contentEl.appendChild(sectionEl);
  });

  // Apply existing highlights
  applyHighlights();

  // Render LaTeX math elements
  renderMathElements();

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

  // Click elsewhere hides popup (but not during active selection/annotation)
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('.highlight-popup') || e.target.closest('.annotation-input')) return;
    if (e.target.closest('.scan-highlight--pending')) return; // Don't clear during pending highlight
    popup.classList.remove('visible');
    // Only hide annotation input if clicking outside it AND outside pending highlight
    if (!pendingHighlight) {
      annotInput.classList.remove('visible');
    }
  });

  // Color pick → immediately highlight, then show comment input
  popup.querySelectorAll('.highlight-popup__color').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const color = btn.dataset.color;
      popup.classList.remove('visible');

      if (!pendingHighlight) return;
      pendingHighlight.color = color;

      // Immediately wrap the selected text in a colored span (preview highlight)
      try {
        const range = pendingHighlight.range;
        // Use extractContents + wrap to handle cross-element selections
        const fragment = range.extractContents();
        const previewSpan = document.createElement('span');
        previewSpan.className = 'scan-highlight scan-highlight--pending';
        previewSpan.dataset.color = color;
        previewSpan.appendChild(fragment);
        range.insertNode(previewSpan);
        pendingHighlight.previewSpan = previewSpan;
      } catch (err) {
        console.log('Preview highlight failed:', err.message);
      }

      window.getSelection().removeAllRanges();

      // Show comment input near the highlighted text
      const target = pendingHighlight.previewSpan || { getBoundingClientRect: () => pendingHighlight.range.getBoundingClientRect() };
      const rect = target.getBoundingClientRect();

      annotInput.style.left = Math.max(20, rect.left) + 'px';
      annotInput.style.top = (rect.bottom + 8) + 'px';
      annotInput.classList.add('visible');
      document.getElementById('annotation-comment').value = '';
      document.getElementById('annotation-comment').focus();
    });
  });

  // Save annotation
  document.getElementById('annotation-save').addEventListener('click', () => {
    if (!pendingHighlight) return;
    const comment = document.getElementById('annotation-comment').value.trim();

    // Remove the temporary preview span (applyHighlights will re-create it properly)
    if (pendingHighlight.previewSpan) {
      const text = pendingHighlight.previewSpan.textContent;
      pendingHighlight.previewSpan.replaceWith(document.createTextNode(text));
    }

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

  // Cancel annotation — also remove preview span
  document.getElementById('annotation-cancel').addEventListener('click', () => {
    if (pendingHighlight?.previewSpan) {
      const text = pendingHighlight.previewSpan.textContent;
      pendingHighlight.previewSpan.replaceWith(document.createTextNode(text));
    }
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
  const bodyEls = document.querySelectorAll('.reader-section__body');

  // STEP 1: Strip ALL existing highlights back to plain text (prevents doubles)
  bodyEls.forEach(bodyEl => {
    bodyEl.querySelectorAll('.scan-highlight').forEach(hl => {
      // Get just the text content (strip the preview span inside)
      const textOnly = hl.childNodes[0]?.nodeType === 3 ? hl.childNodes[0].textContent : hl.textContent.split('\n')[0];
      const textNode = document.createTextNode(hl.textContent.replace(/\n.*$/s, ''));
      // Actually, just grab text before the preview span
      let raw = '';
      for (const child of hl.childNodes) {
        if (child.nodeType === 3) raw += child.textContent;
        else if (!child.classList?.contains('highlight-preview')) raw += child.textContent;
        else break;
      }
      hl.replaceWith(document.createTextNode(raw));
    });
    // Merge adjacent text nodes
    bodyEl.normalize();
  });

  if (!annotations.length) return;

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

  // Single-pass: walk text nodes only (no innerHTML regex — prevents broken nesting)
  bodyEls.forEach(bodyEl => {
    sorted.forEach(ann => {
      const annNorm = ann.text.replace(/\s+/g, ' ').trim();
      let found = false;

      // Strategy: walk all text nodes, try exact match, then normalized match
      const tryMatch = () => {
        const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walker.nextNode())) {
          if (node.parentElement.closest('.scan-highlight')) continue;

          const nodeText = node.textContent;
          const nodeNorm = nodeText.replace(/\s+/g, ' ');

          // Try exact match first, then normalized
          let idx = nodeText.indexOf(ann.text);
          let matchText = ann.text;

          if (idx === -1) {
            idx = nodeNorm.indexOf(annNorm);
            matchText = annNorm;
          }

          // Try prefix match (first 50 chars)
          if (idx === -1 && annNorm.length > 50) {
            const prefix = annNorm.slice(0, 50);
            idx = nodeNorm.indexOf(prefix);
            if (idx !== -1) {
              // Extend to full match length or sentence end
              const available = nodeNorm.slice(idx);
              if (available.length >= annNorm.length) {
                matchText = nodeText.slice(idx, idx + ann.text.length);
              } else {
                idx = -1; // Not enough text in this node
              }
            }
          }

          if (idx === -1) continue;

          const before = nodeText.slice(0, idx);
          const matched = nodeText.slice(idx, idx + matchText.length);
          const after = nodeText.slice(idx + matchText.length);

          const previewHTML = buildPreviewHTML(ann);
          const span = document.createElement('span');
          span.className = 'scan-highlight';
          span.dataset.color = ann.color;
          span.dataset.annotationId = ann.id;
          span.innerHTML = escapeHTML(matched) + previewHTML;

          const parent = node.parentNode;
          if (before) parent.insertBefore(document.createTextNode(before), node);
          parent.insertBefore(span, node);
          if (after) parent.insertBefore(document.createTextNode(after), node);
          parent.removeChild(node);

          return true;
        }
        return false;
      };

      found = tryMatch();

      if (!found) {
        // Normalize the body text nodes (merge fragments) and retry once
        bodyEl.normalize();
        found = tryMatch();
      }
    });
  });

  // Re-render math after highlight DOM changes
  renderMathElements();
}

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Convert scan-math and scan-figure placeholders to renderable HTML
function renderRichContent(text) {
  let html = text;

  // Escape normal text but preserve our scan-* elements
  // First handle scan-figure (which contains nested scan-caption)
  // Then handle scan-math (self-closing style)
  const figPlaceholders = [];
  html = html.replace(/<scan-figure\s+src="([^"]*)">([\s\S]*?)<\/scan-figure>/g, (match) => {
    const idx = figPlaceholders.length;
    figPlaceholders.push(match);
    return `%%SCANFIG${idx}%%`;
  });

  const mathPlaceholders = [];
  html = html.replace(/<scan-math[^>]*><\/scan-math>/g, (match) => {
    const idx = mathPlaceholders.length;
    mathPlaceholders.push(match);
    return `%%SCANMATH${idx}%%`;
  });

  // Now escape everything (our placeholders are safe %% strings)
  html = escapeHTML(html);

  // Restore placeholders
  figPlaceholders.forEach((fig, i) => {
    html = html.replace(`%%SCANFIG${i}%%`, fig);
  });
  mathPlaceholders.forEach((math, i) => {
    html = html.replace(`%%SCANMATH${i}%%`, math);
  });

  // Convert <scan-math> to KaTeX-renderable spans
  // Display math
  html = html.replace(/<scan-math display="block" latex="([^"]*)">\s*<\/scan-math>/g, (_, latex) => {
    const decoded = latex.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    return `<span class="scan-math scan-math--block" data-latex="${latex}">${escapeHTML(decoded)}</span>`;
  });

  // Inline math
  html = html.replace(/<scan-math latex="([^"]*)">\s*<\/scan-math>/g, (_, latex) => {
    const decoded = latex.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    return `<span class="scan-math scan-math--inline" data-latex="${latex}">${escapeHTML(decoded)}</span>`;
  });

  // Convert <scan-figure> to img elements (handle both self-contained and with caption)
  html = html.replace(/<scan-figure\s+src="([^"]*)">([\s\S]*?)<\/scan-figure>/g, (_, src, inner) => {
    const captionMatch = inner.match(/<scan-caption>([\s\S]*?)<\/scan-caption>/);
    const caption = captionMatch ? captionMatch[1] : '';
    return `<figure class="scan-figure">
      <img src="${src}" alt="${caption.slice(0, 100)}" loading="lazy" />
      ${caption ? `<figcaption class="scan-figure__caption">${caption}</figcaption>` : ''}
    </figure>`;
  });

  // Also handle any remaining raw <scan-figure> in the DOM (fallback)
  html = html.replace(/&lt;scan-figure\s+src=&quot;([^&]*)&quot;&gt;([\s\S]*?)&lt;\/scan-figure&gt;/g, (_, src, inner) => {
    const captionMatch = inner.match(/&lt;scan-caption&gt;([\s\S]*?)&lt;\/scan-caption&gt;/);
    const caption = captionMatch ? captionMatch[1] : '';
    return `<figure class="scan-figure">
      <img src="${src}" alt="${caption.slice(0, 100)}" loading="lazy" />
      ${caption ? `<figcaption class="scan-figure__caption">${caption}</figcaption>` : ''}
    </figure>`;
  });

  return html;
}

// Render all KaTeX math elements in the document (call after DOM is built)
function renderMathElements() {
  if (typeof katex === 'undefined') {
    // KaTeX not loaded yet — retry after a short delay
    setTimeout(renderMathElements, 200);
    return;
  }

  document.querySelectorAll('.scan-math').forEach(el => {
    const latex = el.dataset.latex
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    const isBlock = el.classList.contains('scan-math--block');

    try {
      katex.render(latex, el, {
        displayMode: isBlock,
        throwOnError: false,
        strict: false,
        trust: true,
        output: 'html',
      });
    } catch (err) {
      // Leave the raw LaTeX text as fallback
      el.title = `LaTeX: ${latex}`;
      el.classList.add('scan-math--error');
    }
  });
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
      if (e.target.closest('.annotation-item__add-comment')) return;
      if (e.target.closest('textarea') || e.target.closest('button')) return;
      const id = el.dataset.id;
      const highlight = document.querySelector(`.scan-highlight[data-annotation-id="${id}"]`);
      if (highlight) {
        const scrollContainer = document.querySelector('.reader-body') || document.documentElement;
        const headerH = 52;
        const top = highlight.getBoundingClientRect().top + scrollContainer.scrollTop - headerH - (window.innerHeight / 3);
        scrollContainer.scrollTo({ top, behavior: 'smooth' });
        // Flash highlight
        highlight.style.outline = '2px solid #fff';
        highlight.classList.add('pinned');
        setTimeout(() => { highlight.style.outline = ''; }, 3000);
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

    // Click result → scroll to passage and keep it pinned
    resultsEl.querySelectorAll('.concept-result').forEach((el, i) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.concept-result__btn')) return;
        // Mark active result
        resultsEl.querySelectorAll('.concept-result').forEach(r => r.classList.remove('concept-result--active'));
        el.classList.add('concept-result--active');
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

let pinnedPassageEl = null; // Track currently pinned passage element

function scrollToPassage(text) {
  const textNorm = text.replace(/\s+/g, ' ').trim();
  const prefix = textNorm.slice(0, 50);

  // Unpin previous
  if (pinnedPassageEl) {
    pinnedPassageEl.style.outline = '';
    pinnedPassageEl.style.outlineOffset = '';
    pinnedPassageEl.classList.remove('pinned');
    pinnedPassageEl = null;
  }

  // First: check if there's a saved highlight for this text
  const allHighlights = document.querySelectorAll('.scan-highlight');
  for (const hl of allHighlights) {
    const hlText = hl.textContent.replace(/\s+/g, ' ').trim();
    if (hlText.includes(prefix) || textNorm.includes(hlText.slice(0, 50))) {
      const scrollContainer = document.querySelector('.reader-body') || document.documentElement;
      const top = hl.getBoundingClientRect().top + scrollContainer.scrollTop - 52 - (window.innerHeight / 3);
      scrollContainer.scrollTo({ top, behavior: 'smooth' });
      hl.classList.add('pinned');
      hl.style.outline = '2px solid var(--cognition)';
      hl.style.outlineOffset = '2px';
      pinnedPassageEl = hl;
      return;
    }
  }

  // Fallback: find the paragraph containing this text and outline it
  const bodyEls = document.querySelectorAll('.reader-section__body');
  for (const bodyEl of bodyEls) {
    const bodyText = bodyEl.textContent.replace(/\s+/g, ' ');
    if (!bodyText.includes(prefix)) continue;

    const paras = bodyEl.querySelectorAll('p');
    for (const p of paras) {
      const pText = p.textContent.replace(/\s+/g, ' ');
      if (pText.includes(prefix)) {
        const scrollContainer = document.querySelector('.reader-body') || document.documentElement;
        const top = p.getBoundingClientRect().top + scrollContainer.scrollTop - 52 - (window.innerHeight / 3);
        scrollContainer.scrollTo({ top, behavior: 'smooth' });
        p.style.outline = '2px solid var(--cognition)';
        p.style.outlineOffset = '4px';
        pinnedPassageEl = p;
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
