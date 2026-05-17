#!/usr/bin/env node
/**
 * Monomind Hook Handler (Cross-Platform)
 * Dispatches hook events to the appropriate helper modules.
 */

const path = require('path');
const fs = require('fs');

const helpersDir = __dirname;
const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const telemetry = require('./utils/telemetry.cjs');
const monograph = require('./utils/monograph.cjs');
const microAgents = require('./utils/micro-agents.cjs');

const {
  _recordRecentEdit, _getRecentEdits, _recordToolCall,
  _getBudgetStatus, _recordHookLatency, _recordDecisionMarkers,
} = telemetry;

const {
  _requireMonograph, _openMonographDb,
  getMonographSuggestions, getMonographNeighbors,
  _recordGraphTelemetry, _injectCompactGraphMap,
  _findAffectedTests, _maybeRebuildMonograph,
} = monograph;

const {
  safeRequire,
  _triggerExtractYamlValue, _triggerFinalize, _triggerExtractFromFrontmatter,
  _triggerCollectMdFiles, _triggerBuildIndex, scanMicroAgentTriggers,
  _buildKnowledgeSearchFn, _autoIndexKnowledge,
} = microAgents;

// ── LearningService module-level singleton ─────────────────────────────────────
// Singleton contract: one LearningService instance is created per hook-handler
// process. initialize() opens the SQLite DB; consolidate() is called at
// session-end. Hoisting to module scope ensures the DB is not reopened on every
// session-end invocation (which would create a fresh in-memory-only instance
// each time, discarding any state accumulated during the session).
//
// We cache the Promise (not the resolved value) so that concurrent callers all
// await the same initialization. Caching only the resolved value allowed two
// concurrent callers to both enter the `if (!_learningService)` branch and
// construct separate LearningService instances, leaving an orphaned DB handle.
var _learningServicePromise = null;
async function getLearningService() {
  if (!_learningServicePromise) {
    _learningServicePromise = (async function() {
      try {
        var lsMod = await import('file://' + path.join(__dirname, 'learning-service.mjs'));
        var LearningService = lsMod.LearningService || (lsMod.default && lsMod.default.LearningService);
        if (!LearningService) return null;
        var svc = new LearningService();
        if (typeof svc.initialize === 'function') await svc.initialize();
        return svc;
      } catch (e) {
        _learningServicePromise = null; // allow retry on error
        return null;
      }
    })();
  }
  return _learningServicePromise;
}


const router = safeRequire(path.join(helpersDir, 'router.cjs'));
const session = safeRequire(path.join(helpersDir, 'session.cjs'));
const memory = safeRequire(path.join(helpersDir, 'memory.cjs'));
const intelligence = safeRequire(path.join(helpersDir, 'intelligence.cjs'));

// Module-level reference to @monomind/hooks — populated at session-restore,
// then used by pre-task / post-task to bridge into the hook registry (Tasks 26, 39).
let _hooksModule = null;

// ── Intelligence timeout protection (fixes #1530, #1531) ───────────────────
var INTELLIGENCE_TIMEOUT_MS = 1500;
function runWithTimeout(fn, label) {
  return new Promise(function(resolve) {
    var settled = false;
    var timer = setTimeout(function() {
      if (!settled) {
        settled = true;
        process.stderr.write("[WARN] " + label + " timed out after " + INTELLIGENCE_TIMEOUT_MS + "ms, skipping\n");
        resolve(null);
      }
    }, INTELLIGENCE_TIMEOUT_MS);
    Promise.resolve().then(fn).then(
      function(result) { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } },
      function()       { if (!settled) { settled = true; clearTimeout(timer); resolve(null); } }
    );
  });
}


const [,, command, ...args] = process.argv;

// Read stdin — Claude Code sends hook data as JSON via stdin
// Uses a timeout to prevent hanging when stdin is in an ambiguous state
// (not TTY, not a proper pipe) which happens with Claude Code hook invocations.
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
  var safetyTimer = setTimeout(function() {
    process.stderr.write("[WARN] Hook handler global timeout (5s), forcing exit\n");
    process.exit(0);
  }, 5000);
  safetyTimer.unref();

  let stdinData = '';
  try { stdinData = await readStdin(); } catch (e) { /* ignore stdin errors */ }

  let hookInput = {};
  if (stdinData.trim()) {
    try {
      const parsed = JSON.parse(stdinData);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        hookInput = parsed;
      }
    } catch (e) { /* ignore parse errors */ }
  }

  // Merge stdin data into prompt resolution: prefer stdin fields, then env vars.
  // NEVER fall back to argv args — shell glob expansion of braces in bash output
  // creates junk files (#1342). Use env vars or stdin only.
  // Normalize snake_case/camelCase: Claude Code sends tool_input/tool_name (snake_case)
  var toolInput = hookInput.toolInput || hookInput.tool_input || {};
  var toolName = hookInput.toolName || hookInput.tool_name || '';

  var prompt = hookInput.prompt || hookInput.command
    || (typeof toolInput === 'string' ? toolInput : (toolInput.command || toolInput.prompt || ''))
    || process.env.PROMPT || process.env.TOOL_INPUT_command || '';

  // Detect prompts that are predefined single-action commands that don't
  // need agent routing or skill suggestions — invoking those adds token
  // overhead without any benefit.
  function isSimpleCommand(p) {
    if (typeof p !== 'string') return false;
    var s = p.trim();
    // Slash commands: /ts, /list-agents, /commit, /help, /use-agent etc.
    if (/^\/[a-z0-9_-]+(\s|$)/i.test(s)) return true;
    // Short single-word operator tokens (toggle, list, status)
    if (/^(ts|ls|ps|pwd|help|clear|exit|quit|status|toggle|refresh)$/i.test(s)) return true;
    // Already-resolved command messages (Claude Code sends hook with command-name context)
    var cmdName = hookInput.commandName || hookInput.command_name || '';
    if (cmdName && cmdName.length > 0) return true;
    return false;
  }

// Build shared hook context — passed to extracted handler modules so they
// don't need to capture main()-scoped or module-scoped variables via closure.
var hCtx = {
  hookInput: hookInput,
  toolInput: toolInput,
  toolName: toolName,
  prompt: prompt,
  args: args,
  CWD: CWD,
  session: session,
  router: router,
  intelligence: intelligence,
  getLearningService: getLearningService,
  isSimpleCommand: isSimpleCommand,
  // Module-level singleton (populated by session-restore handler)
  get _hooksModule() { return _hooksModule; },
  set _hooksModule(v) { _hooksModule = v; },
  // Utility functions
  _recordRecentEdit: _recordRecentEdit,
  _getRecentEdits: _getRecentEdits,
  _findAffectedTests: _findAffectedTests,
  _recordHookLatency: _recordHookLatency,
  _getBudgetStatus: _getBudgetStatus,
  _injectCompactGraphMap: _injectCompactGraphMap,
  _maybeRebuildMonograph: _maybeRebuildMonograph,
  _buildKnowledgeSearchFn: _buildKnowledgeSearchFn,
  getMonographSuggestions: getMonographSuggestions,
  getMonographNeighbors: getMonographNeighbors,
  runWithTimeout: runWithTimeout,
  safeRequire: safeRequire,
  scanMicroAgentTriggers: scanMicroAgentTriggers,
  _recordGraphTelemetry: _recordGraphTelemetry,
  _recordDecisionMarkers: _recordDecisionMarkers,
  _recordToolCall: _recordToolCall,
  _openMonographDb: _openMonographDb,
  _requireMonograph: _requireMonograph,
  _triggerExtractYamlValue: _triggerExtractYamlValue,
  _triggerFinalize: _triggerFinalize,
  _triggerExtractFromFrontmatter: _triggerExtractFromFrontmatter,
  _triggerCollectMdFiles: _triggerCollectMdFiles,
  _triggerBuildIndex: _triggerBuildIndex,
  _autoIndexKnowledge: _autoIndexKnowledge,
  helpersDir: helpersDir,
  fs: fs,
  path: path,
};

const handlers = {
  'route': async () => {
    const h = require('./handlers/route-handler.cjs');
    await h.handle(hCtx);
  },

  'post-edit': async () => {
    const h = require('./handlers/edit-handler.cjs');
    await h.handle(hCtx);
  },


  'session-restore': async () => {
    const h = require('./handlers/session-restore-handler.cjs');
    await h.handleRestore(hCtx);
  },


  'session-end': async () => {
    const h = require('./handlers/session-handler.cjs');
    await h.handleEnd(hCtx);
  },


  'pre-task': async () => {
    const h = require('./handlers/task-handler.cjs');
    await h.handlePreTask(hCtx);
  },


  'post-task': async () => {
    const h = require('./handlers/task-handler.cjs');
    await h.handlePostTask(hCtx);
  },


  'compact-manual': async () => {
    if (intelligence && intelligence.consolidate) {
      try { await runWithTimeout(function() { return intelligence.consolidate(); }, 'intelligence.consolidate()'); } catch (e) { /* non-fatal */ }
    }
    try {
      var lastRoute = path.join(CWD, '.monomind', 'last-route.json');
      if (fs.existsSync(lastRoute)) {
        var route = JSON.parse(fs.readFileSync(lastRoute, 'utf-8'));
        console.log('[COMPACT_CONTEXT] Last route: ' + route.agent + ' (' + (route.confidence != null ? (route.confidence * 100).toFixed(0) : '?') + '%)');
      }
    } catch (e) { /* non-fatal */ }
    _injectCompactGraphMap();
    console.log('[COMPACT] Manual compaction — intelligence consolidated, context preserved');
  },

  'compact-auto': async () => {
    if (intelligence && intelligence.consolidate) {
      try { await runWithTimeout(function() { return intelligence.consolidate(); }, 'intelligence.consolidate()'); } catch (e) { /* non-fatal */ }
    }
    try {
      var lastRoute = path.join(CWD, '.monomind', 'last-route.json');
      if (fs.existsSync(lastRoute)) {
        var route = JSON.parse(fs.readFileSync(lastRoute, 'utf-8'));
        console.log('[COMPACT_CONTEXT] Last route: ' + route.agent + ' (' + (route.confidence != null ? (route.confidence * 100).toFixed(0) : '?') + '%)');
      }
    } catch (e) { /* non-fatal */ }
    _injectCompactGraphMap();
    console.log('[COMPACT] Auto compaction — intelligence consolidated, context preserved');
    console.log('GOLDEN RULE: 1 message = all parallel operations');
  },

  'agent-start': () => {
    // Called by SubagentStart hook — register this agent so the statusline can count it
    const regDir = path.join(CWD, '.monomind', 'agents', 'registrations');
    try {
      fs.mkdirSync(regDir, { recursive: true });
      const id = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const regFile = path.join(regDir, 'agent-' + id + '.json');
      fs.writeFileSync(regFile, JSON.stringify({
        agentId: id,
        startedAt: new Date().toISOString(),
        pid: process.pid,
      }));
      // Also refresh swarm-activity.json so it's within the 5-min staleness window
      const activityDir = path.join(CWD, '.monomind', 'metrics');
      fs.mkdirSync(activityDir, { recursive: true });
      const activityPath = path.join(activityDir, 'swarm-activity.json');
      const active = fs.readdirSync(regDir).filter(f => f.endsWith('.json')).length;
      // Preserve lastActive (peak) across agent lifecycle so statusline shows non-zero after completion
      let prevLastActive = 0;
      try { prevLastActive = (JSON.parse(fs.readFileSync(activityPath, 'utf-8'))?.swarm?.lastActive) || 0; } catch { /* ignore */ }
      fs.writeFileSync(activityPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        swarm: {
          active: active > 0,
          agent_count: active,
          coordination_active: active > 0,
          lastActive: Math.max(active, prevLastActive),
        },
      }));

      // Write last-dispatch.json so the route handler can suppress redundant suggestions
      // on the next turn when the same type of agent is recommended.
      const agentType = hookInput.subagent_type || hookInput.agentType || hookInput.agent_type || hookInput.agentSlug || 'unknown';
      const agentDesc = hookInput.description || hookInput.prompt_description || '';
      fs.writeFileSync(
        path.join(CWD, '.monomind', 'last-dispatch.json'),
        JSON.stringify({
          agentType: agentType,
          description: agentDesc.substring(0, 120),
          dispatchedAt: new Date().toISOString(),
        }),
        'utf-8'
      );
    } catch (e) { /* non-fatal — never block a subagent from starting */ }

    // Subagent context inheritance — inject graph god nodes + parent's last
    // pre-resolved suggestions so the spawned agent inherits spatial map
    // instead of starting blind.
    try {
      var subDb = _openMonographDb();
      if (subDb) {
        try {
          var godRows = subDb.prepare(
            "SELECT n.name, n.label, n.file_path AS file, " +
            "(SELECT COUNT(*) FROM edges WHERE source_id=n.id OR target_id=n.id) AS deg " +
            "FROM nodes n " +
            "WHERE n.label NOT IN ('Concept') AND n.file_path IS NOT NULL AND n.file_path != '' " +
            "ORDER BY deg DESC LIMIT 5"
          ).all();
          if (godRows.length > 0) {
            console.log('[MONOGRAPH_SUBAGENT_CTX] Graph map inherited from parent:');
            for (var gi = 0; gi < godRows.length; gi++) {
              var gr = godRows[gi];
              console.log('  · ' + gr.name + ' [' + gr.label + '] — ' + (gr.file || '') + ' (deg ' + gr.deg + ')');
            }
            // Also forward parent's last routing suggestion text if any
            try {
              var subAgentDesc = hookInput.description || hookInput.prompt_description || '';
              if (subAgentDesc && subAgentDesc.length > 8) {
                var subHints = getMonographSuggestions(subAgentDesc, 3);
                if (subHints.length > 0) {
                  console.log('  Top files for this subagent task:');
                  for (var si2 = 0; si2 < subHints.length; si2++) {
                    var sh = subHints[si2];
                    console.log('    · ' + sh.name + ' [' + sh.label + '] — ' + (sh.file || ''));
                  }
                }
              }
            } catch (_) {}
            console.log('  Use mcp__monomind__monograph_suggest / monograph_query in this subagent before grepping.');
          }
        } catch (e) { /* non-fatal */ }
      }
    } catch (e) { /* non-fatal */ }

    console.log('[OK] Agent registered');
  },

  // Draft an ADR from accumulated decision markers in .monomind/decisions.jsonl.
  // Usage: node hook-handler.cjs adr-draft   (or via /adr slash command)
  'adr-draft': () => {
    var jsonl = path.join(CWD, '.monomind', 'decisions.jsonl');
    if (!fs.existsSync(jsonl)) {
      console.log('[ADR] No decisions recorded yet. Type prompts containing markers like "let\'s go with X", "we chose Y", "decision: Z" to populate the log.');
      return;
    }
    var lines = fs.readFileSync(jsonl, 'utf-8').trim().split('\n').filter(Boolean);
    if (lines.length === 0) {
      console.log('[ADR] decisions.jsonl is empty.');
      return;
    }
    // Group decisions captured in the last 7 days
    var cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    var recent = lines.map(function(l) { try { return JSON.parse(l); } catch (_) { return null; } })
                       .filter(function(d) { return d && d.ts >= cutoff; });
    if (recent.length === 0) {
      console.log('[ADR] No decisions in the last 7 days. Older entries: ' + lines.length + '.');
      return;
    }

    var adrsDir = path.join(CWD, 'docs', 'adrs');
    try { fs.mkdirSync(adrsDir, { recursive: true }); } catch (_) {}
    // Pick next ADR number
    var existing = [];
    try { existing = fs.readdirSync(adrsDir).filter(function(f) { return /^ADR-\d{4}/.test(f); }); } catch (_) {}
    var nextNum = existing.length + 1;
    var num = String(nextNum).padStart(4, '0');
    var stamp = new Date().toISOString().slice(0,10);
    var slug = 'session-decisions';
    var fname = 'ADR-' + num + '-' + stamp + '-' + slug + '.md';
    var outPath = path.join(adrsDir, fname);

    var body = '# ADR-' + num + ': Session decisions (' + stamp + ')\n\n' +
               '**Status:** Proposed\n**Date:** ' + stamp + '\n\n' +
               '## Context\n\n' +
               'During recent sessions, the following decision markers were captured ' +
               'from user prompts. Each excerpt is the surrounding sentence at the time.\n\n' +
               '## Decisions\n\n';
    for (var i = 0; i < recent.length; i++) {
      var d = recent[i];
      var date = new Date(d.ts).toISOString().slice(0,16).replace('T',' ');
      body += '### ' + (i + 1) + '. ' + date + '\n\n';
      for (var j = 0; j < d.excerpts.length; j++) {
        body += '> ' + d.excerpts[j].trim() + '\n\n';
      }
      if (d.prompt) body += '_Prompt:_ ' + d.prompt.slice(0, 200) + (d.prompt.length > 200 ? '…' : '') + '\n\n';
    }
    body += '## Consequences\n\n_(fill in after review)_\n\n' +
            '## Status\n\nProposed — awaiting human review and refinement.\n';
    fs.writeFileSync(outPath, body);
    console.log('[ADR_DRAFT] Wrote ' + recent.length + ' decision(s) to ' + outPath);
    console.log('  Edit the file to fill in Context and Consequences, then change Status to Accepted/Rejected.');
  },

  'graph-status': () => {
    var db = _openMonographDb();
    if (!db) { console.log('No monograph.db found. Run /monomind:understand to build.'); return; }
    try {
      var n = db.prepare("SELECT COUNT(*) AS c FROM nodes").get().c;
      var e = db.prepare("SELECT COUNT(*) AS c FROM edges").get().c;
      var usage = (function() {
        try { return JSON.parse(fs.readFileSync(path.join(CWD, '.monomind', 'metrics', 'graph-usage.json'), 'utf-8')); }
        catch (_) { return {}; }
      })();
      var wins = (usage.monograph_call || 0) + (usage.preresolve_hit || 0)
               + (usage.graph_assist_search || 0) + (usage.graph_assist_neighbors || 0);
      var search = (usage.grep_call || 0) + (usage.glob_call || 0)
                 + (usage.bash_grep_call || 0) + (usage.bash_find_call || 0);
      var pct = (wins + search) > 0 ? Math.round((wins / (wins + search)) * 100) : 0;
      var saved = usage.dollars_saved || 0;
      console.log('Monograph: ' + n.toLocaleString() + ' nodes · ' + e.toLocaleString() + ' edges');
      console.log('Usage: ' + pct + '% graph · ' + (100 - pct) + '% grep · ' +
                  'wins=' + wins + ' search=' + search +
                  (saved > 0 ? ' · saved $' + saved.toFixed(2) : ''));
    } catch (err) { console.log('Error: ' + err.message); }
  },

  'budget-status': () => {
    var b = _getBudgetStatus();
    if (!b) { console.log('No budget data yet — token tracking not initialized.'); return; }
    console.log('Today:   $' + b.todayCost.toFixed(2) + ' / $' + b.dailyLimit  + ' (' + b.dailyPct  + '%)' + (b.autoTuned ? ' [auto-tuned]' : ''));
    console.log('Month:   $' + b.monthCost.toFixed(2) + ' / $' + b.monthlyLimit + ' (' + b.monthlyPct + '%)');
    console.log('Status:  ' + (b.breached ? 'BREACHED' : b.spike ? 'SPIKE' : b.alert ? 'ALERT' : 'OK'));
    console.log('Edit .monomind/budget.json to adjust. Delete to re-tune.');
  },

  'loops-status': () => {
    var loopsDir = path.join(CWD, '.monomind', 'loops');
    if (!fs.existsSync(loopsDir)) { console.log('No loops directory.'); return; }
    var files = fs.readdirSync(loopsDir).filter(function(f) {
      return f.endsWith('.json') && !f.includes('-hil') && !f.endsWith('.stop');
    });
    var STALE_MS = 6 * 60 * 60 * 1000;
    var now = Date.now();
    var active = [], stale = [];
    files.forEach(function(f) {
      try {
        var d = JSON.parse(fs.readFileSync(path.join(loopsDir, f), 'utf-8'));
        var last = d.lastRunAt || d.startedAt || 0;
        var ageMs = last ? (now - last) : Infinity;
        if (ageMs > STALE_MS) stale.push({ d: d, ageH: Math.round(ageMs / 3600000) });
        else active.push(d);
      } catch (_) {}
    });
    if (active.length === 0 && stale.length === 0) {
      console.log('No loops.'); return;
    }
    if (active.length > 0) {
      console.log('Active (' + active.length + '):');
      active.forEach(function(d) {
        console.log('  · ' + (d.command || '?') + ' [' + (d.type || '?') + '] run ' + (d.currentRep || 0) +
                    (d.maxReps ? '/' + d.maxReps : '') + ' · ' + (d.status || '?'));
      });
    }
    if (stale.length > 0) {
      console.log('Stale (' + stale.length + ' >6h):');
      stale.forEach(function(s) {
        console.log('  · ' + (s.d.command || '?') + ' run ' + (s.d.currentRep || 0) +
                    ' · ' + s.ageH + 'h ago · ' + (s.d.status || '?'));
      });
    }
  },

  'status': () => {
    console.log('[OK] Status check');
  },

  'stats': async () => {
    if (intelligence && intelligence.stats) {
      await Promise.resolve(intelligence.stats(args.includes('--json')));
    } else {
      console.log('[WARN] Intelligence module not available. Run session-restore first.');
    }
  },
};

if (command && handlers[command]) {
    var _hookStart = Date.now();
    try {
      await Promise.resolve(handlers[command]());
    } catch (e) {
      console.log('[WARN] Hook ' + command + ' encountered an error: ' + e.message);
    } finally {
      try { _recordHookLatency(command, Date.now() - _hookStart); } catch (_) {}
    }
  } else if (command) {
    console.log('[OK] Hook: ' + command);
  } else {
    console.log('Usage: hook-handler.cjs <route|pre-bash|pre-search|post-edit|post-read|post-graph-tool|session-restore|session-end|pre-task|post-task|compact-manual|compact-auto|status|stats>');
  }
}

main().catch(function(e) {
  console.log('[WARN] Hook handler error: ' + e.message);
}).finally(function() {
  // Ensure clean exit for Claude Code hooks
  process.exit(0);
});
