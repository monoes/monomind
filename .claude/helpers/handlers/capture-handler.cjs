'use strict';
// Comprehensive session + subagent capture handler.
// Wired to SubagentStart (snapshot + spawn event) and SubagentStop (diff + emit).
//
// On SubagentStart:
//   - Snapshots ~/.claude/projects/{proj}/*.jsonl file sizes
//   - Emits agent:spawn to link the agent to the current mastermind session immediately
//
// On SubagentStop:
//   - Diffs the snapshot, parses new JSONL files for token usage and last messages
//   - Emits agent:complete (replaces org:comms) with full result and token data
//   - Emits agent:usage for cost tracking
//   - Persists to per-run capture log
//
// Active session awareness:
//   - Reads .monomind/capture/active-session.json (written by server on session:start)
//   - Reads .monomind/capture/active-run.json (written by server on run:start)
//   - Includes sessionId in all emitted events so they link to the dashboard session

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const CAPTURE_DIR = path.join(CWD, '.monomind', 'capture');

// ─── Helpers ────────────────────────────────────────────────────────────────

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', c => data += c);
    process.stdin.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    setTimeout(() => resolve({}), 3000);
  });
}

function getClaudeProjectDir() {
  const encoded = CWD.replace(/\//g, '-').replace(/^-/, '');
  return path.join(os.homedir(), '.claude', 'projects', encoded);
}

function snapshotJSONLFiles() {
  const claudeDir = getClaudeProjectDir();
  if (!fs.existsSync(claudeDir)) return [];
  try {
    return fs.readdirSync(claudeDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        try { return { name: f, size: fs.statSync(path.join(claudeDir, f)).size }; }
        catch { return { name: f, size: 0 }; }
      });
  } catch { return []; }
}

function parseJSONLForData(filePath) {
  let tin = 0, tout = 0;
  let allMsgs = [];
  let toolCalls = [];
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const d = JSON.parse(line);
        const u = d?.message?.usage || {};
        tin  += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        tout += (u.output_tokens || 0);
        if (d?.message?.role === 'assistant') {
          const content = d?.message?.content;
          if (Array.isArray(content)) {
            const tb = content.find(b => b.type === 'text');
            if (tb?.text) allMsgs.push(tb.text);
            // Capture tool uses for context
            const tools = content.filter(b => b.type === 'tool_use').map(b => b.name).filter(Boolean);
            toolCalls.push(...tools);
          } else if (typeof content === 'string' && content) {
            allMsgs.push(content);
          }
        }
      } catch { /* skip malformed lines */ }
    }
  } catch { /* unreadable */ }
  // Return last 3 messages for context + first+last message
  const lastMsg = allMsgs[allMsgs.length - 1] || '';
  const firstMsg = allMsgs[0] || '';
  const summary = allMsgs.length > 1
    ? (firstMsg.slice(0, 300) + (allMsgs.length > 2 ? `\n…[${allMsgs.length - 2} more msgs]…\n` : '\n') + lastMsg.slice(0, 700))
    : lastMsg.slice(0, 1000);
  return { tokens_in: tin, tokens_out: tout, summary, last_msg: lastMsg, toolCalls: [...new Set(toolCalls)] };
}

function getActiveRun() {
  const runFile = path.join(CAPTURE_DIR, 'active-run.json');
  if (!fs.existsSync(runFile)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    // Treat as stale after 8 hours (was 60 min — too short for long loops)
    if (Date.now() - (d.ts || 0) > 8 * 60 * 60 * 1000) return null;
    return d;
  } catch { return null; }
}

function getActiveSession() {
  const sessFile = path.join(CAPTURE_DIR, 'active-session.json');
  if (!fs.existsSync(sessFile)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
    // Treat as stale after 8 hours
    if (Date.now() - (d.ts || 0) > 8 * 60 * 60 * 1000) return null;
    return d; // { org, sessionId, ts }
  } catch { return null; }
}

function postEvent(event) {
  return new Promise((resolve) => {
    try {
      const ctrlPath = path.join(CWD, '.monomind', 'control.json');
      let baseUrl = 'http://localhost:4242';
      if (fs.existsSync(ctrlPath)) {
        try { baseUrl = JSON.parse(fs.readFileSync(ctrlPath, 'utf8')).url || baseUrl; } catch {}
      }
      const u = new URL(baseUrl);
      const body = JSON.stringify(event);
      const req = http.request({
        hostname: u.hostname,
        port: parseInt(u.port || '4242', 10),
        path: '/api/mastermind/event',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, () => resolve());
      req.on('error', () => resolve());
      req.setTimeout(3000, () => { req.destroy(); resolve(); });
      req.write(body);
      req.end();
    } catch { resolve(); }
  });
}

// ─── SubagentStart: snapshot + emit agent:spawn ──────────────────────────────

async function handleSubagentStart(hookInput) {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });

  const snapshot = snapshotJSONLFiles();
  const agentType = String(
    hookInput.subagent_type || hookInput.agentType || hookInput.agent_type || 'unknown'
  ).slice(0, 64).replace(/[^a-z0-9_-]/gi, '-');
  const agentDesc = String(hookInput.description || hookInput.prompt_description || '').slice(0, 1000);
  const activeRun = getActiveRun();
  const activeSess = getActiveSession();

  // Write snapshot to FIFO queue — subagent-stop pops the oldest
  const snapFile = path.join(
    CAPTURE_DIR,
    'snap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.json'
  );
  fs.writeFileSync(snapFile, JSON.stringify({
    ts: Date.now(),
    files: snapshot,
    agentType,
    agentDesc,
    org: activeSess?.org || activeRun?.org || null,
    runId: activeRun?.runId || null,
    session: activeSess?.sessionId || null,
  }));

  console.log('[CAPTURE:start] ' + agentType + ' · snapped ' + snapshot.length + ' files'
    + (activeSess ? ' · sess=' + activeSess.sessionId : '')
    + (activeRun ? ' · run=' + activeRun.runId : ' · no active run'));

  // Emit agent:spawn immediately so the dashboard shows the agent starting
  const org = activeSess?.org || activeRun?.org;
  if (org || activeSess?.sessionId) {
    await postEvent({
      type: 'agent:spawn',
      org: org || '',
      runId: activeRun?.runId || '',
      session: activeSess?.sessionId || '',
      agentType,
      task: agentDesc.slice(0, 500),
      from: 'orchestrator',
      to: agentType,
      ts: Date.now(),
    });
  }
}

// ─── SubagentStop: diff + emit ────────────────────────────────────────────────

async function handleSubagentStop(hookInput) {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });

  // Pop oldest snapshot (FIFO — matches the agent that just finished)
  const snapFiles = fs.readdirSync(CAPTURE_DIR)
    .filter(f => f.startsWith('snap-') && f.endsWith('.json'))
    .sort(); // lexicographic = timestamp order

  if (snapFiles.length === 0) {
    console.log('[CAPTURE:stop] No snapshot to diff — skipping');
    return;
  }

  const snapPath = path.join(CAPTURE_DIR, snapFiles[0]);
  let snap;
  try { snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')); } catch {
    try { fs.unlinkSync(snapPath); } catch {}
    return;
  }
  try { fs.unlinkSync(snapPath); } catch {}

  // Also check current active session (may have changed since SubagentStart)
  const activeSess = getActiveSession();
  const session = snap.session || activeSess?.sessionId || null;
  const org = snap.org || activeSess?.org || null;
  const runId = snap.runId || null;

  // Diff JSONL files — only count entirely NEW files (subagent creates its own session)
  const claudeDir = getClaudeProjectDir();
  const currentFiles = snapshotJSONLFiles();
  const prevNames = new Set((snap.files || []).map(f => f.name));

  let totalTin = 0, totalTout = 0;
  let summary = '';
  let toolCalls = [];
  const capturedFiles = [];

  for (const f of currentFiles) {
    if (!prevNames.has(f.name)) {
      const parsed = parseJSONLForData(path.join(claudeDir, f.name));
      totalTin  += parsed.tokens_in;
      totalTout += parsed.tokens_out;
      if (parsed.summary) summary = parsed.summary;
      toolCalls.push(...parsed.toolCalls);
      capturedFiles.push(f.name);
    }
  }

  const costUsd = parseFloat((totalTin * 3e-6 + totalTout * 15e-6).toFixed(6));
  const { agentType, agentDesc } = snap;
  toolCalls = [...new Set(toolCalls)].slice(0, 20);

  console.log('[CAPTURE:stop] ' + agentType + ' · ' + totalTin + '+' + totalTout
    + ' tok · $' + costUsd.toFixed(4) + ' · ' + capturedFiles.length + ' new files'
    + (session ? ' · sess=' + session : '')
    + (org ? ' · ' + org + '/' + runId : ''));

  if (!org && !session) {
    // No active org or session — log to general capture file only
    const genLog = path.join(CAPTURE_DIR, 'unattributed.jsonl');
    fs.appendFileSync(genLog, JSON.stringify({
      ts: Date.now(), agentType, tokens_in: totalTin, tokens_out: totalTout,
      cost_usd: costUsd, capturedFiles, summary: summary.slice(0, 200),
    }) + '\n');
    return;
  }

  // ── Emit agent:usage (token/cost accounting) ──────────────────────────────
  if (totalTin > 0 || totalTout > 0) {
    await postEvent({
      type: 'agent:usage',
      org: org || '',
      runId: runId || '',
      session: session || '',
      role: agentType,
      agentType,
      tokens_in: totalTin,
      tokens_out: totalTout,
      cost_usd: costUsd,
      ts: Date.now(),
    });
  }

  // ── Emit agent:complete (replaces org:comms — richer, includes session) ───
  // Always emit even if summary is empty (so the spawn/complete pair is always visible)
  await postEvent({
    type: 'agent:complete',
    org: org || '',
    runId: runId || '',
    session: session || '',
    agentType,
    role: agentType,
    from: agentType,
    to: 'boss',
    result: summary.slice(0, 1000),
    toolCalls,
    tokens_in: totalTin,
    tokens_out: totalTout,
    cost_usd: costUsd,
    capturedFiles: capturedFiles.slice(0, 10),
    ts: Date.now(),
  });

  // ── Also emit legacy org:comms for backwards compat ───────────────────────
  if (summary && (org || session)) {
    await postEvent({
      type: 'org:comms',
      org: org || '',
      runId: runId || '',
      session: session || '',
      from: agentType,
      to: 'boss',
      msg: summary.slice(0, 500),
      ts: Date.now(),
    });
  }

  // ── Persist transcript reference to run directory ─────────────────────────
  if (capturedFiles.length > 0 && org && runId) {
    const runDir = path.join(CWD, '.monomind', 'orgs', org, 'runs');
    fs.mkdirSync(runDir, { recursive: true });
    const capLog = path.join(runDir, runId + '-captures.jsonl');
    fs.appendFileSync(capLog, JSON.stringify({
      type: 'agent:capture',
      org, runId, session,
      agentType,
      agentDesc: agentDesc.slice(0, 200),
      tokens_in: totalTin,
      tokens_out: totalTout,
      cost_usd: costUsd,
      capturedFiles,
      claudeProjectDir: claudeDir,
      ts: Date.now(),
    }) + '\n');
  }
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

const eventType = process.argv[2]; // 'subagent-start' | 'subagent-stop'

readStdin().then(hookInput => {
  if (eventType === 'subagent-start') return handleSubagentStart(hookInput);
  if (eventType === 'subagent-stop')  return handleSubagentStop(hookInput);
  console.log('[CAPTURE] unknown event type: ' + eventType);
}).catch(() => process.exit(0));
