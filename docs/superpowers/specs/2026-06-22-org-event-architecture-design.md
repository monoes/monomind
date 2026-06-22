# Org Event Architecture — Design Spec

**Approach:** A — Server as Single Event Router

**Goal:** Fix org status (false LIVE), chat completeness (0–2 events), and add asset viewer — by making the server the single write point for all org events.

**Root cause:** Two diverging write paths (bash → JSONL files and curl → flat log) were never reconciled. The dashboard only reads one depending on which org path ran.

---

## Architecture

All org events flow through `POST /api/mastermind/event`. The server fans each event to three destinations simultaneously:

1. **Per-org run JSONL** — `.git/monomind/orgs/{name}/runs/{runId}.jsonl` (canonical run record, chat source)
2. **Flat log** — `mastermind-events.jsonl` (backwards compat)
3. **SSE broadcast** — live dashboard clients

Server writes a durable `{name}-runstate.json` on state-changing events (not every event — see Batching below). Status detection uses a TTL check on this file — no more 65KB event log scanning.

**Constraint:** One active run per org at a time. An incoming `org:start` always supersedes any existing runstate — the previous run is implicitly closed. This is a known limitation; concurrent daemon + scheduled runs for the same org are not supported.

---

## Event Schema

Every event posted to `/api/mastermind/event`:

```json
{
  "type": "org:comms",
  "org": "reengineer-squad",
  "runId": "rn_1751234567890",
  "ts": 1751234567890,
  "from": "boss",
  "to": "developer",
  "content": "task assigned",
  "artifact": null
}
```

Fields: `type` and `org` are required. `runId` is **required on `org:start`** (server returns 400 if missing); optional on all other event types (server pulls from active runstate if absent).

### Event Types

| Type | Description |
|---|---|
| `org:start` | Org run begins. **Must include `runId` and `checkpointInterval`.** Server creates run file + runstate. |
| `org:stop` | Run ends or is stopped. Server marks runstate idle. |
| `org:comms` | Boss ↔ agent communication. Visible in chat. |
| `org:agent:online` | Agent joined. Updates agentStates in runstate. |
| `org:agent:offline` | Agent finished. Updates agentStates to `idle`. |
| `org:checkpoint` | Progress heartbeat. Debounced runstate `lastEventAt` update. |
| `org:artifact` | **New.** File/report generated. Chat shows "View" button. |

### `org:start` Required Fields

```json
{
  "type": "org:start",
  "org": "reengineer-squad",
  "runId": "rn_1751234567890",
  "ts": 1751234567890,
  "checkpointInterval": 600000
}
```

`checkpointInterval` is how often the boss emits `org:checkpoint` (milliseconds). The status TTL = `2 × checkpointInterval`. Default if omitted: 600000ms (10 min), giving a 20-min TTL.

### org:artifact Schema

```json
{
  "type": "org:artifact",
  "org": "reengineer-squad",
  "runId": "rn_1751234567890",
  "ts": 1751234599000,
  "from": "developer",
  "artifact": {
    "label": "auth module refactored",
    "type": "file",
    "path": "/absolute/path/to/file.ts",
    "mimeType": "text/typescript",
    "preview": "first 500 chars of file content...",
    "size": 4200
  }
}
```

`preview` ships with the event so chat renders without an extra server call. "View" opens a side panel; server reads the full file via `GET /api/org/:name/artifact?path=...`. Binary files (non `text/` mimeType) return `{ error: 'binary', size }` — chat shows the artifact card without a View button.

---

## Durable Run State

Server writes `.git/monomind/orgs/{name}-runstate.json` on **state-changing events only** (see Batching):

```json
{
  "runId": "rn_1751234567890",
  "status": "running",
  "startedAt": 1751234567890,
  "lastEventAt": 1751234599000,
  "checkpointInterval": 600000,
  "agentStates": {
    "boss": { "status": "active", "lastSeen": 1751234599000 },
    "developer": { "status": "idle", "lastSeen": 1751234570000 }
  }
}
```

**Status logic:**

```
idle   if (now - lastEventAt) > 2 × checkpointInterval   (default: 20 min TTL)
running otherwise
```

Survives server restart — read from disk, no in-memory state needed. Replaces the 65KB event log scan entirely.

**Batching `lastEventAt` writes:** High-frequency events (`org:comms`, `org:checkpoint`) only update `lastEventAt` in runstate. To avoid disk thrash on busy orgs, these writes are debounced: a 5-second timer flushes the latest `lastEventAt` to disk. State-changing events (`org:start`, `org:stop`, `org:agent:online`, `org:agent:offline`) always write immediately — no debounce.

**`activeOrgRuns` Map:** The existing in-memory Map is kept as a secondary cache (still updated on `org:start`/`org:stop`). Do not remove it — other server code may reference it. The runstate.json is the authoritative source for status; `activeOrgRuns` is a fast-path cache that loses its state on restart (acceptable since runstate.json recovers it).

---

## Server Changes

### Modified: `POST /api/mastermind/event`

```javascript
// Validate: org:start must include runId
if (event.type === 'org:start' && !event.runId) {
  return res.status(400).json({ error: 'org:start requires runId' });
}

// EXISTING — keep as-is
fs.appendFileSync(eventsLog, JSON.stringify(event) + '\n');
sseClients.forEach(c => c.write(`data: ${JSON.stringify(event)}\n\n`));

// ADD: write to per-org run JSONL (all events that have a runId)
const activeRunId = event.runId || _getActiveRunId(event.org, projectDir);
if (event.org && activeRunId) {
  const runFile = _getRunFilePath(event.org, activeRunId, projectDir);
  fs.mkdirSync(path.dirname(runFile), { recursive: true });
  fs.appendFileSync(runFile, JSON.stringify({ ...event, runId: activeRunId }) + '\n');
}

// ADD: update durable runstate (batched for high-frequency events)
if (event.org) _scheduleRunStateUpdate(event, projectDir);
```

### Modified: `GET /api/org/:name`

Replace 65KB scan with runstate TTL check:

```javascript
const projDir = _resolveOrgProjectDir(orgName, serverRoot) || serverRoot;
const runstate = _readRunState(orgName, projDir);
const TTL = (runstate?.checkpointInterval || 600000) * 2;
const isLive = runstate != null
  && runstate.status === 'running'
  && (Date.now() - runstate.lastEventAt) < TTL;
```

Response includes `runId`, `lastEventAt`, `agentStates`.

**Note:** On first deploy, orgs with no `runstate.json` will show IDLE immediately. This is correct — they had no recent events and were incorrectly showing LIVE.

### New: `GET /api/org/:name/artifact`

Query param: `?path=/absolute/path/to/file`

```javascript
// Normalize and guard against path traversal
const rawPath = req.query.path;
if (!rawPath) return res.status(400).json({ error: 'path required' });
const filePath = path.resolve(decodeURIComponent(rawPath));

// Only allow reads within known project dirs
const allowed = _getAllowedDirs(serverRoot); // from known-projects.json + serverRoot
const safe = allowed.some(d => filePath.startsWith(path.resolve(d) + path.sep));
if (!safe) return res.status(403).json({ error: 'path not allowed' });

if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file not found' });

const mimeType = detectMimeType(filePath);
if (!mimeType.startsWith('text/')) {
  // Binary: return metadata only, no content
  return res.json({ binary: true, mimeType, size: fs.statSync(filePath).size });
}

res.json({
  content: fs.readFileSync(filePath, 'utf8'),
  mimeType,
  size: fs.statSync(filePath).size
});
```

### Unchanged

`GET /api/org/:name/runs`, `GET /api/org/:name/runs/:runId`, `/api/org/:name/activity`, `/api/org/:name/threads`, `/api/org/:name/goals`, `/api/org/:name/routines`, `/api/org/:name/adapters`, `/api/orgs`, SSE stream — no changes needed. They work correctly once the event router writes to the right place.

### New Helpers

**`_getRunFilePath(orgName, runId, rootDir)`** — resolves project dir (checking both `.git/monomind` and `.monomind` layouts) and returns JSONL path:
```javascript
function _getRunFilePath(org, runId, root) {
  const projDir = _resolveOrgProjectDir(org, root) || root;
  const base = _getGitMonomindDir(projDir); // existing helper
  return path.join(base, 'orgs', org, 'runs', `${runId}.jsonl`);
}
```

**`_readRunState(orgName, rootDir)`** — reads and parses runstate.json, returns null if missing:
```javascript
function _readRunState(org, root) {
  const projDir = _resolveOrgProjectDir(org, root) || root;
  const base = _getGitMonomindDir(projDir);
  const file = path.join(base, 'orgs', `${org}-runstate.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}
```

**`_updateRunState(event, rootDir)`** — merges event data into runstate, writes immediately (called for state-changing events only):
```javascript
function _updateRunState(event, root) {
  const projDir = _resolveOrgProjectDir(event.org, root) || root;
  const base = _getGitMonomindDir(projDir);
  fs.mkdirSync(path.join(base, 'orgs'), { recursive: true });
  const file = path.join(base, 'orgs', `${event.org}-runstate.json`);
  const cur = _readRunState(event.org, root) || {};

  if (event.type === 'org:start') {
    cur.runId = event.runId;
    cur.status = 'running';
    cur.startedAt = event.ts || Date.now();
    cur.checkpointInterval = event.checkpointInterval || 600000;
    cur.agentStates = {};
  } else if (event.type === 'org:stop') {
    cur.status = 'idle';
  } else if (event.type === 'org:agent:online') {
    cur.agentStates = cur.agentStates || {};
    cur.agentStates[event.from] = { status: 'active', lastSeen: event.ts || Date.now() };
  } else if (event.type === 'org:agent:offline') {
    if (cur.agentStates?.[event.from]) {
      cur.agentStates[event.from].status = 'idle';
    }
  }
  cur.lastEventAt = event.ts || Date.now();
  fs.writeFileSync(file, JSON.stringify(cur, null, 2));
}
```

**`_scheduleRunStateUpdate(event, rootDir)`** — routes to immediate write or debounced `lastEventAt` update:
```javascript
const _runstateDebouncers = new Map(); // org → { lastEventAt, timer }

function _scheduleRunStateUpdate(event, root) {
  const stateChanging = ['org:start','org:stop','org:agent:online','org:agent:offline'];
  if (stateChanging.includes(event.type)) {
    // Clear any pending debounced write before the immediate one
    const pending = _runstateDebouncers.get(event.org);
    if (pending?.timer) clearTimeout(pending.timer);
    _runstateDebouncers.delete(event.org);
    return _updateRunState(event, root);
  }
  // Debounce lastEventAt updates (5s)
  const ts = event.ts || Date.now();
  const existing = _runstateDebouncers.get(event.org);
  if (existing?.timer) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    _runstateDebouncers.delete(event.org);
    const rs = _readRunState(event.org, root);
    if (!rs) return;
    rs.lastEventAt = ts;
    const projDir = _resolveOrgProjectDir(event.org, root) || root;
    const base = _getGitMonomindDir(projDir);
    const file = path.join(base, 'orgs', `${event.org}-runstate.json`);
    try { fs.writeFileSync(file, JSON.stringify(rs, null, 2)); } catch (_) {}
  }, 5000);
  _runstateDebouncers.set(event.org, { lastEventAt: ts, timer });
}
```

**`_getActiveRunId(orgName, rootDir)`** — returns the current runId from runstate (for events that omit it):
```javascript
function _getActiveRunId(org, root) {
  return _readRunState(org, root)?.runId || null;
}
```

---

## runorg Skill Changes

### Remove

- `mkdir -p "${GIT_MONOMIND}/orgs/${ORG}/runs"` at startup
- `RUN_FILE=...` variable and `touch "${RUN_FILE}"` at startup
- All `echo '...' >> "${RUN_FILE}"` direct bash writes (`run:cycle:complete`, `run:complete`)

### Change

Replace removed bash writes with curl to `/api/mastermind/event`, including `runId` and `org` fields.

### Add: `checkpointInterval` to `org:start`

```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"org:start\",\"org\":\"${ORG_NAME}\",\"runId\":\"${RUN_ID}\",\"checkpointInterval\":${CHECKPOINT_INTERVAL_MS:-600000},\"ts\":$(date +%s%3N)}"
```

### Add: `org:stop` for scheduled orgs

At end of each scheduled iteration, before `ScheduleWakeup`:

```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"org:stop\",\"org\":\"${ORG_NAME}\",\"runId\":\"${RUN_ID}\",\"ts\":$(date +%s%3N),\"reason\":\"scheduled-iteration-complete\"}"
```

### Add: `org:agent:offline` when agent finishes

```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"org:agent:offline\",\"org\":\"${ORG_NAME}\",\"runId\":\"${RUN_ID}\",\"from\":\"${AGENT_ROLE}\",\"ts\":$(date +%s%3N)}"
```

### Add: `org:artifact` (optional)

When boss/agent creates or modifies a significant file:

```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"org:artifact\",\"org\":\"${ORG_NAME}\",\"runId\":\"${RUN_ID}\",\"from\":\"${AGENT_ROLE}\",\"artifact\":{\"label\":\"${LABEL}\",\"type\":\"file\",\"path\":\"${FILE_PATH}\",\"mimeType\":\"text/plain\"}}"
```

---

## Dashboard UI Changes

### Chat tab: artifact cards

When an `org:artifact` event appears in the run JSONL, the chat renders an artifact card:

```
[👷 DEVELOPER • 2:14 PM]
Completed auth module refactor.
┌─────────────────────────────────────────┐
│ 📄 auth module refactored               │
│ text/typescript · 4.1 KB · src/auth/... │  [View]
└─────────────────────────────────────────┘
```

- Text files: "View" button calls `GET /api/org/:name/artifact?path=...`, renders content in a side panel with syntax highlighting.
- Binary files: server returns `{ binary: true }` → card shows "Binary file" label, no View button.
- File not found on disk: View returns 404 → toast "File no longer exists".

### Status indicator

Uses `lastEventAt` from runstate TTL instead of event log scan. No other UI change needed.

---

## What This Fixes

| Bug | Fix |
|---|---|
| False LIVE status | TTL on runstate.json, accurate even after crash/restart |
| Chat shows 0–2 events | Server routes all events to run JSONL, chat sees full history |
| Scheduled orgs stuck LIVE | org:stop emitted before ScheduleWakeup |
| State amnesia on restart | runstate.json persists to disk, read on startup |
| No asset viewer | org:artifact event + /api/org/:name/artifact endpoint |

---

## Known Limitations

- **One active run per org.** Concurrent daemon + scheduled runs for the same org are not supported. `org:start` always supersedes the current runstate.
- **Binary artifact content** not served (metadata only). Text files only.
- **5-second debounce** means `lastEventAt` in runstate can lag by up to 5s. Status TTL is 20 min by default, so this is negligible.
- **Artifact View requires file still on disk.** Past runs where files were deleted show a "File no longer exists" toast.

---

## Files Changed

| File | Change |
|---|---|
| `packages/@monomind/cli/dist/src/ui/server.mjs` | Modify `POST /api/mastermind/event`; modify `GET /api/org/:name`; add `GET /api/org/:name/artifact`; add 5 helpers |
| `.claude/skills/mastermind/runorg.md` | Remove bash file writes; add `checkpointInterval` to org:start; add org:stop for scheduled path; add org:agent:offline; add org:artifact pattern |
| Dashboard chat component (embedded in server.mjs) | Render `org:artifact` event as artifact card with View button + side panel |
