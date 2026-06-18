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

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let data = '';
    const t = setTimeout(() => { process.stdin.pause(); resolve(data); }, 800);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { if (data.length < MAX_STDIN) data += c; });
    process.stdin.on('end', () => { clearTimeout(t); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(t); resolve(data); });
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
  const raw = await readStdin();
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

  clearTimeout(safety);
  process.exit(0);
}

main().catch(() => process.exit(0));
