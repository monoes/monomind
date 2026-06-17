'use strict';
// Comprehensive session + subagent capture handler.
// Wired to SubagentStart (snapshot) and SubagentStop (diff + emit).
//
// On SubagentStart: snapshots ~/.claude/projects/{proj}/*.jsonl file sizes so
//   we can diff on stop to find exactly which JSONL files a subagent created.
//
// On SubagentStop: diffs the snapshot, parses new JSONL files for token usage
//   and last assistant message, emits agent:usage + org:comms to server.
//
// Active org/runId awareness: reads .monomind/capture/active-run.json which the
//   server writes when it receives a run:start event.

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
  // ~/.claude/projects/<encoded-path>/ where encoded = CWD with / → -
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
        try {
          return { name: f, size: fs.statSync(path.join(claudeDir, f)).size };
        } catch { return { name: f, size: 0 }; }
      });
  } catch { return []; }
}

function parseJSONLForTokens(filePath) {
  let tin = 0, tout = 0;
  let lastMsg = '';
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
            if (tb?.text) lastMsg = tb.text;
          } else if (typeof content === 'string') {
            lastMsg = content;
          }
        }
      } catch { /* skip malformed lines */ }
    }
  } catch { /* unreadable */ }
  return { tokens_in: tin, tokens_out: tout, last_msg: lastMsg };
}

function getActiveRun() {
  const runFile = path.join(CAPTURE_DIR, 'active-run.json');
  if (!fs.existsSync(runFile)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    // Treat as stale after 60 minutes
    if (Date.now() - (d.ts || 0) > 60 * 60 * 1000) return null;
    return d;
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

// ─── SubagentStart: snapshot ─────────────────────────────────────────────────

async function handleSubagentStart(hookInput) {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });

  const snapshot = snapshotJSONLFiles();
  const agentType = String(
    hookInput.subagent_type || hookInput.agentType || hookInput.agent_type || 'unknown'
  ).slice(0, 64).replace(/[^a-z0-9_-]/gi, '-');
  const agentDesc = String(hookInput.description || hookInput.prompt_description || '').slice(0, 400);
  const activeRun = getActiveRun();

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
    org: activeRun?.org || null,
    runId: activeRun?.runId || null,
  }));

  console.log('[CAPTURE:start] ' + agentType + ' · snapped ' + snapshot.length + ' files'
    + (activeRun ? ' · run=' + activeRun.runId : ' · no active run'));
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
  // Delete immediately — prevents reuse even if we error below
  try { fs.unlinkSync(snapPath); } catch {}

  // Diff JSONL files — only count entirely NEW files (subagent creates its own session)
  const claudeDir = getClaudeProjectDir();
  const currentFiles = snapshotJSONLFiles();
  const prevNames = new Set((snap.files || []).map(f => f.name));

  let totalTin = 0, totalTout = 0;
  let lastMsg = '';
  const capturedFiles = [];

  for (const f of currentFiles) {
    if (!prevNames.has(f.name)) {
      const parsed = parseJSONLForTokens(path.join(claudeDir, f.name));
      totalTin  += parsed.tokens_in;
      totalTout += parsed.tokens_out;
      if (parsed.last_msg) lastMsg = parsed.last_msg;
      capturedFiles.push(f.name);
    }
  }

  const costUsd = parseFloat((totalTin * 3e-6 + totalTout * 15e-6).toFixed(6));
  const { org, runId, agentType, agentDesc } = snap;

  console.log('[CAPTURE:stop] ' + agentType + ' · ' + totalTin + '+' + totalTout
    + ' tok · $' + costUsd.toFixed(4) + ' · ' + capturedFiles.length + ' new files'
    + (org ? ' · ' + org + '/' + runId : ''));

  if (!org || !runId) {
    // No active org — log to general capture file only
    const genLog = path.join(CAPTURE_DIR, 'unattributed.jsonl');
    fs.appendFileSync(genLog, JSON.stringify({
      ts: Date.now(), agentType, tokens_in: totalTin, tokens_out: totalTout,
      cost_usd: costUsd, capturedFiles,
    }) + '\n');
    return;
  }

  // ── Emit agent:usage ──────────────────────────────────────────────────────
  if (totalTin > 0 || totalTout > 0) {
    await postEvent({
      type: 'agent:usage',
      org,
      runId,
      role: agentType,
      tokens_in: totalTin,
      tokens_out: totalTout,
      cost_usd: costUsd,
      ts: Date.now(),
    });
  }

  // ── Emit org:comms with last assistant message summary ────────────────────
  if (lastMsg) {
    const summary = lastMsg.slice(0, 300).replace(/\n+/g, ' ').trim();
    await postEvent({
      type: 'org:comms',
      org,
      runId,
      from: agentType,
      to: 'boss',
      msg: summary,
      ts: Date.now(),
    });
  }

  // ── Persist transcript reference to run directory ─────────────────────────
  if (capturedFiles.length > 0) {
    const runDir = path.join(CWD, '.monomind', 'orgs', org, 'runs');
    fs.mkdirSync(runDir, { recursive: true });
    const capLog = path.join(runDir, runId + '-captures.jsonl');
    fs.appendFileSync(capLog, JSON.stringify({
      type: 'agent:capture',
      org, runId,
      agentType,
      agentDesc: agentDesc.slice(0, 120),
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
