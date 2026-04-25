import { writeFileSync } from 'fs';
import { join } from 'path';
const PALETTE = [
    '#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F',
    '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC',
    '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
    '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4',
    '#a3e635', '#fb923c', '#e879f9', '#34d399', '#60a5fa',
];
const MAX_VISUAL_NODES = 2000;
function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function jsSafe(obj) {
    return JSON.stringify(obj).replace(/<\//g, '<\\/');
}
/** Export a rich, self-contained HTML knowledge graph explorer using vis-network. */
export function exportHTML(serialized, outputDir) {
    const htmlPath = join(outputDir, 'graph.html');
    const totalNodes = serialized.nodes.length;
    const totalEdges = serialized.links.length;
    const projectName = serialized.projectPath.split('/').filter(Boolean).pop() ?? serialized.projectPath;
    // Compute degree
    const degMap = {};
    for (const l of serialized.links) {
        degMap[l.source] = (degMap[l.source] ?? 0) + 1;
        degMap[l.target] = (degMap[l.target] ?? 0) + 1;
    }
    // Sample if too large
    let vizNodes = serialized.nodes;
    let vizLinks = serialized.links;
    const sampled = totalNodes > MAX_VISUAL_NODES;
    if (sampled) {
        const sorted = [...serialized.nodes].sort((a, b) => (degMap[b.id] ?? 0) - (degMap[a.id] ?? 0));
        vizNodes = sorted.slice(0, MAX_VISUAL_NODES);
        const kept = new Set(vizNodes.map(n => n.id));
        vizLinks = serialized.links.filter(l => kept.has(l.source) && kept.has(l.target));
    }
    const nodeCount = vizNodes.length;
    const edgeCount = vizLinks.length;
    // Rebuild degree for sampled graph
    const deg = {};
    for (const l of vizLinks) {
        deg[l.source] = (deg[l.source] ?? 0) + 1;
        deg[l.target] = (deg[l.target] ?? 0) + 1;
    }
    const maxDeg = Math.max(1, ...Object.values(deg));
    // Community map
    const communityNodes = {};
    for (const n of vizNodes) {
        const c = n['community'] ?? -1;
        communityNodes[c] = (communityNodes[c] ?? 0) + 1;
    }
    const communityIds = Object.keys(communityNodes).map(Number).sort((a, b) => (communityNodes[b] ?? 0) - (communityNodes[a] ?? 0));
    // Relation types
    const relCounts = {};
    for (const l of vizLinks) {
        const r = String(l['relation'] ?? 'ref');
        relCounts[r] = (relCounts[r] ?? 0) + 1;
    }
    const relTypes = Object.entries(relCounts).sort((a, b) => b[1] - a[1]);
    // God nodes — top 25 by degree
    const godNodes = [...vizNodes]
        .sort((a, b) => (deg[b.id] ?? 0) - (deg[a.id] ?? 0))
        .slice(0, 25)
        .map(n => ({
        id: n.id,
        label: n['label'] || n.id,
        degree: deg[n.id] ?? 0,
        community: n['community'] ?? -1,
    }));
    // Build vis.js nodes
    const visNodes = vizNodes.map(n => {
        const attrs = n;
        const cid = attrs['community'] ?? -1;
        const color = cid >= 0 ? PALETTE[cid % PALETTE.length] : '#64748b';
        const label = attrs['label'] || n.id;
        const d = deg[n.id] ?? 0;
        const size = 10 + 30 * (d / maxDeg);
        const fontSize = d >= maxDeg * 0.1 ? 12 : 0;
        return {
            id: n.id, label: esc(label),
            color: { background: color, border: color, highlight: { background: '#ffffff', border: color } },
            size: Math.round(size * 10) / 10,
            font: { size: fontSize, color: '#ffffff' },
            title: esc(label), community: cid,
            community_name: `Community ${cid}`,
            source_file: esc(String(attrs['source_file'] ?? attrs['sourceFile'] ?? '')),
            file_type: String(attrs['file_type'] ?? attrs['fileType'] ?? 'code'),
            degree: d,
        };
    });
    // Build vis.js edges
    const visEdges = vizLinks.map(l => {
        const attrs = l;
        const confidence = String(attrs['confidence'] ?? 'EXTRACTED');
        const relation = String(attrs['relation'] ?? 'ref');
        return {
            from: l.source, to: l.target, relation,
            title: esc(`${relation} [${confidence}]`),
            dashes: confidence !== 'EXTRACTED',
            width: confidence === 'EXTRACTED' ? 2 : 1,
            color: { opacity: confidence === 'EXTRACTED' ? 0.7 : 0.35 },
        };
    });
    // Legend data
    const legendData = communityIds.map(cid => ({
        cid, color: cid >= 0 ? PALETTE[cid % PALETTE.length] : '#64748b',
        label: `Community ${cid}`, count: communityNodes[cid] ?? 0,
    }));
    const sampledNote = sampled ? ` (top ${MAX_VISUAL_NODES} of ${totalNodes})` : '';
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Knowledge Graph — ${esc(projectName)}</title>
<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"><\/script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0f0f1a;--bg2:#1a1a2e;--bg3:#242446;--border:#2a2a4e;--text:#e0e0e0;--muted:#888;--dim:#555;--accent:#4E79A7}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;height:100vh;overflow:hidden}

/* Layout */
#app{display:flex;height:100vh}
#graph-area{flex:1;position:relative;overflow:hidden}
#graph{width:100%;height:100%}
#sidebar{width:320px;background:var(--bg2);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;flex-shrink:0}

/* Loading overlay */
#loading{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(15,15,26,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:100;transition:opacity .5s}
#loading.hidden{opacity:0;pointer-events:none}
#loading h2{color:var(--accent);font-size:16px;margin-bottom:12px}
#load-bar{width:240px;height:4px;background:#1a1a2e;border-radius:4px;overflow:hidden}
#load-fill{height:100%;background:var(--accent);width:0%;transition:width .3s}
#load-text{margin-top:8px;font-size:12px;color:var(--muted)}

/* Top bar */
#topbar{position:absolute;top:0;left:0;right:0;height:42px;background:rgba(26,26,46,.88);backdrop-filter:blur(8px);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 14px;gap:10px;z-index:10}
#topbar .title{font-size:13px;font-weight:700;color:#f1f5f9}
#topbar .title span{color:var(--accent)}
.pill{background:var(--bg);border:1px solid var(--border);border-radius:999px;padding:2px 10px;font-size:11px;color:var(--muted)}
.pill b{color:#c7d2fe}
.pill.warn{color:#f59e0b;border-color:#f59e0b44}
#topbar .spacer{flex:1}
.tbtn{background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;white-space:nowrap;transition:.15s}
.tbtn:hover{background:#2f2f5a}
.tbtn.active{background:var(--accent);border-color:var(--accent);color:#fff}

/* Sidebar: tabs */
#tabs{display:flex;border-bottom:1px solid var(--border);flex-shrink:0}
.tab{flex:1;padding:10px 4px;font-size:11px;text-align:center;cursor:pointer;color:var(--muted);border-bottom:2px solid transparent;transition:.15s;text-transform:uppercase;letter-spacing:.04em}
.tab:hover{color:var(--text)}
.tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.tab-panel{display:none;flex:1;overflow-y:auto;padding:14px}
.tab-panel.active{display:block}

/* Search */
#search-box{padding:10px 14px;border-bottom:1px solid var(--border);flex-shrink:0}
#search{width:100%;background:var(--bg);border:1px solid #3a3a5e;color:var(--text);padding:7px 10px 7px 32px;border-radius:6px;font-size:13px;outline:none}
#search:focus{border-color:var(--accent)}
#search-box{position:relative}
#search-icon{position:absolute;left:24px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none;font-size:14px}
#search-results{max-height:200px;overflow-y:auto;margin-top:6px;display:none}
.sr-item{display:flex;align-items:center;gap:8px;padding:5px 8px;cursor:pointer;border-radius:5px;font-size:12px}
.sr-item:hover{background:var(--bg3)}
.sr-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.sr-label{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-deg{color:var(--dim);font-size:10px;flex-shrink:0}

/* Node card */
#node-card{display:none}
.nc-label{font-size:14px;font-weight:600;color:#f1f5f9;margin-bottom:10px;word-break:break-all}
.nc-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:12px}
.nc-row:last-child{border:none}
.nk{color:var(--muted)}.nv{color:#c7d2fe;text-align:right;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nbr-title{margin-top:12px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
#neighbors-list{max-height:220px;overflow-y:auto;margin-top:4px}
.nbr-item{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:5px;cursor:pointer;font-size:12px}
.nbr-item:hover{background:var(--bg3)}
.nbr-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.nbr-lbl{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nbr-rel{color:var(--muted);font-size:10px;flex-shrink:0}

/* Overview stats */
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px}
.stat-box{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center}
.sv{font-size:20px;font-weight:700;color:#f1f5f9}.sk{font-size:10px;color:var(--muted);margin-top:2px}
.section{margin-bottom:16px}
.sec-title{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}

/* Community / Legend */
.com-row{display:flex;align-items:center;gap:8px;padding:5px 6px;cursor:pointer;border-radius:5px;font-size:12px;transition:.15s}
.com-row:hover{background:var(--bg3)}
.com-row.dimmed{opacity:.25}
.com-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.com-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.com-count{color:var(--dim);font-size:11px}

/* God nodes */
.god-item{display:flex;align-items:center;gap:8px;padding:5px 6px;cursor:pointer;border-radius:5px;font-size:12px;transition:.15s}
.god-item:hover{background:var(--bg3)}
.god-rank{width:20px;text-align:right;color:var(--muted);font-size:11px;flex-shrink:0}
.god-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.god-lbl{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.god-deg{font-size:11px;color:var(--muted);flex-shrink:0}

/* Relation legend */
.rel-row{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px}
.rel-line{width:20px;height:2px;border-radius:2px;flex-shrink:0;background:var(--muted)}
.rel-count{color:var(--dim);font-size:10px;margin-left:auto}

/* Path finder */
#pathfinder{margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}
#pathfinder input{width:100%;background:var(--bg);border:1px solid #3a3a5e;color:var(--text);padding:6px 10px;border-radius:5px;font-size:12px;outline:none;margin-bottom:6px}
#pathfinder input:focus{border-color:var(--accent)}
#path-btn{width:100%;background:var(--accent);border:none;color:#fff;padding:7px;border-radius:5px;font-size:12px;cursor:pointer;transition:.15s}
#path-btn:hover{opacity:.85}
#path-result{margin-top:8px;font-size:12px;color:var(--muted);line-height:1.5}

/* Bottom controls */
#floatctrl{position:absolute;bottom:12px;left:12px;display:flex;gap:5px;z-index:10}
.fc{background:rgba(36,36,70,.85);backdrop-filter:blur(6px);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;transition:.15s}
.fc:hover{background:rgba(47,47,90,.9)}

/* Keyboard hints */
#kbd-hint{position:absolute;bottom:12px;right:332px;font-size:10px;color:#444;z-index:10}
kbd{background:var(--bg3);border:1px solid var(--border);border-radius:3px;padding:1px 5px;font-size:10px;color:var(--muted)}
</style>
</head>
<body>
<div id="app">
  <div id="graph-area">
    <div id="graph"></div>

    <!-- Loading overlay -->
    <div id="loading">
      <h2>Stabilizing graph layout…</h2>
      <div id="load-bar"><div id="load-fill"></div></div>
      <div id="load-text">0%</div>
    </div>

    <!-- Top bar -->
    <div id="topbar">
      <div class="title"><span>monobrain</span> graph</div>
      <div class="pill"><b>${nodeCount}</b> nodes${sampled ? ` <span style="color:#f59e0b" title="Sampled top ${MAX_VISUAL_NODES} of ${totalNodes} by degree">▲</span>` : ''}</div>
      <div class="pill"><b>${edgeCount}</b> edges</div>
      <div class="pill"><b>${communityIds.length}</b> groups</div>
      ${sampled ? `<div class="pill warn" title="Showing top ${MAX_VISUAL_NODES} of ${totalNodes} total nodes by connection count">sampled</div>` : ''}
      <div class="spacer"></div>
      <button class="tbtn" id="btn-labels" title="Toggle all labels (L)">Labels</button>
      <button class="tbtn" id="btn-physics" title="Toggle physics (P)">Physics</button>
      <button class="tbtn" id="btn-screenshot" title="Download PNG (S)">PNG</button>
    </div>

    <!-- Float controls -->
    <div id="floatctrl">
      <button class="fc" id="btn-fit" title="Fit to screen (F)">Fit</button>
      <button class="fc" id="btn-zoom-in">+</button>
      <button class="fc" id="btn-zoom-out">−</button>
    </div>
    <div id="kbd-hint"><kbd>/</kbd> search &nbsp; <kbd>F</kbd> fit &nbsp; <kbd>L</kbd> labels &nbsp; <kbd>P</kbd> physics &nbsp; <kbd>S</kbd> png &nbsp; <kbd>Esc</kbd> deselect</div>
  </div>

  <div id="sidebar">
    <div id="search-box">
      <span id="search-icon">⌕</span>
      <input id="search" type="text" placeholder="Search nodes…" autocomplete="off">
      <div id="search-results"></div>
    </div>

    <div id="tabs">
      <div class="tab active" data-tab="overview">Overview</div>
      <div class="tab" data-tab="node">Node</div>
      <div class="tab" data-tab="groups">Groups</div>
      <div class="tab" data-tab="gods">Top Nodes</div>
    </div>

    <!-- Overview tab -->
    <div class="tab-panel active" id="panel-overview">
      <div class="stat-grid">
        <div class="stat-box"><div class="sv">${nodeCount}</div><div class="sk">Nodes${sampled ? ' (sampled)' : ''}</div></div>
        <div class="stat-box"><div class="sv">${edgeCount}</div><div class="sk">Edges</div></div>
        <div class="stat-box"><div class="sv">${communityIds.length}</div><div class="sk">Communities</div></div>
        <div class="stat-box"><div class="sv">${maxDeg}</div><div class="sk">Max Degree</div></div>
      </div>
      <div class="section">
        <div class="sec-title">Edge Types</div>
        ${relTypes.map(([r, c]) => `<div class="rel-row"><div class="rel-line"></div><span>${esc(r)}</span><span class="rel-count">${c}</span></div>`).join('\n        ')}
      </div>
      <div class="section">
        <div class="sec-title">Node Sizes</div>
        <div style="font-size:12px;color:var(--muted);line-height:1.6">Larger nodes = more connections. Top hub has ${maxDeg} edges. Labels auto-show for high-degree nodes.</div>
      </div>
      <div id="pathfinder">
        <div class="sec-title">Find Path</div>
        <input id="path-from" type="text" placeholder="From node…" autocomplete="off">
        <input id="path-to" type="text" placeholder="To node…" autocomplete="off">
        <button id="path-btn">Find shortest path</button>
        <div id="path-result"></div>
      </div>
    </div>

    <!-- Node tab -->
    <div class="tab-panel" id="panel-node">
      <div id="node-card">
        <div class="nc-label" id="nc-label"></div>
        <div id="nc-fields"></div>
        <div class="nbr-title">Neighbors (<span id="nbr-count">0</span>)</div>
        <div id="neighbors-list"></div>
      </div>
      <div id="node-empty" style="color:var(--dim);font-size:13px;padding-top:20px;text-align:center">Click a node to inspect it</div>
    </div>

    <!-- Groups tab -->
    <div class="tab-panel" id="panel-groups">
      <div style="font-size:11px;color:var(--dim);margin-bottom:10px">Click to toggle visibility</div>
      <div id="groups-list"></div>
    </div>

    <!-- God nodes tab -->
    <div class="tab-panel" id="panel-gods">
      <div style="font-size:11px;color:var(--dim);margin-bottom:10px">Most connected nodes — click to fly</div>
      <div id="gods-list"></div>
    </div>
  </div>
</div>

<script>
var RAW_NODES = ${jsSafe(visNodes)};
var RAW_EDGES = ${jsSafe(visEdges)};
var LEGEND = ${jsSafe(legendData)};
var GOD_NODES = ${jsSafe(godNodes)};
var PALETTE = ${jsSafe(PALETTE)};

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

/* ── Build vis datasets ── */
var nodesDS = new vis.DataSet(RAW_NODES.map(function(n){return {
  id:n.id, label:n.label, color:n.color, size:n.size,
  font:n.font, title:n.title,
  _community:n.community, _community_name:n.community_name,
  _source_file:n.source_file, _file_type:n.file_type, _degree:n.degree
}}));

var edgesDS = new vis.DataSet(RAW_EDGES.map(function(e,i){return {
  id:i, from:e.from, to:e.to, _relation:e.relation,
  title:e.title, dashes:e.dashes, width:e.width, color:e.color,
  arrows:{to:{enabled:true,scaleFactor:0.5}}
}}));

/* ── Network ── */
var container = document.getElementById('graph');
var network = new vis.Network(container, {nodes:nodesDS, edges:edgesDS}, {
  physics: {
    enabled:true,
    solver:'forceAtlas2Based',
    forceAtlas2Based:{gravitationalConstant:-60,centralGravity:0.005,springLength:120,springConstant:0.08,damping:0.4,avoidOverlap:0.8},
    stabilization:{iterations:200,fit:true}
  },
  interaction:{hover:true,tooltipDelay:100,hideEdgesOnDrag:true,navigationButtons:false,keyboard:false},
  nodes:{shape:'dot',borderWidth:1.5},
  edges:{smooth:{type:'continuous',roundness:0.2},selectionWidth:3}
});

/* ── Loading progress ── */
var loadEl=document.getElementById('loading'), loadFill=document.getElementById('load-fill'), loadText=document.getElementById('load-text');
network.on('stabilizationProgress',function(p){
  var pct=Math.round(p.iterations/p.total*100);
  loadFill.style.width=pct+'%';
  loadText.textContent=pct+'%';
});
network.once('stabilizationIterationsDone',function(){
  loadFill.style.width='100%';loadText.textContent='Done';
  setTimeout(function(){loadEl.classList.add('hidden');},400);
  network.setOptions({physics:{enabled:false}});
});

/* ── State ── */
var labelsOn=false, physicsOn=false;
var hiddenCommunities=new Set();
var selectedNodeId=null;

/* ── Tabs ── */
document.querySelectorAll('.tab').forEach(function(tab){
  tab.addEventListener('click',function(){
    document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active')});
    document.querySelectorAll('.tab-panel').forEach(function(p){p.classList.remove('active')});
    tab.classList.add('active');
    document.getElementById('panel-'+tab.dataset.tab).classList.add('active');
  });
});
function switchTab(name){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.toggle('active',t.dataset.tab===name)});
  document.querySelectorAll('.tab-panel').forEach(function(p){p.classList.toggle('active',p.id==='panel-'+name)});
}

/* ── Node info ── */
function showInfo(nodeId){
  selectedNodeId=nodeId;
  var n=nodesDS.get(nodeId);if(!n)return;
  switchTab('node');
  document.getElementById('node-card').style.display='block';
  document.getElementById('node-empty').style.display='none';
  document.getElementById('nc-label').textContent=n.label;
  document.getElementById('nc-fields').innerHTML=[
    ['Type',n._file_type||'unknown'],
    ['Community',n._community_name],
    ['Source',n._source_file||'—'],
    ['Degree',n._degree]
  ].map(function(r){return '<div class="nc-row"><span class="nk">'+r[0]+'</span><span class="nv">'+esc(String(r[1]))+'</span></div>';}).join('');

  var neighborIds=network.getConnectedNodes(nodeId);
  document.getElementById('nbr-count').textContent=neighborIds.length;
  var list=document.getElementById('neighbors-list');list.innerHTML='';
  neighborIds.forEach(function(nid){
    var nb=nodesDS.get(nid);if(!nb)return;
    var color=nb.color.background||'#555';
    // Find edge relation
    var edges=network.getConnectedEdges(nodeId);
    var rel='';
    edges.forEach(function(eid){var e=edgesDS.get(eid);if(e&&(e.from===nid||e.to===nid))rel=e._relation||'';});
    var el=document.createElement('div');el.className='nbr-item';
    el.innerHTML='<div class="nbr-dot" style="background:'+esc(color)+'"></div><span class="nbr-lbl">'+esc(nb.label)+'</span><span class="nbr-rel">'+esc(rel)+'</span>';
    el.onclick=function(){focusNode(nid);};
    list.appendChild(el);
  });
}

function focusNode(nodeId){
  network.focus(nodeId,{scale:1.4,animation:true});
  network.selectNodes([nodeId]);
  showInfo(nodeId);
}

/* ── Click/hover ── */
var hoveredNodeId=null;
network.on('hoverNode',function(p){hoveredNodeId=p.node;container.style.cursor='pointer';});
network.on('blurNode',function(){hoveredNodeId=null;container.style.cursor='default';});
container.addEventListener('click',function(){
  if(hoveredNodeId!==null){showInfo(hoveredNodeId);network.selectNodes([hoveredNodeId]);}
});
network.on('click',function(p){
  if(p.nodes.length>0)showInfo(p.nodes[0]);
});
network.on('doubleClick',function(p){
  if(p.nodes.length>0) network.focus(p.nodes[0],{scale:2,animation:true});
});

/* ── Search ── */
var searchInput=document.getElementById('search');
var searchResults=document.getElementById('search-results');
searchInput.addEventListener('input',function(){
  var q=searchInput.value.toLowerCase().trim();
  searchResults.innerHTML='';
  if(!q){searchResults.style.display='none';return;}
  var matches=RAW_NODES.filter(function(n){return n.label.toLowerCase().includes(q);}).slice(0,25);
  if(!matches.length){searchResults.style.display='none';return;}
  searchResults.style.display='block';
  matches.forEach(function(n){
    var el=document.createElement('div');el.className='sr-item';
    el.innerHTML='<div class="sr-dot" style="background:'+n.color.background+'"></div><span class="sr-label">'+esc(n.label)+'</span><span class="sr-deg">'+n.degree+'</span>';
    el.onclick=function(){
      focusNode(n.id);
      searchResults.style.display='none';searchInput.value='';
    };
    searchResults.appendChild(el);
  });
});
document.addEventListener('click',function(e){
  if(!searchResults.contains(e.target)&&e.target!==searchInput)searchResults.style.display='none';
});

/* ── Groups / community toggle ── */
var groupsList=document.getElementById('groups-list');
LEGEND.forEach(function(c){
  var row=document.createElement('div');row.className='com-row';
  row.innerHTML='<div class="com-dot" style="background:'+c.color+'"></div><span class="com-name">'+esc(c.label)+'</span><span class="com-count">'+c.count+'</span>';
  row.onclick=function(){
    if(hiddenCommunities.has(c.cid)){hiddenCommunities.delete(c.cid);row.classList.remove('dimmed');}
    else{hiddenCommunities.add(c.cid);row.classList.add('dimmed');}
    nodesDS.update(RAW_NODES.filter(function(n){return n.community===c.cid;}).map(function(n){return{id:n.id,hidden:hiddenCommunities.has(c.cid)};}));
  };
  groupsList.appendChild(row);
});

/* ── God nodes ── */
var godsList=document.getElementById('gods-list');
GOD_NODES.forEach(function(g,i){
  var c=g.community>=0?PALETTE[g.community%PALETTE.length]:'#64748b';
  var el=document.createElement('div');el.className='god-item';
  el.innerHTML='<span class="god-rank">#'+(i+1)+'</span><div class="god-dot" style="background:'+c+'"></div><span class="god-lbl">'+esc(g.label)+'</span><span class="god-deg">'+g.degree+' edges</span>';
  el.onclick=function(){focusNode(g.id);};
  godsList.appendChild(el);
});

/* ── Path finder (BFS) ── */
document.getElementById('path-btn').addEventListener('click',function(){
  var fromQ=document.getElementById('path-from').value.toLowerCase().trim();
  var toQ=document.getElementById('path-to').value.toLowerCase().trim();
  var resultEl=document.getElementById('path-result');
  if(!fromQ||!toQ){resultEl.textContent='Enter both node names.';return;}
  var fromN=RAW_NODES.find(function(n){return n.label.toLowerCase().includes(fromQ);});
  var toN=RAW_NODES.find(function(n){return n.label.toLowerCase().includes(toQ);});
  if(!fromN){resultEl.textContent='Source "'+fromQ+'" not found.';return;}
  if(!toN){resultEl.textContent='Target "'+toQ+'" not found.';return;}

  // BFS
  var adj={};
  RAW_EDGES.forEach(function(e){
    if(!adj[e.from])adj[e.from]=[];adj[e.from].push(e.to);
    if(!adj[e.to])adj[e.to]=[];adj[e.to].push(e.from);
  });
  var visited={};var queue=[[fromN.id]];visited[fromN.id]=true;var found=null;
  while(queue.length>0&&!found){
    var path=queue.shift();var last=path[path.length-1];
    if(last===toN.id){found=path;break;}
    if(path.length>10)continue;
    (adj[last]||[]).forEach(function(nb){
      if(!visited[nb]){visited[nb]=true;queue.push(path.concat(nb));}
    });
  }
  if(!found){resultEl.textContent='No path found (max 10 hops).';return;}

  // Highlight
  network.selectNodes(found);
  var pathEdgeIds=[];
  for(var i=0;i<found.length-1;i++){
    var a=found[i],b=found[i+1];
    edgesDS.forEach(function(e){if((e.from===a&&e.to===b)||(e.from===b&&e.to===a))pathEdgeIds.push(e.id);});
  }
  network.setSelection({nodes:found,edges:pathEdgeIds});
  network.fit({nodes:found,animation:true});

  var labels=found.map(function(nid){var n=nodesDS.get(nid);return n?n.label:nid;});
  resultEl.innerHTML='<b>'+found.length+' nodes, '+(found.length-1)+' hops:</b><br>'+labels.map(function(l){return esc(l);}).join(' → ');
});

/* ── Toolbar buttons ── */
document.getElementById('btn-fit').onclick=function(){network.fit({animation:true});};
document.getElementById('btn-zoom-in').onclick=function(){var s=network.getScale();network.moveTo({scale:s*1.3,animation:true});};
document.getElementById('btn-zoom-out').onclick=function(){var s=network.getScale();network.moveTo({scale:s/1.3,animation:true});};
document.getElementById('btn-labels').onclick=function(){
  labelsOn=!labelsOn;
  this.classList.toggle('active',labelsOn);
  nodesDS.update(RAW_NODES.map(function(n){return{id:n.id,font:{size:labelsOn?11:n.font.size,color:'#ffffff'}};}));
};
document.getElementById('btn-physics').onclick=function(){
  physicsOn=!physicsOn;
  this.classList.toggle('active',physicsOn);
  network.setOptions({physics:{enabled:physicsOn}});
};
document.getElementById('btn-screenshot').onclick=function(){
  var canvas=container.getElementsByTagName('canvas')[0];
  if(!canvas)return;
  var link=document.createElement('a');link.download='graph.png';link.href=canvas.toDataURL('image/png');link.click();
};

/* ── Keyboard shortcuts ── */
document.addEventListener('keydown',function(e){
  if(e.target.tagName==='INPUT')return;
  if(e.key==='f'||e.key==='F')network.fit({animation:true});
  if(e.key==='l'||e.key==='L')document.getElementById('btn-labels').click();
  if(e.key==='p'||e.key==='P')document.getElementById('btn-physics').click();
  if(e.key==='s'||e.key==='S')document.getElementById('btn-screenshot').click();
  if(e.key==='/'){{e.preventDefault();searchInput.focus();}}
  if(e.key==='Escape'){network.unselectAll();searchInput.blur();}
});
<\/script>
</body>
</html>`;
    writeFileSync(htmlPath, html, 'utf-8');
    return htmlPath;
}
//# sourceMappingURL=visualize.js.map