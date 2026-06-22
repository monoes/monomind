# Org Event Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix org LIVE/IDLE status, make chat show complete event history, add artifact viewer with View button, and fix scheduled orgs stuck-LIVE — by adding `runstate.json` as the durable status store and a new artifact endpoint.

**Architecture:** The run JSONL write already exists in `handleMastermindEvent` (line 430). What's missing is: (1) `runstate.json` updated on every event so status survives restarts, (2) replacing the 65KB scan with a TTL check on runstate, (3) the artifact endpoint, (4) org:stop in the runorg skill for scheduled orgs.

**Tech Stack:** Node.js ES modules, `server.mjs` (5256 lines), `.claude/skills/mastermind/runorg.md`

---

## File Map

| File | Lines | Change |
|---|---|---|
| `packages/@monomind/cli/dist/src/ui/server.mjs` | 5256 | Add helpers at ~235; modify handleMastermindEvent at ~410–427; replace scan at ~3407–3418; replace running check at ~3572; add artifact endpoint before ~4817 |
| `.claude/skills/mastermind/runorg.md` | — | Add checkpointInterval to org:start; add org:stop before ScheduleWakeup; add org:agent:offline; add org:artifact pattern |

---

## Task 1: Add runstate helpers to server.mjs

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/server.mjs:234` (insert after `_resolveOrgProjectDir` function, before the blank line at 236)

- [ ] **Step 1: Read the file around line 234 to confirm insertion point**

Run: `sed -n '230,240p' packages/@monomind/cli/dist/src/ui/server.mjs`
Expected: Line 234 closes `_resolveOrgProjectDir`, line 236 is `// Server state`

- [ ] **Step 2: Insert the 4 helper functions after line 234**

Insert this block between line 234 (`}`) and line 236 (`// Server state`):

```javascript
// ── Org run state helpers ────────────────────────────────────────────────
// Reads {name}-runstate.json from disk. Returns null if missing/corrupt.
function _readRunState(orgName, rootDir) {
  const projDir = _resolveOrgProjectDir(orgName, rootDir) || rootDir;
  const base = _getGitMonomindDir(projDir) || path.join(projDir, '.monomind');
  const file = path.join(base, 'orgs', `${orgName}-runstate.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

// Returns the current runId from runstate (for events that omit it after restart).
function _getActiveRunId(orgName, rootDir) {
  return _readRunState(orgName, rootDir)?.runId || null;
}

// Returns all project dirs allowed for artifact reads (serverRoot + known-projects.json).
function _getAllowedArtifactDirs(serverRoot) {
  const dirs = [path.resolve(serverRoot)];
  try {
    const kf = path.join(serverRoot, 'data', 'known-projects.json');
    if (fs.existsSync(kf)) JSON.parse(fs.readFileSync(kf, 'utf8')).forEach(p => dirs.push(path.resolve(p)));
  } catch (_) {}
  return dirs;
}

// Detects a basic mime type from file extension for artifact responses.
function _detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = { '.ts': 'text/typescript', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain',
    '.html': 'text/html', '.css': 'text/css', '.py': 'text/x-python',
    '.sh': 'text/x-shellscript', '.yaml': 'text/yaml', '.yml': 'text/yaml',
    '.toml': 'text/plain', '.env': 'text/plain', '.xml': 'text/xml' };
  return map[ext] || 'application/octet-stream';
}

// Writes runstate.json for state-changing events. Debounces lastEventAt for frequent events.
const _runstateDebouncers = new Map();
function _updateRunState(event, rootDir) {
  const orgName = String(event.org || '').trim();
  if (!orgName) return;
  const projDir = _resolveOrgProjectDir(orgName, rootDir) || rootDir;
  const base = _getGitMonomindDir(projDir) || path.join(projDir, '.monomind');
  const orgsDir = path.join(base, 'orgs');
  const file = path.join(orgsDir, `${orgName}-runstate.json`);
  const stateChanging = ['org:start','org:stop','org:agent:online','org:agent:offline'];
  const ts = event.ts || Date.now();

  if (stateChanging.includes(event.type)) {
    // State-changing: clear any pending debounced write, then write immediately
    const pending = _runstateDebouncers.get(orgName);
    if (pending?.timer) clearTimeout(pending.timer);
    _runstateDebouncers.delete(orgName);
    let cur = null;
    try { cur = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}; } catch (_) { cur = {}; }
    if (event.type === 'org:start') {
      cur.runId = event.runId || cur.runId;
      cur.status = 'running';
      cur.startedAt = ts;
      cur.checkpointInterval = event.checkpointInterval || 600000;
      cur.agentStates = {};
    } else if (event.type === 'org:stop') {
      cur.status = 'idle';
    } else if (event.type === 'org:agent:online') {
      cur.agentStates = cur.agentStates || {};
      cur.agentStates[String(event.from || '').trim()] = { status: 'active', lastSeen: ts };
    } else if (event.type === 'org:agent:offline') {
      if (cur.agentStates?.[String(event.from || '').trim()]) {
        cur.agentStates[String(event.from).trim()].status = 'idle';
      }
    }
    cur.lastEventAt = ts;
    try { fs.mkdirSync(orgsDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(cur, null, 2)); } catch (_) {}
  } else {
    // Frequent event: debounce lastEventAt write by 5s
    const existing = _runstateDebouncers.get(orgName);
    if (existing?.timer) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      _runstateDebouncers.delete(orgName);
      try {
        if (!fs.existsSync(file)) return;
        const rs = JSON.parse(fs.readFileSync(file, 'utf8'));
        rs.lastEventAt = ts;
        fs.writeFileSync(file, JSON.stringify(rs, null, 2));
      } catch (_) {}
    }, 5000);
    _runstateDebouncers.set(orgName, { timer });
  }
}
// ── End runstate helpers ─────────────────────────────────────────────────
```

- [ ] **Step 3: Verify insertion compiled cleanly — check no syntax errors**

Run: `node --check packages/@monomind/cli/dist/src/ui/server.mjs 2>&1 | head -20`
Expected: no output (clean parse)

- [ ] **Step 4: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/server.mjs
git commit -m "feat(server): add _readRunState, _updateRunState, runstate helpers"
```

---

## Task 2: Wire runstate updates into handleMastermindEvent

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/server.mjs:410–427` (the activeOrgRuns block inside handleMastermindEvent)

- [ ] **Step 1: Read lines 410–430 to confirm exact context**

Run: `sed -n '408,432p' packages/@monomind/cli/dist/src/ui/server.mjs`

- [ ] **Step 2: After the activeOrgRuns block (line 427, after the `} catch(_e) {}` close), add runstate update**

Find this exact line (around 427):
```javascript
      } catch(_e) {}
    }
    try { fs.appendFileSync(path.join(dataDir, 'mastermind-events.jsonl'), JSON.stringify(event) + '\n'); } catch (_) {}
```

After the `}` that closes the `if (event.org)` block and before the `try { fs.appendFileSync...` line, add:

```javascript
    // Update durable runstate.json — survives server restarts
    if (event.org) _updateRunState(event, root);
```

- [ ] **Step 3: Extend runId fallback to use runstate when activeOrgRuns is empty (line 414)**

Find:
```javascript
      else if (activeOrgRuns.has(_orgKey)) event.runId = activeOrgRuns.get(_orgKey);
```

Change to:
```javascript
      else if (activeOrgRuns.has(_orgKey)) event.runId = activeOrgRuns.get(_orgKey);
      else { const _rsId = _getActiveRunId(_orgKey, root); if (_rsId) event.runId = _rsId; }
```

This ensures events that arrive after a restart still get routed to the correct run JSONL file.

- [ ] **Step 4: Verify no syntax errors**

Run: `node --check packages/@monomind/cli/dist/src/ui/server.mjs 2>&1 | head -20`
Expected: no output

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/server.mjs
git commit -m "feat(server): wire runstate updates and restart-safe runId recovery"
```

---

## Task 3: Replace 65KB scan in GET /api/orgs with runstate TTL check

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/server.mjs:3407–3434`

- [ ] **Step 1: Read the target block**

Run: `sed -n '3405,3436p' packages/@monomind/cli/dist/src/ui/server.mjs`
Expected: The per-project loop that reads mastermind-events.jsonl and scans for org:start/stop.

- [ ] **Step 2: Replace the scan block**

Find this code (the scan + running detection per org, approximately lines 3406–3433):
```javascript
          // Read events file once per project dir
          let recentLines = [];
          try {
            const evFile = path.join(_opd, 'data', 'mastermind-events.jsonl');
            if (fs.existsSync(evFile)) {
              const stat = fs.statSync(evFile);
              const TAIL = 65536;
              const fd = fs.openSync(evFile, 'r');
              const buf = Buffer.alloc(Math.min(TAIL, stat.size));
              try { fs.readSync(fd, buf, 0, buf.length, Math.max(0, stat.size - buf.length)); } finally { fs.closeSync(fd); }
              recentLines = buf.toString('utf8').split('\n').filter(Boolean).reverse();
            }
          } catch(_) {}
```

And later in the same loop:
```javascript
              let running = false;
              const lastStart = recentLines.find(l => { try { const e = JSON.parse(l); return e.type === 'org:start' && e.org === _lOrgName; } catch(_) { return false; } });
              const lastStop = recentLines.find(l => { try { const e = JSON.parse(l); return (e.type === 'org:stop' || e.type === 'org:complete') && e.org === _lOrgName; } catch(_) { return false; } });
              if (lastStart) {
                const startTs = JSON.parse(lastStart).ts || 0;
                const stopTs = lastStop ? (JSON.parse(lastStop).ts || 0) : 0;
                running = startTs > stopTs;
              }
              if (!running && activeOrgRuns.has(_lOrgName)) running = true;
```

Replace the entire scan block (the `let recentLines = []` block) with an empty line (remove it — it's no longer needed).

Replace the running detection block with:
```javascript
              const _rs = _readRunState(_lOrgName, _opd);
              const _ttl = (_rs?.checkpointInterval || 600000) * 2;
              let running = (_rs?.status === 'running' && (Date.now() - (_rs?.lastEventAt || 0)) < _ttl)
                || activeOrgRuns.has(_lOrgName);
```

- [ ] **Step 3: Verify no syntax errors**

Run: `node --check packages/@monomind/cli/dist/src/ui/server.mjs 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/server.mjs
git commit -m "fix(server): replace 65KB event scan with runstate TTL check in GET /api/orgs"
```

---

## Task 4: Replace complex running check in GET /api/org/:name

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/server.mjs:3534–3572`

- [ ] **Step 1: Read the target block**

Run: `sed -n '3534,3575p' packages/@monomind/cli/dist/src/ui/server.mjs`
Expected: The stop-file check, loop detection, and final `running` assignment.

- [ ] **Step 2: Replace the complex running determination (line 3572)**

Find:
```javascript
        const running = !fs.existsSync(stopFile) && (activeOrgRuns.has(orgName) || ['running','active'].includes(state.status) || Object.values(state.agents || {}).some(a => a.status === 'running') || _loopRunning);
```

Replace with:
```javascript
        const _runstateData = _readRunState(orgName, d);
        const _runstateTtl = (_runstateData?.checkpointInterval || 600000) * 2;
        const _runstateAlive = _runstateData?.status === 'running' && (Date.now() - (_runstateData?.lastEventAt || 0)) < _runstateTtl;
        const running = !fs.existsSync(stopFile) && (_runstateAlive || activeOrgRuns.has(orgName) || _loopRunning);
```

Note: keep the `_loopRunning` check as a secondary source (covers scheduled orgs using the loop file mechanism). The runstate is now primary.

- [ ] **Step 3: Also add runstate data to the response (line 3583–3584)**

Find:
```javascript
        const result = { config, state, goals: goalsData.goals, routines: routinesData.routines,
          approvals: approvalsData.approvals, running, tasks };
```

Replace with:
```javascript
        const result = { config, state, goals: goalsData.goals, routines: routinesData.routines,
          approvals: approvalsData.approvals, running, tasks,
          runId: _runstateData?.runId || null,
          lastEventAt: _runstateData?.lastEventAt || null,
          agentStates: _runstateData?.agentStates || {} };
```

- [ ] **Step 4: Verify no syntax errors**

Run: `node --check packages/@monomind/cli/dist/src/ui/server.mjs 2>&1 | head -20`

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/server.mjs
git commit -m "fix(server): replace complex running check with runstate TTL in GET /api/org/:name"
```

---

## Task 5: Add GET /api/org/:name/artifact endpoint

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/server.mjs:4817` (insert before the POST /api/mastermind/event route)

- [ ] **Step 1: Read context around line 4817**

Run: `sed -n '4813,4821p' packages/@monomind/cli/dist/src/ui/server.mjs`
Expected: The `// POST /api/mastermind/event` comment at 4817.

- [ ] **Step 2: Insert the artifact endpoint before line 4817**

Insert this block immediately before line 4817 (`// POST /api/mastermind/event`):

```javascript
    // GET /api/org/:name/artifact — serve file content for chat "View" button
    if (req.method === 'GET' && /^\/api\/org\/[^/]+\/artifact/.test(url)) {
      try {
        const _artQp = new URL('http://x' + req.url).searchParams;
        const _rawPath = _artQp.get('path');
        if (!_rawPath) { res.writeHead(400); res.end(JSON.stringify({ error: 'path required' })); return; }
        const _filePath = path.resolve(decodeURIComponent(_rawPath));
        // Path traversal guard: only allow reads within known project dirs
        const _allowed = _getAllowedArtifactDirs(projectDir || process.cwd());
        const _safe = _allowed.some(d => _filePath.startsWith(d + path.sep) || _filePath === d);
        if (!_safe) { res.writeHead(403); res.end(JSON.stringify({ error: 'path not allowed' })); return; }
        if (!fs.existsSync(_filePath)) { res.writeHead(404); res.end(JSON.stringify({ error: 'file not found' })); return; }
        const _mime = _detectMimeType(_filePath);
        const _size = fs.statSync(_filePath).size;
        if (!_mime.startsWith('text/') && _mime !== 'application/json') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ binary: true, mimeType: _mime, size: _size }));
          return;
        }
        const _content = fs.readFileSync(_filePath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ content: _content, mimeType: _mime, size: _size }));
      } catch (_e) { res.writeHead(500); res.end(JSON.stringify({ error: 'read failed' })); }
      return;
    }

```

- [ ] **Step 3: Verify no syntax errors**

Run: `node --check packages/@monomind/cli/dist/src/ui/server.mjs 2>&1 | head -20`

- [ ] **Step 4: Test the endpoint manually**

```bash
# Start server if not running; in another terminal:
curl -s "http://localhost:4242/api/org/reengineer-squad/artifact?path=$(python3 -c 'import urllib.parse; print(urllib.parse.quote("/Users/morteza/Desktop/tools/monomind/README.md"))')" | python3 -m json.tool | head -10
```
Expected: `{ "content": "...", "mimeType": "text/markdown", "size": ... }`

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/server.mjs
git commit -m "feat(server): add GET /api/org/:name/artifact endpoint with path traversal guard"
```

---

## Task 6: Add org:artifact rendering to dashboard chat

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/server.mjs` (inside the embedded `MASTERMIND_DIAGRAM_HTML` string — the JavaScript that renders run events)

- [ ] **Step 1: Find where org:comms events are rendered in the dashboard JS**

Run: `grep -n "org:comms\|e\.type.*comms\|evType.*comms\|renderEvent\|event-row\|msg.*event\|e\.content\|e\.msg" packages/@monomind/cli/dist/src/ui/server.mjs | grep -v "^[0-9]*:.*\/\/" | head -20`

- [ ] **Step 2: Find the renderEvent / event display function in the embedded HTML**

Run: `grep -n "function render\|function draw\|function show.*event\|function.*Event\|case 'org:comms'\|\.type === 'org:comms'" packages/@monomind/cli/dist/src/ui/server.mjs | head -20`

- [ ] **Step 3: Add org:artifact case to the event rendering switch/if block**

Find the block that renders an `org:comms` event (it likely builds an HTML string for a chat bubble). Immediately after that block (or as a new `else if (e.type === 'org:artifact')` branch), add:

```javascript
} else if (e.type === 'org:artifact' && e.artifact) {
  const _art = e.artifact;
  const _isText = (_art.mimeType || '').startsWith('text/') || (_art.mimeType || '') === 'application/json';
  const _label = _escHtml(_art.label || path.basename(_art.path || 'artifact'));
  const _meta = [_art.mimeType, _art.size ? `${Math.round(_art.size/1024*10)/10} KB` : null, _art.path ? _art.path.split('/').slice(-2).join('/') : null].filter(Boolean).join(' · ');
  const _viewBtn = _isText && _art.path
    ? `<button onclick="viewArtifact('${_escHtml(_art.path)}','${_label}')" style="background:#1a3a5a;color:#5d9fd9;border:1px solid #2980b944;border-radius:4px;padding:3px 9px;font-size:10px;font-weight:700;cursor:pointer;margin-left:auto">View</button>`
    : `<span style="font-size:10px;color:#555">Binary</span>`;
  msgHtml += `<div style="background:#1a1a2e;border:1px solid #3333aa44;border-radius:6px;padding:7px 10px;margin-top:5px;display:flex;align-items:center;gap:8px">
    <span style="font-size:16px">📄</span>
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:700;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_label}</div>
      <div style="font-size:10px;color:#888">${_escHtml(_meta)}</div>
    </div>
    ${_viewBtn}
  </div>`;
}
```

- [ ] **Step 4: Add the `viewArtifact` function to the dashboard JS**

Find where other dashboard helper functions are defined (e.g. search for `function _escHtml` or `function showRun`). After that function block, add:

```javascript
async function viewArtifact(filePath, label) {
  const orgName = currentOrg;
  if (!orgName || !filePath) return;
  const url = `/api/org/${encodeURIComponent(orgName)}/artifact?path=${encodeURIComponent(filePath)}`;
  try {
    const data = await fetch(url).then(r => r.json());
    if (data.binary) { showToast('Binary file — cannot display'); return; }
    if (data.error === 'file not found') { showToast('File no longer exists'); return; }
    if (data.error) { showToast(`Error: ${data.error}`); return; }
    showArtifactPanel(label, data.content, data.mimeType);
  } catch(_) { showToast('Failed to load artifact'); }
}

function showArtifactPanel(label, content, mimeType) {
  let panel = document.getElementById('artifact-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'artifact-panel';
    panel.style.cssText = 'position:fixed;top:0;right:0;width:480px;height:100vh;background:#0a0a14;border-left:1px solid #333;z-index:1000;display:flex;flex-direction:column;overflow:hidden';
    document.body.appendChild(panel);
  }
  panel.innerHTML = `
    <div style="padding:12px 14px;border-bottom:1px solid #1a1a2a;display:flex;align-items:center;gap:10px">
      <span style="font-size:13px;font-weight:700;color:#ccc;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</span>
      <button onclick="document.getElementById('artifact-panel').remove()" style="background:none;border:none;color:#888;font-size:16px;cursor:pointer">✕</button>
    </div>
    <pre style="flex:1;overflow:auto;padding:14px;font-size:11px;line-height:1.6;color:#bbb;white-space:pre-wrap;word-break:break-word">${content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
  `;
  panel.style.display = 'flex';
}
```

- [ ] **Step 5: Verify the dashboard loads (server restart + browser check)**

```bash
npx monomind browse open http://localhost:4242
npx monomind browse wait --text "MASTERMIND" --timeout 5000
npx monomind browse errors
```
Expected: no JS errors, page loads normally.

- [ ] **Step 6: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/server.mjs
git commit -m "feat(dashboard): render org:artifact events as artifact cards with View button"
```

---

## Task 7: Update runorg.md skill

**Files:**
- Modify: `.claude/skills/mastermind/runorg.md`

- [ ] **Step 1: Read the current runorg.md to find the exact sections to change**

Read: `.claude/skills/mastermind/runorg.md` — focus on:
  1. Where `RUN_FILE` / `touch "${RUN_FILE}"` appears (startup section)
  2. Where `echo '...' >> "${RUN_FILE}"` appears (boss behavior)
  3. Where `ScheduleWakeup` is called (scheduled path)
  4. Where `org:start` is emitted (to add `checkpointInterval`)

- [ ] **Step 2: Add checkpointInterval to org:start emission**

Find the `org:start` curl call (it will look like):
```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"org:start\",\"org\":\"${ORG_NAME}\",...}"
```

Add `"checkpointInterval":${CHECKPOINT_INTERVAL_MS:-600000}` to the JSON body.

- [ ] **Step 3: Remove bash file-creation from startup (if present)**

Search for `RUN_FILE=` in runorg.md. If found, remove:
- `mkdir -p "..."` for the runs dir
- `RUN_FILE=...` variable definition
- `touch "${RUN_FILE}"` or `echo '...' >> "${RUN_FILE}"` at startup

- [ ] **Step 4: Replace any `echo ... >> "${RUN_FILE}"` in boss behavior with curl**

For each `echo '{"type":"run:cycle:complete"...}' >> "${RUN_FILE}"`, replace with:
```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"run:cycle:complete\",\"org\":\"${ORG_NAME}\",\"runId\":\"${RUN_ID}\",\"cycle\":${CYCLE_NUM:-1},\"ts\":$(date +%s%3N)}" || true
```

- [ ] **Step 5: Add org:stop before ScheduleWakeup in the scheduled path**

Find the `ScheduleWakeup` call in the scheduled loop section. Immediately before it, add:
```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"org:stop\",\"org\":\"${ORG_NAME}\",\"runId\":\"${RUN_ID}\",\"ts\":$(date +%s%3N),\"reason\":\"scheduled-iteration-complete\"}" || true
```

- [ ] **Step 6: Add org:agent:offline instruction for boss**

In the section describing how boss spawns agents, after the agent completes its task, add an instruction to emit:
```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"org:agent:offline\",\"org\":\"${ORG_NAME}\",\"runId\":\"${RUN_ID}\",\"from\":\"${AGENT_ROLE}\",\"ts\":$(date +%s%3N)}" || true
```

- [ ] **Step 7: Add org:artifact instruction (optional pattern)**

At the end of the skill, add a section "Reporting artifacts":
```markdown
## Reporting Artifacts (optional)

When you create or modify a file that represents output of the org run, emit:

\```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"org:artifact\",\"org\":\"${ORG_NAME}\",\"runId\":\"${RUN_ID}\",\"from\":\"${AGENT_ROLE}\",\"artifact\":{\"label\":\"${ARTIFACT_LABEL}\",\"type\":\"file\",\"path\":\"${FILE_PATH}\",\"mimeType\":\"text/plain\"}}" || true
\```

The dashboard chat will show this as an artifact card with a "View" button.
```

- [ ] **Step 8: Commit**

```bash
git add .claude/skills/mastermind/runorg.md
git commit -m "feat(runorg): add checkpointInterval to org:start, org:stop for scheduled orgs, org:artifact pattern"
```

---

## Task 8: Smoke test

- [ ] **Step 1: Restart the dashboard server**

```bash
pkill -f "monomind.*server" 2>/dev/null || true
sleep 1
# Server auto-starts via control-start.cjs hook or:
npx monomind browse open http://localhost:4242
npx monomind browse wait --text "MASTERMIND" --timeout 8000
```

- [ ] **Step 2: Navigate to Orgs tab and verify statuses**

```bash
npx monomind browse find role link --name "Orgs" click
npx monomind browse wait --text "reengineer-squad" --timeout 5000
npx monomind browse screenshot orgs-after-fix.png
```
Expected: Orgs show correct LIVE/IDLE (not stuck LIVE for stopped orgs).

- [ ] **Step 3: Click an org and verify chat events load**

```bash
npx monomind browse find text "reengineer-squad" click
npx monomind browse wait --text "Chat" --timeout 3000
npx monomind browse find text "Chat" click
npx monomind browse screenshot chat-after-fix.png
```
Expected: Chat shows more than 2 events (all org:comms, org:checkpoint, etc.).

- [ ] **Step 4: Test artifact endpoint directly**

```bash
curl -s "http://localhost:4242/api/org/reengineer-squad/artifact?path=$(python3 -c 'import urllib.parse,os; print(urllib.parse.quote(os.getcwd()+"/CLAUDE.md"))')" | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK', d.get('mimeType'), len(d.get('content','')))"
```
Expected: `OK text/markdown 1234` (some byte count)

- [ ] **Step 5: Verify no JS errors in browser**

```bash
npx monomind browse errors
```
Expected: `[]` or empty.

- [ ] **Step 6: Commit smoke test screenshot evidence**

```bash
git add orgs-after-fix.png chat-after-fix.png 2>/dev/null || true
git commit -m "test: smoke test screenshots showing status and chat fixes" 2>/dev/null || echo "no screenshots to commit"
```
