# Org Dashboard v2 — Architecture Design & Issue Resolution

> **Status:** Pre-Phase-1 (foundation fixes applied and empirically verified; Phases 1–4 unbuilt)
> **Scope:** Org lifecycle state, LIVE EVENTS / Chat tab, hook-based event capture  
> **Replaces:** Current curl-push + TTL + SSE architecture in `server.mjs` / `orgs.html` / `capture-handler.cjs`
> **All open questions resolved as of 2026-06-23. No blocking unknowns remain for Phase 1.**

---

## 1. What's Wrong With the Current Architecture

### 1.1 State lives in three places simultaneously

```
activeOrgRuns map       ← in-memory, lost on server restart
runstate.json           ← durable, but TTL-based liveness is a guess  
mastermind-events.jsonl ← ground truth, but server doesn't tail it
```

No single source of truth. Server restart rebuilds from runstate.json (stale) and ignores
the event log (accurate). Dashboard can show IDLE for a running org or LIVE for a dead one.

### 1.2 Org lifecycle depends on LLM instructions being followed

```
Boss receives instruction: "curl org:start to the server"
  → Boss may skip it, misformat it, or forget template substitution
  → org:start never fires → runstate never written → badge shows IDLE forever
```

This is the root cause of the dentalos-ux-qa IDLE bug. Fixed by merging the curl into
the bash script (Step 2+3), but the underlying dependency on LLM compliance remains
for all subsequent lifecycle events (heartbeats, org:complete).

### 1.3 LIVE EVENTS tab is populated from two incompatible sources

- Real-time: SSE broadcast from server when events arrive via HTTP POST
- Historical: manual fetch from `/api/orgs/:name/runs/current` on org select

If the server restarts mid-run, SSE clients reconnect but receive no history — chat is blank.
Historical fetch only covers events in the JSONL file, not in-memory SSE buffer.
Gap: events that arrived via SSE but before the historical fetch replayed are duplicated or missing.

### 1.4 capture-handler.cjs silently produces untagged events

`SubagentStart`/`SubagentStop` hooks fire but `active-run.json` was always absent
(server only wrote it on HTTP `run:start`, which never arrived since bash writes directly to JSONL).
Result: `agent:spawn` and `agent:complete` events emitted with empty `org` and `runId` —
dashboard could never attribute them to any org.

Additionally, `active-run.json` was written to `{root}/.monomind/capture/` (the org's project dir,
e.g. `/dntst/`) but capture-handler reads from `CLAUDE_PROJECT_DIR/.monomind/capture/`
(the monomind session dir). Cross-project orgs: permanent mismatch.

---

## 2. Target Architecture

### 2.1 Single source of truth: the run JSONL file

```
.monomind/orgs/{orgName}/runs/{runId}.jsonl
```

Every lifecycle event, agent event, and tool event is appended here.
Server does not maintain in-memory state beyond what it can reconstruct from this file.
Dashboard streams this file. No separate runstate.json for liveness (only for metadata).

Note: path uses `.monomind/` (the project's own directory), not `.git/monomind/`.
`_getGitMonomindDir()` in server.mjs resolves this to the git-root-adjacent `.monomind/`
directory so paths are stable across git worktrees.

### 2.2 File watcher replaces activeOrgRuns map

Phase 1 uses `fs.watch()` (zero dependencies, works on macOS and Windows). Linux
requires the chokidar upgrade path — see Issue 1 resolution.

```javascript
// Phase 1: fs.watch() — built-in, no dependencies
function watchOrgsDir(orgsDir) {
  fs.watch(orgsDir, { recursive: true }, (eventType, filename) => {
    if (!filename || !filename.endsWith('.jsonl')) return;
    const { orgName, runId } = parseRunPath(path.join(orgsDir, filename));
    if (orgName && runId) processRunFile(path.join(orgsDir, filename), orgName, runId);
  });
}
```

On Linux, `{ recursive: true }` is unsupported — upgrade to chokidar (see Issue 1).

Org is "running" = latest run file has `run:start`, no `run:complete` yet.
No TTL, no guessing. Deterministic from file content.

### 2.3 Three-state liveness from mtime + file content

| State   | Condition                                               | Badge     |
|---------|---------------------------------------------------------|-----------|
| LIVE    | run:start present, no run:complete, mtime < 30 min     | 🟢 LIVE   |
| QUIET   | run:start present, no run:complete, mtime 30 min–2 hr  | 🟡 QUIET  |
| STALE   | run:start present, no run:complete, mtime > 2 hr       | 🔴 STALE  |
| DONE    | run:complete present in latest run file                 | ⚫ IDLE   |

QUIET = boss is processing a long task. STALE = probably crashed.
Both are honest signals rather than TTL guesses.

### 2.4 Hook-driven telemetry — partial LLM curl dependency remains

```
Claude Code hooks (guaranteed to fire):
  SubagentStart (any)   → capture-handler emits agent:spawn (reads active-run.json)
  SubagentStop  (any)   → capture-handler emits agent:complete + org:comms + agent:usage
  PreToolUse            → capture-handler emits agent:read / agent:edit / agent:bash (Phase 3)
  PostToolUse           → capture-handler emits agent:bash:result (Phase 3)

Bash script in runorg.md (still required for lifecycle events):
  step 2+3 curl         → org:start + session:start (fires before any agent work)
  org loop exit curl    → org:complete (fires when boss loop finishes)
```

**Important constraint (empirically verified 2026-06-23):** Boss cannot be identified
from hooks — `CLAUDE_SESSION_ID`, `CLAUDE_CODE_AGENT_ROLE`, and `process.ppid` are all
identical between boss and member hook processes. Therefore:
- `run:start` and `run:complete` CANNOT be written from hooks without premature truncation
- Lifecycle events MUST come from the runorg.md bash script (org:start / org:complete curls)
- Hooks handle only telemetry events (agent:spawn, agent:complete, tool captures)

This is the implementable state. A fully hook-driven lifecycle would require Claude Code
to expose a discriminating identity value (e.g. a `BossStop` hook type or `CLAUDE_CODE_AGENT_ROLE`
env var) that is not currently available.

### 2.5 Streaming tail replaces dual SSE + historical fetch

```
GET /api/orgs/:name/runs/current/stream?since=0   (SSE, chunked)
```

Server tails the run JSONL file from byte offset `since`.
Client stores its last offset in memory. On reconnect, passes offset back.
Zero events lost across reconnects or server restarts.
Historical load = same endpoint with `since=0`.
No more dual-source reconciliation.

**Run transition:** The `/current` segment resolves to the latest `run:start`-bearing run file
for that org. When a run completes (`run:complete` written) and a new run begins, the endpoint
URL does not change — the server resolves `/current` dynamically. Clients that are streaming
will see both `run:complete` and the new `run:start` on the same SSE stream without reconnecting.
If the client disconnects and reconnects after a run boundary, it must pass `since=0` to get
full history from the new current run (not the completed one). Clients should track the latest
`runId` from events and reinitialise the stream if `runId` changes mid-stream.

### 2.6 Chat tab event taxonomy

| Hook              | Event Type         | Chat Display                                    |
|-------------------|--------------------|-------------------------------------------------|
| SubagentStart     | `agent:spawn`      | 🤖 Boss → browser-tester: "Test registration"  |
| SubagentStop      | `agent:complete`   | ✅ browser-tester → done (3 files changed)      |
| PreToolUse: Edit  | `agent:edit`       | ✏️  ux-analyst editing PatientForm.tsx +12/-4  |
| PreToolUse: Read  | `agent:read`       | 📖 ux-analyst reading auth/session.ts           |
| PreToolUse: Bash  | `agent:bash`       | 💻 npm run test -- --grep "registration"        |
| PostToolUse: Bash | `agent:bash:result`| exit 0, 8 tests passed                          |
| browse tools      | `agent:browse`     | 🌐 http://91.99.106.218:9090/register           |
| org:comms         | `agent:comm`       | 💬 orchestrator: "Moving to phase 2"            |
| agent:usage       | `agent:usage`      | token/cost meter per agent                      |

---

## 3. Design Issues & Resolutions

### Issue 1 — fs.watch is not cross-platform

**Severity:** Critical  
**Impact:** On Linux servers (VPS, CI), `fs.watch({ recursive: true })` does not recursively
watch subdirectories. Org state changes silently never get picked up. The entire watcher
architecture fails on the most common deployment target.

**Resolution:**  
Replace `fs.watch` with `chokidar` (battle-tested, 50M+ weekly downloads).
Chokidar wraps FSEvents (macOS), inotify (Linux), and ReadDirectoryChangesW (Windows)
with a unified API and recursive support on all platforms.

```javascript
import chokidar from 'chokidar';

const watcher = chokidar.watch([], {
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  // awaitWriteFinish coalesces rapid appends into one event (fixes FSEvents batching caveat)
});
watcher.on('change', handleRunFileChange);

// Add watch paths for each known project
function watchProject(projectDir) {
  const orgsDir = path.join(_getGitMonomindDir(projectDir) ?? path.join(projectDir, '.monomind'), 'orgs');
  if (fs.existsSync(orgsDir)) watcher.add(orgsDir);
}
```

`awaitWriteFinish` also resolves Issue 10 (FSEvents coalescing) for free.

---

### Issue 2 — Concurrent JSONL writes corrupt data

**Severity:** Critical  
**Impact:** Boss and multiple subagents append to `{runId}.jsonl` simultaneously.
`fs.appendFileSync` is not atomic across processes. Two agents writing at the same moment
can interleave bytes mid-line, producing invalid JSON that breaks all downstream parsing
silently and permanently.

**Resolution:**  
Use SQLite with WAL mode for the run event log. WAL (Write-Ahead Logging) handles
concurrent writers natively — readers never block writers, multiple writers queue safely.

```sql
CREATE TABLE run_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id   TEXT NOT NULL,
  org      TEXT NOT NULL,
  type     TEXT NOT NULL,
  payload  TEXT NOT NULL,  -- JSON
  ts       INTEGER NOT NULL
);
CREATE INDEX idx_run_events_run_id ON run_events(run_id, id);
```

```javascript
// Any process, any agent, any time — safe concurrent writes
db.prepare('INSERT INTO run_events (run_id, org, type, payload, ts) VALUES (?,?,?,?,?)')
  .run(runId, org, event.type, JSON.stringify(event), event.ts);
```

The streaming tail endpoint reads from `WHERE run_id = ? AND id > ?` using `ROWID`
as the byte-offset equivalent. Deterministic, concurrent-safe, indexed.

**Implementation choice (see Section 9):** Use `sql.js` (WASM SQLite) rather than
`better-sqlite3`. The WASM build is already a transitive dependency via `@monomind/memory`
— zero new install burden, no ARM64 vs x86 native compilation risk. Only escalate to
`better-sqlite3` if WASM write throughput proves insufficient for observed event rates.

**Critical: sql.js is in-memory — explicit disk persistence required.** Unlike better-sqlite3,
sql.js does not write to disk automatically. After every INSERT, call:

```javascript
function persistDb() {
  const data = db.export(); // Uint8Array
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}
```

Also register exit handlers so no events are lost on graceful shutdown:
```javascript
process.on('SIGTERM', () => { persistDb(); process.exit(0); });
process.on('SIGINT',  () => { persistDb(); process.exit(0); });
```

For high-frequency writes, debounce `persistDb()` with a 500ms trailing flush rather than
writing after every single INSERT — at 10 events/second the per-write persist would become
a bottleneck. sql.js in @monomind/memory uses a 1000ms auto-persist interval for reference.

**Migration note:** Existing JSONL files can be imported into SQLite on first startup.
Export API can still produce JSONL for external consumers.

---

### Issue 3 — active-run.json is a single slot

**Severity:** Critical  
**Impact:** If two orgs start before either completes, the second org:start overwrites
`active-run.json`. All hook events from the first org's still-running subagents get
misattributed to the second org. Tool events, agent events, and usage data are poisoned.

**Resolution:**  
Replace the single-file approach with a registry keyed by the parent Claude Code process.

```
.monomind/capture/active-runs/
  {ppid}.json    ← one file per active Claude Code session (keyed by parent PID)
```

capture-handler resolves which org it belongs to by reading the file for its `process.ppid`.
On org:complete, delete `{ppid}.json`.

**Key insight (empirically verified 2026-06-23):** `CLAUDE_SESSION_ID` is NOT set in hook
processes, so ppid is the only viable discriminator. Crucially, for multi-org attribution,
ppid DOES work: each Claude Code session has a unique PID (verified: 6059, 78648, 85539, etc.
all running concurrently), so hooks from Session A (`ppid = 6059`) and hooks from Session B
(`ppid = 9999`) naturally resolve to different active-run files. Boss/member discrimination
within a single session is NOT needed here — we only need to distinguish sessions.

```javascript
function getActiveRunFile() {
  // ppid = the Claude Code process that spawned this hook — unique per session
  return path.join(captureDir, 'active-runs', `${process.ppid}.json`);
}
```

**Bootstrap (writing the active-run file):** The `ppid` is only available inside the hook
process, not in the curl from runorg.md. Therefore the active-run file must be written by
capture-handler on `SubagentStart` using its own `process.ppid`, not by the server on org:start.
The org:start curl tells the server which org/runId is active; capture-handler writes the
ppid-keyed file on its first SubagentStart:

```javascript
// In capture-handler.cjs handleSubagentStart:
const runFile = path.join(captureDir, 'active-runs', `${process.ppid}.json`);
if (!fs.existsSync(runFile) && activeRun) {
  fs.writeFileSync(runFile, JSON.stringify({ ...activeRun, ppid: process.ppid }));
}
```

**Bootstrap race:** If two orgs start and both reach SubagentStart before either writes
its ppid file, each correctly writes its own `{ppid}.json` (different ppid = different file).
No collision is possible — each session has a unique ppid and writes only its own file.

---

### Issue 4 — Agent role attribution for PreToolUse/PostToolUse (Phase 3)

**Severity:** Significant (Phase 3 only — not blocking Phases 1–2)
**Impact:** The "who is editing what" feature (Phase 3) requires knowing which agent
(orchestrator, browser-tester, ux-analyst) is making each tool call so PreToolUse events
can be labeled correctly.

**Empirical findings (2026-06-23):** CLAUDE_SESSION_ID and CLAUDE_CODE_AGENT_ROLE are
both unset in hook processes. process.ppid is identical for all hooks within a session —
boss and member hooks share the same ppid. Therefore, no env var directly identifies
which subagent is making the current tool call.

**Resolution (implementable with current Claude Code):**

The SubagentStart hook payload contains the agent's description and type. Capture-handler
writes a per-`process.pid` role file at SubagentStart time — since each hook invocation
is a separate Node.js process, the hook's own PID is the agent's unique handle for this
invocation. PreToolUse hooks (spawned shortly after) can read this file.

```javascript
// SubagentStart: record role keyed by hook process PID
const roleFile = path.join(captureDir, 'roles', `${process.pid}.json`);
fs.writeFileSync(roleFile, JSON.stringify({ role: agentType, org, runId, ts: Date.now() }));

// PreToolUse: find the closest role by scanning recent role files
const roles = fs.readdirSync(rolesDir)
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(rolesDir, f), 'utf8')));
const myRole = roles.sort((a, b) => b.ts - a.ts)[0]?.role || 'unknown';
```

**Cleanup:** role files must be pruned on `run:complete` (or by the server on org completion)
to prevent unbounded growth. Server deletes all `roles/*.json` with `runId` matching the
completed run. TTL fallback: server also prunes role files older than 8 hours on startup.

---

### Issue 5 — Hook failures are permanently silent

**Severity:** Significant  
**Impact:** If the hook POST to the server fails (server busy, port wrong, crash),
Claude Code logs the error internally but continues silently. For lifecycle events
(org:start, org:complete), this means the dashboard shows incorrect state with no
way to detect or recover.

**Resolution:**  
Write-first, POST-second pattern in all hook handlers:

```javascript
async function emitEvent(event) {
  // Step 1: Write to local spool file (atomic, always succeeds if disk available)
  const spoolFile = path.join(captureDir, 'spool', `${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.mkdirSync(path.dirname(spoolFile), { recursive: true });
  fs.writeFileSync(spoolFile, JSON.stringify(event));

  // Step 2: Attempt immediate HTTP POST using http (CJS compatible, no fetch dependency)
  return new Promise((resolve) => {
    try {
      const body = JSON.stringify(event);
      const req = http.request({
        hostname: 'localhost', port: ctrlPort, path: '/api/mastermind/event',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, () => { fs.unlinkSync(spoolFile); resolve(); });
      req.on('error', () => resolve()); // spool entry stays
      req.setTimeout(2000, () => { req.destroy(); resolve(); });
      req.write(body);
      req.end();
    } catch { resolve(); }
  });
}
```

Server polls `.monomind/capture/spool/` every 5 seconds, processes and deletes
each file. Effectively a local dead-letter queue. Max event latency: 5 seconds.
No events permanently lost unless disk fails.

**Cross-project spool discovery:** capture-handler can run from any project dir
(`CLAUDE_PROJECT_DIR` varies). The spool lives at `{CLAUDE_PROJECT_DIR}/.monomind/capture/spool/`.
Server discovers spool dirs from `data/orgs.json` (the server's registry of known project dirs,
written on each `org:start`). On startup and every 30 seconds, server scans spool dirs for all
known project dirs. New orgs are registered on their first `org:start` event arriving successfully
(before that, spool files wait on disk and get drained once the org is registered).

---

### Issue 6 — run:complete has no hard guarantee

**Severity:** Significant  
**Impact:** If Claude Code crashes (SIGKILL, power loss, OOM), SubagentStop never fires.
`run:complete` is never written. Org shows QUIET → STALE indefinitely.
Cannot distinguish "boss thinking for 45 minutes" from "boss is dead."

**Resolution:**  
Accept the fundamental limitation (no OS-level process ownership without a long-running
daemon) and make the three-state model explicit in the UI:

1. **QUIET badge** (30 min no activity): "Org is running but hasn't emitted events recently.
   This is normal during long browser tests or deep research tasks."

2. **STALE badge** (2 hr no activity): "No activity for 2 hours. The org may have crashed.
   Check with `monomind orgs status {name}` or restart with `monomind runorg {name}`."

3. **Manual recovery command:** `monomind orgs mark-complete {name} --runId {runId}`
   writes `run:complete` to the run file manually, clearing the stale state.
   **Phase assignment:** This CLI subcommand does not yet exist. Add it in Phase 2 as
   `monomind orgs mark-complete <orgName> [--runId <id>]` (defaults to current run).

4. **Daemon heartbeat (optional, future):** If the monomind daemon is running,
   it can periodically check if the Claude Code process owning a run is still alive
   via `/proc/{pid}/status` (Linux) or `ps -p {pid}` (macOS) and write `run:crashed`
   if the process is gone. This requires knowing the Claude Code PID — available from
   `process.ppid` in hook handlers.

---

### Issue 7 — Watcher startup gap

**Severity:** Significant  
**Impact:** On server startup: (1) read all JSONL/DB records to reconstruct state,
(2) start watchers. Events landing between (1) and (2) are in the file but watcher
doesn't fire for them. Org state is wrong until the next file change.

**Resolution:**  
Reverse the order and use change detection based on the current max SQLite ROWID
(not file size — Phase 1 uses SQLite, not JSONL):

```javascript
async function initWatchers() {
  // 1. Snapshot max event ID per run BEFORE reading (SQLite ROWID, not file size)
  const snapshots = new Map(); // runId → maxId
  for (const [runId] of knownRuns) {
    const row = db.prepare('SELECT MAX(id) as maxId FROM run_events WHERE run_id = ?').get(runId);
    snapshots.set(runId, row?.maxId ?? 0);
  }

  // 2. Start watchers (watching BEFORE we process history)
  startFsWatcher(); // fs.watch() in Phase 1, chokidar in Phase 2+ for Linux

  // 3. Reconstruct org state from existing events
  await reconstructAllOrgStates();

  // 4. Gap-fill: for each run, emit any events that arrived during step 3
  for (const [runId, snapshotId] of snapshots) {
    const missed = db.prepare('SELECT * FROM run_events WHERE run_id = ? AND id > ?')
                     .all(runId, snapshotId);
    if (missed.length) processEvents(missed, runId);
  }
}
```

Since watchers start before reading history, any event that lands during reconstruction
triggers the watcher AND gets caught by the gap-fill in step 4. No events missed.

---

### Issue 8 — JSONL / SQLite grows without bound

**Severity:** Manageable  
**Impact:** A 24-hour org with full PreToolUse/PostToolUse capture can generate 50,000+
events. Initial chat history load becomes slow. `run:complete` scan at startup iterates
a huge file. Storage pressure on limited-disk deployments.

**Resolution:**  
Three-tier retention strategy:

```
Hot tier (SQLite, current run):    full event granularity, streamed to dashboard
Warm tier (JSONL archive):         on run:complete, export run_events to {runId}.jsonl
                                   summarize: keep lifecycle + agent events, drop reads
Cold tier (compressed archive):    after 7 days, gzip the JSONL
```

Summary compaction on run complete:
```javascript
// Type sets for retention filtering
const LIFECYCLE_TYPES = new Set(['run:start', 'run:complete', 'run:crashed', 'org:start', 'org:complete', 'session:start']);
const AGENT_TYPES     = new Set(['agent:spawn', 'agent:complete', 'agent:usage', 'org:comms']);
const TOOL_TYPES      = new Set(['agent:edit', 'agent:bash', 'agent:bash:result', 'agent:browse']);
// agent:read is intentionally excluded from all sets — dropped at compaction

function compactRunEvents(runId) {
  const events = db.prepare('SELECT * FROM run_events WHERE run_id = ?').all(runId);
  const summary = {
    lifecycle: events.filter(e => LIFECYCLE_TYPES.has(e.type)),
    agents:    events.filter(e => AGENT_TYPES.has(e.type)),
    tools:     events.filter(e => TOOL_TYPES.has(e.type)),
  };

  // Write archive FIRST, verify it, THEN delete from SQLite (crash-safe order)
  const archPath = archivePath(runId);
  fs.writeFileSync(archPath + '.tmp', JSON.stringify(summary));
  fs.renameSync(archPath + '.tmp', archPath); // atomic on POSIX
  db.prepare('DELETE FROM run_events WHERE run_id = ?').run(runId);
  // If crash between rename and DELETE: archive exists, SQLite still has data.
  // On next startup: check if archivePath exists before compacting — skip if already done.
}
```

Dashboard: show last 500 events by default, "load more" on scroll. No user-visible
performance impact for typical runs.

---

### Issue 9 — PreToolUse/PostToolUse creates chat noise

**Severity:** Manageable  
**Impact:** An active researcher subagent might emit 30+ `agent:read` events per minute.
Five subagents = 150 events/minute. Chat tab becomes a log dump, not a useful view.

**Resolution:**  
Two-level filtering: server-side emit control + client-side rendering groups.

**Server-side:** capture-handler respects a noise floor. Group rapid consecutive reads.
Important: capture-handler is a short-lived process that exits in milliseconds — a
`setTimeout(fn, 3000)` will never fire. Batching must be file-based, accumulating reads
in the spool directory and flushing synchronously at process exit:

```javascript
const readBatchFile = path.join(captureDir, `read-batch-${process.ppid}.json`);

// Accumulate reads into a file (survives process exit)
function accumulateRead(role, filePath) {
  let batch = [];
  try { batch = JSON.parse(fs.readFileSync(readBatchFile, 'utf8')); } catch {}
  batch.push({ role, path: filePath, ts: Date.now() });
  fs.writeFileSync(readBatchFile, JSON.stringify(batch));
}

// Server polls the batch file every 3s and emits agent:read:batch events,
// then DELETES the file (or truncates to [] if capture-handler is still active).
// capture-handler does NOT need a timer — server does the batching.
// Batch files older than 8 hours are pruned on server startup.
```

**Client-side:** chat UI uses three render modes:
- **Summary** (default): only `agent:spawn`, `agent:complete`, `agent:edit`, `org:comms`
- **Detailed**: adds `agent:bash`, `agent:browse`, `agent:read:batch`
- **Raw**: everything (developer/debug mode)

Toggle in the chat tab header. Mode persists to localStorage.

---

### Issue 10 — FSEvents on macOS coalesces rapid writes

**Severity:** Manageable  
**Impact:** macOS FSEvents batches file change notifications. 50 JSONL lines appended
in 1 second may trigger only 1-2 watcher callbacks. Server must read to EOF, not assume
one callback = one new line.

**Resolution:**  
Resolved by chokidar's `awaitWriteFinish` option (see Issue 1 resolution).
Additionally, the SQLite approach (Issue 2) eliminates the file-append pattern entirely
for concurrent writes — watcher fires on SQLite WAL file changes, which are less
susceptible to coalescing since WAL checkpoints are less frequent.

Explicit defensive code regardless:
```javascript
watcher.on('change', async (filePath) => {
  // Always read ALL new content since last known position, not just assume one event
  const newRows = db.prepare('SELECT * FROM run_events WHERE id > ? AND run_id = ?')
                    .all(lastId[runId], runId);
  processEvents(newRows);
  lastId[runId] = newRows.at(-1)?.id ?? lastId[runId];
});
```

---

### Issue 11 — SSE connection limits (HTTP/1.1)

**Severity:** Manageable  
**Impact:** Browsers cap at 6 concurrent connections per origin under HTTP/1.1.
Multiple dashboard tabs each opening an SSE stream to the tail endpoint exhaust
the limit quickly, causing stalled connections in other tabs.

**Resolution:**  
Use a `SharedWorker` to multiplex one SSE connection across all tabs from the same origin:

```javascript
// shared-worker.js (served by monomind dashboard)
const connections = new Map(); // orgName → SSESource
const ports = [];

self.onconnect = (e) => {
  const port = e.ports[0];
  ports.push(port);
  port.onmessage = ({ data: { action, orgName } }) => {
    if (action === 'subscribe') {
      if (!connections.has(orgName)) {
        const source = new EventSource(`/api/orgs/${orgName}/runs/current/stream`);
        source.onmessage = (e) => {
          ports.forEach(p => p.postMessage({ orgName, event: e.data }));
        };
        connections.set(orgName, source);
      }
    }
  };
};
```

One SSE connection per org regardless of how many dashboard tabs are open.
Falls back to direct EventSource if SharedWorker is unavailable.

---

### Issue 12 — process.cwd() assumption is fragile

**Severity:** Manageable  
**Impact:** `active-run.json` is written to `process.cwd()/.monomind/capture/`.
This matches `CLAUDE_PROJECT_DIR` only when the server is started from the monomind
project root interactively. Breaks when server starts via systemd, launchd, or global
`monomind` binary from a different working directory.

**Resolution:**  
Use explicit `MONOMIND_HOME` resolution in all path computations, not `process.cwd()`:

```javascript
function getMonomindHome() {
  // Priority: env var > nearest .monomind ancestor from cwd > cwd fallback
  if (process.env.MONOMIND_HOME) return path.resolve(process.env.MONOMIND_HOME);

  // Walk up from cwd (not argv[1] — argv[1] is the CLI binary path inside node_modules,
  // which anchors the walk in the wrong tree and finds the monomind package dir, not the
  // user's project dir)
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.monomind', 'control.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd(); // last resort
}

const MONOMIND_HOME = getMonomindHome();
const CAPTURE_DIR = path.join(MONOMIND_HOME, '.monomind', 'capture');
```

Same resolution logic in capture-handler.cjs, replacing `process.env.CLAUDE_PROJECT_DIR`
with `MONOMIND_HOME` discovery. Both paths converge on the same directory.
In capture-handler specifically, `CLAUDE_PROJECT_DIR` is reliable (set by Claude Code hook
runner), so it remains the primary source — `MONOMIND_HOME` discovery is the server-side fix.

---

## 4. What the Fixes Already Applied Give Us

| Fix | What it does | Remaining gap |
|-----|-------------|---------------|
| org:start in combined bash block | Fires reliably without LLM curl | Boss still curls optional events |
| active-run.json on org:start (not just run:start) | capture-handler gets org/runId context | Single-slot issue (Issue 3) |
| active-run.json uses process.cwd() not root | Cross-project path mismatch fixed | cwd fragility (Issue 12) |
| TTL floor 2 hours | Fewer false IDLE flips | TTL is still a guess |
| orgRunsDir uses _getGitMonomindDir | Correct path for loop orgs | Watcher architecture not yet built |
| orgs.html historical events fetch | LIVE EVENTS populated on org select | Not streamed, point-in-time only |
| session:start emitted before org:start in runorg.md | Creates session record; writes active-session.json; all subsequent capture-handler events tagged with sessionId; chat tab populates | — |
| capture-handler: synthetic session fallback (Issue 19) | If session:start never fires, synthesizes `auto-{org}-{runId}` session so agent events are always attributed; eliminates LLM-compliance dependency for Chat tab | Synthetic sessions show no prompt text (session:start carries it) |
| capture-handler: init auto-wiring (Issue 18) | `monomind init` now writes capture-handler to SubagentStart/SubagentStop in generated settings.json; all new projects get telemetry automatically | Existing projects (pre-fix) need manual update |
| Event type validation in server.mjs (Issue 17) | Prefix-based regex `/^[a-z][a-z0-9-]*:[a-z][a-z0-9:-]*$/` rejects injections, accepts all current and future scope:action types without whitelist maintenance | — |
| appendChatEvent: agent:complete explicit rendering | Shows agentType, result (first 300 chars), toolCalls, cost | No truncation indicator for long results |
| appendChatEvent: agent:spawn uses agentType not agent field | Shows real agent name instead of "agent" fallback | — |
| appendChatEvent: org:comms explicit intercom rendering | Boss ↔ agent messages visible in chat tab | — |
| connectSSE includes agent: events in live strip | agent:spawn and agent:complete appear in LIVE EVENTS pane | — |

---

## 5. Implementation Phases

### Phase 1 — Critical fixes (unblock correct functionality)

1. Fix concurrent writes: replace JSONL append with `sql.js` WAL SQLite (Issue 2, decided: sql.js)
2. Migrate existing JSONL run files to SQLite on first server startup (Issue 2 — users must not
   lose history; import each `{runId}.jsonl` into `run_events` table keyed by runId)
3. Fix file watching: use `fs.watch()` with fallback path for Linux (Issue 1, decided: fs.watch first)
4. Fix multi-org attribution: replace single `active-run.json` with `active-runs/{ppid}.json` directory
   (Issue 3 — ppid as key, not CLAUDE_SESSION_ID which is unset)

### Phase 2 — Reliability (make it robust)

4. Spool-based hook delivery with dead-letter queue (Issue 5)
5. Explicit MONOMIND_HOME resolution (Issue 12)
6. Startup gap-fill logic (Issue 7)
7. STALE badge UI + manual recovery command (Issue 6)

### Phase 3 — Chat tab (new capability)

8. PreToolUse/PostToolUse capture in capture-handler with 3s read batching (Issues 4, 9)
9. Streaming tail endpoint `/api/orgs/:name/runs/current/stream?since=N` (replaces dual SSE + fetch)
10. Chat tab UI with three render modes (Summary / Detailed / Raw)
11. SharedWorker for SSE multiplexing if user opens 7+ tabs (Issue 11 — defer until needed)

### Phase 4 — Retention & scale

12. Compaction on run:complete, three-tier retention (Issue 8)
13. Daemon heartbeat via `ps -p {ppid}` liveness check (Issue 6 enhancement)
14. Role attribution hardening for PreToolUse events (Issue 4 — best-effort heuristic, per-PID role files)

---

## 6. Open Questions

1. **Does CLAUDE_SESSION_ID differ between boss and subagent hooks? (ANSWERED)**
   **Empirical result (2026-06-23):** Both `CLAUDE_SESSION_ID` and `CLAUDE_CODE_AGENT_ROLE`
   are **unset** in hook processes (SubagentStart and SubagentStop both returned `null`).
   `process.ppid` was **identical** (6059) for both boss and subagent hook processes —
   hooks are spawned by Claude Code, not by the boss process, so ppid cannot discriminate.
   
   **Consequence for Issue 16:** None of the three candidate discriminators work today.
   The current safe approach (explicit `org:complete` curl from runorg.md) remains the
   only reliable boss signal. Do NOT add automatic SubagentStop → run:complete until
   Claude Code exposes a discriminating identity value in the hook environment.

2. **Is chokidar acceptable as a runtime dependency? (DECIDED)**
   **Decision: Use `fs.watch()` for Phase 1.** This is a single-user local tool — max
   ~8 concurrent writers on one machine. `fs.watch()` is built-in, zero dependencies.
   The recursive option (`{ recursive: true }`) works on macOS and Windows. Linux requires
   the chokidar upgrade path (no recursive support in Node.js `fs.watch` on Linux).
   
   Migration path: Start Phase 1 with `fs.watch()`. If users report issues on Linux VPS
   deployments, add chokidar as an optional peer dependency with a `fs.watch()` fallback.
   Do not add chokidar until a real user hits the limitation.

3. **SQLite vs append-only file for run events? (DECIDED)**
   **Decision: Use `sql.js` (WASM SQLite) for Phase 1.** Zero native compilation, already a
   transitive dependency of `@monomind/memory`, ARM64/x86 compatible. Concurrent write
   safety is the main goal; sql.js WAL mode provides it. If write throughput proves
   insufficient (<10k events/run is the expected ceiling), escalate to `better-sqlite3`
   with a documented build requirement. Do not pre-optimize.

4. **SharedWorker browser support? (DECIDED)**
   Supported in all modern browsers including Safari 16+. Falls back gracefully to direct
   EventSource. Defer to Phase 3 — only needed when SSE 6-connection limit is actually hit
   (requires user to open 7+ dashboard tabs, which is rare in single-user local use).

---

## 7. Empirical Verification

Before adding more architecture, verify what already works.

**Synthetic test (2026-06-23, server PID 40419):**

```bash
curl -s -X POST http://localhost:4242/api/mastermind/event \
  -H "Content-Type: application/json" \
  -d '{"type":"org:start","session":"test","org":"dentalos-ux-qa","runId":"verify-001",...}'

# Results:
# active-run.json → written at monomind/.monomind/capture/active-run.json ✓
# /api/orgs       → dentalos-ux-qa shows running=true, projectDir=/Users/morteza/Desktop/dntst ✓
```

Both fixes from this session (process.cwd() + org:start trigger) are confirmed working
against a live server. The cross-project path resolution is correct.

**Full chain test (2026-06-23, server PID 40419):**

```bash
SID="test-sess-1782216755"
# 1. session:start   → server writes active-session.json ✓
# 2. agent:spawn     → persisted to data/sessions/$SID.jsonl ✓
# 3. org:comms       → persisted to data/sessions/$SID.jsonl ✓
# 4. agent:complete  → persisted to data/sessions/$SID.jsonl ✓

# /api/mastermind/sessions response:
# { id: "test-sess-1782216755", org: "dentalos-ux-qa", prompt: "test full chain",
#   events: [ session:start, agent:spawn(coder), org:comms(boss→coder), agent:complete(coder) ] }
```

All 4 events landed in the session with correct agentType names. The chat tab
can now render them via the fixed `appendChatEvent` function.

**Open Question 1 empirical test (2026-06-23, server PID 40419):**

Added identity diagnostics to `capture-handler.cjs` and spawned a real Task subagent.
The hook wrote `identity-diag.log` with the following values:

```
subagent-start | pid=58694  ppid=6059 | CLAUDE_SESSION_ID=null | CLAUDE_CODE_AGENT_ROLE=null
subagent-stop  | pid=59046  ppid=6059 | CLAUDE_SESSION_ID=null | CLAUDE_CODE_AGENT_ROLE=null
```

Key findings:
- `CLAUDE_SESSION_ID` is **not set** in hook processes — env var doesn't exist
- `CLAUDE_CODE_AGENT_ROLE` is **not set** in hook processes
- `ppid` (6059) is **identical** for both — hooks are children of Claude Code, not of the boss agent
- Agent events (`agent:spawn`, `agent:complete`) correctly arrived at server and were persisted
  to `data/sessions/diag-test-1782222935000.jsonl` with correct org/runId/session tags ✓

**Full pipeline verified working in a real run.** Session file was created and populated.
The boss discriminator question (Issue 16) is now definitively closed: no discriminator
is available in the hook environment. The curl-based `org:complete` from runorg.md remains
the only reliable signal.

---

## 8. Additional Issues Found in Deep Review

These two issues survive regardless of which storage/watching architecture is chosen.
The other ~18 candidates from the initial sweep are artifacts of the SQLite + chokidar
dependency choices and disappear if a simpler serializing-writer approach is used instead.

### Issue 16 — SubagentStop boss identification is unresolved (latent, not active)

**Severity: Critical when triggered — currently latent**

**Clarification:** The current `capture-handler.cjs` does NOT write `run:complete` on
SubagentStop. It only emits `agent:complete` / `org:comms` / `agent:usage`. So this is
NOT an active bug today. It becomes critical the moment anyone adds automatic
`run:complete` writing to SubagentStop (a natural next step when implementing Phase 1).

Claude Code fires SubagentStop for every agent in the team — teammates complete before
the boss. If run:complete is ever written on SubagentStop without a boss guard, the
first teammate to finish marks the entire run done, silently truncating all subsequent events.

```
Dangerous future timeline (if run:complete added naively):
  SubagentStart(boss)      → run:start written
  SubagentStart(member-1)  → agent:spawn emitted
  SubagentStop(member-1)   → PREMATURE: run:complete written ← truncates run
  SubagentStop(boss)       → active-run.json deleted (run already "closed")
```

**Resolution (empirically verified 2026-06-23):** All three candidate discriminators
have been tested in a real hook run and **none are available**:
1. `CLAUDE_SESSION_ID` — **not set** in hook environment
2. `process.ppid` — **identical** for boss and subagent hooks (both are children of Claude Code)
3. `CLAUDE_CODE_AGENT_ROLE` — **not set** in hook environment

**Decision: Do NOT add automatic SubagentStop → run:complete.** The curl-based
`org:complete` from runorg.md is the only reliable boss signal and should remain the
sole mechanism for closing a run. Any future implementation of automatic run closing
must wait until Claude Code exposes a discriminating identity value in the hook environment
(or a new hook type like `BossStop` is introduced).

### Issue 17 — No input validation on HTTP event endpoint (FIXED)

**Severity: Significant → RESOLVED 2026-06-23**

`POST /api/mastermind/event` previously accepted arbitrary JSON and wrote it directly to the
event store. A hallucinating agent or malicious curl could inject foreign events or flood
the store with garbage.

**Implemented fix (server.mjs `handleMastermindEvent`):**

```javascript
// Prefix-based validation: any {scope}:{action} pattern auto-works.
// New event types don't require whitelist updates — they just need to follow the convention.
// Malformed types are logged to data/unknown-events.jsonl and rejected with 400.
if (event.type != null) {
  if (typeof event.type !== 'string' || !/^[a-z][a-z0-9-]*:[a-z][a-z0-9:-]*$/.test(event.type)) {
    fs.appendFileSync(unknownEventsLog, JSON.stringify({ ts, type: event.type, body: body.slice(0, 256) }) + '\n');
    res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'invalid event type' })); return;
  }
}
```

**Why prefix-based instead of whitelist:** The original proposed hardcoded Set would silently
break delivery whenever a new event type was introduced (Phase 3 tool events, custom hooks).
The pattern `/^[a-z][a-z0-9-]*:[a-z][a-z0-9:-]*$/` accepts all 26 known event types and all
future `scope:action` types automatically. Unknown types are logged for discovery, not silently
dropped. Verified against all known emitters — all pass. Injected `null`, uppercase strings,
paths, and bare words are rejected.

**Breaking-change audit:** Any emitter using a bare event type without a colon now receives
HTTP 400 silently. The one known risk is any legacy code emitting `type: 'intercom'` (no scope
prefix). Search codebase for `'intercom'` or `"intercom"` as an event type value before
deploying this fix. Rename to `agent:intercom` or the appropriate `{scope}:{action}` form.
(Current capture-handler.cjs and orgs.html have been audited — no bare `intercom` emitters.)

### Issue 18 — Cross-project sessions produce zero agent events (FIXED)

**Severity: Critical — silently breaks all dashboard visibility for dntst orgs**

The `org-dashboard-v2` design assumes `capture-handler.cjs` fires on every `SubagentStart`
and `SubagentStop`. This is only true for sessions opened from the `monomind` project directory.
Sessions opened from a different project directory (e.g. `/Users/morteza/Desktop/dntst`) use
that project's `settings.json` — which previously had NO `capture-handler.cjs` wiring.

**Symptom:** Running `/mastermind:runorg` from a dntst Claude Code session:
- `session:start` fires correctly (bash curl, session-independent)
- `org:start` fires correctly (bash curl, session-independent)
- `agent:spawn` — **never fires** — SubagentStart hook calls `hook-handler.cjs status` only
- `agent:complete` — **never fires** — SubagentStop hook calls `hook-handler.cjs post-task` only
- Dashboard LIVE EVENTS strip: empty after org:start
- Dashboard Chat tab: session record created, then silent

**Root cause:** `capture-handler.cjs` is only wired in monomind's `.claude/settings.json`.
Any project that uses monomind orgs without capture-handler in its SubagentStart/Stop hooks
will silently drop all agent telemetry. The doc and tests never verified this path.

**Fix applied (2026-06-23):**
- Copied `capture-handler.cjs` to `dntst/.claude/helpers/handlers/capture-handler.cjs`
- Added capture-handler wiring to `dntst/.claude/settings.json`:

```json
"SubagentStart": [{"hooks": [
  { "command": "... hook-handler.cjs status", "timeout": 3000 },
  { "command": "node \"${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/handlers/capture-handler.cjs\" subagent-start", "timeout": 5000 }
]}],
"SubagentStop": [{"hooks": [
  { "command": "... hook-handler.cjs post-task", "timeout": 5000 },
  { "command": "node \"${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/handlers/capture-handler.cjs\" subagent-stop", "timeout": 10000 }
]}]
```

**Generalized requirement (NOW AUTOMATED):** The root cause was that `settings-generator.ts`
generated `SubagentStart`/`SubagentStop` hooks with only `hook-handler.cjs` calls —
`capture-handler.cjs` was never included. This means every project initialized with
`monomind init` before this fix was missing telemetry wiring.

**Fix implemented 2026-06-23** in `src/init/settings-generator.ts`:
- Added `captureHandlerCmd()` helper (analogous to `hookHandlerCmd()`)
- `SubagentStart` now wires both `hook-handler.cjs status` (3s) AND `capture-handler.cjs subagent-start` (5s)
- `SubagentStop` now wires both `hook-handler.cjs post-task` (5s) AND `capture-handler.cjs subagent-stop` (10s)
- Any project that runs `monomind init` or `monomind init --update` going forward gets the wiring automatically
- Existing projects (dntst) must be manually updated — see the hook format at top of this section

**Verification:** A real org run from any project will now produce `agent:spawn` and
`agent:complete` events visible in both the LIVE EVENTS strip and Chat tab, confirmed
by empirical test in Section 7 (Open Question 1).

### Issue 19 — Session chain breaks silently if session:start is never emitted (FIXED)

**Severity: Significant → RESOLVED 2026-06-23**

If the boss agent never emits `session:start` (LLM compliance failure, runorg.md template
substitution error, or a project not using runorg.md at all), `active-session.json` is never
written by the server. Result: all capture-handler events have `session: null` and fall to
`unattributed.jsonl` — the Chat tab is permanently empty with no error indication.

**Implemented fix (capture-handler.cjs `getActiveSession`):**

```javascript
function getActiveSession(activeRun) {
  // 1. Try reading the real active-session.json (written by server on session:start)
  if (fs.existsSync(sessFile)) { /* read and return if not stale */ }

  // 2. Fallback: synthesize a session from active-run so events are always attributed.
  //    Stable ID = 'auto-{org}-{runId}' so all subagent events within the same run
  //    land in the same session file even without an explicit session:start.
  if (activeRun?.org && activeRun?.runId) {
    const synthetic = { org, sessionId: 'auto-' + org + '-' + runId, ts: Date.now(), synthetic: true };
    fs.writeFileSync(sessFile, JSON.stringify(synthetic)); // caches for subsequent SubagentStart calls
    return synthetic;
  }
  return null;
}
```

**Why this is safe:** The synthetic session ID is deterministic (`auto-{org}-{runId}`) so all
agents within one run share a session. If a real `session:start` arrives later, the server
writes `active-session.json` over the synthetic one — subsequent SubagentStart calls pick up
the real session. The only degradation from a synthetic session: the Chat tab shows no `prompt`
field (because session:start carries it), but all agent communications are visible.

---

## 9. Design Proportionality Note

Before committing to Phase 1–3 implementation, apply the proportionality test:

**This is a local single-user tool.** Maximum concurrent writers: ~8 subagent hooks on
one machine. Maximum events per run: ~10,000 over 2 hours. No remote clients, no
multi-user access, no SLA.

Against that baseline, evaluate each proposed dependency:

| Dependency | Problem it solves | Proportionate alternative |
|---|---|---|
| `better-sqlite3` (native binary) | Concurrent JSONL corruption | Single serializing writer process; advisory lock; or `sql.js` (WASM, no compilation) |
| `chokidar` | File watching across projects | `fs.watch()` (built-in, polling fallback on network drives) |
| `SharedWorker` | SSE 6-connection limit | Tolerable for local dev; add only if user opens 7+ tabs |
| Streaming tail endpoint | Historical + real-time gap | Simple: re-fetch history on reconnect (already partially implemented) |

**Recommendation:** Phase 1 should use `sql.js` (WASM SQLite, zero native compilation)
instead of `better-sqlite3`. The WASM build is already a dependency of `@monomind/memory`
— no new install, no ARM64 vs x86 mismatch risk.

If `sql.js` proves too slow for sequential appends (unlikely at <10k events/run), escalate
to `better-sqlite3` with a documented build requirement.
