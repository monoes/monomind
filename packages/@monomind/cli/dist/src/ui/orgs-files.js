// packages/@monomind/cli/dist/src/ui/orgs-files.js
// Files tab + diff-view feature, split out of orgs.html to keep that file under
// the CLAUDE.md 500-line guideline. Loaded as a classic <script> right where this
// code used to live inline — shares the same global scope as orgs.html's main
// script (chatSessions, orgSessionMatch, esc, currentTab, loadChatSessions,
// viewArtifact are all defined there and referenced here by closure).

// ── Files tab: every asset produced by this org, grouped by path with full
// version history (not deduped) so successive writes to the same file can be
// diffed against each other, latest-touched file first ──
let filesGroups = [];

function collectOrgArtifacts() {
  const bySessions = chatSessions.filter(orgSessionMatch);
  const byPath = new Map(); // path -> [{ art, ts, from }]
  bySessions.forEach(s => (s.events || []).forEach(ev => {
    if (ev.type !== 'org:artifact') return;
    const art = ev.artifact || (ev.path ? { path: ev.path, label: ev.label, mimeType: ev.mimeType } : null);
    if (!art || !art.path) return;
    if (!byPath.has(art.path)) byPath.set(art.path, []);
    byPath.get(art.path).push({ art, ts: ev.ts || 0, from: ev.from || '' });
  }));
  const groups = [];
  byPath.forEach((versions, path) => {
    versions.sort((a, b) => a.ts - b.ts);
    groups.push({ path, versions, latest: versions[versions.length - 1] });
  });
  groups.sort((a, b) => b.latest.ts - a.latest.ts);
  return groups;
}

function mkFileCard(group) {
  const { art, ts, from } = group.latest;
  const el = document.createElement('div');
  el.className = 'file-card';
  const isText = (art.mimeType || '').startsWith('text/') || (art.mimeType || '') === 'application/json';
  const labelRaw = art.label || (art.path || 'file').split('/').pop();
  const timeStr = ts ? new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const meta = [from, art.path ? art.path.split('/').slice(-3).join('/') : null, timeStr].filter(Boolean).join(' · ');
  const vBadge = group.versions.length > 1 ? `<span class="fc-vbadge">${group.versions.length}v</span>` : '';
  const diffable = group.versions.filter(v => typeof v.art.content === 'string').length >= 2;
  el.innerHTML = `
    <div class="fc-icon">📄</div>
    <div class="fc-body">
      <div class="fc-name">${esc(labelRaw)} ${vBadge}</div>
      <div class="fc-meta">${esc(meta)}</div>
    </div>
    ${diffable ? `<button class="fc-diff" onclick="openDiffPanel(${JSON.stringify(art.path)})">Diff</button>` : ''}
    ${isText && art.path
      ? `<button class="fc-view" onclick="viewArtifact(${JSON.stringify(art.path)},${JSON.stringify(labelRaw)})">View</button>`
      : `<span class="fc-binary">Binary</span>`}
  `;
  return el;
}

function paintFilesGrid() {
  const grid = document.getElementById('files-grid');
  const empty = document.getElementById('files-empty');
  if (!grid) return;
  filesGroups = collectOrgArtifacts();
  renderFilesGridFromGroups();
}

/** Re-renders the grid from the current in-memory `filesGroups` — no rescan.
 *  Split out of paintFilesGrid() so applyArtifactEvent() can repaint after an
 *  O(groups) incremental update instead of forcing a full O(all-events) rescan. */
function renderFilesGridFromGroups() {
  const grid = document.getElementById('files-grid');
  const empty = document.getElementById('files-empty');
  if (!grid) return;
  grid.innerHTML = '';
  if (!filesGroups.length) { if (empty) empty.style.display = 'block'; return; }
  if (empty) empty.style.display = 'none';
  filesGroups.forEach(group => grid.appendChild(mkFileCard(group)));
}

/** Incrementally folds a single new org:artifact event into `filesGroups` —
 *  O(groups) to re-sort by latest-touched, not O(all sessions' all events)
 *  like collectOrgArtifacts(). Mirrors collectOrgArtifacts()'s grouping rules. */
function applyArtifactEvent(ev) {
  const art = ev.artifact || (ev.path ? { path: ev.path, label: ev.label, mimeType: ev.mimeType } : null);
  if (!art || !art.path) return;
  const entry = { art, ts: ev.ts || 0, from: ev.from || '' };
  let group = filesGroups.find(g => g.path === art.path);
  if (!group) {
    group = { path: art.path, versions: [], latest: entry };
    filesGroups.push(group);
  }
  group.versions.push(entry);
  group.versions.sort((a, b) => a.ts - b.ts);
  group.latest = group.versions[group.versions.length - 1];
  filesGroups.sort((a, b) => b.latest.ts - a.latest.ts);
  renderFilesGridFromGroups();
}

function renderFilesTab() {
  paintFilesGrid(); // paint immediately with whatever's cached
  loadChatSessions().then(() => { if (currentTab === 'files') paintFilesGrid(); });
}

// ── Diff view: compare two captured versions of the same file ──
window.openDiffPanel = function(path) {
  const group = filesGroups.find(g => g.path === path);
  if (!group) return;
  const versions = group.versions.filter(v => typeof v.art.content === 'string');
  if (versions.length < 2) return;
  const label = group.latest.art.label || path.split('/').pop();
  renderDiffPanel(label, versions);
};

function renderDiffPanel(label, versions) {
  let panel = document.getElementById('artifact-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'artifact-panel';
    panel.style.cssText = 'position:fixed;top:0;right:0;width:640px;height:100vh;background:#0a0a14;border-left:1px solid #333;z-index:1000;display:flex;flex-direction:column;overflow:hidden';
    document.body.appendChild(panel);
  }
  const optLabel = v => `${new Date(v.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · ${esc(v.from || '?')}`;
  const opts = versions.map((v, i) => `<option value="${i}">${optLabel(v)}</option>`).join('');
  panel.innerHTML = `
    <div style="padding:12px 14px;border-bottom:1px solid #1a1a2a;display:flex;align-items:center;gap:10px">
      <span style="font-size:13px;font-weight:700;color:#ccc;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label)} — diff</span>
      <button onclick="document.getElementById('artifact-panel').remove()" style="background:none;border:none;color:#888;font-size:16px;cursor:pointer">✕</button>
    </div>
    <div style="padding:8px 14px;border-bottom:1px solid #1a1a2a;display:flex;gap:8px;align-items:center;font-size:10px;color:#888">
      <select id="diff-from" style="background:#151520;color:#ccc;border:1px solid #333;border-radius:3px;padding:2px 6px;font-size:10px">${opts}</select>
      <span>→</span>
      <select id="diff-to" style="background:#151520;color:#ccc;border:1px solid #333;border-radius:3px;padding:2px 6px;font-size:10px">${opts}</select>
    </div>
    <div id="diff-body" style="flex:1;overflow:auto;font-size:11px;line-height:1.6;font-family:var(--mono,ui-monospace,monospace)"></div>
  `;
  panel.style.display = 'flex';
  const fromSel = document.getElementById('diff-from');
  const toSel = document.getElementById('diff-to');
  fromSel.value = String(versions.length - 2);
  toSel.value = String(versions.length - 1);
  const recompute = () => renderDiffBody(versions[Number(fromSel.value)].art.content, versions[Number(toSel.value)].art.content);
  fromSel.onchange = recompute;
  toSel.onchange = recompute;
  recompute();
}

function renderDiffBody(oldText, newText) {
  const body = document.getElementById('diff-body');
  if (!body) return;
  if (oldText === newText) {
    body.innerHTML = '<div style="padding:14px;color:#666">No differences between these two versions.</div>';
    return;
  }
  const rows = diffLines(oldText, newText);
  if (!rows) {
    body.innerHTML = '<div style="padding:14px;color:#666">File too large to diff line-by-line.</div>';
    return;
  }
  body.innerHTML = rows.map(r => {
    const style = r.type === 'add' ? 'background:#0d2818;color:#7ee787'
      : r.type === 'del' ? 'background:#2d0d10;color:#ffa198' : 'color:#8b949e';
    const prefix = r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' ';
    return `<div style="${style};padding:1px 12px;white-space:pre-wrap;word-break:break-word">${esc(prefix + ' ' + r.text)}</div>`;
  }).join('');
}

/** Line-level LCS diff. Returns null (caller shows a fallback message) rather
 *  than hanging the tab if both files are unexpectedly huge — the O(n*m) DP
 *  table would otherwise blow past what's reasonable to allocate client-side.
 *  Bounds n and m individually, not just their product: a lopsided pair (e.g.
 *  n=1, m=4000000 — one huge file diffed against a near-empty one) passes the
 *  product check but still allocates a 4M-row DP table, one row per line of A. */
function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  const n = A.length, m = B.length;
  const DIFF_MAX_LINES = 20000;
  if (n > DIFF_MAX_LINES || m > DIFF_MAX_LINES || n * m > 4000000) return null;
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ type: 'ctx', text: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: A[i] }); i++; }
    else { out.push({ type: 'add', text: B[j] }); j++; }
  }
  while (i < n) { out.push({ type: 'del', text: A[i] }); i++; }
  while (j < m) { out.push({ type: 'add', text: B[j] }); j++; }
  return out;
}
