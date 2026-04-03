// ═══════════════════════════════════════════════════════════
// BASIRA_ Graph Engine — D3.js Force-Directed Knowledge Graph
// ═══════════════════════════════════════════════════════════
//
// Renders all papers as an interactive force-directed graph.
//
// Nodes: Colored circles — domain color, white for overlap,
//        r=4 for single-domain, r=6 for multi-domain.
//
// Edges: Lines between papers sharing keywords/authors/categories.
//        Width & opacity proportional to edge weight.
//
// Interactions:
//   Hover  → tooltip, dim unrelated, highlight neighbors
//   Click  → fire 'scan:paper-select' event, apply .selected
//   Drag   → reposition node in force layout
//   Zoom   → d3.zoom, scale 0.1×–6×
//
// Filtering:
//   filterByDomains([])  — show/hide by domain membership
//   filterByTag(tag)     — show/hide by keyword
//   filterBySearch(q)    — show/hide by substring
//   zoomToFit()          — animate zoom to encompass all nodes
//
// ═══════════════════════════════════════════════════════════
const DOMAIN_COLORS = {
  neuroscience: '#00f0ff',
  ai: '#ff00aa',
  cybernetics: '#ffaa00',
  cognition: '#00ff88',
  biomimetics: '#aa44ff',
};

const GraphEngine = {
  svg: null,
  simulation: null,
  nodes: [],
  links: [],
  nodeElements: null,
  linkElements: null,
  zoom: null,
  container: null,
  width: 0,
  height: 0,
  selectedId: null,

  init(containerSelector) {
    const containerEl = document.querySelector(containerSelector);
    this.width = containerEl.clientWidth;
    this.height = containerEl.clientHeight;

    this.svg = d3.select(containerSelector)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', [0, 0, this.width, this.height]);

    // Defs for glow filter
    const defs = this.svg.append('defs');

    const filter = defs.append('filter')
      .attr('id', 'glow')
      .attr('x', '-50%').attr('y', '-50%')
      .attr('width', '200%').attr('height', '200%');

    filter.append('feGaussianBlur')
      .attr('stdDeviation', '3')
      .attr('result', 'coloredBlur');

    const feMerge = filter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Zoom
    this.zoom = d3.zoom()
      .scaleExtent([0.1, 6])
      .on('zoom', (event) => {
        this.container.attr('transform', event.transform);
      });

    this.svg.call(this.zoom);

    this.container = this.svg.append('g').attr('class', 'graph-world');

    // Link group (behind nodes)
    this.container.append('g').attr('class', 'links-group');
    // Node group
    this.container.append('g').attr('class', 'nodes-group');
  },

  setData(papers, edges) {
    // Build node data
    this.nodes = papers.map(p => ({
      id: p.id,
      title: p.title,
      domains: p.domains,
      tags: p.tags,
      authors: p.authors,
      isOverlap: p.isOverlap,
      r: p.isOverlap ? 6 : 4, // Overlap nodes larger
    }));

    const nodeIds = new Set(this.nodes.map(n => n.id));

    this.links = edges
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map(e => ({
        source: e.source,
        target: e.target,
        weight: e.weight,
        sharedTags: e.sharedTags,
      }));

    this.render();
  },

  render() {
    const linksGroup = this.container.select('.links-group');
    const nodesGroup = this.container.select('.nodes-group');

    // Clear existing
    linksGroup.selectAll('*').remove();
    nodesGroup.selectAll('*').remove();

    // Links
    this.linkElements = linksGroup.selectAll('line')
      .data(this.links)
      .join('line')
      .attr('class', 'graph-link')
      .attr('stroke', 'rgba(255, 255, 255, 0.12)')
      .attr('stroke-width', d => Math.max(0.4, d.weight * 0.25))
      .attr('stroke-opacity', d => Math.min(0.35, 0.05 + d.weight * 0.05));

    // Nodes
    const nodeGroups = nodesGroup.selectAll('g')
      .data(this.nodes)
      .join('g')
      .attr('class', 'node-group')
      .call(d3.drag()
        .on('start', (event, d) => this._dragStart(event, d))
        .on('drag', (event, d) => this._drag(event, d))
        .on('end', (event, d) => this._dragEnd(event, d))
      );

    // Node circles
    nodeGroups.append('circle')
      .attr('class', 'node-circle')
      .attr('r', d => d.r)
      .attr('fill', d => this._nodeColor(d))
      .attr('stroke', d => this._nodeColor(d))
      .attr('stroke-opacity', 0.6)
      .attr('fill-opacity', 0.7);

    // Node labels (hidden by default, shown on hover via CSS)
    nodeGroups.append('text')
      .attr('class', 'node-label')
      .attr('dy', d => -(d.r + 6))
      .text(d => d.title.length > 40 ? d.title.substring(0, 40) + '…' : d.title);

    this.nodeElements = nodeGroups;

    // Events
    nodeGroups
      .on('mouseover', (event, d) => this._onHover(event, d))
      .on('mouseout', () => this._onHoverEnd())
      .on('click', (event, d) => this._onClick(event, d));

    // Simulation
    this.simulation = d3.forceSimulation(this.nodes)
      .force('link', d3.forceLink(this.links).id(d => d.id).distance(d => Math.max(30, 120 - d.weight * 8)).strength(d => Math.min(0.3, d.weight * 0.03)))
      .force('charge', d3.forceManyBody().strength(-25).distanceMax(300))
      .force('center', d3.forceCenter(this.width / 2, this.height / 2).strength(0.05))
      .force('collision', d3.forceCollide().radius(d => d.r + 2))
      .force('x', d3.forceX(this.width / 2).strength(0.02))
      .force('y', d3.forceY(this.height / 2).strength(0.02))
      .alpha(0.8)
      .alphaDecay(0.015)
      .on('tick', () => this._tick());
  },

  _tick() {
    if (this.linkElements) {
      this.linkElements
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);
    }

    if (this.nodeElements) {
      this.nodeElements.attr('transform', d => `translate(${d.x},${d.y})`);
    }
  },

  _nodeColor(d) {
    if (d.isOverlap) return '#ffffff';
    const primary = d.domains[0];
    return DOMAIN_COLORS[primary] || '#888888';
  },

  _dragStart(event, d) {
    if (!event.active) this.simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  },

  _drag(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  },

  _dragEnd(event, d) {
    if (!event.active) this.simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  },

  _onHover(event, d) {
    const tooltip = document.getElementById('tooltip');
    const title = document.getElementById('tooltip-title');
    const meta = document.getElementById('tooltip-meta');

    title.textContent = d.title;
    meta.textContent = `${d.domains.join(', ')} · ${d.authors ? d.authors.length : 0} authors`;

    tooltip.classList.add('visible');
    tooltip.style.left = (event.pageX - document.querySelector('.main').getBoundingClientRect().left + 12) + 'px';
    tooltip.style.top = (event.pageY - document.querySelector('.main').getBoundingClientRect().top - 10) + 'px';

    // Highlight connected
    const connectedIds = new Set();
    connectedIds.add(d.id);
    this.links.forEach(l => {
      const sid = typeof l.source === 'object' ? l.source.id : l.source;
      const tid = typeof l.target === 'object' ? l.target.id : l.target;
      if (sid === d.id) connectedIds.add(tid);
      if (tid === d.id) connectedIds.add(sid);
    });

    this.nodeElements.classed('dimmed', n => !connectedIds.has(n.id));
    this.nodeElements.classed('highlighted', n => connectedIds.has(n.id) && n.id !== d.id);
    this.linkElements.classed('dimmed', l => {
      const sid = typeof l.source === 'object' ? l.source.id : l.source;
      const tid = typeof l.target === 'object' ? l.target.id : l.target;
      return sid !== d.id && tid !== d.id;
    });
  },

  _onHoverEnd() {
    document.getElementById('tooltip').classList.remove('visible');
    if (this.nodeElements) {
      this.nodeElements.classed('dimmed', false).classed('highlighted', false);
    }
    if (this.linkElements) {
      this.linkElements.classed('dimmed', false);
    }
  },

  _onClick(event, d) {
    this.selectedId = d.id;
    this.nodeElements.classed('selected', n => n.id === d.id);

    // Fire custom event
    window.dispatchEvent(new CustomEvent('scan:paper-select', { detail: { id: d.id } }));
  },

  filterByDomains(domains) {
    if (!this.nodeElements) return;
    if (domains.length === 0) {
      this.nodeElements.style('display', null);
      this.linkElements.style('display', null);
      return;
    }

    const visibleIds = new Set();
    this.nodeElements.each(function(d) {
      const visible = d.domains.some(dom => domains.includes(dom));
      d3.select(this).style('display', visible ? null : 'none');
      if (visible) visibleIds.add(d.id);
    });

    this.linkElements.each(function(d) {
      const sid = typeof d.source === 'object' ? d.source.id : d.source;
      const tid = typeof d.target === 'object' ? d.target.id : d.target;
      d3.select(this).style('display', visibleIds.has(sid) && visibleIds.has(tid) ? null : 'none');
    });
  },

  filterByTag(tag) {
    if (!this.nodeElements) return;
    if (!tag) {
      this.nodeElements.style('display', null);
      this.linkElements.style('display', null);
      return;
    }

    const visibleIds = new Set();
    this.nodeElements.each(function(d) {
      const visible = d.tags.includes(tag);
      d3.select(this).style('display', visible ? null : 'none');
      if (visible) visibleIds.add(d.id);
    });

    this.linkElements.each(function(d) {
      const sid = typeof d.source === 'object' ? d.source.id : d.source;
      const tid = typeof d.target === 'object' ? d.target.id : d.target;
      d3.select(this).style('display', visibleIds.has(sid) && visibleIds.has(tid) ? null : 'none');
    });
  },

  filterByIds(idSet) {
    if (!this.nodeElements) return;
    if (!idSet || idSet.size === 0) {
      this.nodeElements.style('display', null);
      this.linkElements.style('display', null);
      return;
    }

    this.nodeElements.each(function(d) {
      d3.select(this).style('display', idSet.has(d.id) ? null : 'none');
    });

    this.linkElements.each(function(d) {
      const sid = typeof d.source === 'object' ? d.source.id : d.source;
      const tid = typeof d.target === 'object' ? d.target.id : d.target;
      d3.select(this).style('display', idSet.has(sid) && idSet.has(tid) ? null : 'none');
    });
  },

  // Combined filter: domains + tag + search all at once
  filterByAll(domains, tag, search) {
    if (!this.nodeElements) return;
    const hasDomains = domains && domains.length > 0;
    const hasTag = !!tag;
    const hasSearch = !!search;
    const q = search ? search.toLowerCase() : '';

    if (!hasDomains && !hasTag && !hasSearch) {
      // Show all, reset any overlap highlights
      this.nodeElements.style('display', null).select('circle').attr('stroke', null).attr('stroke-width', null);
      this.linkElements.style('display', null);
      return;
    }

    const visibleIds = new Set();
    this.nodeElements.each(function(d) {
      let visible = true;
      if (hasDomains) visible = visible && d.domains.some(dom => domains.includes(dom));
      if (hasTag) visible = visible && d.tags.includes(tag);
      if (hasSearch) visible = visible && (
        d.title.toLowerCase().includes(q) ||
        d.tags.some(t => t.includes(q)) ||
        (d.authors && d.authors.some(a => a.toLowerCase().includes(q)))
      );
      d3.select(this).style('display', visible ? null : 'none');
      if (visible) visibleIds.add(d.id);

      // Highlight overlap: if multiple domains active, ring papers that belong to 2+ active domains
      if (hasDomains && domains.length > 1 && visible) {
        const overlapCount = d.domains.filter(dom => domains.includes(dom)).length;
        if (overlapCount > 1) {
          d3.select(this).select('circle')
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 2.5);
        } else {
          d3.select(this).select('circle')
            .attr('stroke', null)
            .attr('stroke-width', null);
        }
      } else {
        d3.select(this).select('circle')
          .attr('stroke', null)
          .attr('stroke-width', null);
      }
    });

    this.linkElements.each(function(d) {
      const sid = typeof d.source === 'object' ? d.source.id : d.source;
      const tid = typeof d.target === 'object' ? d.target.id : d.target;
      d3.select(this).style('display', visibleIds.has(sid) && visibleIds.has(tid) ? null : 'none');
    });
  },

  filterBySearch(query) {
    if (!this.nodeElements) return;
    if (!query) {
      this.nodeElements.style('display', null);
      this.linkElements.style('display', null);
      return;
    }

    const q = query.toLowerCase();
    const visibleIds = new Set();
    this.nodeElements.each(function(d) {
      const visible = d.title.toLowerCase().includes(q) ||
        d.tags.some(t => t.includes(q)) ||
        (d.authors && d.authors.some(a => a.toLowerCase().includes(q)));
      d3.select(this).style('display', visible ? null : 'none');
      if (visible) visibleIds.add(d.id);
    });

    this.linkElements.each(function(d) {
      const sid = typeof d.source === 'object' ? d.source.id : d.source;
      const tid = typeof d.target === 'object' ? d.target.id : d.target;
      d3.select(this).style('display', visibleIds.has(sid) && visibleIds.has(tid) ? null : 'none');
    });
  },

  zoomToFit() {
    if (!this.nodes.length) return;
    const bounds = this._getBounds();
    const dx = bounds.maxX - bounds.minX;
    const dy = bounds.maxY - bounds.minY;
    const x = (bounds.minX + bounds.maxX) / 2;
    const y = (bounds.minY + bounds.maxY) / 2;
    const scale = 0.85 / Math.max(dx / this.width, dy / this.height);
    const translate = [this.width / 2 - scale * x, this.height / 2 - scale * y];

    this.svg.transition().duration(750).call(
      this.zoom.transform,
      d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
    );
  },

  _getBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    this.nodes.forEach(n => {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    });
    return { minX, minY, maxX, maxY };
  },

  // ═══════════════════════════════════════════════════════
  // CONCEPT GRAPH MODE
  // ═══════════════════════════════════════════════════════

  graphMode: 'papers', // 'papers' or 'concepts'

  setConceptData(conceptData) {
    this.graphMode = 'concepts';

    this.nodes = conceptData.nodes.map(n => ({
      id: n.id,
      label: n.label,
      type: 'concept',
      paperCount: n.paperCount,
      papers: n.papers,
      primaryDomain: n.primaryDomain,
      domains: n.domains,
      isMultiDomain: n.isMultiDomain,
      r: Math.max(4, Math.min(12, 3 + n.paperCount * 0.5)),
    }));

    const nodeIds = new Set(this.nodes.map(n => n.id));
    this.links = conceptData.edges
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map(e => ({ source: e.source, target: e.target, weight: e.weight, sharedPapers: e.sharedPapers }));

    this._renderConceptGraph();
  },

  _renderConceptGraph() {
    const linksGroup = this.container.select('.links-group');
    const nodesGroup = this.container.select('.nodes-group');

    linksGroup.selectAll('*').remove();
    nodesGroup.selectAll('*').remove();

    // Links — thicker for concept connections
    this.linkElements = linksGroup.selectAll('line')
      .data(this.links)
      .join('line')
      .attr('class', 'graph-link')
      .attr('stroke', 'rgba(255, 255, 255, 0.08)')
      .attr('stroke-width', d => Math.max(0.5, d.weight * 0.6))
      .attr('stroke-opacity', d => Math.min(0.4, 0.05 + d.weight * 0.06));

    // Node groups
    const nodeGroups = nodesGroup.selectAll('g')
      .data(this.nodes)
      .join('g')
      .attr('class', 'node-group concept-node')
      .call(d3.drag()
        .on('start', (event, d) => this._dragStart(event, d))
        .on('drag', (event, d) => this._drag(event, d))
        .on('end', (event, d) => this._dragEnd(event, d))
      );

    // Main circle — clean, same style as paper nodes
    nodeGroups.append('circle')
      .attr('class', 'node-circle')
      .attr('r', d => d.r)
      .attr('fill', d => DOMAIN_COLORS[d.primaryDomain] || '#888')
      .attr('stroke', d => DOMAIN_COLORS[d.primaryDomain] || '#888')
      .attr('stroke-opacity', 0.6)
      .attr('fill-opacity', 0.7);

    // Concept label — subtle, neutral colour
    nodeGroups.append('text')
      .attr('class', 'concept-label')
      .attr('dy', d => d.r + 12)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(255,255,255,0.45)')
      .attr('font-size', '8px')
      .attr('font-family', 'var(--font-mono)')
      .attr('letter-spacing', '0.5px')
      .text(d => d.label);

    this.nodeElements = nodeGroups;

    // Events
    nodeGroups
      .on('mouseover', (event, d) => this._onConceptHover(event, d))
      .on('mouseout', () => this._onHoverEnd())
      .on('click', (event, d) => this._onConceptClick(event, d));

    // Simulation — more spread out for concept graph
    this.simulation = d3.forceSimulation(this.nodes)
      .force('link', d3.forceLink(this.links).id(d => d.id).distance(120).strength(d => Math.min(0.2, d.weight * 0.03)))
      .force('charge', d3.forceManyBody().strength(-80).distanceMax(400))
      .force('center', d3.forceCenter(this.width / 2, this.height / 2).strength(0.03))
      .force('collision', d3.forceCollide().radius(d => d.r + 10))
      .force('x', d3.forceX(this.width / 2).strength(0.015))
      .force('y', d3.forceY(this.height / 2).strength(0.015))
      .alpha(0.8)
      .alphaDecay(0.012)
      .on('tick', () => this._tick());
  },

  _onConceptHover(event, d) {
    const tooltip = document.getElementById('tooltip');
    const title = document.getElementById('tooltip-title');
    const meta = document.getElementById('tooltip-meta');

    title.textContent = d.label;

    // Build rich paper list HTML
    const paperItems = d.papers.slice(0, 8).map(p => {
      const dots = (p.domains || []).map(dom =>
        `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${DOMAIN_COLORS[dom] || '#888'};margin-right:3px;"></span>`
      ).join('');
      const titleText = p.title.length > 55 ? p.title.slice(0, 55) + '…' : p.title;
      return `<div style="display:flex;align-items:flex-start;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="display:flex;align-items:center;gap:1px;flex-shrink:0;padding-top:3px;">${dots}</div>
        <span style="font-size:10px;color:rgba(255,255,255,0.7);line-height:1.35;">${titleText}</span>
      </div>`;
    }).join('');
    const extra = d.papers.length > 8 ? `<div style="font-size:9px;color:rgba(255,255,255,0.35);padding-top:4px;">+ ${d.papers.length - 8} more</div>` : '';

    meta.innerHTML = `<div style="font-size:10px;color:rgba(255,255,255,0.4);margin-bottom:6px;">${d.paperCount} papers · ${d.domains.join(', ')}</div>${paperItems}${extra}`;

    // Position tooltip
    const mainRect = document.querySelector('.main')?.getBoundingClientRect() || { left: 0, top: 0 };
    tooltip.classList.add('visible');
    tooltip.style.left = (event.pageX - mainRect.left + 14) + 'px';
    tooltip.style.top = (event.pageY - mainRect.top - 10) + 'px';

    // Highlight connected concepts
    const connectedIds = new Set();
    connectedIds.add(d.id);
    this.links.forEach(l => {
      const sid = typeof l.source === 'object' ? l.source.id : l.source;
      const tid = typeof l.target === 'object' ? l.target.id : l.target;
      if (sid === d.id) connectedIds.add(tid);
      if (tid === d.id) connectedIds.add(sid);
    });

    this.nodeElements.classed('dimmed', n => !connectedIds.has(n.id));
    this.nodeElements.classed('highlighted', n => connectedIds.has(n.id) && n.id !== d.id);
    this.linkElements.classed('dimmed', l => {
      const sid = typeof l.source === 'object' ? l.source.id : l.source;
      const tid = typeof l.target === 'object' ? l.target.id : l.target;
      return sid !== d.id && tid !== d.id;
    });
  },

  _onConceptClick(event, d) {
    this.selectedId = d.id;
    this.nodeElements.classed('selected', n => n.id === d.id);
    // Fire event with concept data (papers list)
    window.dispatchEvent(new CustomEvent('scan:concept-select', { detail: d }));
  },

  destroy() {
    if (this.simulation) this.simulation.stop();
    if (this.svg) this.svg.remove();
  }
};
