#!/usr/bin/env node
/**
 * Universal Event Logger
 * Captures 100% of Claude Code hook events.
 * Writes to .git/monomind/events/ (branch-agnostic, shared across worktrees).
 * Falls back to .monomind/events/ when git is unavailable.
 * Runs as a fast, non-blocking hook — append-only, no processing.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');

const CWD       = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const eventType = process.argv[2] || 'unknown';

// Safety exit — never hang
const safety = setTimeout(() => process.exit(0), 2000);
safety.unref();

const MAX_STDIN = 1024 * 1024; // 1 MiB

// P3-16: mirrors hook-handler.cjs's readStdin — byte-counted, discard-whole-
// payload-on-overflow. The old version did `if (data.length < MAX_STDIN)
// data += c`, which silently DROPPED characters once the cap was hit instead
// of aborting the read, so an oversized payload produced truncated, invalid
// JSON that then failed JSON.parse downstream with the whole event (and its
// toolName/sessionId attribution) discarded anyway — just with extra steps
// and no signal as to why. Discarding the entire payload up front (with a
// logged, flagged event) is equivalent in outcome but honest about it.
function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let data = '';
    let byteCount = 0;
    let truncated = false;
    const t = setTimeout(() => { process.stdin.pause(); resolve({ data, truncated }); }, 800);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => {
      if (truncated) return;
      byteCount += Buffer.byteLength(c, 'utf8');
      if (byteCount > MAX_STDIN) {
        truncated = true;
        process.stdin.pause();
        clearTimeout(t);
        resolve({ data: '', truncated: true }); // discard oversized input, same as hook-handler.cjs
        return;
      }
      data += c;
    });
    process.stdin.on('end', () => { clearTimeout(t); resolve({ data, truncated }); });
    process.stdin.on('error', () => { clearTimeout(t); resolve({ data, truncated }); });
    process.stdin.resume();
  });
}

function forwardToDashboard(entry) {
  try {
    const ctrlPath = path.join(CWD, '.monomind', 'control.json');
    if (!fs.existsSync(ctrlPath)) return;
    const MAX_CTRL = 64 * 1024; // 64 KiB
    try { if (fs.statSync(ctrlPath).size > MAX_CTRL) return; } catch { return; }
    const ctrl = JSON.parse(fs.readFileSync(ctrlPath, 'utf8'));
    const rawPort = Number(ctrl.port);
    const port = (Number.isInteger(rawPort) && rawPort >= 1024 && rawPort <= 65535) ? rawPort : 4242;
    const body = JSON.stringify({ ...entry, hookCaptured: true });
    const req = http.request({
      method: 'POST',
      hostname: 'localhost',
      port,
      path: '/api/mastermind/event',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 400,
    });
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch {}
}

async function main() {
  const stdinResult = await readStdin();
  const raw = stdinResult.data;
  const stdinTruncated = stdinResult.truncated;
  if (stdinTruncated) {
    // Oversized payload was discarded whole (see readStdin) — log it so the
    // drop is visible instead of silently vanishing as a JSON.parse failure.
    console.error('[event-logger] stdin payload exceeded ' + MAX_STDIN + ' bytes; discarded (event=' + eventType + ')');
  }
  let payload = {};
  try { payload = JSON.parse(raw); } catch {}

  const MAX_SESSION_ID = 128;
  const rawSessionId = process.env.CLAUDE_SESSION_ID
    || payload.session_id
    || payload.sessionId
    || 'unknown';
  const sessionId = String(rawSessionId).slice(0, MAX_SESSION_ID).replace(/[^a-zA-Z0-9_\-]/g, '_');

  const entry = {
    hookType: eventType,
    ts: Date.now(),
    sessionId,
    toolName: payload.toolName || payload.tool_name || undefined,
    toolInput: payload.toolInput || payload.tool_input || undefined,
    toolResult: payload.toolResult || payload.tool_result || undefined,
    message: payload.message || payload.notification || payload.prompt || undefined,
    raw: (raw.length < 4096) ? payload : undefined,
    truncated: stdinTruncated || undefined,
  };

  // Remove undefined keys
  Object.keys(entry).forEach(k => entry[k] === undefined && delete entry[k]);

  // Resolve the git-safe monomind root (mirrors _getGitMonomindDir in server.mjs)
  function getMonoDir(workDir) {
    try {
      const gitEntry = path.join(workDir, '.git');
      const st = fs.statSync(gitEntry);
      if (st.isDirectory()) return path.join(gitEntry, 'monomind');
      if (st.isFile()) {
        const m = fs.readFileSync(gitEntry, 'utf8').match(/^gitdir:\s*(.+)/m);
        if (m) {
          const worktreeDir = path.resolve(workDir, m[1].trim());
          return path.join(path.dirname(path.dirname(worktreeDir)), 'monomind');
        }
      }
    } catch {}
    return path.join(workDir, '.monomind');
  }
  const monoDir = getMonoDir(CWD);

  // Write to daily all-events log
  const eventsDir = path.join(monoDir, 'events');
  const today = new Date().toISOString().slice(0, 10);
  const allLog = path.join(eventsDir, `${today}-all-events.jsonl`);

  try {
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.appendFileSync(allLog, JSON.stringify(entry) + '\n');
  } catch {}

  // Rotation — event logs (daily + per-session) accumulate forever with no
  // cleanup otherwise. Cheap: single readdir + stat pass, only on session-start
  // (once per session, not per-event) so normal hook latency is unaffected.
  if (eventType === 'session-start') {
    rotateEventLogs(eventsDir);
  }

  // Write to per-session log
  if (sessionId !== 'unknown') {
    try {
      const sessionLog = path.join(eventsDir, `session-${sessionId}.jsonl`);
      fs.appendFileSync(sessionLog, JSON.stringify(entry) + '\n');
    } catch {}
  }

  // Solution 5: cross-reference Claude session ID into the active mastermind session.
  // When a new Claude session starts, record its UUID in current.json so future
  // lookups can join mastermind session state with the Claude conversation transcript.
  if (eventType === 'session-start' && sessionId !== 'unknown') {
    try {
      const sessionsDir = path.join(monoDir, 'sessions');
      const currentFile = path.join(sessionsDir, 'current.json');
      if (fs.existsSync(currentFile)) {
        const cur = JSON.parse(fs.readFileSync(currentFile, 'utf8'));
        const claudeSessions = Array.isArray(cur.claude_sessions) ? cur.claude_sessions : [];
        if (!claudeSessions.includes(sessionId)) {
          claudeSessions.push(sessionId);
          const updated = { ...cur, claude_sessions: claudeSessions };
          const tmp = `${currentFile}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, JSON.stringify(updated, null, 2), 'utf8');
          fs.renameSync(tmp, currentFile);
        }
      }
    } catch {}
  }

  // Forward notifications and subagent events to dashboard for live visibility
  const forwardTypes = ['notification', 'subagent-start', 'subagent-stop', 'user-prompt'];
  if (forwardTypes.includes(eventType)) {
    forwardToDashboard(entry);
  }

  // Detect route changes and worker metric updates by mtime and forward them too.
  // These aren't Claude Code hook events — they're file writes from route-handler.cjs
  // and the @monomind/hooks workers respectively — so we poll cheaply on every hook invocation.
  forwardFileChanges(monoDir, CWD);

  clearTimeout(safety);
  process.exit(0);
}

function forwardFileChanges(monoDir, workDir) {
  try {
    const cachePath = path.join(monoDir, 'dashboard-watch-cache.json');
    let cache = {};
    try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch {}
    let changed = false;

    // Route changes (.monomind/last-route.json, written every prompt by route-handler.cjs)
    const routePath = path.join(workDir, '.monomind', 'last-route.json');
    try {
      const routeMtime = fs.statSync(routePath).mtimeMs;
      if (routeMtime !== cache.routeMtime) {
        cache.routeMtime = routeMtime;
        changed = true;
        let route = null;
        try { route = JSON.parse(fs.readFileSync(routePath, 'utf8')); } catch {}
        forwardToDashboard({ hookType: 'route-change', ts: Date.now(), route });
      }
    } catch {}

    // Worker-complete: newest mtime among .monomind/metrics/*.json (written by @monomind/hooks workers)
    const metricsDir = path.join(workDir, '.monomind', 'metrics');
    try {
      const files = fs.readdirSync(metricsDir).filter(f => f.endsWith('.json') && !f.startsWith('.'));
      let latestFile = null;
      let latestMtime = cache.metricsMtime || 0;
      for (const f of files) {
        const mtime = fs.statSync(path.join(metricsDir, f)).mtimeMs;
        if (mtime > latestMtime) { latestMtime = mtime; latestFile = f; }
      }
      if (latestFile) {
        cache.metricsMtime = latestMtime;
        changed = true;
        forwardToDashboard({ hookType: 'daemon-complete', ts: Date.now(), metric: latestFile.replace(/\.json$/, '') });
      }
    } catch {}

    if (changed) fs.writeFileSync(cachePath, JSON.stringify(cache));
  } catch {}
}

// Delete any daily or per-session event log whose mtime is older than
// maxAgeMs (default 14 days). Single readdir + stat pass — no recursion.
function rotateEventLogs(eventsDir, maxAgeMs) {
  maxAgeMs = maxAgeMs || 14 * 24 * 60 * 60 * 1000;
  try {
    const cutoff = Date.now() - maxAgeMs;
    const entries = fs.readdirSync(eventsDir).filter(f => !f.startsWith('._'));
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(eventsDir, f);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      } catch {}
    }
  } catch {}
}

module.exports = { rotateEventLogs };

if (require.main === module) {
  main().catch(() => process.exit(0));
}
