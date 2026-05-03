import type { MonographNode, MonographEdge } from '../types.js';

const MAX_NODES = 2000;

// 20-color dark-friendly community palette (vivid, readable on #0d0d1a)
const COMMUNITY_COLORS = [
  '#7B61FF','#00E5C8','#ef4444','#f59e0b','#22c55e',
  '#ec4899','#06b6d4','#f97316','#84cc16','#6366f1',
  '#14b8a6','#e11d48','#0ea5e9','#d97706','#10b981',
  '#9333ea','#db2777','#0891b2','#65a30d','#a78bfa',
];

const RELATION_COLORS: Record<string, string> = {
  IMPORTS:        '#3b82f6',
  CALLS:          '#8b5cf6',
  EXTENDS:        '#ef4444',
  IMPLEMENTS:     '#f97316',
  DEFINES:        '#22c55e',
  CONTAINS:       '#64748b',
  CO_OCCURS:      '#f59e0b',
  DESCRIBES:      '#14b8a6',
  CAUSES:         '#ec4899',
  PART_OF:        '#06b6d4',
  RELATED_TO:     '#475569',
  USES:           '#84cc16',
  CONTRASTS_WITH: '#e11d48',
  REF:            '#475569',
};

// Node shape by type
const TYPE_SHAPES: Record<string, string> = {
  File:      'dot',
  Function:  'diamond',
  Class:     'square',
  Interface: 'triangle',
  Method:    'diamond',
  Variable:  'dot',
  Module:    'hexagon',
  Section:   'dot',
  Concept:   'star',
};

export function toHtml(nodes: MonographNode[], edges: MonographEdge[]): string {
  // Sort by degree DESC, take top MAX_NODES
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.sourceId, (degree.get(e.sourceId) ?? 0) + 1);
    degree.set(e.targetId, (degree.get(e.targetId) ?? 0) + 1);
  }
  const sorted = [...nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));
  const slicedNodes = sorted.slice(0, MAX_NODES);
  const nodeIds = new Set(slicedNodes.map(n => n.id));

  // When community_id is null (not yet computed), assign a stable color by type
  const TYPE_PALETTE: Record<string, string> = {
    File: '#7B61FF', Function: '#00E5C8', Class: '#f59e0b', Interface: '#06b6d4',
    Method: '#00E5C8', Variable: '#64748b', Module: '#ec4899', Section: '#22c55e',
    Concept: '#84cc16',
  };

  const visNodes = slicedNodes.map(n => {
    const deg = degree.get(n.id) ?? 0;
    const hasCommunity = n.communityId !== null && n.communityId !== undefined;
    const color = hasCommunity
      ? COMMUNITY_COLORS[(n.communityId ?? 0) % COMMUNITY_COLORS.length]
      : (TYPE_PALETTE[n.label] ?? '#64748b');
    const importance = (n.properties as Record<string, unknown> | undefined)?.importance as number | undefined;
    // Log-scaled size so high-degree nodes stand out but don't dominate
    const size = importance
      ? 8 + importance * 5
      : Math.max(6, 6 + Math.log2(deg + 1) * 4);
    const shape = TYPE_SHAPES[n.label] ?? 'dot';
    const shortLabel = n.name.length > 20 ? n.name.slice(0, 18) + '…' : n.name;
    return {
      id: n.id,
      label: shortLabel,
      title: buildTooltip(n, deg),
      group: n.communityId ?? 0,
      color: {
        background: color,
        border: color,
        highlight: { background: '#ffffff', border: color },
        hover:      { background: lighten(color), border: '#ffffff' },
      },
      size,
      shape,
      font: {
        size: Math.max(9, 8 + Math.floor(Math.log2(deg + 1))),
        color: '#e2e8f0',
        face: 'Azeret Mono, monospace',
        strokeWidth: 2,
        strokeColor: '#0d0d1a',
      },
      shadow: deg > 4 ? { enabled: true, color: color + '66', size: Math.min(deg, 20), x: 0, y: 0 } : { enabled: false },
      _nodeType: n.label,
      _deg: deg,
      _filePath: n.filePath,
    };
  });

  const visEdges = edges
    .filter(e => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId))
    .map((e, i) => {
      const weight = (e as { weight?: number }).weight ?? 1;
      const color = RELATION_COLORS[e.relation] ?? RELATION_COLORS['REF'];
      return {
        id: `e${i}`,
        from: e.sourceId,
        to: e.targetId,
        title: e.relation + (weight > 1 ? ` (×${weight})` : ''),
        _label: e.relation,
        color: { color: color + 'aa', highlight: color, hover: color, opacity: 0.6 },
        width: Math.min(1 + Math.log2(weight), 5),
        arrows: { to: { enabled: true, scaleFactor: 0.4, type: 'arrow' } },
        font: { size: 9, color: '#94a3b8', face: 'Azeret Mono, monospace', align: 'middle' },
        smooth: { enabled: true, type: 'dynamic', roundness: 0.3 },
        hidden: false,
      };
    });

  const nodeTypes = [...new Set(slicedNodes.map(n => n.label))].sort();
  const relationTypes = [...new Set(visEdges.map(e => e._label))].sort();

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Monograph — Knowledge Graph</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Azeret+Mono:wght@400;500&family=Syne:wght@600;700&display=swap" rel="stylesheet">
<script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0d0d1a;--surface:rgba(255,255,255,0.04);--border:rgba(255,255,255,0.09);
  --text:#e2e8f0;--muted:#64748b;--dim:#475569;
  --purple:#7B61FF;--teal:#00E5C8;--red:#ef4444;
}
html,body{width:100%;height:100%;background:var(--bg);color:var(--text);overflow:hidden;font-family:'Azeret Mono',monospace}
#graph{position:absolute;inset:0;top:44px;background:var(--bg)}

/* top bar */
#topbar{
  position:fixed;top:0;left:0;right:0;height:44px;z-index:30;
  display:flex;align-items:center;gap:6px;padding:0 12px;
  background:rgba(13,13,26,0.97);border-bottom:1px solid var(--border);
  backdrop-filter:blur(10px);
}
#topbar-title{font-family:'Syne',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.12em;color:var(--purple);white-space:nowrap;margin-right:4px}
#search{
  flex:1;max-width:240px;height:26px;
  background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:3px;
  padding:0 8px;font-size:11px;font-family:'Azeret Mono',monospace;color:var(--text);outline:none;
}
#search:focus{border-color:rgba(123,97,255,0.5);background:rgba(123,97,255,0.06)}
#search::placeholder{color:var(--dim)}
.tb-btn{
  height:26px;padding:0 9px;border:1px solid var(--border);border-radius:3px;
  background:var(--surface);font-size:9px;font-family:'Azeret Mono',monospace;
  letter-spacing:0.08em;color:var(--muted);cursor:pointer;white-space:nowrap;transition:all 0.15s;
}
.tb-btn:hover{color:var(--text);border-color:rgba(255,255,255,0.2)}
.tb-btn.on{background:rgba(123,97,255,0.18);border-color:rgba(123,97,255,0.5);color:var(--purple)}
.tb-btn.teal.on{background:rgba(0,229,200,0.12);border-color:rgba(0,229,200,0.4);color:var(--teal)}
#stats{margin-left:auto;font-size:9px;color:var(--dim);white-space:nowrap;letter-spacing:0.05em}
#loading{
  position:fixed;top:44px;left:0;right:0;bottom:0;z-index:25;
  background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
}
#loading-title{font-family:'Syne',sans-serif;font-size:13px;letter-spacing:0.12em;color:var(--purple)}
#prog-bar{width:200px;height:3px;background:rgba(255,255,255,0.07);border-radius:2px;overflow:hidden}
#prog-fill{height:100%;background:linear-gradient(90deg,var(--purple),var(--teal));width:0%;transition:width 0.3s}
#prog-label{font-size:10px;color:var(--muted)}

/* side panel */
#panel{
  position:fixed;top:44px;right:0;bottom:0;z-index:20;width:200px;
  background:rgba(10,10,20,0.97);border-left:1px solid var(--border);
  padding:12px 10px;overflow-y:auto;display:flex;flex-direction:column;gap:12px;
  transform:translateX(0);transition:transform 0.2s;
}
#panel.hidden{transform:translateX(200px)}
.ps-title{font-size:8px;letter-spacing:0.12em;color:var(--dim);text-transform:uppercase;margin-bottom:6px;font-weight:500}
.filter-row{display:flex;align-items:center;gap:6px;margin-bottom:3px;cursor:pointer}
.filter-row label{font-size:10px;color:var(--muted);cursor:pointer;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.filter-row input{cursor:pointer;accent-color:var(--purple)}
.color-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.slider-row{margin-bottom:6px}
.slider-row label{display:flex;justify-content:space-between;font-size:9px;color:var(--dim);margin-bottom:3px}
.slider-row label span{color:var(--muted)}
.slider-row input[type=range]{width:100%;accent-color:var(--purple);cursor:pointer}
.shape-legend{display:flex;flex-wrap:wrap;gap:6px}
.shape-item{font-size:9px;color:var(--dim);display:flex;align-items:center;gap:4px}

/* info card */
#infocard{
  position:fixed;bottom:16px;left:16px;z-index:25;
  background:rgba(10,10,20,0.97);border:1px solid var(--border);border-radius:4px;
  padding:12px 14px;max-width:280px;min-width:200px;
  box-shadow:0 8px 32px rgba(0,0,0,0.5);display:none;
}
#ic-close{float:right;cursor:pointer;color:var(--dim);font-size:14px;line-height:1}
#ic-close:hover{color:var(--text)}
#ic-type{font-size:8px;letter-spacing:0.12em;color:var(--purple);text-transform:uppercase;margin-bottom:4px}
#ic-name{font-family:'Syne',sans-serif;font-size:13px;font-weight:600;color:var(--text);margin-bottom:6px;word-break:break-all}
#ic-meta{font-size:10px;color:var(--muted);line-height:1.7}
#ic-meta a{color:var(--teal);text-decoration:none}
#ic-badge{
  display:inline-block;margin-top:6px;padding:1px 6px;
  border-radius:2px;font-size:9px;background:rgba(123,97,255,0.18);color:var(--purple);
  letter-spacing:0.06em;
}

/* minimap hint */
#hint{position:fixed;bottom:12px;right:12px;z-index:15;font-size:9px;color:var(--dim);letter-spacing:0.06em;line-height:1.6;text-align:right}

/* scrollbar */
::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}
<\/style>
<\/head>
<body>

<div id="topbar">
  <div id="topbar-title">◈ MONOGRAPH</div>
  <input id="search" type="text" placeholder="Search nodes…" oninput="onSearch(this.value)" autocomplete="off">
  <button class="tb-btn" onclick="resetSearch()">RESET</button>
  <button class="tb-btn on" id="physicsBtn" onclick="togglePhysics()">PHYSICS</button>
  <button class="tb-btn" id="labelsBtn" onclick="toggleEdgeLabels()">EDGES</button>
  <button class="tb-btn" id="hierBtn" onclick="toggleHierarchical()">TREE</button>
  <button class="tb-btn teal on" id="panelBtn" onclick="togglePanel()">FILTERS</button>
  <span id="stats">${visNodes.length.toLocaleString()} nodes · ${visEdges.length.toLocaleString()} edges</span>
</div>

<div id="loading">
  <div id="loading-title">STABILIZING GRAPH…</div>
  <div id="prog-bar"><div id="prog-fill"></div></div>
  <div id="prog-label" id="prog-label">0%</div>
</div>

<div id="graph"></div>

<div id="panel">
  <div>
    <div class="ps-title">Node Types</div>
    ${nodeTypes.map(t => {
      const sample = slicedNodes.find(n => n.label === t);
      const color = sample ? COMMUNITY_COLORS[(sample.communityId ?? 0) % COMMUNITY_COLORS.length] : '#64748b';
      return `<div class="filter-row" onclick="toggleType('${t}')">
        <input type="checkbox" id="type_${t}" checked>
        <div class="color-dot" style="background:${color}"></div>
        <label for="type_${t}">${t}</label>
      </div>`;
    }).join('')}
  </div>
  <div>
    <div class="ps-title">Relations</div>
    ${relationTypes.map(r => {
      const color = RELATION_COLORS[r] ?? '#475569';
      return `<div class="filter-row" onclick="toggleRelation('${r}')">
        <input type="checkbox" id="rel_${r}" checked>
        <div class="color-dot" style="background:${color};border-radius:0"></div>
        <label for="rel_${r}" style="font-size:9px">${r}</label>
      </div>`;
    }).join('')}
  </div>
  <div>
    <div class="ps-title">Physics</div>
    <div class="slider-row">
      <label>Spring length <span id="springVal">150</span></label>
      <input type="range" min="40" max="500" value="150" oninput="setSpring(+this.value)">
    </div>
    <div class="slider-row">
      <label>Gravity <span id="gravVal">2000</span></label>
      <input type="range" min="100" max="10000" value="2000" oninput="setGravity(+this.value)">
    </div>
    <div class="slider-row">
      <label>Damping <span id="dampVal">0.09</span></label>
      <input type="range" min="1" max="50" value="9" oninput="setDamping(+this.value/100)">
    </div>
    <button class="tb-btn" style="width:100%;margin-top:4px" onclick="network.fit()">FIT VIEW</button>
    <button class="tb-btn" style="width:100%;margin-top:4px" onclick="network.stabilize(100)">RE-STABILIZE</button>
  </div>
</div>

<div id="infocard">
  <span id="ic-close" onclick="closeInfoCard()">✕</span>
  <div id="ic-type"></div>
  <div id="ic-name"></div>
  <div id="ic-meta"></div>
  <div id="ic-badge"></div>
</div>

<div id="hint">Scroll: zoom · Drag: pan · Click: inspect · Ctrl+click: multi-select</div>

<script>
const ALL_NODES = ${JSON.stringify(visNodes)};
const ALL_EDGES = ${JSON.stringify(visEdges)};
const RELATION_COLORS = ${JSON.stringify(RELATION_COLORS)};

const nodesDS = new vis.DataSet(ALL_NODES);
const edgesDS = new vis.DataSet(ALL_EDGES);
const container = document.getElementById('graph');

const BASE_OPTIONS = {
  physics: {
    enabled: true,
    barnesHut: {
      gravitationalConstant: -2000,
      centralGravity: 0.05,
      springLength: 150,
      springConstant: 0.04,
      damping: 0.09,
      avoidOverlap: 0.15,
    },
    stabilization: {
      enabled: true,
      iterations: 200,
      updateInterval: 20,
      fit: true,
    },
    minVelocity: 0.75,
  },
  interaction: {
    hover: true,
    tooltipDelay: 100,
    navigationButtons: false,
    keyboard: { enabled: true, bindToWindow: false },
    multiselect: true,
    zoomSpeed: 0.5,
  },
  edges: {
    smooth: { enabled: true, type: 'dynamic', roundness: 0.3 },
    selectionWidth: 2,
    hoverWidth: 2,
  },
  nodes: {
    borderWidth: 1.5,
    borderWidthSelected: 3,
    chosen: true,
  },
  rendering: {
    hideEdgesOnDrag: true,
    hideNodesOnDrag: false,
  },
};

let network = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, BASE_OPTIONS);

function attachNetworkEvents() {
  network.on('stabilizationProgress', p => {
    const pct = Math.round(p.iterations / p.total * 100);
    document.getElementById('prog-fill').style.width = pct + '%';
    document.getElementById('prog-label').textContent = pct + '%';
  });
  network.on('stabilizationIterationsDone', () => {
    document.getElementById('loading').style.display = 'none';
    network.fit({ animation: { duration: 800, easingFunction: 'easeInOutQuad' } });
  });
  network.on('click', params => {
    if (params.nodes.length > 0) {
      highlightNeighbors(params.nodes[0]);
      showInfoCard(params.nodes[0]);
    } else if (!params.ctrlKey && params.edges.length === 0) {
      resetHighlight();
      closeInfoCard();
    }
  });
  network.on('doubleClick', params => {
    if (params.nodes.length > 0) {
      network.focus(params.nodes[0], { scale: 1.4, animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
    }
  });
}

attachNetworkEvents();

function highlightNeighbors(nodeId) {
  const connectedEdges = new Set(network.getConnectedEdges(nodeId));
  const connectedNodes = new Set(network.getConnectedNodes(nodeId));
  connectedNodes.add(nodeId);
  nodesDS.update(ALL_NODES.map(n => ({ id: n.id, opacity: connectedNodes.has(n.id) ? 1 : 0.08 })));
  edgesDS.update(ALL_EDGES.map(e => ({ id: e.id, opacity: connectedEdges.has(e.id) ? 0.9 : 0.03 })));
}

function resetHighlight() {
  nodesDS.update(ALL_NODES.map(n => ({ id: n.id, opacity: 1 })));
  edgesDS.update(ALL_EDGES.map(e => ({ id: e.id, opacity: 0.6 })));
}

function showInfoCard(nodeId) {
  const node = ALL_NODES.find(n => n.id === nodeId);
  if (!node) return;
  const neighbors = network.getConnectedNodes(nodeId);
  document.getElementById('ic-type').textContent = node._nodeType || '';
  document.getElementById('ic-name').textContent = node.label;
  document.getElementById('ic-meta').innerHTML =
    (node._filePath ? '<span style="color:#00E5C8">' + node._filePath.split('/').pop() + '</span><br>' +
      '<span style="color:#475569;font-size:9px">' + node._filePath + '</span><br>' : '') +
    '<b style="color:#7B61FF">' + neighbors.length + '</b> connections';
  document.getElementById('ic-badge').textContent = node._deg + ' degree';
  document.getElementById('infocard').style.display = 'block';
}

function closeInfoCard() {
  document.getElementById('infocard').style.display = 'none';
  resetHighlight();
}

// Search: highlight matches, dim others
let searchActive = false;
function onSearch(q) {
  searchActive = !!q;
  const lq = q.toLowerCase();
  if (!q) { resetHighlight(); return; }
  const matchIds = new Set(ALL_NODES.filter(n => n.label.toLowerCase().includes(lq) || (n._filePath && n._filePath.toLowerCase().includes(lq))).map(n => n.id));
  nodesDS.update(ALL_NODES.map(n => ({ id: n.id, opacity: matchIds.has(n.id) ? 1 : 0.06 })));
  edgesDS.update(ALL_EDGES.map(e => ({ id: e.id, opacity: matchIds.has(e.from) && matchIds.has(e.to) ? 0.7 : 0.03 })));
  // Focus on first match
  if (matchIds.size > 0 && matchIds.size < 20) {
    network.fit({ nodes: [...matchIds], animation: true });
  }
}

function resetSearch() {
  document.getElementById('search').value = '';
  searchActive = false;
  resetHighlight();
}

// Edge labels toggle
let edgeLabelsOn = false;
function toggleEdgeLabels() {
  edgeLabelsOn = !edgeLabelsOn;
  edgesDS.update(ALL_EDGES.map(e => ({ id: e.id, label: edgeLabelsOn ? e._label : '' })));
  document.getElementById('labelsBtn').classList.toggle('on', edgeLabelsOn);
}

// Physics toggle
let physicsOn = true;
function togglePhysics() {
  physicsOn = !physicsOn;
  network.setOptions({ physics: { enabled: physicsOn } });
  document.getElementById('physicsBtn').classList.toggle('on', physicsOn);
}

// Hierarchical toggle
let hierOn = false;
function toggleHierarchical() {
  hierOn = !hierOn;
  // vis-network requires full re-init when switching hierarchical layout
  const container = document.getElementById('graph');
  if (hierOn) {
    network.destroy();
    network = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, {
      ...BASE_OPTIONS,
      layout: { hierarchical: { enabled: true, direction: 'UD', sortMethod: 'directed', levelSeparation: 150, nodeSpacing: 140, treeSpacing: 200 } },
      physics: { enabled: false },
    });
    attachNetworkEvents();
    setTimeout(() => network.fit(), 100);
  } else {
    network.destroy();
    network = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, BASE_OPTIONS);
    attachNetworkEvents();
  }
  document.getElementById('hierBtn').classList.toggle('on', hierOn);
}

// Panel toggle
function togglePanel() {
  document.getElementById('panel').classList.toggle('hidden');
  document.getElementById('panelBtn').classList.toggle('on', !document.getElementById('panel').classList.contains('hidden'));
}

// Node type filter
function toggleType(type) {
  const cb = document.getElementById('type_' + type);
  cb.checked = !cb.checked;
  applyFilters();
}
function applyFilters() {
  const enabledTypes = new Set();
  document.querySelectorAll('[id^="type_"]').forEach(cb => { if (cb.checked) enabledTypes.add(cb.id.replace('type_', '')); });
  const enabledRels = new Set();
  document.querySelectorAll('[id^="rel_"]').forEach(cb => { if (cb.checked) enabledRels.add(cb.id.replace('rel_', '')); });
  const hiddenNodeIds = new Set(ALL_NODES.filter(n => !enabledTypes.has(n._nodeType)).map(n => n.id));
  nodesDS.update(ALL_NODES.map(n => ({ id: n.id, hidden: hiddenNodeIds.has(n.id) })));
  edgesDS.update(ALL_EDGES.map(e => ({
    id: e.id,
    hidden: hiddenNodeIds.has(e.from) || hiddenNodeIds.has(e.to) || !enabledRels.has(e._label),
  })));
}
function toggleRelation(rel) {
  const cb = document.getElementById('rel_' + rel);
  cb.checked = !cb.checked;
  applyFilters();
}

// Physics sliders
function setSpring(v) { document.getElementById('springVal').textContent = v; network.setOptions({ physics: { barnesHut: { springLength: v } } }); }
function setGravity(v) { document.getElementById('gravVal').textContent = v; network.setOptions({ physics: { barnesHut: { gravitationalConstant: -v } } }); }
function setDamping(v) { document.getElementById('dampVal').textContent = v.toFixed(2); network.setOptions({ physics: { barnesHut: { damping: v } } }); }

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeInfoCard(); resetSearch(); document.getElementById('search').value = ''; }
  if (e.key === 'f' && e.ctrlKey) { e.preventDefault(); document.getElementById('search').focus(); }
  if (e.key === 'F' && !e.ctrlKey) network.fit({ animation: true });
  if (e.key === 'p') togglePhysics();
});
<\/script>
<\/body>
<\/html>`;
}

function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 0xff) + 40);
  const g = Math.min(255, ((n >> 8) & 0xff) + 40);
  const b = Math.min(255, (n & 0xff) + 40);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function buildTooltip(n: MonographNode, deg: number): string {
  const props = n.properties as Record<string, unknown> | undefined;
  return [
    `<div style="font-family:monospace;font-size:11px;background:#0d0d1a;color:#e2e8f0;padding:8px 10px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);max-width:260px;">`,
    `<b style="color:#7B61FF">${n.name}</b>`,
    `<br><span style="color:#64748b">${n.label}</span>`,
    n.filePath ? `<br><span style="color:#00E5C8;font-size:10px">${n.filePath}</span>` : '',
    `<br><span style="color:#94a3b8">degree: ${deg}</span>`,
    props?.importance ? `<br><span style="color:#f59e0b">${'★'.repeat(props.importance as number)}${'☆'.repeat(5 - (props.importance as number))}</span>` : '',
    `</div>`,
  ].filter(Boolean).join('');
}
