# Dashboard v2 — v1 Feature Port

**Date:** 2026-05-29  
**Target file:** `packages/@monomind/cli/dist/src/ui/dashboard-v2.html`  
**Audience:** Developers + operators  
**Source:** `docs/dashboard-v1-features.md`

---

## Scope

Port 11 high-impact features from dashboard v1 into dashboard-v2. Only features missing or significantly underdeveloped in v2 are included. Features already present in v2 (Monograph 7-tab suite, global feed, project grid, session feed with replay) are not touched.

---

## Architecture

Single-file HTML dashboard. No build step. All additions are inline CSS/HTML/JS blocks. Every new render function follows existing patterns:

- Uses `apiFetch()` for all API calls
- Uses `esc()` for all dynamic string output (XSS guard)
- Uses `relTime()` for timestamps
- Uses OKLCH tokens from `:root` — no hardcoded hex values
- No `onclick="fn('${raw}')"` patterns — handlers use `data-*` attributes or index references

---

## Wave 1 — Self-Contained Polish (no new views)

### 1. Loops — Live Countdown Timer + Progress Bar

**Target:** `loadLoopsView()` and the mini-loops in the metrics pane  
**Data:** existing `/api/loops` response fields `nextRunAt`, `currentRep`, `maxReps`

- Each loop card renders a `<span class="loop-cdown" data-nextat="${l.nextRunAt}">` element
- `setInterval(updateCountdowns, 1000)` sweeps all `.loop-cdown` elements: `ms = nextAt - Date.now()`, renders `Xm Ys` or `overdue` (red) or `running` if no nextAt
- For `repeat` loops with `maxReps > 0`: `<div class="lp-bar"><div class="lp-fill" style="width:${Math.round(currentRep/maxReps*100)}%"></div></div>`
- STOP button: `data-loop-id="${l.id}"` → `onclick` handler → `POST /api/loops/stop` with body `{id}`
- CSS: `.lp-bar` is 4px tall, `background: var(--border)`, `.lp-fill` uses `background: var(--accent)`, border-radius 2px
- `prefers-reduced-motion`: skip interval, show static text

### 2. Token Chart — Animated Bars + Threshold Coloring + Period Tabs

**Target:** `renderTokChart()` + new period tab row in the tokens view  
**Data:** `/api/token-usage?period=X` (already called by `loadTokensView`)

**Animated bars:**
- `renderTokChart(daily, animate=true)` — uses `requestAnimationFrame` loop over 400ms
- Progress: `t = (Date.now() - startTime) / 400`, eased with `1 - Math.pow(1-t, 3)` (ease-out-cubic)
- Bar height: `targetH * eased`; re-renders every frame until `t >= 1`

**Threshold coloring:**
- Compute `avg = sum(vals) / vals.length`
- `val < avg * 0.5` → `var(--green)` (low)
- `val < avg * 1.5` → `var(--accent)` (normal)
- `val >= avg * 1.5` → `var(--red)` (spike)
- Today's bar: same color but with a 2px white cap drawn at top
- `opacity: 0.45` for non-today bars; `1.0` for today's bar

**Period tabs:**
- HTML row above chart: `<div class="tok-periods"><button data-period="today">Today</button><button data-period="week">Week</button><button data-period="30d">30 days</button><button data-period="month">Month</button></div>`
- Active tab: `background: var(--accent-dim); color: var(--accent)`
- Clicking a tab calls `loadTokensView(period)` which passes period to the API

### 3. Session Rows — Compact Summary Excerpt

**Target:** `renderSessionRow()` / `renderSessionList()`  
**Data:** existing `/api/session-journal` response `session.summary` + `session.compactCount`

- Below the `.sr-prompt`: `<div class="sr-summary">${esc(s.summary?.slice(0, 180))}</div>` — only rendered if `s.summary` is truthy
- CSS: `.sr-summary { font-size:11px; color:var(--text-lo); font-style:italic; margin-top:3px; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }`
- Compacted badge: `<span class="ss-pill on">+${s.compactCount} compacted</span>` if `s.compactCount > 0`

### 4. Status Strip — Rich Data Enrichment

**Target:** `loadStatusStrip()`  
**Data:** `/api/status` (existing) + supplementary data assembled from already-loaded `appData`

- After loading `/api/status`, additionally render fixed pills from `appData`:
  - `HNSW` — green `on` or dim `off` based on `appData.memory?.hnsw?.enabled`
  - `PATTERNS N` — from `appData.memory?.patterns` count
  - `CHUNKS N` — from `appData.memory?.chunks` count  
  - `SWARM topology` or `SWARM IDLE` — from `appData.swarm?.topology` or absence
  - `LAST ROUTE agentName` — from last routing feedback entry
- These supplementary pills are appended after the service-check pills
- If `appData` fields are absent, the pills are omitted (no errors shown)

### 5. Live Border Glow on Fresh Data

**Target:** all `.view` containers and the metrics pane sections  
**Implementation:**

```css
@keyframes live-fade { 0%{box-shadow:0 0 0 1px oklch(72% 0.18 75 / 0.45)} 100%{box-shadow:none} }
.live-glow { animation: live-fade 8s ease-out forwards; }
```

- Each view container gets `data-last-updated` set to `Date.now()` at the end of each `loadXxxView()` call
- `setInterval(refreshGlow, 2000)` checks `Date.now() - parseInt(el.dataset.lastUpdated)`:
  - If `< 10000`: add class `live-glow` (re-triggering resets the animation)
  - If `>= 10000`: remove class `live-glow`
- Respects `prefers-reduced-motion`: skip glow entirely

---

## Wave 2 — New Memory Sub-Tabs

The memory view currently has tabs: `memories | routing | usage | adrs`. Wave 2 adds three more and upgrades the `memories` tab to support full CRUD.

**New tab bar order:** `memories | swarm | chunks | agent-graph | routing | usage | adrs`

### 6. Memory — MEMORIES Tab (upgrade to CRUD)

**Data:** `/api/palace` (existing), `PUT /api/memory-file`, `DELETE /api/memory-file`

**Left pane (list):**
- Grouped by type: `user` (indigo `#7B8EFF`), `feedback` (amber `#FFB347`), `project` (teal `--accent`), `reference` (violet `#B47BFF`), `handoff` (pink `#FF6B9D`)
- Each item: colored dot + name
- Click → loads detail in right pane

**Right pane (detail):**
- Type badge, name, description
- Body rendered with markdown-lite: `**text**` → `<strong>`, `# heading` → `<div class="mem-h">`, `- item` → bullet
- Actions row: `EDIT` button + `DELETE` button

**Edit modal:**
- `<textarea>` pre-filled with raw frontmatter + body content
- SAVE → `PUT /api/memory-file` with `{path, content}`
- Cancel → close without saving

**Delete:**
- Confirm dialog: `"Delete this memory? This cannot be undone."`
- On confirm: `DELETE /api/memory-file` with `{path}`
- On success: remove from list, clear detail pane

**NEW MEMORY button:**
- Template picker: `user | feedback | project | reference`
- Each template pre-fills a minimal frontmatter skeleton
- Opens edit modal with template content; SAVE creates new file via `PUT /api/memory-file`

### 7. Memory → SWARM Tab

**Data:** `/api/swarm-history`, `/api/swarm-events?agentId=&dir=`, `DELETE /api/swarm-clean`

**Left pane:**
- Swarm run list: topology pill (hierarchical=teal, mesh=violet, adaptive=amber, other=gray), agent count, duration, age
- LIVE badge (green dot + "LIVE") for active runs
- Click → loads detail

**Right pane:**
- Header: swarm ID (8 chars), topology · consensus · N agents · duration
- `<canvas id="swarm-topo-canvas" width="400" height="220">` — topology visualization:
  - Hierarchical: queen at top, worker nodes fanned below, spoke edges
  - Mesh: circle layout, partial peer edges (max 30 edges shown)
  - Other: circle layout
  - Queen node: 9px radius, `var(--accent)` fill, "Q" label
  - Agent nodes: 5px radius, colored by type (coder=green, security=red, architect=violet, other=text-lo)
- Agent table: type, QUEEN/WORKER label, task description (truncated)
- Event log: `GET /api/swarm-events` on run select, shows last 200 events, scrollable
- CLEAN DATA button: `DELETE /api/swarm-clean` → confirm → reload swarm list

### 8. Memory → CHUNKS Tab

**Data:** `GET /api/section?name=knowledge&full=1` (lazy-loaded on first tab open)

- Filter input → real-time JS filter on `data-search` attribute
- Chunk cards: 
  - Source path: last 2 path segments (e.g., `hooks/pre-task.md`)
  - Excerpt: first 220 chars of content
  - Namespace badge + type badge
  - EDIT button → modal with `<textarea>` → `PUT /api/knowledge-chunk`
  - DELETE button → confirm → `DELETE /api/knowledge-chunk`
- Empty state: "No knowledge chunks indexed. Run `/monomind:understand` to build the index."

### 9. Memory → AGENT GRAPH Tab

**Data:** `GET /api/graph`

**Layout:**
- Summary stat bar: sessions | agent types | total spawns | tool calls | total cost
- Left: session list (ID, spawn count badge, tool count badge, age)
- Right (on select):
  - Session header: turns, spawns, tool calls, cost
  - `<canvas id="ag-spawn-chart">` — horizontal bars: agent type → spawn count, sorted descending, top 12, `var(--accent)` bars
  - `<canvas id="ag-tool-chart">` — horizontal bars: tool name → call count, top 15, teal bars with proportional width
- Canvas renders use same helper as `renderTokChart` — HiDPI, no animation needed

---

## Wave 3 — Org Room Full Expansion

The current v2 org detail pane calls 3 endpoints and shows a basic info card. Wave 3 replaces this with a full tab-bar overlay following the existing Monograph overlay pattern.

### 10. Org Room — 18-Tab Expansion

**Trigger:** clicking an org row opens a slide-in overlay (or replaces the detail pane content) with a tab bar.

**Data fetching strategy:** Parallel fetch all available endpoints on open; individual tabs render from cached data. Tabs that need supplementary data fetch on first activate.

**Primary fetch on open (parallel):**
```
/api/org/:name
/api/org/:name/activity
/api/org/:name/health
/api/org/:name/agents
/api/org/:name/budgets
/api/org/:name/members
/api/org/:name/issues
```

**Lazy-fetched on tab activate:**
```
/api/org/:name/plugins      → PLUGINS tab
/api/org/:name/my-issues    → MY ISSUES tab
/api/org/:name/approvals    → APPROVALS tab
/api/org/:name/secrets      → SECRETS tab
/api/org/:name/routines     → ROUTINES tab
```

**Tab inventory (18 tabs):**

| Tab | Source | Key content |
|---|---|---|
| HEARTBEATS | `agents` | Status dot, adapter, tokens in+out, last heartbeat age. Live agents highlighted teal. |
| TASK BOARD | `org.state.tasks` | 3-column kanban: TODO/DOING/DONE. Cards: ID, description, assignee, priority pill. |
| LIVE | `activity` + SSE poll | Green-dot agent list + scrolling event log. Auto-updates every 5s when active. |
| COSTS | `budgets` + `agents` | Org token+USD budget with fill bar. Per-agent cost table with overrun warnings in red. |
| GOALS | `org.config.goals` | Hierarchical tree: goal text, status badge, progress bar (filled/total sub-goals). |
| MEMBERS | `members` | Member list: avatar initials, role badge (owner/admin/operator/viewer). Invite form → generates CLI command. |
| HEALTH | `health` | Metrics grid: requests/errors/latency. Agent status table with success rate bar. |
| ORG CHART | `org.config.roles` | SVG recursive tree. CEO at root. Box width = label length × 7px + 24px padding. Hierarchical layout. |
| BOARD | `issues` | Kanban: open/in_progress/blocked/done/cancelled. Cards sorted by priority emoji (🔴🟠🟡). |
| ACTIVITY | `activity` | Event log: type chip (color-coded), agent ID, timestamp, description. |
| AGENTS | `agents` | Table: ID (8 chars), adapter, status dot, last heartbeat, tokens in+out. |
| APPROVALS | lazy `/approvals` | Table: requester, action (80 chars), status pill. APPROVE / REJECT buttons → `POST /api/org/:name/approvals/:id`. |
| SECRETS | lazy `/secrets` | Names only. Values never transmitted. Purpose field if set. |
| SETTINGS | `org.config` | Form: topology (select), governance (select), budget tokens (number), alert threshold (%). SAVE → generates `npx monomind mastermind org-settings ...` CLI command to copy. No direct API write. |
| ROUTINES | lazy `/routines` | Table: name, cron expression, last run (relTime), next run, status dot. |
| MY ISSUES | lazy `/my-issues` | Table: ID, status dot, priority emoji, title (truncated), updated date. |
| BUDGETS | `budgets` | Org-wide token + USD budget with ASCII-style fill bars. Per-agent breakdown. |
| PLUGINS | lazy `/plugins` | Grid cards: name, status badge (installed=teal/error=red/disabled=dim), description. |

**Tab-switching:** client-side only, data already cached. No re-fetch on re-visit.

**SSE for LIVE tab:** When LIVE tab is active, connect `EventSource('/api/events')` scoped to org. Disconnect on tab switch or org close.

**Org Room header:**
- Org name + goal (truncated 60 chars) + topology badge + status dot
- STOP ORG button → confirm → `POST /api/orgs/:name/stop`
- CLOSE button (✕) → returns to org list

---

## Security

All dynamic values passed through `esc()`. No raw user data in event handler attributes. Approval/stop actions require confirm dialogs. Settings tab generates CLI commands only — no direct config writes from UI. Secrets tab shows names only, values never fetched.

---

## Implementation Order

```
Wave 1  (5 features, additive only)
  1. Loops countdown + progress bar
  2. Token chart animation + thresholds + period tabs
  3. Session summary excerpts + compacted badge
  4. Status strip enrichment
  5. Live border glow

Wave 2  (4 new tabs in memory view)
  6. Memory CRUD (memories tab upgrade)
  7. Memory → Swarm canvas tab
  8. Memory → Chunks tab
  9. Memory → Agent Graph tab

Wave 3  (org room expansion)
  10. Full 18-tab Org Room
```

Each wave is a single commit to `dashboard-v2.html`.

---

## Success Criteria

- [ ] Loops view shows per-second countdown and progress bar for repeat loops
- [ ] Token chart bars animate in and change color based on cost vs average
- [ ] Token period tabs switch between today/week/30d/month data
- [ ] Session list shows compact summary excerpts where available
- [ ] Status strip shows HNSW status, pattern count, swarm status, last route agent
- [ ] Memory memories tab supports create/edit/delete operations
- [ ] Memory swarm tab shows canvas topology for past swarm runs
- [ ] Memory chunks tab shows knowledge chunks with edit/delete
- [ ] Memory agent graph tab shows per-session spawn + tool analytics
- [ ] Org room shows 18 tabs including HEARTBEATS, TASK BOARD, LIVE, COSTS, ORG CHART
- [ ] All new strings pass through `esc()` before insertion into DOM
- [ ] All animations respect `prefers-reduced-motion`
