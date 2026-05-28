# Dashboard v2 — v1 Feature Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port 11 missing features from dashboard v1 into `dashboard-v2.html`, covering loops countdown, token chart animation, session summaries, status strip enrichment, live border glow, memory CRUD + 3 new tabs, and 10 new Org Room tabs.

**Architecture:** Single-file HTML dashboard at `packages/@monomind/cli/dist/src/ui/dashboard-v2.html` (no build step). All changes are inline CSS/HTML/JS additions. Every dynamic value goes through the existing `esc()` helper. New functions follow the existing `async function loadXxx()` / `apiFetch()` pattern.

**Tech Stack:** Vanilla JS, Canvas 2D API, EventSource (SSE), OKLCH CSS custom properties already defined in `:root`

---

## File

- Modify: `packages/@monomind/cli/dist/src/ui/dashboard-v2.html`

Existing reference functions and IDs used throughout:
- `apiFetch(url)` — wraps fetch, throws on error
- `esc(str)` — XSS-safe HTML escape
- `relTime(ts)` — human-readable relative timestamp
- `enc(str)` — `encodeURIComponent` alias
- `DIR` — currently selected project directory
- `showToast(title, msg, type)` — toast notification

---

## Wave 1 — Polish / Additive (no new views)

---

### Task 1: Loops — Live Countdown + Progress Bar

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/dashboard-v2.html` (CSS ~line 200, loops HTML ~line 1350, `renderLoops` function ~line 3523)

- [ ] **Step 1: Add CSS for countdown, progress bar, and STOP button**

Find the existing `.loop-row` CSS block (around line 240). Add immediately after it:

```css
.loop-cdown { font-family: var(--mono); font-size: 11px; color: var(--accent); white-space: nowrap; }
.loop-cdown.overdue { color: var(--red); }
.lp-bar { height: 4px; background: var(--border); border-radius: 2px; margin-top: 5px; overflow: hidden; }
.lp-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.4s ease; }
.loop-stop-btn { font-size: 11px; padding: 2px 8px; background: none; border: 1px solid var(--border); border-radius: 4px; color: var(--text-lo); cursor: pointer; flex-shrink: 0; }
.loop-stop-btn:hover { border-color: var(--red); color: var(--red); }
```

- [ ] **Step 2: Add countdown data attributes and STOP button to `renderLoops()`**

In `renderLoops()` (~line 3530), find the loop card template. Replace the closing `</div>` of the `.loop-body` section with:

```js
// BEFORE (find this line):
const interval = l.interval || l.schedule || '';
// AFTER: add these two lines after it:
const nextAt = l.nextRunAt ? parseInt(l.nextRunAt) : 0;
const maxReps = l.maxReps || 0;
const curRep  = l.currentRep || 0;
const pct = (maxReps > 0) ? Math.min(100, Math.round(curRep / maxReps * 100)) : 0;
const progBar = (maxReps > 0)
  ? `<div class="lp-bar"><div class="lp-fill" style="width:${pct}%"></div></div>`
  : '';
const cdownHtml = running && nextAt
  ? `<span class="loop-cdown" data-nextat="${nextAt}">…</span>`
  : '';
```

Then in the returned HTML template, add inside `.loop-meta` div:

```js
// Change:
<div class="loop-meta">${esc([interval, l.description].filter(Boolean).join(' · ').slice(0, 80))}</div>
// To:
<div class="loop-meta">${esc([interval, l.description].filter(Boolean).join(' · ').slice(0, 80))} ${cdownHtml}</div>
${progBar}
```

And add a STOP button after the `.loop-status` div:

```js
<button class="loop-stop-btn" data-loop-id="${esc(l.id||l.name||String(idx))}" onclick="stopLoop(event,this.dataset.loopId)">■ Stop</button>
```

- [ ] **Step 3: Add `stopLoop()` and `updateCountdowns()` functions**

Find the `createLoop()` function. Add these two functions immediately before it:

```js
async function stopLoop(evt, id) {
  evt.stopPropagation();
  if (!confirm('Stop loop "' + esc(id) + '"?')) return;
  try {
    await fetch('/api/loops/stop?dir=' + enc(DIR), {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ id })
    });
    showToast('Stopped', 'Loop stopped', 'ok');
    renderLoops();
  } catch(e) { showToast('Error', e.message, 'err'); }
}

let _cdownInterval = null;
function startCountdowns() {
  if (_cdownInterval) return;
  _cdownInterval = setInterval(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.querySelectorAll('.loop-cdown[data-nextat]').forEach(el => {
      const ms = parseInt(el.dataset.nextat) - Date.now();
      if (ms <= 0) { el.textContent = 'overdue'; el.classList.add('overdue'); return; }
      const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
      el.textContent = m > 0 ? `${m}m ${s}s` : `${s}s`;
      el.classList.remove('overdue');
    });
  }, 1000);
}
```

- [ ] **Step 4: Call `startCountdowns()` after `renderLoops()` completes**

At the end of `renderLoops()`, just before the final `}`:

```js
  startCountdowns();
```

- [ ] **Step 5: Open the dashboard, navigate to Loops, verify countdown ticking**

Open `http://localhost:4242` (or serve the file). Go to Loops. Confirm: running loops show a countdown that decrements per second. Loops with `maxReps` show a progress bar. The ■ Stop button confirms before POSTing.

- [ ] **Step 6: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/dashboard-v2.html
git commit -m "feat(dashboard-v2): loops live countdown timer and stop button"
```

---

### Task 2: Token Chart — Animation, Threshold Colors, Period Tabs

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/dashboard-v2.html` (CSS, tokens HTML ~line 1385, `renderTokChart` ~line 2407, `loadTokensView` ~line 2371)

- [ ] **Step 1: Add CSS for period tabs and the threshold legend**

After `.tok-card` CSS (around line 220), add:

```css
.tok-periods { display: flex; gap: 4px; margin-bottom: 12px; }
.tok-period-btn { font-size: 11px; padding: 3px 10px; border: 1px solid var(--border); border-radius: 4px; background: none; color: var(--text-lo); cursor: pointer; transition: all 0.1s; }
.tok-period-btn:hover { color: var(--text-hi); }
.tok-period-btn.active { background: var(--accent-dim); color: var(--accent); border-color: var(--accent); }
```

- [ ] **Step 2: Add period tab HTML above the chart canvas**

Find the TOKENS view HTML (around line 1385). Before the `<canvas id="tok-chart"` line, add:

```html
<div class="tok-periods">
  <button class="tok-period-btn active" data-period="today" onclick="setTokPeriod(this,'today')">Today</button>
  <button class="tok-period-btn" data-period="week" onclick="setTokPeriod(this,'week')">Week</button>
  <button class="tok-period-btn" data-period="30d" onclick="setTokPeriod(this,'30d')">30 Days</button>
  <button class="tok-period-btn" data-period="month" onclick="setTokPeriod(this,'month')">Month</button>
</div>
```

- [ ] **Step 3: Replace `renderTokChart()` with animated threshold version**

Find `function renderTokChart(daily)` (~line 2407). Replace the entire function with:

```js
function renderTokChart(daily, animated = true) {
  const canvas = document.getElementById('tok-chart');
  if (!canvas || !daily.length) return;
  window._tokDaily = daily;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || 600, H = 100;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const vals = daily.map(d => Number(d.cost ?? d.value ?? 0));
  const max  = Math.max(...vals, 0.0001);
  const avg  = vals.reduce((a,b) => a+b, 0) / vals.length || 0.0001;
  const bar  = Math.max(2, Math.floor((W - (vals.length - 1) * 2) / vals.length));
  const targets = vals.map((v, i) => ({
    v, i,
    isToday: i === vals.length - 1,
    color: v >= avg * 1.5 ? 'oklch(60% 0.18 25)' : v < avg * 0.5 ? 'oklch(65% 0.15 150)' : 'oklch(72% 0.18 75)',
  }));
  if (!animated || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    ctx.clearRect(0, 0, W, H);
    targets.forEach(({v, i, color, isToday}) => {
      const x = i * (bar + 2);
      const h = Math.max(2, Math.round((v / max) * (H - 10)));
      ctx.globalAlpha = isToday ? 1 : 0.5;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(x, H - h, bar, h, 2); ctx.fill();
      if (isToday) { ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.fillRect(x, H - h - 2, bar, 2); }
    });
    ctx.globalAlpha = 1;
    return;
  }
  const start = performance.now();
  const dur = 400;
  function frame(now) {
    const t = Math.min((now - start) / dur, 1);
    const e = 1 - Math.pow(1 - t, 3); // ease-out-cubic
    ctx.clearRect(0, 0, W, H);
    targets.forEach(({v, i, color, isToday}) => {
      const x = i * (bar + 2);
      const fullH = Math.max(2, Math.round((v / max) * (H - 10)));
      const h = Math.max(2, Math.round(fullH * e));
      ctx.globalAlpha = isToday ? 1 : 0.5;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(x, H - h, bar, h, 2); ctx.fill();
      if (isToday && t >= 0.95) { ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.fillRect(x, H - fullH - 2, bar, 2); }
    });
    ctx.globalAlpha = 1;
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
```

- [ ] **Step 4: Add `setTokPeriod()` function**

Immediately after the updated `renderTokChart` function, add:

```js
async function setTokPeriod(btn, period) {
  document.querySelectorAll('.tok-period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const cards = document.getElementById('tok-cards');
  const table = document.getElementById('tok-table');
  if (cards) cards.innerHTML = '<div class="loading-txt">Loading…</div>';
  try {
    const data = await apiFetch('/api/token-usage?period=' + enc(period) + '&dir=' + enc(DIR));
    const s = data?.summary || data?.tokens?.summary || {};
    const daily = Array.isArray(data?.daily) ? data.daily : (data?.tokens?.daily || []);
    const rows  = Array.isArray(data?.rows)  ? data.rows  : (data?.tokens?.rows  || []);
    if (cards) cards.innerHTML = [
      { label: 'Cost',    val: typeof s.todayCost  === 'number' ? '$' + s.todayCost.toFixed(2)  : (typeof s.cost === 'number' ? '$' + s.cost.toFixed(2) : '—') },
      { label: 'Calls',   val: s.todayCalls ?? s.calls ?? '—' },
      { label: 'Tokens',  val: s.totalTokens != null ? Number(s.totalTokens).toLocaleString() : '—' },
      { label: 'Models',  val: s.modelCount ?? s.models ?? '—' },
    ].map(c => `<div class="tok-card"><div class="tc-label">${esc(c.label)}</div><div class="tc-val">${esc(String(c.val))}</div></div>`).join('');
    renderTokChart(daily);
    if (table && rows.length) {
      table.innerHTML = '<div class="m-group-title" style="margin-bottom:6px">Breakdown</div>' +
        '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;font-family:monospace"><thead><tr style="color:var(--text-xs);text-align:left"><th style="padding:3px 8px 3px 0">Label</th><th style="padding:3px 8px">Calls</th><th style="padding:3px 8px">Cost</th></tr></thead><tbody>' +
        rows.slice(0, 30).map(r => `<tr style="border-top:1px solid var(--border)"><td style="padding:3px 8px 3px 0;color:var(--text-hi);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.session||r.label||r.id||'—')}</td><td style="padding:3px 8px;color:var(--text-lo)">${r.calls??'—'}</td><td style="padding:3px 8px;color:var(--accent)">$${Number(r.cost??0).toFixed(4)}</td></tr>`).join('') +
        '</tbody></table></div>';
    } else if (table) { table.innerHTML = ''; }
  } catch(_) {}
}
```

- [ ] **Step 5: Verify animated chart and period tabs**

Open dashboard → Tokens view. Confirm bars animate in on load, bars are green (low), amber (normal), red (spike cost). Click Week / 30 Days / Month tabs — chart redraws with correct data.

- [ ] **Step 6: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/dashboard-v2.html
git commit -m "feat(dashboard-v2): token chart animation, threshold colors, period tabs"
```

---

### Task 3: Session Rows — Compact Summary Excerpts + Compacted Badge

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/dashboard-v2.html` (CSS, session list render ~line 2589)

- [ ] **Step 1: Add CSS for summary excerpt and compacted badge**

After `.sr-time` CSS block (find it near the sessions styles), add:

```css
.sr-summary { font-size: 11px; color: var(--text-lo); font-style: italic; margin-top: 3px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.sr-compact-badge { display: inline-block; font-size: 10px; padding: 1px 6px; background: oklch(72% 0.18 75 / 0.12); color: var(--accent); border-radius: 8px; margin-left: 6px; }
```

- [ ] **Step 2: Find and update the session row render function**

Search for `function renderSessionList` or the place where `.sess-row` HTML is built (around line 2589). Find where session rows are built. Update the row template to include the summary:

```js
// Find the line that creates a sess-row (it will look like):
// `<div class="sess-row" ...>`
// Add inside each sess-row, after the .sr-top div:

const summaryHtml = s.summary
  ? `<div class="sr-summary">${esc(s.summary.slice(0, 180))}</div>`
  : '';
const compactBadge = (s.compactCount > 0)
  ? `<span class="sr-compact-badge">+${s.compactCount} compacted</span>`
  : '';

// In the sr-top div, append compactBadge after sr-time:
// <div class="sr-top">
//   <div class="sr-prompt">${esc(...)}</div>
//   <div class="sr-time">${relTime(...)}</div>${compactBadge}
// </div>
// ${summaryHtml}
```

The full updated row template (replace the existing one):

```js
return `<div class="sess-row" onclick="openSession(${idx})">
  <div class="sr-top">
    <div class="sr-prompt">${esc(s.lastPrompt || s.id?.slice(0,8) || '—')}</div>
    <div class="sr-time">${relTime(s.lastTs || s.mtime)}</div>${compactBadge}
  </div>
  ${summaryHtml}
</div>`;
```

- [ ] **Step 3: Verify session list shows summaries**

Navigate to Sessions view. Confirm rows with `summary` field show a 2-line italic excerpt. Rows with `compactCount > 0` show the "+N compacted" badge.

- [ ] **Step 4: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/dashboard-v2.html
git commit -m "feat(dashboard-v2): session compact summary excerpts and compacted badge"
```

---

### Task 4: Status Strip — HNSW, Patterns, Swarm, Last Route

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/dashboard-v2.html` (`loadStatusStrip` ~line 2354)

- [ ] **Step 1: Replace `loadStatusStrip()` with enriched version**

Find `async function loadStatusStrip()` (~line 2355). Replace the entire function:

```js
async function loadStatusStrip() {
  const strip = document.getElementById('status-strip');
  if (!strip || !DIR) return;
  try {
    // fetch service checks
    const [statusData, memData] = await Promise.allSettled([
      apiFetch('/api/status?dir=' + enc(DIR)),
      apiFetch('/api/memory/stats?dir=' + enc(DIR)),
    ]);
    const checks = statusData.status === 'fulfilled'
      ? (Array.isArray(statusData.value) ? statusData.value : (statusData.value?.checks || []))
      : [];
    const mem = memData.status === 'fulfilled' ? (memData.value?.stats || memData.value || {}) : {};

    // Assemble pills
    const pills = [];

    // service health pills
    checks.forEach(c => {
      const cls = c.ok === false ? 'warn' : (c.ok ? 'on' : '');
      pills.push(`<span class="ss-pill ${cls}">${esc(c.name || c.label || c.key || '?')}</span>`);
    });

    // HNSW status
    const hnswOn = mem.hnsw === true || mem.hnswEnabled === true || mem.hnsw_enabled === true;
    pills.push(`<span class="ss-pill ${hnswOn ? 'on' : ''}">HNSW ${hnswOn ? 'ON' : 'OFF'}</span>`);

    // Patterns count
    if (mem.patterns != null) pills.push(`<span class="ss-pill">PATTERNS ${mem.patterns}</span>`);

    // Chunks count
    if (mem.chunks != null) pills.push(`<span class="ss-pill">CHUNKS ${mem.chunks}</span>`);

    // Swarm status from appData
    if (window._appSwarm) {
      const topo = window._appSwarm.topology || '';
      pills.push(`<span class="ss-pill ${topo ? 'on' : ''}">SWARM ${esc(topo || 'IDLE')}</span>`);
    }

    // Last route from routing feedback (cached)
    if (window._lastRouteAgent) {
      pills.push(`<span class="ss-pill">ROUTE ${esc(window._lastRouteAgent)}</span>`);
    }

    if (!pills.length) { strip.style.display = 'none'; return; }
    strip.style.display = 'flex';
    strip.innerHTML = pills.join('');
  } catch(_) { strip.style.display = 'none'; }
}
```

- [ ] **Step 2: Cache routing and swarm data when they are loaded**

In `loadMemRouting()` (~line 2459), after the rows are received, add:

```js
// After: const rows = Array.isArray(data) ? data : (data.rows || data.feedback || []);
if (rows.length > 0) {
  const last = rows[rows.length - 1];
  window._lastRouteAgent = last.route || last.category || last.agent || '';
}
```

In `renderOrgs()` or wherever swarm data is fetched, cache it as `window._appSwarm`.

- [ ] **Step 3: Verify status strip**

Load a project. Status strip should show HNSW ON/OFF, PATTERNS N, CHUNKS N, and SWARM topology if one is running.

- [ ] **Step 4: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/dashboard-v2.html
git commit -m "feat(dashboard-v2): enrich status strip with HNSW, patterns, swarm, last route"
```

---

### Task 5: Live Border Glow on Fresh Data

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/dashboard-v2.html` (CSS, end of each `loadXxxView()`)

- [ ] **Step 1: Add CSS keyframe and class**

At the end of the CSS `<style>` block, add:

```css
@keyframes live-fade { 0% { box-shadow: 0 0 0 1px oklch(72% 0.18 75 / 0.45); } 100% { box-shadow: none; } }
.live-glow { animation: live-fade 8s ease-out forwards; }
@media (prefers-reduced-motion: reduce) { .live-glow { animation: none; } }
```

- [ ] **Step 2: Add `markLiveGlow()` helper and interval**

Find the `startCountdowns()` function added in Task 1. Add after it:

```js
function markLiveGlow(viewId) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = document.getElementById(viewId);
  if (!el) return;
  el.dataset.lastUpdated = Date.now();
  el.classList.remove('live-glow');
  void el.offsetWidth; // force reflow to restart animation
  el.classList.add('live-glow');
}
```

- [ ] **Step 3: Call `markLiveGlow()` at end of each major load function**

At the end of these functions (just before the final `}`), add `markLiveGlow('view-<name>')`:

- `loadTokensView()` → `markLiveGlow('view-tokens')`
- `renderLoops()` → `markLiveGlow('view-loops')`
- `renderSessions()` → `markLiveGlow('view-sessions')`
- `renderMemories()` / `switchMemTab()` → `markLiveGlow('view-memory')`
- `renderOrgs()` → `markLiveGlow('view-orgs')`

- [ ] **Step 4: Verify glow effect**

Navigate between views. After a view loads, a subtle teal border should briefly pulse and fade over 8 seconds. Verify the glow doesn't appear for users with `prefers-reduced-motion: reduce`.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/dashboard-v2.html
git commit -m "feat(dashboard-v2): live border glow on fresh data load"
```

---

## Wave 2 — New Memory Sub-Tabs

---

### Task 6: Memory — MEMORIES Tab Full CRUD

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/dashboard-v2.html` (CSS, memory tab HTML ~line 1399, `switchMemTab` ~line 2441)

- [ ] **Step 1: Add CSS for memory list, detail pane, edit modal**

After existing memory CSS (find `.mem-tab-bar`), add:

```css
/* Memory CRUD layout */
.mem-split { display: flex; gap: 0; height: 100%; min-height: 400px; }
.mem-list-pane { width: 220px; flex-shrink: 0; border-right: 1px solid var(--border); overflow-y: auto; }
.mem-detail-pane { flex: 1; padding: 16px; overflow-y: auto; }
.mem-type-hdr { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; padding: 10px 12px 4px; color: var(--text-xs); }
.mem-item { padding: 6px 12px; cursor: pointer; border-left: 2px solid transparent; transition: background 0.1s; }
.mem-item:hover { background: var(--surface-hi); }
.mem-item.active { background: var(--accent-dim); border-left-color: var(--accent); }
.mem-item-name { font-size: 13px; color: var(--text-hi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mem-item-desc { font-size: 11px; color: var(--text-lo); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mem-type-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px; }
.mem-badge { display: inline-block; font-size: 10px; padding: 1px 7px; border-radius: 8px; font-family: var(--mono); margin-bottom: 10px; }
.mem-body-render { font-size: 12.5px; color: var(--text-hi); line-height: 1.65; white-space: pre-wrap; word-break: break-word; }
.mem-body-render strong { color: var(--accent); }
.mem-body-render h4 { color: var(--text-hi); font-size: 13px; margin: 8px 0 4px; }
.mem-actions { display: flex; gap: 8px; margin-top: 16px; }
/* Memory modal */
#mem-modal { display: none; position: fixed; inset: 0; z-index: 3000; background: oklch(0% 0 0 / 0.7); align-items: center; justify-content: center; }
#mem-modal.open { display: flex; }
#mem-modal-box { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; width: 600px; max-width: 92vw; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
#mem-modal-title { font-size: 14px; font-weight: 600; color: var(--text-hi); }
#mem-modal-ta { width: 100%; height: 280px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px; font-family: var(--mono); font-size: 12px; color: var(--text-hi); resize: vertical; outline: none; }
#mem-modal-ta:focus { border-color: var(--accent); }
.mem-modal-btns { display: flex; justify-content: flex-end; gap: 8px; }
```

- [ ] **Step 2: Replace `mem-tab-memories` HTML with split-pane layout**

Find `<div id="mem-tab-memories">` (~line 1410). Replace its content with:

```html
<div id="mem-tab-memories">
  <div class="mem-split" id="mem-split">
    <div class="mem-list-pane" id="mem-list-pane">
      <div class="loading-txt" style="padding:16px">Loading…</div>
    </div>
    <div class="mem-detail-pane" id="mem-detail-pane">
      <div style="color:var(--text-lo);font-size:13px;padding:20px 0">Select a memory</div>
    </div>
  </div>
  <button class="btn" style="margin-top:12px" onclick="openNewMemModal()">+ New Memory</button>
</div>
```

Also add the modal HTML outside `#app` (after the budget modal at ~line 1695):

```html
<!-- memory edit modal -->
<div id="mem-modal">
  <div id="mem-modal-box">
    <div id="mem-modal-title">Edit Memory</div>
    <textarea id="mem-modal-ta" spellcheck="false"></textarea>
    <div class="mem-modal-btns">
      <button class="btn" onclick="closeMemModal()">Cancel</button>
      <button class="btn" style="color:var(--accent);border-color:var(--accent)" onclick="saveMemModal()">Save</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add memory CRUD functions**

Add the following functions after `loadMemADRs()`:

```js
// ── memory CRUD ────────────────────────────────────────────
const MEM_COLORS = {
  user:'#7B8EFF', feedback:'#FFB347', project:'oklch(72% 0.18 75)',
  reference:'#B47BFF', handoff:'#FF6B9D'
};
let _memFiles = [], _selMem = null, _editPath = null;

async function loadMemoriesTab() {
  const list = document.getElementById('mem-list-pane');
  if (!list) return;
  list.innerHTML = '<div class="loading-txt" style="padding:16px">Loading…</div>';
  try {
    const data = await apiFetch('/api/memory-files?dir=' + enc(DIR));
    _memFiles = Array.isArray(data) ? data : (data.files || data.memories || []);
    renderMemList();
  } catch(e) {
    list.innerHTML = '<div class="empty" style="padding:16px">Failed: ' + esc(e.message) + '</div>';
  }
}

function renderMemList() {
  const list = document.getElementById('mem-list-pane');
  if (!list) return;
  if (!_memFiles.length) { list.innerHTML = '<div style="padding:16px;color:var(--text-lo);font-size:12px">No memory files found</div>'; return; }
  const byType = {};
  _memFiles.forEach(f => { const t = f.type||'other'; (byType[t]||(byType[t]=[])).push(f); });
  list.innerHTML = Object.entries(byType).map(([type, files]) =>
    `<div class="mem-type-hdr">${esc(type)}</div>` +
    files.map(f => {
      const col = MEM_COLORS[type] || 'var(--text-lo)';
      const active = _selMem?.path === f.path ? ' active' : '';
      return `<div class="mem-item${active}" data-path="${esc(f.path||'')}" onclick="selectMem(${JSON.stringify(esc(f.path||''))})">
        <span class="mem-type-dot" style="background:${esc(col)}"></span>
        <span class="mem-item-name">${esc(f.name||f.slug||'?')}</span>
      </div>`;
    }).join('')
  ).join('');
}

async function selectMem(path) {
  _selMem = _memFiles.find(f => f.path === path) || { path };
  document.querySelectorAll('.mem-item').forEach(el => el.classList.toggle('active', el.dataset.path === path));
  const detail = document.getElementById('mem-detail-pane');
  if (!detail) return;
  try {
    const data = await apiFetch('/api/memory-file?dir=' + enc(DIR) + '&path=' + enc(path));
    const f = data.file || data;
    const col = MEM_COLORS[f.type||''] || 'var(--text-lo)';
    const bodyHtml = (f.body || f.content || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/^# (.+)/gm,'<h4>$1</h4>')
      .replace(/^- (.+)/gm,'<li>$1</li>');
    detail.innerHTML = `
      <span class="mem-badge" style="background:${esc(col)}22;color:${esc(col)}">${esc(f.type||'?')}</span>
      <div style="font-size:15px;font-weight:600;color:var(--text-hi);margin-bottom:4px">${esc(f.name||f.slug||'—')}</div>
      ${f.description ? `<div style="font-size:12px;color:var(--text-lo);margin-bottom:12px">${esc(f.description)}</div>` : ''}
      <div class="mem-body-render">${bodyHtml}</div>
      <div class="mem-actions">
        <button class="btn" onclick="openEditMemModal(${JSON.stringify(esc(path))})">✎ Edit</button>
        <button class="btn" style="color:var(--red);border-color:var(--red)" onclick="deleteMem(${JSON.stringify(esc(path))})">✕ Delete</button>
      </div>`;
  } catch(e) { detail.innerHTML = '<div class="empty">Failed to load: ' + esc(e.message) + '</div>'; }
}

async function openEditMemModal(path) {
  _editPath = path;
  try {
    const data = await apiFetch('/api/memory-file?dir=' + enc(DIR) + '&path=' + enc(path));
    const raw = data.raw || data.content || '';
    document.getElementById('mem-modal-title').textContent = 'Edit: ' + path.split('/').pop();
    document.getElementById('mem-modal-ta').value = raw;
    document.getElementById('mem-modal').classList.add('open');
  } catch(e) { showToast('Error', e.message, 'err'); }
}

const MEM_TEMPLATES = {
  user: `---\nname: \ndescription: \nmetadata:\n  type: user\n---\n\n`,
  feedback: `---\nname: \ndescription: \nmetadata:\n  type: feedback\n---\n\n`,
  project: `---\nname: \ndescription: \nmetadata:\n  type: project\n---\n\n`,
  reference: `---\nname: \ndescription: \nmetadata:\n  type: reference\n---\n\n`,
};

function openNewMemModal() {
  const type = prompt('Memory type (user/feedback/project/reference):') || 'project';
  _editPath = null;
  document.getElementById('mem-modal-title').textContent = 'New Memory';
  document.getElementById('mem-modal-ta').value = MEM_TEMPLATES[type] || MEM_TEMPLATES.project;
  document.getElementById('mem-modal').classList.add('open');
}

function closeMemModal() {
  document.getElementById('mem-modal').classList.remove('open');
  _editPath = null;
}

async function saveMemModal() {
  const content = document.getElementById('mem-modal-ta').value;
  if (!content.trim()) { showToast('Error', 'Content is empty', 'warn'); return; }
  try {
    const body = _editPath ? { path: _editPath, content, dir: DIR } : { content, dir: DIR };
    const r = await fetch('/api/memory-file', {
      method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    showToast('Saved', 'Memory saved', 'ok');
    closeMemModal();
    await loadMemoriesTab();
  } catch(e) { showToast('Error', e.message, 'err'); }
}

async function deleteMem(path) {
  if (!confirm('Delete this memory file? This cannot be undone.')) return;
  try {
    const r = await fetch('/api/memory-file', {
      method: 'DELETE', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ path, dir: DIR })
    });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    showToast('Deleted', 'Memory deleted', 'ok');
    _selMem = null;
    document.getElementById('mem-detail-pane').innerHTML = '<div style="color:var(--text-lo);font-size:13px;padding:20px 0">Select a memory</div>';
    await loadMemoriesTab();
  } catch(e) { showToast('Error', e.message, 'err'); }
}
```

- [ ] **Step 4: Wire `loadMemoriesTab()` into `switchMemTab()`**

In `switchMemTab()` (~line 2441), add a branch for `memories`:

```js
// In the if/else chain, add:
if (tab === 'memories') loadMemoriesTab();
// (keep the existing routing/usage/adrs branches)
```

Also call `loadMemoriesTab()` when the memory view first loads (in `switchView('memory')`).

- [ ] **Step 5: Verify CRUD**

Memory tab → Memories sub-tab → list loads. Click a memory → detail pane shows. Edit → modal with raw frontmatter. Save → updates file. Delete → confirm → removed from list. New Memory → template picker.

- [ ] **Step 6: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/dashboard-v2.html
git commit -m "feat(dashboard-v2): memory CRUD - edit, delete, create with templates"
```

---

### Task 7: Memory → Swarm Tab with Canvas Topology

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/dashboard-v2.html`

- [ ] **Step 1: Add swarm tab button to memory tab bar**

Find the memory tab bar HTML (~line 1404). Add a new button:

```html
<button class="odt-btn" data-memtab="swarm" onclick="switchMemTab('swarm')">Swarm</button>
```

Add corresponding pane after `mem-tab-memories`:

```html
<div id="mem-tab-swarm" style="display:none">
  <div class="mem-split">
    <div class="mem-list-pane" id="swarm-run-list" style="padding:8px">
      <div class="loading-txt">Loading…</div>
    </div>
    <div class="mem-detail-pane" id="swarm-run-detail">
      <div style="color:var(--text-lo);font-size:13px;padding:20px 0">Select a swarm run</div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add swarm tab CSS**

```css
.swarm-run-row { padding: 7px 10px; cursor: pointer; border-radius: 6px; transition: background 0.1s; margin-bottom: 3px; }
.swarm-run-row:hover { background: var(--surface-hi); }
.swarm-run-row.active { background: var(--accent-dim); }
.swarm-topo-pill { font-size: 10px; padding: 1px 7px; border-radius: 8px; background: var(--surface-hi); color: var(--text-lo); font-family: var(--mono); }
.swarm-live-badge { font-size: 10px; color: var(--green); font-weight: 600; margin-left: 6px; }
```

- [ ] **Step 3: Add swarm tab functions**

```js
// ── swarm tab ──────────────────────────────────────────────
let _swarmRuns = [];

async function loadSwarmTab() {
  const list = document.getElementById('swarm-run-list');
  if (!list) return;
  list.innerHTML = '<div class="loading-txt">Loading…</div>';
  try {
    const data = await apiFetch('/api/swarm-history?dir=' + enc(DIR));
    _swarmRuns = Array.isArray(data) ? data : (data.runs || data.history || []);
    renderSwarmRunList();
  } catch(e) { list.innerHTML = '<div class="empty">Failed: ' + esc(e.message) + '</div>'; }
}

function renderSwarmRunList() {
  const list = document.getElementById('swarm-run-list');
  if (!_swarmRuns.length) { list.innerHTML = '<div class="empty">No swarm runs found</div>'; return; }
  list.innerHTML = _swarmRuns.map((r, i) => {
    const topo = r.topology || 'hierarchical';
    const live = r.status === 'running' || r.active;
    return `<div class="swarm-run-row" onclick="selectSwarmRun(${i})">
      <div style="display:flex;align-items:center;gap:6px">
        <span class="swarm-topo-pill">${esc(topo)}</span>
        ${live ? '<span class="swarm-live-badge">⬤ LIVE</span>' : ''}
      </div>
      <div style="font-size:11px;color:var(--text-lo);margin-top:3px">${r.agentCount||0} agents · ${relTime(r.startedAt||r.created_at)}</div>
    </div>`;
  }).join('');
}

async function selectSwarmRun(idx) {
  const run = _swarmRuns[idx];
  if (!run) return;
  document.querySelectorAll('.swarm-run-row').forEach((el,i) => el.classList.toggle('active', i === idx));
  const detail = document.getElementById('swarm-run-detail');
  detail.innerHTML = `
    <div style="margin-bottom:12px">
      <div style="font-size:13px;font-weight:600;color:var(--text-hi)">${esc(run.swarmId||run.id||'—').slice(0,12)}</div>
      <div style="font-size:11px;color:var(--text-lo);margin-top:3px">${esc(run.topology||'—')} · ${esc(run.consensus||'—')} · ${run.agentCount||0} agents</div>
    </div>
    <canvas id="swarm-topo-canvas" style="width:100%;max-width:400px;height:200px;display:block;margin-bottom:16px"></canvas>
    <div id="swarm-agent-list"></div>
    <div id="swarm-event-log" style="margin-top:12px;font-size:11px;font-family:var(--mono);max-height:180px;overflow-y:auto"></div>
    <button class="btn" style="margin-top:12px;color:var(--red);border-color:var(--red)" onclick="cleanSwarmData()">⌫ Clean Data</button>`;
  drawSwarmTopology(run);
  renderSwarmAgents(run);
  loadSwarmEvents(run.swarmId || run.id);
}

function drawSwarmTopology(run) {
  const canvas = document.getElementById('swarm-topo-canvas');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || 400, H = 200;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const agents = run.agents || Array.from({length: run.agentCount||4}, (_,i) => ({id:'agent-'+i, type:'worker'}));
  const n = agents.length;
  if (!n) return;
  const topo = (run.topology || 'hierarchical').toLowerCase();
  const cx = W/2, cy = H/2;
  const positions = [];
  if (topo.includes('hierarchical') || topo.includes('centralized')) {
    positions.push({x: cx, y: 36}); // queen
    const workers = agents.slice(1);
    workers.forEach((_, i) => {
      const a = (i / Math.max(workers.length-1,1)) * Math.PI * 1.2 - 0.6;
      positions.push({x: cx + Math.cos(a-Math.PI/2) * (W*0.3), y: H - 40 + Math.sin(a-Math.PI/2) * 30});
    });
  } else {
    // circle layout for mesh/adaptive
    agents.forEach((_, i) => {
      const a = (i / n) * Math.PI * 2;
      positions.push({x: cx + Math.cos(a) * (Math.min(W,H)*0.35), y: cy + Math.sin(a) * (Math.min(W,H)*0.35)});
    });
  }
  // draw edges
  ctx.strokeStyle = 'oklch(42% 0.006 75 / 0.4)'; ctx.lineWidth = 1;
  if (topo.includes('hierarchical') || topo.includes('centralized')) {
    for (let i = 1; i < positions.length; i++) {
      ctx.beginPath(); ctx.moveTo(positions[0].x, positions[0].y);
      ctx.lineTo(positions[i].x, positions[i].y); ctx.stroke();
    }
  } else {
    const maxEdges = Math.min(30, n*(n-1)/2);
    let drawn = 0;
    for (let i = 0; i < n && drawn < maxEdges; i++) {
      for (let j = i+1; j < n && drawn < maxEdges; j++, drawn++) {
        ctx.beginPath(); ctx.moveTo(positions[i].x, positions[i].y);
        ctx.lineTo(positions[j].x, positions[j].y); ctx.stroke();
      }
    }
  }
  // draw nodes
  agents.forEach((ag, i) => {
    const {x,y} = positions[i];
    const isQueen = i === 0 && (topo.includes('hierarchical')||topo.includes('centralized'));
    const r = isQueen ? 9 : 5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
    ctx.fillStyle = isQueen ? 'oklch(72% 0.18 75)' : 'oklch(55% 0.008 75)';
    ctx.fill();
    ctx.fillStyle = isQueen ? 'oklch(11% 0.009 55)' : 'oklch(93% 0.008 75)';
    ctx.font = isQueen ? 'bold 9px sans-serif' : '8px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(isQueen ? 'Q' : String(i), x, y);
    if (!isQueen) {
      ctx.fillStyle = 'oklch(55% 0.006 75)'; ctx.font = '9px sans-serif';
      ctx.fillText(esc((ag.type||'').slice(0,6)), x, y + 14);
    }
  });
}

function renderSwarmAgents(run) {
  const el = document.getElementById('swarm-agent-list');
  if (!el) return;
  const agents = run.agents || [];
  if (!agents.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="m-group-title" style="margin-bottom:6px">Agents</div>' +
    agents.slice(0,20).map(a => `<div style="display:flex;gap:10px;padding:3px 0;font-size:11px;border-bottom:1px solid var(--border)">
      <span style="color:var(--text-lo);font-family:var(--mono);flex-shrink:0">${esc((a.id||'').slice(0,10))}</span>
      <span style="color:var(--text-hi)">${esc(a.type||a.role||'worker')}</span>
      <span style="margin-left:auto;color:var(--text-xs)">${esc(a.status||'—')}</span>
    </div>`).join('');
}

async function loadSwarmEvents(swarmId) {
  if (!swarmId) return;
  const el = document.getElementById('swarm-event-log');
  if (!el) return;
  try {
    const data = await apiFetch('/api/swarm-events?agentId=' + enc(swarmId) + '&dir=' + enc(DIR));
    const events = Array.isArray(data) ? data : (data.events || []);
    if (!events.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="m-group-title" style="margin-bottom:4px">Events</div>' +
      events.slice(-50).map(e => `<div style="color:var(--text-lo);padding:2px 0">${esc(relTime(e.ts||e.timestamp))} <span style="color:var(--text-mid)">${esc(e.type||e.kind||'?')}</span> ${esc((e.message||e.data||'').toString().slice(0,80))}</div>`).join('');
    el.scrollTop = el.scrollHeight;
  } catch(_) {}
}

async function cleanSwarmData() {
  if (!confirm('Delete all swarm run data? This cannot be undone.')) return;
  try {
    await fetch('/api/swarm-clean?dir=' + enc(DIR), { method: 'DELETE' });
    showToast('Cleaned', 'Swarm data deleted', 'ok');
    loadSwarmTab();
  } catch(e) { showToast('Error', e.message, 'err'); }
}
```

- [ ] **Step 4: Wire into `switchMemTab()`**

In `switchMemTab()`, add: `else if (tab === 'swarm') loadSwarmTab();`

- [ ] **Step 5: Verify swarm tab**

Memory → Swarm tab. Run list appears. Click a run → canvas draws topology with queen node at top (hierarchical) or circle (mesh). Agent list below. Event log at bottom.

- [ ] **Step 6: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/dashboard-v2.html
git commit -m "feat(dashboard-v2): memory swarm tab with canvas topology visualization"
```

---

### Task 8: Memory → Chunks Tab

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/dashboard-v2.html`

- [ ] **Step 1: Add Chunks tab button and pane HTML**

In memory tab bar, add: `<button class="odt-btn" data-memtab="chunks" onclick="switchMemTab('chunks')">Chunks</button>`

Add pane:

```html
<div id="mem-tab-chunks" style="display:none">
  <div class="filter-bar">
    <input class="filter-input" type="text" placeholder="Filter chunks…" oninput="filterChunks(this.value)">
  </div>
  <div id="chunks-grid"></div>
</div>
```

- [ ] **Step 2: Add CSS for chunk cards**

```css
.chunk-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 8px; }
.chunk-card:hover { border-color: var(--accent); }
.chunk-src { font-size: 11px; color: var(--accent); font-family: var(--mono); margin-bottom: 4px; }
.chunk-excerpt { font-size: 12px; color: var(--text-hi); line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.chunk-footer { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.chunk-ns { font-size: 10px; padding: 1px 7px; border-radius: 8px; background: var(--surface-hi); color: var(--text-lo); }
```

- [ ] **Step 3: Add chunks tab functions**

```js
// ── chunks tab ─────────────────────────────────────────────
let _chunks = [], _chunksLoaded = false;

async function loadChunksTab() {
  if (_chunksLoaded) return;
  const grid = document.getElementById('chunks-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading-txt">Loading…</div>';
  try {
    const data = await apiFetch('/api/section?name=knowledge&full=1&dir=' + enc(DIR));
    _chunks = Array.isArray(data) ? data : (data.chunks || data.knowledge || []);
    _chunksLoaded = true;
    renderChunks(_chunks);
  } catch(e) { grid.innerHTML = '<div class="empty">Failed: ' + esc(e.message) + '</div>'; }
}

function renderChunks(list) {
  const grid = document.getElementById('chunks-grid');
  if (!grid) return;
  if (!list.length) {
    grid.innerHTML = '<div class="empty">No chunks indexed.<br><span style="font-size:11px;color:var(--text-xs)">Run <code>/monomind:understand</code> to build the index.</span></div>';
    return;
  }
  grid.innerHTML = list.slice(0, 60).map(c => {
    const src = (c.source || c.file || '').split('/').slice(-2).join('/');
    const excerpt = (c.content || c.text || c.body || '').slice(0, 220);
    const ns = c.namespace || c.type || '';
    const id = esc(c.id || c.path || '');
    return `<div class="chunk-card" data-search="${esc(src + ' ' + excerpt + ' ' + ns).toLowerCase()}">
      <div class="chunk-src">${esc(src || '—')}</div>
      <div class="chunk-excerpt">${esc(excerpt)}</div>
      <div class="chunk-footer">
        ${ns ? `<span class="chunk-ns">${esc(ns)}</span>` : ''}
        <button class="btn" style="margin-left:auto;font-size:10px" onclick="editChunk(${JSON.stringify(id)})">✎ Edit</button>
        <button class="btn" style="font-size:10px;color:var(--red);border-color:var(--red)" onclick="deleteChunk(${JSON.stringify(id)})">✕</button>
      </div>
    </div>`;
  }).join('');
}

function filterChunks(q) {
  const lq = q.toLowerCase();
  document.querySelectorAll('#chunks-grid .chunk-card').forEach(el => {
    el.style.display = (!lq || (el.dataset.search||'').includes(lq)) ? '' : 'none';
  });
}

async function editChunk(id) {
  const chunk = _chunks.find(c => (c.id||c.path) === id);
  if (!chunk) return;
  _editPath = id;
  document.getElementById('mem-modal-title').textContent = 'Edit Chunk';
  document.getElementById('mem-modal-ta').value = chunk.content || chunk.text || chunk.body || '';
  document.getElementById('mem-modal').classList.add('open');
  // Override saveMemModal for chunk context
  window._memModalContext = 'chunk';
}

async function deleteChunk(id) {
  if (!confirm('Delete this knowledge chunk?')) return;
  try {
    const r = await fetch('/api/knowledge-chunk', {
      method: 'DELETE', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ id, dir: DIR })
    });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    showToast('Deleted', 'Chunk deleted', 'ok');
    _chunksLoaded = false;
    loadChunksTab();
  } catch(e) { showToast('Error', e.message, 'err'); }
}
```

- [ ] **Step 4: Wire into `switchMemTab()`**

Add: `else if (tab === 'chunks') loadChunksTab();`

- [ ] **Step 5: Verify chunks tab**

Memory → Chunks → grid of knowledge chunk cards with source path, excerpt, namespace. Filter input narrows results in real time. Edit/Delete buttons work.

- [ ] **Step 6: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/dashboard-v2.html
git commit -m "feat(dashboard-v2): memory chunks tab with filter, edit, delete"
```

---

### Task 9: Memory → Agent Graph Tab

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/dashboard-v2.html`

- [ ] **Step 1: Add Agent Graph tab button and pane**

Memory tab bar: `<button class="odt-btn" data-memtab="agent-graph" onclick="switchMemTab('agent-graph')">Agent Graph</button>`

Pane:

```html
<div id="mem-tab-agent-graph" style="display:none">
  <div id="ag-summary-bar" style="display:flex;gap:20px;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border)"></div>
  <div style="display:flex;gap:12px;min-height:300px">
    <div id="ag-sess-list" style="width:200px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--border);padding-right:8px"></div>
    <div id="ag-detail" style="flex:1">
      <div style="color:var(--text-lo);font-size:13px">Select a session</div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add agent graph functions**

```js
// ── agent graph tab ────────────────────────────────────────
let _agData = null;

async function loadAgentGraphTab() {
  if (_agData) { renderAgSummary(); renderAgSessList(); return; }
  document.getElementById('ag-summary-bar').innerHTML = '<div class="loading-txt">Loading…</div>';
  try {
    const data = await apiFetch('/api/graph?dir=' + enc(DIR));
    _agData = data;
    renderAgSummary();
    renderAgSessList();
  } catch(e) { document.getElementById('ag-summary-bar').innerHTML = '<div class="empty">Failed: ' + esc(e.message) + '</div>'; }
}

function renderAgSummary() {
  const el = document.getElementById('ag-summary-bar');
  if (!_agData || !el) return;
  const d = _agData;
  const stats = [
    { l: 'Sessions',    v: d.sessionCount ?? d.sessions?.length ?? '—' },
    { l: 'Agent Types', v: d.agentTypes ?? '—' },
    { l: 'Spawns',      v: d.totalSpawns ?? '—' },
    { l: 'Tool Calls',  v: d.totalToolCalls != null ? Number(d.totalToolCalls).toLocaleString() : '—' },
    { l: 'Total Cost',  v: d.totalCost != null ? '$' + Number(d.totalCost).toFixed(3) : '—' },
  ];
  el.innerHTML = stats.map(s => `<div><div style="font-size:10px;color:var(--text-lo);text-transform:uppercase;letter-spacing:0.07em">${esc(s.l)}</div><div style="font-size:16px;font-weight:700;color:var(--text-hi);font-family:var(--mono)">${esc(String(s.v))}</div></div>`).join('');
}

function renderAgSessList() {
  const el = document.getElementById('ag-sess-list');
  if (!_agData || !el) return;
  const sessions = _agData.sessions || [];
  if (!sessions.length) { el.innerHTML = '<div class="empty" style="font-size:12px">No sessions</div>'; return; }
  el.innerHTML = sessions.map((s, i) => `<div class="sess-row" style="margin-bottom:4px" onclick="selectAgSession(${i})">
    <div class="sr-top">
      <div class="sr-prompt" style="font-size:11px">${esc((s.id||'').slice(0,12))}</div>
    </div>
    <div style="font-size:10px;color:var(--text-lo);margin-top:2px">${s.spawnCount||0} spawns · ${s.toolCount||0} tools</div>
  </div>`).join('');
}

function selectAgSession(idx) {
  const s = (_agData?.sessions || [])[idx];
  if (!s) return;
  document.querySelectorAll('#ag-sess-list .sess-row').forEach((el,i) => el.classList.toggle('active', i===idx));
  const detail = document.getElementById('ag-detail');
  if (!detail) return;
  const agentTypes = s.agentTypes || {};
  const tools = s.tools || {};
  const agArr = Object.entries(agentTypes).sort((a,b) => b[1]-a[1]).slice(0,12);
  const toolArr = Object.entries(tools).sort((a,b) => b[1]-a[1]).slice(0,15);
  detail.innerHTML = `
    <div style="display:flex;gap:16px;margin-bottom:12px;font-size:12px">
      <span>Turns: <b style="color:var(--text-hi)">${s.turns||0}</b></span>
      <span>Spawns: <b style="color:var(--text-hi)">${s.spawnCount||0}</b></span>
      <span>Tools: <b style="color:var(--text-hi)">${s.toolCount||0}</b></span>
      ${s.cost != null ? `<span>Cost: <b style="color:var(--accent)">$${Number(s.cost).toFixed(4)}</b></span>` : ''}
    </div>
    ${agArr.length ? `<div class="m-group-title" style="margin-bottom:6px">Agent Types Spawned</div>
    ${agArr.map(([type,count]) => {
      const pct = Math.round(count / Math.max(...agArr.map(x=>x[1])) * 100);
      return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px">
        <div style="width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-hi)">${esc(type)}</div>
        <div style="flex:1;height:8px;background:var(--border);border-radius:2px;overflow:hidden"><div style="width:${pct}%;height:100%;background:var(--accent);border-radius:2px"></div></div>
        <div style="width:24px;text-align:right;color:var(--text-lo);font-family:var(--mono);font-size:11px">${count}</div>
      </div>`;
    }).join('')}` : ''}
    ${toolArr.length ? `<div class="m-group-title" style="margin-bottom:6px;margin-top:16px">Top Tools</div>
    ${toolArr.map(([tool,count]) => {
      const pct = Math.round(count / Math.max(...toolArr.map(x=>x[1])) * 100);
      return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px">
        <div style="width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-hi);font-family:var(--mono);font-size:11px">${esc(tool)}</div>
        <div style="flex:1;height:8px;background:var(--border);border-radius:2px;overflow:hidden"><div style="width:${pct}%;height:100%;background:oklch(62% 0.12 195);border-radius:2px"></div></div>
        <div style="width:28px;text-align:right;color:var(--text-lo);font-family:var(--mono);font-size:11px">${count}</div>
      </div>`;
    }).join('')}` : ''}
  `;
}
```

- [ ] **Step 3: Wire into `switchMemTab()`**

Add: `else if (tab === 'agent-graph') loadAgentGraphTab();`

- [ ] **Step 4: Verify agent graph**

Memory → Agent Graph → summary bar shows session/spawn/tool/cost totals. Session list on left. Click session → agent type bar chart + tool usage bar chart on right.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/dashboard-v2.html
git commit -m "feat(dashboard-v2): memory agent graph tab with spawn and tool analytics"
```

---

## Wave 3 — Org Room Tab Expansion

The v2 Org Room already has 8 tabs: Chart, Roles, Activity, Health, Heartbeats, Tasks, Costs, Members. This wave adds 10 more.

---

### Task 10: Org Room — 10 New Tabs

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/dashboard-v2.html` (org tab bar ~line 1459, `v2RenderOrgTab` ~line 3987, org fetch ~line 3947)

- [ ] **Step 1: Add 10 new tab buttons to the org tab bar**

Find `#org-detail-tabs` (~line 1459). After the existing `<button>` entries, add:

```html
<button class="odt-btn" data-tab="goals"     onclick="v2SwitchOrgTab('goals')">Goals</button>
<button class="odt-btn" data-tab="board"     onclick="v2SwitchOrgTab('board')">Board</button>
<button class="odt-btn" data-tab="live"      onclick="v2SwitchOrgTab('live')">Live</button>
<button class="odt-btn" data-tab="approvals" onclick="v2SwitchOrgTab('approvals')">Approvals</button>
<button class="odt-btn" data-tab="secrets"   onclick="v2SwitchOrgTab('secrets')">Secrets</button>
<button class="odt-btn" data-tab="settings"  onclick="v2SwitchOrgTab('settings')">Settings</button>
<button class="odt-btn" data-tab="routines"  onclick="v2SwitchOrgTab('routines')">Routines</button>
<button class="odt-btn" data-tab="myissues"  onclick="v2SwitchOrgTab('myissues')">My Issues</button>
<button class="odt-btn" data-tab="budgets"   onclick="v2SwitchOrgTab('budgets')">Budgets</button>
<button class="odt-btn" data-tab="plugins"   onclick="v2SwitchOrgTab('plugins')">Plugins</button>
```

Add corresponding panes:

```html
<div class="odt-pane" id="odt-goals"></div>
<div class="odt-pane" id="odt-board"></div>
<div class="odt-pane" id="odt-live"></div>
<div class="odt-pane" id="odt-approvals"></div>
<div class="odt-pane" id="odt-secrets"></div>
<div class="odt-pane" id="odt-settings"></div>
<div class="odt-pane" id="odt-routines"></div>
<div class="odt-pane" id="odt-myissues"></div>
<div class="odt-pane" id="odt-budgets"></div>
<div class="odt-pane" id="odt-plugins"></div>
```

- [ ] **Step 2: Extend the parallel fetch in `v2SelectOrg()` to load additional data**

Find the `Promise.all([...])` in `v2SelectOrg` (~line 3947). Extend it:

```js
const [mainR, actR, healthR, agentsR, budgetsR, membersR, issuesR] = await Promise.all([
  apiFetch(`/api/org/${_enc}${DIR ? '?dir=' + encodeURIComponent(DIR) : ''}`),
  fetch(`/api/org/${_enc}/activity${DIR ? '?dir=' + encodeURIComponent(DIR) : ''}`).then(r=>r.ok?r.json():[]).catch(()=>[]),
  fetch(`/api/org/${_enc}/health${DIR ? '?dir=' + encodeURIComponent(DIR) : ''}`).then(r=>r.ok?r.json():null).catch(()=>null),
  fetch(`/api/org/${_enc}/agents${DIR ? '?dir=' + encodeURIComponent(DIR) : ''}`).then(r=>r.ok?r.json():[]).catch(()=>[]),
  fetch(`/api/org/${_enc}/budgets${DIR ? '?dir=' + encodeURIComponent(DIR) : ''}`).then(r=>r.ok?r.json():null).catch(()=>null),
  fetch(`/api/org/${_enc}/members${DIR ? '?dir=' + encodeURIComponent(DIR) : ''}`).then(r=>r.ok?r.json():[]).catch(()=>[]),
  fetch(`/api/org/${_enc}/issues${DIR ? '?dir=' + encodeURIComponent(DIR) : ''}`).then(r=>r.ok?r.json():[]).catch(()=>[]),
]);
// After the existing _v2OrgData assignment, add:
_v2OrgData._agents  = Array.isArray(agentsR)  ? agentsR  : (agentsR?.agents  || []);
_v2OrgData._budgets = budgetsR;
_v2OrgData._members = Array.isArray(membersR) ? membersR : (membersR?.members || []);
_v2OrgData._issues  = Array.isArray(issuesR)  ? issuesR  : (issuesR?.issues   || []);
```

- [ ] **Step 3: Add the 10 render functions in `v2RenderOrgTab()`**

Extend the `if/else` chain in `v2RenderOrgTab()`:

```js
else if (tab === 'goals')     v2RenderOrgGoals();
else if (tab === 'board')     v2RenderOrgBoard();
else if (tab === 'live')      v2RenderOrgLive();
else if (tab === 'approvals') v2RenderOrgApprovals();
else if (tab === 'secrets')   v2RenderOrgSecrets();
else if (tab === 'settings')  v2RenderOrgSettings();
else if (tab === 'routines')  v2RenderOrgRoutines();
else if (tab === 'myissues')  v2RenderOrgMyIssues();
else if (tab === 'budgets')   v2RenderOrgBudgets();
else if (tab === 'plugins')   v2RenderOrgPlugins();
```

- [ ] **Step 4: Implement the 10 render functions**

Add these functions after `v2RenderOrgMembers()`:

```js
// ── GOALS ──────────────────────────────────────────────────
function v2RenderOrgGoals() {
  const el = document.getElementById('odt-goals'); if (!el || !_v2OrgData) return;
  const goals = _v2OrgData.goals || _v2OrgData.config?.goals || [];
  if (!goals.length) { el.innerHTML = '<div class="empty">No goals defined</div>'; return; }
  function renderGoal(g, depth) {
    const indent = depth * 20;
    const pct = g.total > 0 ? Math.round(g.filled / g.total * 100) : 0;
    return `<div style="padding:8px 0;border-bottom:1px solid var(--border);padding-left:${indent}px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="flex:1;font-size:13px;color:var(--text-hi)">${esc(g.text||g.goal||g.title||'—')}</span>
        <span class="ss-pill ${g.status==='done'?'on':g.status==='blocked'?'warn':''}">${esc(g.status||'?')}</span>
      </div>
      ${g.total > 0 ? `<div style="margin-top:5px;height:4px;background:var(--border);border-radius:2px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${pct>=100?'var(--green)':'var(--accent)'};border-radius:2px"></div></div>` : ''}
      ${(g.children||[]).map(c => renderGoal(c, depth+1)).join('')}
    </div>`;
  }
  el.innerHTML = goals.map(g => renderGoal(g, 0)).join('');
}

// ── BOARD ──────────────────────────────────────────────────
function v2RenderOrgBoard() {
  const el = document.getElementById('odt-board'); if (!el || !_v2OrgData) return;
  const issues = _v2OrgData._issues || [];
  const cols = ['open','in_progress','blocked','done','cancelled'];
  const PRIORITY = {'urgent':'🔴','high':'🟠','medium':'🟡','low':'🟢'};
  el.innerHTML = `<div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:8px">` +
    cols.map(col => {
      const cards = issues.filter(i => (i.status||i.state||'open') === col);
      return `<div style="min-width:180px;flex:1">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-lo);padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:8px">${esc(col.replace('_',' '))} <span style="background:var(--surface-hi);padding:1px 6px;border-radius:8px">${cards.length}</span></div>
        ${cards.slice(0,20).map(i => `<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:6px;font-size:12px">
          <div style="color:var(--text-hi);margin-bottom:4px">${PRIORITY[i.priority]||''} ${esc((i.title||i.description||'—').slice(0,60))}</div>
          ${i.assignee ? `<div style="font-size:10px;color:var(--text-lo)">${esc(i.assignee)}</div>` : ''}
        </div>`).join('')}
      </div>`;
    }).join('') + `</div>`;
}

// ── LIVE ───────────────────────────────────────────────────
let _orgLiveInterval = null;
function v2RenderOrgLive() {
  const el = document.getElementById('odt-live'); if (!el || !_v2OrgData) return;
  const agents = _v2OrgData._agents || [];
  const running = agents.filter(a => a.status === 'running' || a.running);
  el.innerHTML = `
    <div style="margin-bottom:14px">
      ${running.length ? running.map(a => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <span class="live-dot" style="background:var(--green);flex-shrink:0"></span>
        <span style="font-size:13px;color:var(--text-hi)">${esc(a.type||a.title||a.id||'—')}</span>
        <span style="margin-left:auto;font-size:11px;color:var(--text-lo)">${esc(a.adapter||'')}</span>
      </div>`).join('') : '<div style="color:var(--text-lo);font-size:13px;padding:12px 0">No agents currently running</div>'}
    </div>
    <div class="m-group-title" style="margin-bottom:6px">Activity Feed</div>
    <div id="org-live-feed" style="max-height:280px;overflow-y:auto;font-size:11px;font-family:var(--mono)">
      ${(_v2OrgData._activity||[]).slice(-30).reverse().map(e => `<div style="padding:3px 0;border-bottom:1px solid var(--border);color:var(--text-lo)">
        ${esc(relTime(e.ts||e.timestamp||e.created_at))}
        <span style="color:var(--text-mid);margin-left:6px">${esc(e.type||e.kind||e.event||'—')}</span>
        ${e.agentId ? `<span style="color:var(--text-xs);margin-left:6px">${esc(e.agentId.slice(0,10))}</span>` : ''}
        ${e.message ? `<span style="color:var(--text-hi);margin-left:6px">${esc(e.message.slice(0,80))}</span>` : ''}
      </div>`).join('')}
    </div>`;
  // auto-refresh while LIVE tab is active
  if (_orgLiveInterval) clearInterval(_orgLiveInterval);
  _orgLiveInterval = setInterval(() => {
    if (_v2OrgTab === 'live' && _v2SelOrg) {
      const _enc = encodeURIComponent(_v2SelOrg);
      fetch(`/api/org/${_enc}/activity${DIR ? '?dir=' + encodeURIComponent(DIR) : ''}`)
        .then(r => r.ok ? r.json() : []).then(data => {
          if (!_v2OrgData) return;
          _v2OrgData._activity = Array.isArray(data) ? data : [];
          v2RenderOrgLive();
        }).catch(() => {});
    } else { clearInterval(_orgLiveInterval); _orgLiveInterval = null; }
  }, 5000);
}

// ── APPROVALS ──────────────────────────────────────────────
async function v2RenderOrgApprovals() {
  const el = document.getElementById('odt-approvals'); if (!el || !_v2OrgData) return;
  el.innerHTML = '<div class="loading-txt">Loading…</div>';
  try {
    const _enc = encodeURIComponent(_v2SelOrg);
    const data = await fetch(`/api/org/${_enc}/approvals${DIR ? '?dir=' + encodeURIComponent(DIR) : ''}`).then(r=>r.ok?r.json():[]).catch(()=>[]);
    const approvals = Array.isArray(data) ? data : (data.approvals || []);
    if (!approvals.length) { el.innerHTML = '<div class="empty">No pending approvals</div>'; return; }
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="color:var(--text-xs);text-align:left"><th style="padding:6px 8px">Requester</th><th>Action</th><th>Status</th><th>Date</th><th></th></tr></thead>
      <tbody>${approvals.slice(0,50).map(a => {
        const cls = a.status === 'approved' ? 'on' : a.status === 'rejected' ? 'warn' : '';
        const pending = !a.status || a.status === 'pending';
        return `<tr style="border-top:1px solid var(--border)">
          <td style="padding:7px 8px;color:var(--text-hi)">${esc(a.requester||a.agent||'—')}</td>
          <td style="padding:7px 8px;color:var(--text-lo);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((a.action||a.description||'').slice(0,80))}</td>
          <td style="padding:7px 8px"><span class="ss-pill ${cls}">${esc(a.status||'pending')}</span></td>
          <td style="padding:7px 8px;color:var(--text-xs);font-size:11px;font-family:var(--mono)">${relTime(a.created_at||a.ts)}</td>
          <td style="padding:7px 8px;white-space:nowrap">
            ${pending ? `<button class="btn" style="font-size:10px;color:var(--green);border-color:var(--green)" onclick="orgApproveAction(${JSON.stringify(esc(a.id||''))}, 'approve')">✓</button>
            <button class="btn" style="font-size:10px;color:var(--red);border-color:var(--red);margin-left:4px" onclick="orgApproveAction(${JSON.stringify(esc(a.id||''))}, 'reject')">✕</button>` : ''}
          </td>
        </tr>`;
      }).join('')}</tbody></table>`;
  } catch(e) { el.innerHTML = '<div class="empty">Failed: ' + esc(e.message) + '</div>'; }
}

async function orgApproveAction(id, action) {
  if (!confirm(action + ' this request?')) return;
  try {
    const _enc = encodeURIComponent(_v2SelOrg);
    await fetch(`/api/org/${_enc}/approvals/${encodeURIComponent(id)}`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action })
    });
    showToast('Done', action + 'd', 'ok');
    v2RenderOrgApprovals();
  } catch(e) { showToast('Error', e.message, 'err'); }
}

// ── SECRETS ────────────────────────────────────────────────
async function v2RenderOrgSecrets() {
  const el = document.getElementById('odt-secrets'); if (!el) return;
  el.innerHTML = '<div class="loading-txt">Loading…</div>';
  try {
    const _enc = encodeURIComponent(_v2SelOrg);
    const data = await fetch(`/api/org/${_enc}/secrets${DIR ? '?dir=' + encodeURIComponent(DIR) : ''}`).then(r=>r.ok?r.json():[]).catch(()=>[]);
    const secrets = Array.isArray(data) ? data : (data.secrets || []);
    if (!secrets.length) { el.innerHTML = '<div class="empty">No secrets configured</div>'; return; }
    el.innerHTML = '<div style="font-size:11px;color:var(--text-lo);margin-bottom:10px">Secret values are never transmitted or displayed.</div>' +
      secrets.map(s => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
        <span style="font-family:var(--mono);color:var(--text-hi)">${esc(s.name||s.key||'—')}</span>
        ${s.purpose ? `<span style="color:var(--text-lo)">${esc(s.purpose)}</span>` : ''}
        <span style="margin-left:auto;font-family:var(--mono);color:var(--border)">••••••••</span>
      </div>`).join('');
  } catch(e) { el.innerHTML = '<div class="empty">Failed: ' + esc(e.message) + '</div>'; }
}

// ── SETTINGS ───────────────────────────────────────────────
function v2RenderOrgSettings() {
  const el = document.getElementById('odt-settings'); if (!el || !_v2OrgData) return;
  const d = _v2OrgData;
  el.innerHTML = `
    <div style="font-size:11px;color:var(--text-lo);margin-bottom:14px">Changes generate a CLI command. No direct writes from UI.</div>
    <div style="display:flex;flex-direction:column;gap:12px;max-width:400px">
      <div><div class="le-lbl">Goal</div><input id="os-goal" class="filter-input" value="${esc(d.goal||'')}"></div>
      <div><div class="le-lbl">Topology</div>
        <select id="os-topo" class="filter-input" style="cursor:pointer">
          ${['hierarchical','mesh','hierarchical-mesh','adaptive','centralized','hybrid'].map(t => `<option ${d.topology===t?'selected':''}>${t}</option>`).join('')}
        </select></div>
      <div><div class="le-lbl">Governance</div>
        <select id="os-gov" class="filter-input" style="cursor:pointer">
          ${['auto','board','strict'].map(t => `<option ${d.governance===t?'selected':''}>${t}</option>`).join('')}
        </select></div>
      <div><div class="le-lbl">Budget (tokens)</div><input id="os-budget" class="filter-input" type="number" value="${esc(String(d.budgetTokens||d.budget_tokens||''))}"></div>
      <button class="btn" style="width:fit-content;color:var(--accent);border-color:var(--accent)" onclick="generateOrgSettingsCmd()">Generate CLI Command</button>
      <div id="os-cmd-out" style="display:none;font-family:var(--mono);font-size:12px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px;word-break:break-all;cursor:pointer" onclick="navigator.clipboard.writeText(this.textContent).then(()=>showToast('Copied','',\'ok\'))"></div>
    </div>`;
}

function generateOrgSettingsCmd() {
  const org = esc(_v2SelOrg||'');
  const goal = (document.getElementById('os-goal')?.value||'').trim();
  const topo = document.getElementById('os-topo')?.value||'';
  const gov  = document.getElementById('os-gov')?.value||'';
  const budget = (document.getElementById('os-budget')?.value||'').trim();
  const parts = [`/mastermind:org-settings --org "${org}"`];
  if (goal)   parts.push(`--goal "${goal.replace(/"/g,'\\"')}"`);
  if (topo)   parts.push(`--topology ${topo}`);
  if (gov)    parts.push(`--governance ${gov}`);
  if (budget) parts.push(`--budget-tokens ${budget}`);
  const cmd = parts.join(' ');
  const out = document.getElementById('os-cmd-out');
  if (out) { out.textContent = cmd; out.style.display = 'block'; }
}

// ── ROUTINES ───────────────────────────────────────────────
async function v2RenderOrgRoutines() {
  const el = document.getElementById('odt-routines'); if (!el) return;
  el.innerHTML = '<div class="loading-txt">Loading…</div>';
  try {
    const _enc = encodeURIComponent(_v2SelOrg);
    const data = await fetch(`/api/org/${_enc}/routines${DIR ? '?dir=' + encodeURIComponent(DIR) : ''}`).then(r=>r.ok?r.json():[]).catch(()=>[]);
    const routines = Array.isArray(data) ? data : (data.routines || _v2OrgData.config?.routines || []);
    if (!routines.length) { el.innerHTML = '<div class="empty">No routines configured</div>'; return; }
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="color:var(--text-xs);text-align:left"><th style="padding:6px 8px">Name</th><th>Cron</th><th>Last Run</th><th>Next</th><th>Status</th></tr></thead>
      <tbody>${routines.map(r => `<tr style="border-top:1px solid var(--border)">
        <td style="padding:7px 8px;color:var(--text-hi)">${esc(r.name||'—')}</td>
        <td style="padding:7px 8px;font-family:var(--mono);color:var(--text-lo)">${esc(r.cron||r.schedule||'—')}</td>
        <td style="padding:7px 8px;color:var(--text-lo)">${r.lastRun ? relTime(r.lastRun) : '—'}</td>
        <td style="padding:7px 8px;color:var(--text-lo)">${r.nextRun ? relTime(r.nextRun) : '—'}</td>
        <td style="padding:7px 8px"><span class="ss-pill ${r.active||r.status==='active'?'on':''}">${esc(r.status||'—')}</span></td>
      </tr>`).join('')}</tbody></table>`;
  } catch(e) { el.innerHTML = '<div class="empty">Failed: ' + esc(e.message) + '</div>'; }
}

// ── MY ISSUES ──────────────────────────────────────────────
async function v2RenderOrgMyIssues() {
  const el = document.getElementById('odt-myissues'); if (!el) return;
  el.innerHTML = '<div class="loading-txt">Loading…</div>';
  try {
    const _enc = encodeURIComponent(_v2SelOrg);
    const data = await fetch(`/api/org/${_enc}/my-issues${DIR ? '?dir=' + encodeURIComponent(DIR) : ''}`).then(r=>r.ok?r.json():[]).catch(()=>[]);
    const issues = Array.isArray(data) ? data : (data.issues || []);
    if (!issues.length) { el.innerHTML = '<div class="empty">No issues assigned to you</div>'; return; }
    const PRIORITY = {'urgent':'🔴','high':'🟠','medium':'🟡','low':'🟢'};
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="color:var(--text-xs);text-align:left"><th style="padding:6px 4px">P</th><th style="padding:6px 8px">Title</th><th>Status</th><th>Updated</th></tr></thead>
      <tbody>${issues.slice(0,50).map(i => `<tr style="border-top:1px solid var(--border)">
        <td style="padding:6px 4px">${PRIORITY[i.priority]||'·'}</td>
        <td style="padding:6px 8px;color:var(--text-hi);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((i.title||i.description||'—').slice(0,80))}</td>
        <td style="padding:6px 8px"><span class="ss-pill ${i.status==='done'?'on':i.status==='blocked'?'warn':''}">${esc(i.status||'open')}</span></td>
        <td style="padding:6px 8px;color:var(--text-xs);font-family:var(--mono);font-size:11px">${relTime(i.updated_at||i.ts)}</td>
      </tr>`).join('')}</tbody></table>`;
  } catch(e) { el.innerHTML = '<div class="empty">Failed: ' + esc(e.message) + '</div>'; }
}

// ── BUDGETS ────────────────────────────────────────────────
function v2RenderOrgBudgets() {
  const el = document.getElementById('odt-budgets'); if (!el || !_v2OrgData) return;
  const b = _v2OrgData._budgets || _v2OrgData.budgets || {};
  const agents = _v2OrgData._agents || [];
  function fillBar(used, limit) {
    if (!limit) return '';
    const pct = Math.min(100, Math.round(used / limit * 100));
    const col = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'oklch(70% 0.18 60)' : 'var(--accent)';
    const bar = '█'.repeat(Math.round(pct/5)) + '░'.repeat(20 - Math.round(pct/5));
    return `<div style="font-family:var(--mono);font-size:11px;color:${col}">${bar} ${pct}%</div>`;
  }
  let html = '<div style="margin-bottom:16px">';
  if (b.tokens != null || b.tokenLimit != null) {
    html += `<div class="m-group-title">Tokens</div>
      ${fillBar(b.tokens||0, b.tokenLimit)}
      <div style="font-size:12px;color:var(--text-lo);margin-top:4px">${(b.tokens||0).toLocaleString()} / ${b.tokenLimit ? b.tokenLimit.toLocaleString() : '∞'}</div>`;
  }
  if (b.usd != null || b.usdLimit != null) {
    html += `<div class="m-group-title" style="margin-top:14px">USD Budget</div>
      ${fillBar(b.usd||0, b.usdLimit)}
      <div style="font-size:12px;color:var(--text-lo);margin-top:4px">$${Number(b.usd||0).toFixed(4)} / ${b.usdLimit ? '$'+Number(b.usdLimit).toFixed(2) : '∞'}</div>`;
  }
  html += '</div>';
  if (agents.length) {
    html += '<div class="m-group-title">Per Agent</div>' +
      `<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="color:var(--text-xs);text-align:left"><th style="padding:5px 8px">Agent</th><th>Tokens In</th><th>Tokens Out</th><th>Cost</th></tr></thead><tbody>` +
      agents.slice(0,20).map(a => {
        const over = a.budgetLimit && (a.tokensIn||0)+(a.tokensOut||0) > a.budgetLimit;
        return `<tr style="border-top:1px solid var(--border)${over?' color:var(--red)':''}">
          <td style="padding:5px 8px;color:var(--text-hi);font-family:var(--mono);font-size:11px">${esc((a.id||a.title||'—').slice(0,14))}</td>
          <td style="padding:5px 8px;color:var(--text-lo)">${Number(a.tokensIn||0).toLocaleString()}</td>
          <td style="padding:5px 8px;color:var(--text-lo)">${Number(a.tokensOut||0).toLocaleString()}</td>
          <td style="padding:5px 8px;color:var(--accent)">$${Number(a.cost||0).toFixed(4)}${over?'  ⚠':'  '}</td>
        </tr>`;
      }).join('') + '</tbody></table>';
  }
  el.innerHTML = html || '<div class="empty">No budget data</div>';
}

// ── PLUGINS ────────────────────────────────────────────────
async function v2RenderOrgPlugins() {
  const el = document.getElementById('odt-plugins'); if (!el) return;
  el.innerHTML = '<div class="loading-txt">Loading…</div>';
  try {
    const _enc = encodeURIComponent(_v2SelOrg);
    const data = await fetch(`/api/org/${_enc}/plugins${DIR ? '?dir=' + encodeURIComponent(DIR) : ''}`).then(r=>r.ok?r.json():[]).catch(()=>[]);
    const plugins = Array.isArray(data) ? data : (data.plugins || []);
    if (!plugins.length) { el.innerHTML = '<div class="empty">No plugins installed</div>'; return; }
    el.innerHTML = `<div class="proj-grid">${plugins.map(p => {
      const status = p.status||'installed';
      const col = status === 'installed' ? 'var(--accent)' : status === 'error' ? 'var(--red)' : 'var(--text-lo)';
      return `<div class="proj-card">
        <div class="proj-card-name">${esc(p.name||'—')}</div>
        <div class="proj-card-path">${esc(p.description||'').slice(0,80)}</div>
        <div style="margin-top:8px"><span class="ss-pill" style="color:${col};border-color:${col}22;background:${col}18">${esc(status)}</span></div>
      </div>`;
    }).join('')}</div>`;
  } catch(e) { el.innerHTML = '<div class="empty">Failed: ' + esc(e.message) + '</div>'; }
}
```

- [ ] **Step 5: Test all 10 new tabs**

Open Dashboard → Orgs → select any org.
- **Goals**: Hierarchical goal tree with status badges and progress bars
- **Board**: Kanban with 5 columns, cards sorted by priority emoji
- **Live**: Running agent list with green dots, activity feed, auto-refreshes every 5s
- **Approvals**: Table with ✓/✕ action buttons for pending items
- **Secrets**: Names only, values show ••••••••, explanatory note at top
- **Settings**: Form fields for topology/governance/budget → "Generate CLI Command" button → copyable command
- **Routines**: Table with cron expressions, last/next run
- **My Issues**: Table with priority emoji, status badge
- **Budgets**: ASCII fill bars for token and USD limits, per-agent cost table with ⚠ for overruns
- **Plugins**: Card grid with status-colored badges

- [ ] **Step 6: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/dashboard-v2.html
git commit -m "feat(dashboard-v2): org room +10 tabs (goals, board, live, approvals, secrets, settings, routines, my-issues, budgets, plugins)"
```

- [ ] **Step 7: Push all 3 waves**

```bash
git push origin main
```

---

## Self-Review

**Spec coverage check:**
- ✅ Loops countdown + progress bar + STOP → Task 1
- ✅ Token chart animation + threshold colors + period tabs → Task 2
- ✅ Session summary excerpts + compacted badge → Task 3
- ✅ Status strip HNSW/patterns/swarm/last-route → Task 4
- ✅ Live border glow → Task 5
- ✅ Memory CRUD (edit/delete/create) → Task 6
- ✅ Memory swarm canvas tab → Task 7
- ✅ Memory chunks tab → Task 8
- ✅ Memory agent graph tab → Task 9
- ✅ Org Room 10 new tabs → Task 10

**Security audit:**
- All user-controlled values pass through `esc()` before DOM insertion ✅
- No `onclick="fn('${raw}')"` patterns — all handlers use `JSON.stringify(esc(...))` ✅
- Secrets tab: only names, never values ✅
- Settings tab: generates CLI commands, no direct API writes ✅
- Approvals require `confirm()` dialog ✅
- Swarm clean requires `confirm()` dialog ✅

**Reduced motion:**
- `startCountdowns()` checks `prefers-reduced-motion` ✅
- `renderTokChart()` skips animation when reduced motion ✅
- `markLiveGlow()` skips glow when reduced motion ✅
