#!/usr/bin/env node
/**
 * Loop Tracker — PostToolUse hook for ScheduleWakeup
 * Writes loop state to .monomind/loops/<sessionId>.json so the
 * Monomind Control dashboard can display active loops.
 *
 * Claude Code sends hook data as JSON via stdin:
 *   { tool_name, tool_input: { delaySeconds, prompt, reason }, session_id }
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const LOOPS_DIR = path.join(CWD, '.monomind', 'loops');

async function readStdin() {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => { process.stdin.removeAllListeners(); resolve(data); }, 3000);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(data); });
    process.stdin.resume();
  });
}

function parseRepInfo(prompt, reason) {
  // Try reason first: "repeat run 2/10 of ..."
  const reasonMatch = (reason || '').match(/(\d+)\s*\/\s*(\d+)/);
  if (reasonMatch) {
    return { currentRep: parseInt(reasonMatch[1]), maxReps: parseInt(reasonMatch[2]) };
  }
  // Try prompt flags: --rep 2, --times 10
  const repMatch = (prompt || '').match(/--rep\s+(\d+)/);
  const timesMatch = (prompt || '').match(/--times\s+(\d+)/);
  if (repMatch || timesMatch) {
    return {
      currentRep: repMatch ? parseInt(repMatch[1]) : 1,
      maxReps: timesMatch ? parseInt(timesMatch[1]) : 0,
    };
  }
  return { currentRep: 1, maxReps: 0 };
}

function detectType(prompt, maxReps) {
  if (maxReps > 0) return 'repeat';
  if ((prompt || '').startsWith('/monomind-repeat') || (prompt || '').startsWith('/loop')) return 'repeat';
  return 'do';
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) { process.exit(0); }

  let hookInput = {};
  try { hookInput = JSON.parse(raw); } catch { process.exit(0); }

  const toolInput = hookInput.tool_input || hookInput.toolInput || {};
  const sessionId = hookInput.session_id || hookInput.sessionId || hookInput.id || '';

  if (!sessionId) { process.exit(0); }

  const delaySeconds = toolInput.delaySeconds || toolInput.delay_seconds || 60;
  const prompt = toolInput.prompt || '';
  const reason = toolInput.reason || '';

  const { currentRep, maxReps } = parseRepInfo(prompt, reason);
  const type = detectType(prompt, maxReps);

  const loopFile = path.join(LOOPS_DIR, `${sessionId}.json`);
  let existing = {};
  try {
    if (fs.existsSync(loopFile)) {
      existing = JSON.parse(fs.readFileSync(loopFile, 'utf-8'));
    }
  } catch { /* start fresh */ }

  const now = Date.now();
  const entry = {
    id: sessionId,
    sessionId,
    type,
    status: 'waiting',
    prompt: (prompt || '').slice(0, 300),
    reason,
    startedAt: existing.startedAt || now,
    lastRunAt: now,
    nextRunAt: now + delaySeconds * 1000,
    currentRep,
    maxReps,
    interval: Math.round(delaySeconds / 60),
    source: 'schedule_wakeup_hook',
  };

  try {
    fs.mkdirSync(LOOPS_DIR, { recursive: true });
    fs.writeFileSync(loopFile, JSON.stringify(entry, null, 2), 'utf-8');
  } catch { /* ignore write errors */ }

  process.exit(0);
}

main().catch(() => process.exit(0));
