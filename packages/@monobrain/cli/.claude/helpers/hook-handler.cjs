#!/usr/bin/env node
/**
 * Monobrain Hook Handler (Cross-Platform)
 * Dispatches hook events to the appropriate helper modules.
 *
 * Usage: node hook-handler.cjs <command> [args...]
 *
 * Commands:
 *   route          - Route a task to optimal agent (reads PROMPT from env/stdin)
 *   pre-bash       - Validate command safety before execution
 *   post-edit      - Record edit outcome for learning
 *   session-restore - Restore previous session state
 *   session-end    - End session and persist state
 */

const path = require('path');
const fs = require('fs');

const helpersDir = __dirname;

// Safe require with stdout suppression - the helper modules have CLI
// sections that run unconditionally on require(), so we mute console
// during the require to prevent noisy output.
function safeRequire(modulePath) {
  try {
    if (fs.existsSync(modulePath)) {
      const origLog = console.log;
      const origError = console.error;
      console.log = () => {};
      console.error = () => {};
      try {
        const mod = require(modulePath);
        return mod;
      } finally {
        console.log = origLog;
        console.error = origError;
      }
    }
  } catch (e) {
    // silently fail
  }
  return null;
}

const router = safeRequire(path.join(helpersDir, 'router.js'));
const session = safeRequire(path.join(helpersDir, 'session.js'));
const memory = safeRequire(path.join(helpersDir, 'memory.js'));
const intelligence = safeRequire(path.join(helpersDir, 'intelligence.cjs'));

// ── Intelligence timeout protection (fixes #1530, #1531) ───────────────────
const INTELLIGENCE_TIMEOUT_MS = 3000;
function runWithTimeout(fn, label) {
  // For synchronous blocking calls, we use a global safety timer.
  // The readJSON file-size guard prevents loading huge files, but this
  // is an additional safety net.
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      process.stderr.write("[WARN] " + label + " timed out after " + INTELLIGENCE_TIMEOUT_MS + "ms, skipping\n");
      resolve(null);
    }, INTELLIGENCE_TIMEOUT_MS);
    try {
      const result = fn();
      clearTimeout(timer);
      resolve(result);
    } catch (e) {
      clearTimeout(timer);
      resolve(null);
    }
  });
}


// Get the command from argv
const [,, command, ...args] = process.argv;

// Read stdin with timeout — Claude Code sends hook data as JSON via stdin.
// Timeout prevents hanging when stdin is not properly closed (common on Windows).
async function readStdin() {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => {
      process.stdin.removeAllListeners();
      process.stdin.pause();
      resolve(data);
    }, 500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(data); });
    process.stdin.resume();
  });
}

async function main() {
  // Global safety timeout: hooks must NEVER hang (#1530, #1531)
  const safetyTimer = setTimeout(() => {
    process.stderr.write("[WARN] Hook handler global timeout (5s), forcing exit\n");
    process.exit(0);
  }, 5000);
  safetyTimer.unref(); // don't keep process alive just for this timer

  let stdinData = '';
  try { stdinData = await readStdin(); } catch (e) { /* ignore stdin errors */ }

  let hookInput = {};
  if (stdinData.trim()) {
    try { hookInput = JSON.parse(stdinData); } catch (e) { /* ignore parse errors */ }
  }

  // Normalize snake_case/camelCase: Claude Code sends tool_input/tool_name (snake_case)
  const toolInput = hookInput.toolInput || hookInput.tool_input || {};
  const toolName = hookInput.toolName || hookInput.tool_name || '';

  // Merge stdin data into prompt resolution: prefer stdin fields, then env, then argv
  const prompt = hookInput.prompt || hookInput.command || toolInput
    || process.env.PROMPT || process.env.TOOL_INPUT_command || args.join(' ') || '';

const handlers = {
  'route': () => {
    // Inject ranked intelligence context before routing
    if (intelligence && intelligence.getContext) {
      try {
        const ctx = intelligence.getContext(prompt);
        if (ctx) console.log(ctx);
      } catch (e) { /* non-fatal */ }
    }
    if (router && router.routeTask) {
      const result = router.routeTask(prompt);
      // Format output for Claude Code hook consumption — real data only
      const output = [
        `[INFO] Routing task: ${prompt.substring(0, 80) || '(no prompt)'}`,
        '',
        '+------------------- Primary Recommendation -------------------+',
        `| Agent: ${result.agent.padEnd(53)}|`,
        `| Confidence: ${(result.confidence * 100).toFixed(1)}%${' '.repeat(44)}|`,
        `| Reason: ${(result.reason || '').substring(0, 53).padEnd(53)}|`,
        '+--------------------------------------------------------------+',
      ];
      console.log(output.join('\n'));
    } else {
      console.log('[INFO] Router not available, using default routing');
    }
  },

  'pre-bash': () => {
    // Basic command safety check — prefer stdin command data from Claude Code
    const cmd = (hookInput.command || prompt).toLowerCase();
    const dangerous = ['rm -rf /', 'format c:', 'del /s /q c:\\', ':(){:|:&};:'];
    for (const d of dangerous) {
      if (cmd.includes(d)) {
        console.error(`[BLOCKED] Dangerous command detected: ${d}`);
        process.exit(1);
      }
    }
    console.log('[OK] Command validated');
  },

  'post-edit': () => {
    // Record edit for session metrics
    if (session && session.metric) {
      try { session.metric('edits'); } catch (e) { /* no active session */ }
    }
    // Record edit for intelligence consolidation — prefer stdin data from Claude Code
    if (intelligence && intelligence.recordEdit) {
      try {
        const file = hookInput.file_path || toolInput.file_path
          || process.env.TOOL_INPUT_file_path || args[0] || '';
        intelligence.recordEdit(file);
      } catch (e) { /* non-fatal */ }
    }
    console.log('[OK] Edit recorded');
  },

  'session-restore': async () => {
    if (session) {
      // Try restore first, fall back to start
      const existing = session.restore && session.restore();
      if (!existing) {
        session.start && session.start();
      }
    } else {
      // Minimal session restore output
      const sessionId = `session-${Date.now()}`;
      console.log(`[INFO] Restoring session: %SESSION_ID%`);
      console.log('');
      console.log(`[OK] Session restored from %SESSION_ID%`);
      console.log(`New session ID: ${sessionId}`);
      console.log('');
      console.log('Restored State');
      console.log('+----------------+-------+');
      console.log('| Item           | Count |');
      console.log('+----------------+-------+');
      console.log('| Tasks          |     0 |');
      console.log('| Agents         |     0 |');
      console.log('| Memory Entries |     0 |');
      console.log('+----------------+-------+');
    }
    // Initialize intelligence graph after session restore (with timeout — #1530)
    if (intelligence && intelligence.init) {
      const initResult = await runWithTimeout(() => intelligence.init(), 'intelligence.init()');
      if (initResult && initResult.nodes > 0) {
        console.log(`[INTELLIGENCE] Loaded ${initResult.nodes} patterns, ${initResult.edges} edges`);
      }
    }
  },

  'session-end': async () => {
    // Consolidate intelligence before ending session (with timeout — #1530)
    if (intelligence && intelligence.consolidate) {
      const consResult = await runWithTimeout(() => intelligence.consolidate(), 'intelligence.consolidate()');
      if (consResult && consResult.entries > 0) {
        console.log(`[INTELLIGENCE] Consolidated: ${consResult.entries} entries, ${consResult.edges} edges${consResult.newEntries > 0 ? `, ${consResult.newEntries} new` : ''}, PageRank recomputed`);
      }
    }
    if (session && session.end) {
      session.end();
    } else {
      console.log('[OK] Session ended');
    }
  },

  'pre-task': () => {
    if (session && session.metric) {
      try { session.metric('tasks'); } catch (e) { /* no active session */ }
    }
    // Route the task if router is available
    if (router && router.routeTask && prompt) {
      const result = router.routeTask(prompt);
      console.log(`[INFO] Task routed to: ${result.agent} (confidence: ${result.confidence})`);
    } else {
      console.log('[OK] Task started');
    }
  },

  'agent-start': () => {
    const regDir = path.join(CWD, '.monobrain', 'agents', 'registrations');
    try {
      fs.mkdirSync(regDir, { recursive: true });
      const id = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      fs.writeFileSync(path.join(regDir, 'agent-' + id + '.json'), JSON.stringify({
        agentId: id, startedAt: new Date().toISOString(), pid: process.pid,
      }));
      const activityDir = path.join(CWD, '.monobrain', 'metrics');
      fs.mkdirSync(activityDir, { recursive: true });
      const active = fs.readdirSync(regDir).filter(f => f.endsWith('.json')).length;
      fs.writeFileSync(path.join(activityDir, 'swarm-activity.json'), JSON.stringify({
        timestamp: new Date().toISOString(),
        swarm: { active: active > 0, agent_count: active, coordination_active: active > 0 },
      }));
    } catch (e) { /* non-fatal */ }
    console.log('[OK] Agent registered');
  },

  'post-task': () => {
    // Implicit success feedback for intelligence
    if (intelligence && intelligence.feedback) {
      try {
        intelligence.feedback(true);
      } catch (e) { /* non-fatal */ }
    }
    // Each TeammateIdle/TaskCompleted = one agent done → remove oldest registration (FIFO)
    const regDir = path.join(CWD, '.monobrain', 'agents', 'registrations');
    try {
      if (fs.existsSync(regDir)) {
        const files = fs.readdirSync(regDir).filter(f => f.endsWith('.json'));
        if (files.length > 0) {
          const sorted = files
            .map(f => ({ f, mtime: (() => { try { return fs.statSync(path.join(regDir, f)).mtimeMs; } catch { return 0; } })() }))
            .sort((a, b) => a.mtime - b.mtime);
          try { fs.unlinkSync(path.join(regDir, sorted[0].f)); } catch { /* ignore */ }
        }
        const now = Date.now();
        for (const f of fs.readdirSync(regDir).filter(f => f.endsWith('.json'))) {
          try { if (now - fs.statSync(path.join(regDir, f)).mtimeMs > 30 * 60 * 1000) fs.unlinkSync(path.join(regDir, f)); } catch { /* ignore */ }
        }
        const remaining = fs.readdirSync(regDir).filter(f => f.endsWith('.json')).length;
        fs.writeFileSync(path.join(CWD, '.monobrain', 'metrics', 'swarm-activity.json'), JSON.stringify({
          timestamp: new Date().toISOString(),
          swarm: { active: remaining > 0, agent_count: remaining, coordination_active: remaining > 0 },
        }));
      }
    } catch (e) { /* non-fatal */ }
    console.log('[OK] Task completed');
  },

  'stats': () => {
    if (intelligence && intelligence.stats) {
      intelligence.stats(args.includes('--json'));
    } else {
      console.log('[WARN] Intelligence module not available. Run session-restore first.');
    }
  },
};

  // Execute the handler
  if (command && handlers[command]) {
    try {
      await Promise.resolve(handlers[command]());
    } catch (e) {
      // Hooks should never crash Claude Code - fail silently
      console.log(`[WARN] Hook ${command} encountered an error: ${e.message}`);
    }
  } else if (command) {
    // Unknown command - pass through without error
    console.log(`[OK] Hook: ${command}`);
  } else {
    console.log('Usage: hook-handler.cjs <route|pre-bash|post-edit|session-restore|session-end|pre-task|post-task|stats>');
  }
}

// Hooks must ALWAYS exit 0 — Claude Code treats non-zero as "hook error"
// and skips all subsequent hooks for the event.
process.exitCode = 0;
main().catch((e) => {
  try { console.log(`[WARN] Hook handler error: ${e.message}`); } catch (_) {}
}).finally(() => {
  process.exit(0);
});
