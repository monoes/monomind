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
//   - Reads .monomind/capture/active-run.json (written by server on run:start or org:start)
//   - Includes sessionId in all emitted events so they link to the dashboard session

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { appendJsonlWithRotation } = require('../utils/fs-helpers.cjs');

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const CAPTURE_DIR = path.join(CWD, '.monomind', 'capture');
const SNAP_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour — orphaned snapshots are cleaned up this old

// P2-23: derive a stable key for a subagent invocation from whatever
// identifying info Claude Code actually gives us in the hook payload.
// `transcript_path` is the one field that's both present on SubagentStart
// and SubagentStop AND unique per-subagent (each subagent gets its own
// transcript file, distinct from the parent session's) — session_id alone
// is shared by every concurrently-running subagent in the same team, so it
// can't disambiguate which stop event belongs to which start.
function subagentKey(hookInput) {
  var raw = hookInput && (hookInput.transcript_path || hookInput.transcriptPath);
  if (!raw) return null;
  return crypto.createHash('md5').update(String(raw)).digest('hex').slice(0, 16);
}

// Determine subagent success. `lastToolError` (was the transcript's final
// tool_result an is_error block — a real signal parsed straight off the
// transcript, not text sniffing) is authoritative when present; the summary
// keyword check is a fallback for failures narrated without a tool error
// (e.g. "I couldn't find X" with no failing tool call). Shared by the
// Monograph `success` column and the intelligence.feedback() call below.
function deriveSubagentSuccess(summary, lastToolError) {
  if (lastToolError) return false;
  if (!summary) return true;
  var sumLower = summary.toLowerCase();
  if (sumLower.includes('error') || sumLower.includes('failed') || sumLower.includes('exception') || sumLower.includes('fatal')) {
    return false;
  }
  return true;
}

// Delete snap-*.json files older than SNAP_MAX_AGE_MS — orphaned when a
// SubagentStop never arrived (crash, forced-stop) or was matched to a
// different snapshot before keyed matching existed.
function cleanupStaleSnaps() {
  try {
    var files = fs.readdirSync(CAPTURE_DIR).filter(f => f.startsWith('snap-') && f.endsWith('.json') && !f.startsWith('._'));
    var now = Date.now();
    for (var i = 0; i < files.length; i++) {
      var p = path.join(CAPTURE_DIR, files[i]);
      try { if (now - fs.statSync(p).mtimeMs > SNAP_MAX_AGE_MS) fs.unlinkSync(p); } catch { /* ignore */ }
    }
  } catch { /* CAPTURE_DIR may not exist yet */ }
}

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
  const encoded = CWD.replace(/\//g, '-');
  return path.join(os.homedir(), '.claude', 'projects', encoded);
}

function snapshotJSONLFiles() {
  const claudeDir = getClaudeProjectDir();
  if (!fs.existsSync(claudeDir)) return [];
  try {
    return fs.readdirSync(claudeDir)
      .filter(f => f.endsWith('.jsonl') && !f.startsWith('._'))
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
  let lastToolError = false; // tracks the most recent tool_result seen, in file order
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
        } else if (d?.message?.role === 'user') {
          const content = d?.message?.content;
          if (Array.isArray(content)) {
            const results = content.filter(b => b.type === 'tool_result');
            if (results.length > 0) lastToolError = results.some(b => b.is_error === true);
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
  return { tokens_in: tin, tokens_out: tout, summary, last_msg: lastMsg, toolCalls: [...new Set(toolCalls)], lastToolError };
}

function getActiveRun() {
  // Phase 1: Try ppid-keyed file first — supports multiple concurrent orgs (Issue 3)
  const ppidFile = path.join(CAPTURE_DIR, 'active-runs', `${process.ppid}.json`);
  if (fs.existsSync(ppidFile)) {
    try {
      const d = JSON.parse(fs.readFileSync(ppidFile, 'utf8'));
      if (Date.now() - (d.ts || 0) > 8 * 60 * 60 * 1000) return null;
      return d;
    } catch { /* fall through to single-slot fallback */ }
  }
  // Fallback: single-slot active-run.json (written by server on org:start)
  const runFile = path.join(CAPTURE_DIR, 'active-run.json');
  if (!fs.existsSync(runFile)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    // Treat as stale after 8 hours (was 60 min — too short for long loops)
    if (Date.now() - (d.ts || 0) > 8 * 60 * 60 * 1000) return null;
    return d;
  } catch { return null; }
}

function getActiveSession(activeRun) {
  const sessFile = path.join(CAPTURE_DIR, 'active-session.json');
  if (fs.existsSync(sessFile)) {
    try {
      const d = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
      // Treat as stale after 8 hours
      if (Date.now() - (d.ts || 0) <= 8 * 60 * 60 * 1000) return d; // { org, sessionId, ts }
    } catch { /* fall through to synthesis */ }
  }
  // Fallback: synthesize a session from active-run so agent events are always attributed,
  // even if session:start was never emitted (LLM compliance risk). The synthetic session
  // uses a stable ID so all events within the same run land in the same session file.
  if (activeRun?.org && activeRun?.runId) {
    const synthetic = { org: activeRun.org, sessionId: 'auto-' + activeRun.org + '-' + activeRun.runId, ts: Date.now(), synthetic: true };
    try { fs.writeFileSync(sessFile, JSON.stringify(synthetic)); } catch { /* non-fatal */ }
    return synthetic;
  }
  return null;
}

function emitEvent(event) {
  // Phase 2: Write to spool first (dead-letter queue) — survives server restart/downtime (Issue 5)
  const spoolDir = path.join(CAPTURE_DIR, 'spool');
  const spoolFile = path.join(spoolDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  try {
    fs.mkdirSync(spoolDir, { recursive: true });
    fs.writeFileSync(spoolFile, JSON.stringify(event));
  } catch { /* non-fatal — proceed with HTTP attempt */ }
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
      }, () => {
        try { fs.unlinkSync(spoolFile); } catch {}
        resolve();
      });
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
  cleanupStaleSnaps();

  const snapshot = snapshotJSONLFiles();
  const agentType = String(
    hookInput.subagent_type || hookInput.agentType || hookInput.agent_type || 'unknown'
  ).slice(0, 64).replace(/[^a-z0-9_-]/gi, '-');
  const agentDesc = String(hookInput.description || hookInput.prompt_description || '').slice(0, 1000);
  const activeRun = getActiveRun();
  // Phase 1: Bootstrap ppid-keyed active-run file for multi-org support (Issue 3)
  if (activeRun) {
    const ppidDir = path.join(CAPTURE_DIR, 'active-runs');
    const ppidFile = path.join(ppidDir, `${process.ppid}.json`);
    if (!fs.existsSync(ppidFile)) {
      try {
        fs.mkdirSync(ppidDir, { recursive: true });
        fs.writeFileSync(ppidFile, JSON.stringify({ ...activeRun, ppid: process.ppid }));
      } catch { /* non-fatal */ }
    }
  }
  const activeSess = getActiveSession(activeRun);

  // P2-23: key the snapshot filename by transcript_path when available so
  // SubagentStop can look up the EXACT matching snapshot instead of
  // FIFO-popping the lexicographically-oldest one — under real concurrency
  // (multiple subagents stopping in close succession) FIFO pop can match a
  // stop event to the wrong subagent's snapshot. Falls back to the old
  // timestamp+random naming when transcript_path isn't present in the
  // payload, so SubagentStop's FIFO fallback path still has something to
  // match against.
  const subKey = subagentKey(hookInput);
  const snapFile = path.join(
    CAPTURE_DIR,
    subKey ? 'snap-' + subKey + '.json'
           : 'snap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.json'
  );
  const leanModePath = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.monomind/state/monolean-mode');
  let leanMode = null;
  try { leanMode = fs.readFileSync(leanModePath, 'utf8').trim() || null; } catch {}

  fs.writeFileSync(snapFile, JSON.stringify({
    ts: Date.now(),
    files: snapshot,
    agentType,
    agentDesc,
    org: activeSess?.org || activeRun?.org || null,
    runId: activeRun?.runId || null,
    session: activeSess?.sessionId || null,
    leanMode: leanMode || 'off',
  }));

  console.log('[CAPTURE:start] ' + agentType + ' · snapped ' + snapshot.length + ' files'
    + (activeSess ? ' · sess=' + activeSess.sessionId : '')
    + (activeRun ? ' · run=' + activeRun.runId : ' · no active run'));

  // Emit agent:spawn immediately so the dashboard shows the agent starting
  const org = activeSess?.org || activeRun?.org;
  if (org || activeSess?.sessionId) {
    await emitEvent({
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
  cleanupStaleSnaps();

  // P2-23: prefer the exact keyed snapshot (see subagentKey/handleSubagentStart)
  // over FIFO-popping the oldest snap-*.json — FIFO misattributes the stop
  // event to the wrong subagent whenever multiple subagents stop in close
  // succession. Fall back to FIFO only when this event's payload carries no
  // transcript_path (older Claude Code versions / unexpected payload shape).
  const subKey = subagentKey(hookInput);
  let snapPath = null;
  if (subKey) {
    const keyedPath = path.join(CAPTURE_DIR, 'snap-' + subKey + '.json');
    if (fs.existsSync(keyedPath)) snapPath = keyedPath;
  }
  if (!snapPath) {
    const snapFiles = fs.readdirSync(CAPTURE_DIR)
      .filter(f => f.startsWith('snap-') && f.endsWith('.json') && !f.startsWith('._'))
      .sort(); // lexicographic = timestamp order (FIFO fallback)
    if (snapFiles.length === 0) {
      console.log('[CAPTURE:stop] No snapshot to diff — skipping');
      return;
    }
    snapPath = path.join(CAPTURE_DIR, snapFiles[0]);
    console.log('[CAPTURE:stop] no transcript_path/keyed snapshot — falling back to FIFO match');
  }

  let snap;
  try { snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')); } catch {
    try { fs.unlinkSync(snapPath); } catch {}
    return;
  }
  try { fs.unlinkSync(snapPath); } catch {}

  // Also check current active session (may have changed since SubagentStart)
  // Pass a synthetic activeRun from snap so session can be synthesized even if snap.session is null
  const _snapRun = snap.runId ? { org: snap.org, runId: snap.runId } : null;
  const activeSess = getActiveSession(_snapRun);
  const session = snap.session || activeSess?.sessionId || null;
  const org = snap.org || activeSess?.org || null;
  const runId = snap.runId || null;

  // Diff JSONL files — only count entirely NEW files (subagent creates its own session)
  const claudeDir = getClaudeProjectDir();
  const currentFiles = snapshotJSONLFiles();
  const prevNames = new Set((snap.files || []).map(f => f.name));

  // Prefer reading THIS subagent's own transcript directly when known —
  // transcript_path is unique per-subagent (see subagentKey() above). The
  // "every file that's new in the directory since snapshot" fallback below
  // is not actually scoped to this subagent: under real concurrency (this
  // project's default hierarchical-swarm topology spawns several subagents
  // together), a sibling subagent's transcript file created between THIS
  // subagent's start-snapshot and its own stop event also looks "new" and
  // would get folded into this subagent's totals/summary/lastToolError —
  // misattributing a sibling's success/failure to this one. Falls back to
  // the directory-wide diff only when transcript_path is unavailable
  // (older Claude Code payload shape), matching this file's existing
  // fallback philosophy for snapshot matching above.
  const _ownTranscriptRaw = hookInput && (hookInput.transcript_path || hookInput.transcriptPath);
  const _ownTranscriptName = _ownTranscriptRaw ? path.basename(String(_ownTranscriptRaw)) : null;
  const filesToProcess = _ownTranscriptName
    ? currentFiles.filter(f => f.name === _ownTranscriptName)
    : currentFiles.filter(f => !prevNames.has(f.name));

  let totalTin = 0, totalTout = 0;
  let summary = '';
  let toolCalls = [];
  let lastToolError = false;
  const capturedFiles = [];

  for (const f of filesToProcess) {
    const parsed = parseJSONLForData(path.join(claudeDir, f.name));
    totalTin  += parsed.tokens_in;
    totalTout += parsed.tokens_out;
    if (parsed.summary) summary = parsed.summary;
    toolCalls.push(...parsed.toolCalls);
    lastToolError = parsed.lastToolError; // last (only, when scoped) file wins
    capturedFiles.push(f.name);
  }

  const costUsd = parseFloat((totalTin * 3e-6 + totalTout * 15e-6).toFixed(6));
  const { agentType, agentDesc } = snap;
  toolCalls = [...new Set(toolCalls)].slice(0, 20);

  console.log('[CAPTURE:stop] ' + agentType + ' · ' + totalTin + '+' + totalTout
    + ' tok · $' + costUsd.toFixed(4) + ' · ' + capturedFiles.length + ' new files'
    + (session ? ' · sess=' + session : '')
    + (org ? ' · ' + org + '/' + runId : ''));

  // Feed the real per-subagent success/failure signal into the same
  // intelligence-outcomes.jsonl that session-handler.cjs's SessionEnd
  // heuristic reads (via outcomesSignal) to veto a commit-based "success".
  // Without this, that veto path never fires — SubagentStop is the only
  // remaining event that carries a genuine failure signal, since post-task
  // (TeammateIdle/TaskCompleted) is dead code (those aren't valid Claude
  // Code hook events and are stripped from settings.json on init).
  try {
    require('../intelligence.cjs').feedback(deriveSubagentSuccess(summary, lastToolError));
  } catch (e) { /* non-fatal — feedback recording must never block subagent-stop */ }

  if (!org && !session) {
    // No active org or session — log to general capture file only
    // P2-26: rotate — was a pure appendFileSync with no cap, unlike
    // intelligence-outcomes.jsonl (500-line cap).
    const genLog = path.join(CAPTURE_DIR, 'unattributed.jsonl');
    appendJsonlWithRotation(genLog, JSON.stringify({
      ts: Date.now(), agentType, tokens_in: totalTin, tokens_out: totalTout,
      cost_usd: costUsd, capturedFiles, summary: summary.slice(0, 200),
    }), 500);
    return;
  }

  // ── Emit agent:usage (token/cost accounting) ──────────────────────────────
  if (totalTin > 0 || totalTout > 0) {
    await emitEvent({
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
  await emitEvent({
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
    await emitEvent({
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
    const capLog = path.join(runDir, runId + '-captures.jsonl');
    // P2-26: rotate — was a pure appendFileSync with no cap. A long-running
    // org loop can spawn far more than 500 agents over its lifetime, so
    // this uses the same 500-line cap convention as the other JSONL logs.
    appendJsonlWithRotation(capLog, JSON.stringify({
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
    }), 500);
  }

  // ── Wire captured interaction into EpisodicStore ────
  try {
    var episodicPath = path.join(CWD, '.monomind', 'episodic', 'episodes.jsonl');
    var episodicDir = path.dirname(episodicPath);
    if (!fs.existsSync(episodicDir)) fs.mkdirSync(episodicDir, { recursive: true });

    // Append a lightweight episode entry directly (avoid importing @monomind/memory)
    var episodeEntry = {
      episodeId: require('crypto').randomUUID(),
      sessionId: session || '',
      runIds: [runId || 'unknown'],
      summary: [
        '[agent:' + (agentType || 'unknown') + ']',
        summary ? summary.slice(0, 500) : '',
        totalTin ? '[memory:write] tokens_in=' + totalTin : '',
        totalTout ? '[memory:write] tokens_out=' + totalTout : ''
      ].filter(Boolean).join('\n'),
      startedAt: snap.ts || Date.now(),
      endedAt: Date.now(),
      agentSlugs: [agentType || 'unknown'],
      taskTypes: [agentType || 'unknown'],
      tokenEstimate: Math.ceil(((summary || '').length) / 4)
    };
    fs.appendFileSync(episodicPath, JSON.stringify(episodeEntry) + '\n', 'utf-8');
  } catch (e) { /* non-fatal */ }

  // ── Record agent interaction in Monograph SQLite ────────────────────────────
  try {
    var mgDbPath = path.join(CWD, '.monomind', 'monograph.db');
    if (fs.existsSync(mgDbPath)) {
      var monographMod = null;
      var mgCandidates = [
        path.join(CWD, 'node_modules/.pnpm/node_modules/@monoes/monograph'),
        path.join(CWD, 'packages/node_modules/.pnpm/node_modules/@monoes/monograph'),
        path.join(CWD, 'node_modules/@monoes/monograph'),
      ];
      for (var mi = 0; mi < mgCandidates.length; mi++) {
        try { if (fs.existsSync(mgCandidates[mi])) { monographMod = require(mgCandidates[mi]); break; } } catch (e2) {}
      }
      if (!monographMod) { try { monographMod = require('@monoes/monograph'); } catch (e2) {} }
      if (monographMod && monographMod.openDb) {
        var mgDb = monographMod.openDb(mgDbPath);
        try {
          mgDb.prepare(
            'INSERT OR IGNORE INTO agent_interactions ' +
            '(id, session_id, org_name, agent_type, parent_agent, prompt_summary, result_summary, tokens_in, tokens_out, cost_usd, success, duration_ms, timestamp) ' +
            'VALUES (@id, @session_id, @org_name, @agent_type, @parent_agent, @prompt_summary, @result_summary, @tokens_in, @tokens_out, @cost_usd, @success, @duration_ms, @timestamp)'
          ).run({
            id: require('crypto').randomUUID(),
            session_id: session || '',
            org_name: org || null,
            agent_type: agentType || 'unknown',
            parent_agent: null,
            prompt_summary: agentDesc ? agentDesc.slice(0, 500) : null,
            result_summary: summary ? summary.slice(0, 1000) : null,
            tokens_in: totalTin || 0,
            tokens_out: totalTout || 0,
            cost_usd: costUsd || 0,
            success: deriveSubagentSuccess(summary, lastToolError) ? 1 : 0,
            duration_ms: snap.ts ? (Date.now() - snap.ts) : 0,
            timestamp: Date.now(),
          });
        } finally {
          if (monographMod.closeDb) monographMod.closeDb(mgDb);
        }
      }
    }
  } catch (e) { /* non-fatal — monograph may not be available */ }
}

// ─── Phase 3: PreToolUse accumulator (Issue 9) ────────────────────────────────
// capture-handler is short-lived — no timers. Accumulate tool calls to a
// persistent batch file; server polls and emits agent:read:batch events.

async function handlePreTool(hookInput) {
  const activeRun = getActiveRun();
  if (!activeRun) return; // no active run — nothing to attribute to

  const toolName = String(hookInput.tool_name || hookInput.name || '').toLowerCase();
  const toolInput = hookInput.tool_input || hookInput.input || {};

  // Only batch file-read events; edits/bash/browse are emitted directly
  const isRead = toolName === 'read' || toolName === 'readfile';
  const isEdit = toolName === 'edit' || toolName === 'write' || toolName === 'multiedit';
  const isBash = toolName === 'bash' || toolName === 'shell';
  const isBrowse = toolName === 'browse' || toolName.includes('browse');

  if (isRead) {
    // Accumulate to batch file (server polls every 3s)
    const batchFile = path.join(CAPTURE_DIR, `read-batch-${process.ppid}.json`);
    let batch = [];
    try { batch = JSON.parse(fs.readFileSync(batchFile, 'utf8')); } catch {}
    batch.push({ path: toolInput.file_path || toolInput.path || '', ts: Date.now() });
    try { fs.writeFileSync(batchFile, JSON.stringify(batch)); } catch {}
  } else if (isEdit || isBash || isBrowse) {
    // Emit directly — these are important events worth showing immediately
    const evType = isEdit ? 'agent:edit' : isBash ? 'agent:bash' : 'agent:browse';
    const payload = isEdit ? (toolInput.file_path || toolInput.path || '') : (toolInput.command || toolInput.url || '');
    const activeSess = getActiveSession(activeRun);
    await emitEvent({
      type: evType,
      org: activeRun.org || '',
      runId: activeRun.runId || '',
      session: activeSess?.sessionId || '',
      payload: String(payload).slice(0, 256),
      ts: Date.now(),
    });
  }
}

// ─── Phase 4: PostToolUse — capture Bash output (test results, command output) ────

async function handlePostTool(hookInput) {
  const activeRun = getActiveRun();
  if (!activeRun) return;

  const toolName = String(hookInput.tool_name || hookInput.name || '').toLowerCase();
  const toolInput = hookInput.tool_input || hookInput.input || {};
  const toolResponse = hookInput.tool_response || hookInput.response || {};

  const isBash = toolName === 'bash' || toolName === 'shell';
  const isEdit = toolName === 'edit' || toolName === 'write' || toolName === 'multiedit';
  const isMemoryStore = toolName.includes('memory_store') || toolName.includes('memory_pattern');
  const isMemorySearch = toolName.includes('memory_search') || toolName.includes('memory_retrieve');

  // Track real memory ops (writes stats to session file)
  if (isMemoryStore || isMemorySearch) {
    try {
      var sessionId = process.env.CLAUDE_SESSION_ID || '';
      var statsPath = path.join(CWD, '.monomind', 'memory-ops-' + sessionId.slice(0, 16) + '.json');
      var stats = { writes: 0, searches: 0, redundantWrites: 0, emptySearches: 0 };
      try { stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8')); } catch {}
      if (isMemoryStore) {
        stats.writes++;
        // Detect duplicate: response contains "already exists" or "duplicate"
        var respStr = JSON.stringify(toolResponse).toLowerCase();
        if (respStr.includes('duplicate') || respStr.includes('already exists') || respStr.includes('skip')) {
          stats.redundantWrites++;
        }
      }
      if (isMemorySearch) {
        stats.searches++;
        // Detect empty results
        var results = toolResponse.results || toolResponse.entries || toolResponse.data;
        if (Array.isArray(results) && results.length === 0) {
          stats.emptySearches++;
        } else if (toolResponse.count === 0 || toolResponse.total === 0) {
          stats.emptySearches++;
        }
      }
      fs.mkdirSync(path.dirname(statsPath), { recursive: true });
      fs.writeFileSync(statsPath, JSON.stringify(stats), 'utf-8');
    } catch (e) { /* non-fatal */ }
  }

  if (!isBash && !isEdit) return;

  const activeSess = getActiveSession(activeRun);

  if (isBash) {
    const cmd = String(toolInput.command || toolInput.cmd || '').slice(0, 256);
    // Capture output — tool_response may be a string or {output, error} object
    const rawOut = typeof toolResponse === 'string' ? toolResponse
      : (toolResponse.output || toolResponse.stdout || toolResponse.result || '');
    const output = String(rawOut).slice(0, 1200); // cap at 1200 chars for storage
    // Only emit if there's actual output worth showing
    if (!cmd) return;
    await emitEvent({
      type: 'agent:bash',
      org: activeRun.org || '',
      runId: activeRun.runId || '',
      session: activeSess?.sessionId || '',
      payload: cmd,
      output: output,
      ts: Date.now(),
    });
  } else if (isEdit) {
    const filePath = String(toolInput.file_path || toolInput.path || '').slice(0, 256);
    if (!filePath) return;
    await emitEvent({
      type: 'agent:edit',
      org: activeRun.org || '',
      runId: activeRun.runId || '',
      session: activeSess?.sessionId || '',
      payload: filePath,
      ts: Date.now(),
    });
  }
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  const eventType = process.argv[2]; // 'subagent-start' | 'subagent-stop' | 'pretool' | 'posttool'

  readStdin().then(hookInput => {
    if (eventType === 'subagent-start') return handleSubagentStart(hookInput);
    if (eventType === 'subagent-stop')  return handleSubagentStop(hookInput);
    if (eventType === 'pretool')        return handlePreTool(hookInput);
    if (eventType === 'posttool')       return handlePostTool(hookInput);
    console.log('[CAPTURE] unknown event type: ' + eventType);
  }).catch(() => process.exit(0));
}

module.exports = { deriveSubagentSuccess, parseJSONLForData };
