#!/usr/bin/env node
/**
 * Monomind Hook Handler (Cross-Platform)
 * Dispatches hook events to the appropriate helper modules.
 *
 * ARCHITECTURE NOTE — Two Hook Systems
 * =====================================
 * There are two independent hook systems in this project:
 *
 * 1. .claude/helpers/ CJS handlers (THIS FILE and ./handlers/*.cjs)
 *    These are the handlers that actually run via settings.json hook
 *    configuration. They are plain CommonJS scripts invoked directly
 *    by Claude Code's hook runtime. This is the "live" system.
 *
 * 2. @monoes/hooks TypeScript package (packages/@monomind/hooks/)
 *    A full TypeScript package with workers, learning services, and
 *    a WorkerManager. It compiles to dist/ but is only loaded
 *    optionally, bridged at six lifecycle events: SessionStart (restore),
 *    PreTask, PostTask, PostEdit, SessionEnd, and AgentSpawn (agent-start).
 *    The CJS handlers in system (1) are the authoritative dispatch path;
 *    system (2) provides optional enrichment when the package is
 *    installed and built.
 *
 *    IMPORTANT: each hook event is dispatched as its OWN fresh `node`
 *    process (Claude Code spawns one invocation per event — this file
 *    does not stay resident across events). So the @monoes/hooks
 *    module, and anything it registers (trace collector spans, episode
 *    binner, etc.), cannot be set up once and reused across events —
 *    every bridging handler must call hCtx._ensureHooksModule() itself,
 *    which lazily imports the package AND calls initDefaultWorkers() in
 *    that process before firing executeHooks(). Cross-event state (e.g.
 *    correlating a PreTask span to its matching PostTask) is NOT
 *    possible via in-memory maps for this reason; only handlers/hooks
 *    that persist state to disk (like the daemon workers under
 *    .monomind/metrics/) can meaningfully bridge across separate events.
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
  _requireMonograph, _openMonographDb, _isGraphFresh,
  getMonographSuggestions, getMonographNeighbors,
  _recordGraphTelemetry, _injectCompactGraphMap,
  _findAffectedTests, _maybeRebuildMonograph,
  _graphGateShouldBlock, _graphGateMarkQueried,
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

// Module-level reference to @monoes/hooks — populated lazily via
// _ensureHooksModule(). NOTE: hook-handler.cjs runs as a fresh `node` process
// per hook event (Claude Code spawns one invocation per event, it does not
// keep the process alive across events), so a value set during one event
// (e.g. session-restore) is NOT visible to a later event's process (e.g.
// pre-task). Each handler that needs the bridge MUST call
// hCtx._ensureHooksModule() itself rather than reading hCtx._hooksModule
// directly, or the bridge silently no-ops.
let _hooksModule = null;
let _hooksModuleLoadAttempted = false;
async function _ensureHooksModule() {
  if (_hooksModule) return _hooksModule;
  if (_hooksModuleLoadAttempted) return null; // already tried+failed this process
  _hooksModuleLoadAttempted = true;
  // 1) Bare specifier — works when @monoes/hooks is installed/linked in a
  //    node_modules reachable from this file (e.g. an end-user install).
  try {
    _hooksModule = await import('@monoes/hooks');
  } catch (e) {
    _hooksModule = null;
  }
  // 2) Dev-repo fallback — in the monorepo the pnpm workspace link lives under
  //    packages/@monomind/cli/node_modules, NOT at the repo root, so the bare
  //    specifier never resolves from .claude/helpers. Import the compiled dist
  //    entry directly by path (same pattern as session-restore-handler.cjs).
  if (!_hooksModule) {
    try {
      const _distIndex = path.join(CWD, 'packages', '@monomind', 'hooks', 'dist', 'index.js');
      if (fs.existsSync(_distIndex)) {
        _hooksModule = await import('file://' + _distIndex);
      }
    } catch (e) {
      _hooksModule = null; // not built — bridge stays a fail-soft no-op
    }
  }
  if (!_hooksModule) _warnHooksBridgeUnavailable();
  return _hooksModule;
}

// ── Visible one-time warning when the @monoes/hooks bridge fully fails ───
// Both load paths above (bare specifier + dev-repo file:// fallback) failed:
// the 15 background workers (metrics, security scan, DDD tracking, etc.) are
// unavailable for the rest of this session. This is almost always because
// @monoes/hooks was never resolvable from npm (it ships with
// optionalDependencies:"*", which npm silently skips) — NOT a problem with
// the user's own project setup. Historically this failed completely
// silently (see docs/AUDIT-BACKLOG.md P1-1), burning debugging time on the
// wrong target. Warned once per session (file-marker keyed by session id,
// same pattern as the once-per-day update check below) since every hook
// event is its own fresh `node` process and would otherwise spam this on
// every single tool call.
function _warnHooksBridgeUnavailable() {
  try {
    var sessId = String((hookInput && (hookInput.sessionId || hookInput.session_id)) || '');
    var flagFile = path.join(CWD, '.monomind', 'hooks-bridge-warned.json');
    var alreadyWarned = false;
    if (sessId && fs.existsSync(flagFile)) {
      try {
        var flagData = JSON.parse(fs.readFileSync(flagFile, 'utf-8'));
        if (flagData && flagData.sessionId === sessId) alreadyWarned = true;
      } catch (e) { /* corrupt/unreadable flag file — warn again to be safe */ }
    }
    if (alreadyWarned) return;
    process.stderr.write(
      '[WARN] @monoes/hooks could not be loaded (bare specifier and dev-repo fallback both failed) — ' +
      'background workers (metrics, security scan, DDD tracking, etc.) are unavailable this session. ' +
      'This is not a problem with your project configuration — the package is not resolvable via npm ' +
      'from this install. See docs/AUDIT-BACKLOG.md P1-1 or https://github.com/monoes/monomind/issues.\n'
    );
    if (sessId) {
      try {
        fs.mkdirSync(path.join(CWD, '.monomind'), { recursive: true });
        fs.writeFileSync(flagFile, JSON.stringify({ sessionId: sessId, warnedAt: new Date().toISOString() }), 'utf-8');
      } catch (e) { /* non-fatal — worst case we warn again next event */ }
    }
  } catch (e) { /* never let the warning itself break a hook event */ }
}

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
// Hard cap at 1 MiB: a legitimate hook payload (tool name + input) is at most
// a few KB; anything larger is either a bug or an adversarial OOM attempt.
const MAX_STDIN_BYTES = 1 * 1024 * 1024; // 1 MiB
async function readStdin() {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let data = '';
    let byteCount = 0;
    let truncated = false;
    const timer = setTimeout(() => {
      process.stdin.removeAllListeners();
      process.stdin.pause();
      resolve(data);
    }, 500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      if (truncated) return;
      byteCount += Buffer.byteLength(chunk, 'utf8');
      if (byteCount > MAX_STDIN_BYTES) {
        truncated = true;
        process.stdin.pause();
        clearTimeout(timer);
        resolve(''); // discard oversized input to prevent OOM
        return;
      }
      data += chunk;
    });
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
  // Module-level singleton (populated by session-restore handler, or lazily
  // via _ensureHooksModule() — required since each hook event is a fresh process).
  get _hooksModule() { return _hooksModule; },
  set _hooksModule(v) { _hooksModule = v; },
  _ensureHooksModule: _ensureHooksModule,
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
  _isGraphFresh: _isGraphFresh,
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
    const h = require('./handlers/compact-handler.cjs');
    await h.handle(hCtx, 'manual');
  },

  'compact-auto': async () => {
    const h = require('./handlers/compact-handler.cjs');
    await h.handle(hCtx, 'auto');
  },

  'agent-start': async () => {
    const h = require('./handlers/agent-start-handler.cjs');
    await h.handle(hCtx);
  },

  'adr-draft': () => {
    const h = require('./handlers/adr-draft-handler.cjs');
    h.handle(hCtx);
  },

  'pre-bash': async () => {
    // SECURITY GATE FIRST — destructive-ops + secrets enforcement must never
    // be starved by the slower enrichment work below (monograph hint lookups,
    // monofence-ai scan). Previously this ran LAST, after up to 10 monograph
    // SQLite strategies and a 1.5s monofence budget; under load/slow disk the
    // global 5s safety timer (see main()'s `process.exit(0)`) could fire
    // before the gate ever printed its block decision — i.e. the gate could
    // fail OPEN under time pressure. Computing it first guarantees the
    // block/allow decision (process.exitCode) is set before any enrichment
    // work even starts; enrichment output is still attached afterward if
    // there's time left in the process's lifetime.
    var gates = require('./handlers/gates-handler.cjs');
    await gates.handlePreBash(hCtx);
    if (process.exitCode === 2) return; // blocked — skip enrichment entirely

    var cmd = (hCtx.toolInput && (hCtx.toolInput.command || hCtx.toolInput.cmd)) || '';
    var isGrep = /\b(?:grep|rg|ag)\b/.test(cmd);
    var isFind = /\b(?:find|fd)\b/.test(cmd) && !isGrep;
    if (isGrep || isFind) {
      var sessIdGate = String((hCtx.hookInput && (hCtx.hookInput.sessionId || hCtx.hookInput.session_id)) || '');
      if (_graphGateShouldBlock(sessIdGate)) {
        process.stderr.write(JSON.stringify({
          decision: 'block',
          reason: '[graph-gate] Call mcp__monomind__monograph_query or monograph_suggest before grep/rg/find for code exploration (CLAUDE.md). This blocks once per session — after your first monograph call (or this one warning), Bash grep/find work normally for the rest of the session.',
        }) + '\n');
        process.exitCode = 2;
        return;
      }
      var graphAssisted = false;
      if (_isGraphFresh()) {
        try {
          if (isGrep) {
            // Extract pattern from grep/rg/ag — find the first quoted string that
            // looks like a search pattern (not a flag value like "*.ts" or "!dir")
            var grepCmd = cmd.match(/\b(grep|rg|ag)\b/)[1];
            var cmdAfterTool = cmd.slice(cmd.indexOf(grepCmd) + grepCmd.length);
            var allQuoted = [];
            var _qre = /["']([^"']{3,80})["']/g;
            var _qm;
            while ((_qm = _qre.exec(cmdAfterTool)) !== null) allQuoted.push(_qm[1]);
            // Pick the first quoted string that looks like identifier/symbol, not a glob/path
            var pattern = allQuoted.find(function(q) { return /[a-zA-Z]/.test(q) && !/^[!*.]/.test(q) && !/[*?{}]/.test(q); });
            // Fallback: unquoted bare identifier after flags
            if (!pattern) {
              var _um = cmdAfterTool.match(/(?:^|\s)(?!-)([a-zA-Z_$][a-zA-Z0-9_$-]*[a-zA-Z0-9])(?:\s|$)/);
              if (_um) pattern = _um[1];
            }
            if (pattern && pattern.length >= 3 && pattern.length <= 80) {
              var db = _openMonographDb();
              if (db) {
                // Stop words: language keywords + generic single-word identifiers
                // that match Variable nodes in markdown/scripts (not real code symbols)
                // monolean: only JS/TS reserved words — generic identifiers (handler, config, router, etc.) are valid symbol names
                var _grepStop = {import:1,export:1,from:1,require:1,return:1,function:1,const:1,let:1,var:1,class:1,interface:1,type:1,extends:1,implements:1,async:1,await:1,yield:1,throw:1,catch:1,finally:1,typeof:1,instanceof:1,void:1,null:1,undefined:1,true:1,false:1,this:1,super:1,new:1,delete:1,switch:1,case:1,break:1,continue:1,default:1,else:1,while:1,for:1,with:1,static:1,enum:1,string:1,number:1,object:1,boolean:1};

                // --- Strategy 1: clean identifier → exact name match (case-sensitive) ---
                if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(pattern) && pattern.length >= 4
                    && !_grepStop[pattern.toLowerCase()]) {
                  var row = db.prepare(
                    'SELECT n.name, n.file_path, n.start_line FROM nodes n WHERE n.name = ? AND n.label NOT IN (\'Concept\',\'Community\',\'Folder\') AND n.file_path IS NOT NULL AND n.file_path NOT LIKE \'%.md\' LIMIT 1'
                  ).get(pattern);
                  if (row) {
                    graphAssisted = true;
                    var hint = row.file_path + (row.start_line != null ? ':' + row.start_line : '');
                    console.log('[MONOGRAPH_HINT] ' + pattern + ' → ' + hint);
                  }
                }

                // --- Strategy 2: case-insensitive name match (uses COLLATE NOCASE index) ---
                if (!graphAssisted && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(pattern) && pattern.length >= 4
                    && !_grepStop[pattern.toLowerCase()]) {
                  var row = db.prepare(
                    'SELECT n.name, n.file_path, n.start_line FROM nodes n WHERE n.name = ? COLLATE NOCASE AND n.label NOT IN (\'Concept\',\'Community\',\'Folder\') AND n.file_path IS NOT NULL AND n.file_path NOT LIKE \'%.md\' LIMIT 1'
                  ).get(pattern);
                  if (row) {
                    graphAssisted = true;
                    var hint = row.file_path + (row.start_line != null ? ':' + row.start_line : '');
                    console.log('[MONOGRAPH_HINT] ' + row.name + ' → ' + hint);
                  }
                }

                // --- Strategy 3: dotted filename (db.ts, orchestrator.ts) → File node lookup ---
                if (!graphAssisted && /^[a-zA-Z0-9_-]+\.[a-z]{1,4}$/.test(pattern)) {
                  var row = db.prepare(
                    'SELECT n.name, n.file_path FROM nodes n WHERE n.name = ? AND n.label = \'File\' LIMIT 1'
                  ).get(pattern);
                  if (row) {
                    graphAssisted = true;
                    console.log('[MONOGRAPH_HINT] file ' + pattern + ' → ' + row.file_path);
                  }
                }

                // --- Strategy 4: file path fragment (hyphenated: "scope-resolution") ---
                if (!graphAssisted && /^[a-zA-Z0-9_-]+(\.[a-zA-Z]+)?$/.test(pattern) && pattern.length >= 5
                    && pattern.indexOf('-') !== -1) {
                  var pathLike = '%/' + pattern + '%';
                  var row = db.prepare(
                    'SELECT n.name, n.file_path FROM nodes n WHERE n.label = \'File\' AND n.file_path LIKE ? LIMIT 1'
                  ).get(pathLike);
                  if (row) {
                    graphAssisted = true;
                    console.log('[MONOGRAPH_HINT] file ' + pattern + ' → ' + row.file_path);
                  }
                }

                // --- Strategy 5: extract ≥4-char identifiers from regex patterns ---
                if (!graphAssisted) {
                  var identifiers = pattern.match(/[a-zA-Z_$][a-zA-Z0-9_$]{3,}/g) || [];
                  var tried = {};
                  for (var ji = 0; ji < identifiers.length && !graphAssisted; ji++) {
                    var id = identifiers[ji];
                    if (_grepStop[id.toLowerCase()] || tried[id.toLowerCase()]) continue;
                    tried[id.toLowerCase()] = 1;
                    var row2 = db.prepare(
                      'SELECT n.name, n.file_path, n.start_line FROM nodes n WHERE n.name = ? COLLATE NOCASE AND n.label NOT IN (\'Concept\',\'Community\',\'Folder\') AND n.file_path IS NOT NULL AND n.file_path NOT LIKE \'%.md\' LIMIT 1'
                    ).get(id);
                    if (row2) {
                      graphAssisted = true;
                      var hint2 = row2.file_path + (row2.start_line != null ? ':' + row2.start_line : '');
                      console.log('[MONOGRAPH_HINT] ' + row2.name + ' → ' + hint2);
                    }
                  }
                }

                // --- Strategy 6: FTS5 trigram substring match ---
                if (!graphAssisted && pattern.length >= 4) {
                  try {
                    var ftsPattern = '"' + pattern.replace(/"/g, '""') + '"';
                    var ftsRow = db.prepare(
                      'SELECT n.name, n.file_path, n.start_line FROM nodes_fts f ' +
                      'JOIN nodes n ON n.rowid = f.rowid ' +
                      'WHERE nodes_fts MATCH ? ' +
                      'AND n.label NOT IN (\'Concept\',\'Community\',\'Folder\') ' +
                      'AND n.file_path IS NOT NULL AND n.file_path NOT LIKE \'%.md\' LIMIT 1'
                    ).get(ftsPattern);
                    if (ftsRow) {
                      graphAssisted = true;
                      var ftsHint = ftsRow.file_path + (ftsRow.start_line != null ? ':' + ftsRow.start_line : '');
                      console.log('[MONOGRAPH_HINT] ' + ftsRow.name + ' → ' + ftsHint);
                    }
                  } catch (e) { /* FTS table may not exist */ }
                }

                // --- Strategy 7: dotted property access (ctx.allFilesCached, cache.hashFile) ---
                if (!graphAssisted && pattern.indexOf('.') !== -1 && /^[a-zA-Z_$]/.test(pattern)) {
                  var dotParts = pattern.split('.').filter(function(p) { return p.length >= 4 && /^[a-zA-Z_$]/.test(p); });
                  for (var di = dotParts.length - 1; di >= 0 && !graphAssisted; di--) {
                    var dp = dotParts[di];
                    if (_grepStop[dp.toLowerCase()]) continue;
                    var drow = db.prepare(
                      'SELECT n.name, n.file_path, n.start_line FROM nodes n WHERE n.name = ? COLLATE NOCASE AND n.label NOT IN (\'Concept\',\'Community\',\'Folder\') AND n.file_path IS NOT NULL AND n.file_path NOT LIKE \'%.md\' LIMIT 1'
                    ).get(dp);
                    if (drow) {
                      graphAssisted = true;
                      var dhint = drow.file_path + (drow.start_line != null ? ':' + drow.start_line : '');
                      console.log('[MONOGRAPH_HINT] ' + drow.name + ' → ' + dhint);
                    }
                  }
                }

                // --- Strategy 8: snake_case → camelCase conversion ---
                if (!graphAssisted && pattern.indexOf('_') !== -1 && /^[a-z]/.test(pattern) && pattern.length >= 6) {
                  var camel = pattern.replace(/_([a-z])/g, function(_, c) { return c.toUpperCase(); });
                  if (camel !== pattern && !_grepStop[camel.toLowerCase()]) {
                    var crow = db.prepare(
                      'SELECT n.name, n.file_path, n.start_line FROM nodes n WHERE n.name = ? COLLATE NOCASE AND n.label NOT IN (\'Concept\',\'Community\',\'Folder\') AND n.file_path IS NOT NULL AND n.file_path NOT LIKE \'%.md\' LIMIT 1'
                    ).get(camel);
                    if (crow) {
                      graphAssisted = true;
                      var chint = crow.file_path + (crow.start_line != null ? ':' + crow.start_line : '');
                      console.log('[MONOGRAPH_HINT] ' + crow.name + ' → ' + chint);
                    }
                  }
                }

                // --- Strategy 9: alternation patterns (TODO\|FIXME, mock\|fake\|stub) ---
                if (!graphAssisted && pattern.indexOf('|') !== -1) {
                  var altParts = pattern.split(/\\?\|/).map(function(p) {
                    return p.replace(/[^a-zA-Z0-9_$]/g, '');
                  }).filter(function(p) {
                    return p.length >= 4 && /^[a-zA-Z_$]/.test(p) && !_grepStop[p.toLowerCase()];
                  });
                  for (var ai = 0; ai < altParts.length && !graphAssisted; ai++) {
                    var arow = db.prepare(
                      'SELECT n.name, n.file_path, n.start_line FROM nodes n WHERE n.name = ? COLLATE NOCASE AND n.label NOT IN (\'Concept\',\'Community\',\'Folder\') AND n.file_path IS NOT NULL AND n.file_path NOT LIKE \'%.md\' LIMIT 1'
                    ).get(altParts[ai]);
                    if (arow) {
                      graphAssisted = true;
                      var ahint = arow.file_path + (arow.start_line != null ? ':' + arow.start_line : '');
                      console.log('[MONOGRAPH_HINT] ' + arow.name + ' → ' + ahint);
                    }
                  }
                }

              }
            }
            // --- Strategy 10: grep targeting a known source directory ---
            // Runs outside `if (pattern)` so it works even when pattern extraction fails
            if (!graphAssisted) {
              var db10 = _openMonographDb();
              if (db10) {
                var dirMatch10 = cmdAfterTool.match(/\b(src|packages(?:\/[a-zA-Z0-9_@/-]*)?)\//);
                if (dirMatch10) {
                  var dirPath10 = dirMatch10[1].replace(/\/$/, '');
                  var drow10 = db10.prepare(
                    'SELECT COUNT(*) AS c FROM nodes WHERE label = \'File\' AND file_path LIKE ? LIMIT 1'
                  ).get('%' + dirPath10 + '/%');
                  if (drow10 && drow10.c > 0) {
                    graphAssisted = true;
                    console.log('[MONOGRAPH_HINT] grep scope ' + dirPath10 + ' has ' + drow10.c + ' indexed files');
                  }
                }
              }
            }
          } else {
            // find/fd -name "foo.ts" — check if the filename exists in File nodes
            var fm = cmd.match(/-name\s+["']([^"'*?]+\.[a-z]+)["']/);
            if (fm && fm[1]) {
              var db = _openMonographDb();
              if (db) {
                var row = db.prepare(
                  'SELECT n.file_path FROM nodes n WHERE n.name = ? AND n.label = \'File\' LIMIT 1'
                ).get(fm[1]);
                if (row) {
                  graphAssisted = true;
                  console.log('[MONOGRAPH_HINT] file ' + fm[1] + ' → ' + row.file_path);
                }
              }
            }
            // find -name "*worker*" — extract core word from wildcard patterns
            if (!graphAssisted) {
              var wm = cmd.match(/-name\s+["'][*]?([a-zA-Z][a-zA-Z0-9_-]{3,})[*]?(?:\.[a-z]+)?["']/);
              if (wm && wm[1]) {
                var db = _openMonographDb();
                if (db) {
                  var wrow = db.prepare(
                    'SELECT n.name, n.file_path FROM nodes n WHERE n.name LIKE ? AND n.label = \'File\' AND n.file_path NOT LIKE \'%.md\' LIMIT 1'
                  ).get('%' + wm[1] + '%');
                  if (wrow) {
                    graphAssisted = true;
                    console.log('[MONOGRAPH_HINT] file *' + wm[1] + '* → ' + wrow.file_path);
                  }
                }
              }
            }
            // find with -type f in a known directory scope
            if (!graphAssisted) {
              var fdm = cmd.match(/\bfind\s+(\S*(?:src|packages|lib|app)[a-zA-Z0-9_@/-]*)/);
              if (fdm && fdm[1]) {
                var db = _openMonographDb();
                if (db) {
                  var fdrow = db.prepare(
                    'SELECT COUNT(*) AS c FROM nodes WHERE label = \'File\' AND file_path LIKE ? LIMIT 1'
                  ).get(fdm[1].replace(/\/$/, '') + '/%');
                  if (fdrow && fdrow.c > 0) {
                    graphAssisted = true;
                    console.log('[MONOGRAPH_HINT] find scope ' + fdm[1] + ' has ' + fdrow.c + ' indexed files');
                  }
                }
              }
            }
          }
        } catch (e) { /* non-fatal */ }
      }
      if (graphAssisted) _recordGraphTelemetry('graph_assist_search');
      else if (isGrep) _recordGraphTelemetry('bash_grep_call');
      else _recordGraphTelemetry('bash_find_call');
    }
  },

  'pre-write': async () => {
    // Enforcement gate: secrets detection + monofence-ai threat scan before
    // Write/Edit/MultiEdit content lands on disk
    var gates = require('./handlers/gates-handler.cjs');
    await gates.handlePreWrite(hCtx);
  },

  'pre-search': () => {
    var tool = hCtx.toolName || '';
    var sessIdGate = String((hCtx.hookInput && (hCtx.hookInput.sessionId || hCtx.hookInput.session_id)) || '');
    if (_graphGateShouldBlock(sessIdGate)) {
      process.stderr.write(JSON.stringify({
        decision: 'block',
        reason: '[graph-gate] Call mcp__monomind__monograph_query or monograph_suggest before ' + (tool || 'Grep/Glob') + ' for code exploration (CLAUDE.md). This blocks once per session — after your first monograph call (or this one warning), search tools work normally for the rest of the session.',
      }) + '\n');
      process.exitCode = 2;
      return;
    }
    var graphResolved = false;
    try {
      var grepPattern = (typeof toolInput === 'object' && toolInput !== null)
        ? (toolInput.pattern || toolInput.query || '')
        : '';
      if (grepPattern.length >= 4 && grepPattern.length <= 80 && _isGraphFresh()) {
        var db = _openMonographDb();
        if (db) {
          try {
            // monolean: only JS/TS reserved words — generic identifiers are valid symbol names
            var _searchStop = {import:1,export:1,from:1,require:1,return:1,function:1,const:1,let:1,var:1,class:1,interface:1,type:1,extends:1,implements:1,async:1,await:1,yield:1,throw:1,catch:1,finally:1,typeof:1,instanceof:1,void:1,null:1,undefined:1,true:1,false:1,this:1,super:1,new:1,delete:1,switch:1,case:1,break:1,continue:1,default:1,else:1,while:1,for:1,with:1,static:1,enum:1,string:1,number:1,object:1,boolean:1};

            var isCleanSymbol = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(grepPattern);

            // Strategy 1: exact name match (case-sensitive)
            if (isCleanSymbol && !_searchStop[grepPattern.toLowerCase()]) {
              var row = db.prepare(
                'SELECT n.name, n.file_path, n.start_line FROM nodes n ' +
                'WHERE n.name = ? AND n.label NOT IN (\'Concept\',\'Community\',\'Folder\') ' +
                'AND n.file_path IS NOT NULL AND n.file_path NOT LIKE \'%.md\' LIMIT 1'
              ).get(grepPattern);
              if (row) {
                graphResolved = true;
                var hint = row.file_path + (row.start_line != null ? ':' + row.start_line : '');
                console.log('[MONOGRAPH_HINT] ' + grepPattern + ' found at ' + hint);
              }
            }

            // Strategy 2: case-insensitive name match (uses COLLATE NOCASE index)
            if (!graphResolved && isCleanSymbol && !_searchStop[grepPattern.toLowerCase()]) {
              var row = db.prepare(
                'SELECT n.name, n.file_path, n.start_line FROM nodes n ' +
                'WHERE n.name = ? COLLATE NOCASE AND n.label NOT IN (\'Concept\',\'Community\',\'Folder\') ' +
                'AND n.file_path IS NOT NULL AND n.file_path NOT LIKE \'%.md\' LIMIT 1'
              ).get(grepPattern);
              if (row) {
                graphResolved = true;
                var hint = row.file_path + (row.start_line != null ? ':' + row.start_line : '');
                console.log('[MONOGRAPH_HINT] ' + row.name + ' found at ' + hint);
              }
            }

            // Strategy 3: dotted filename (db.ts, orchestrator.ts) → File node lookup
            if (!graphResolved && /^[a-zA-Z0-9_-]+\.[a-z]{1,4}$/.test(grepPattern)) {
              var row = db.prepare(
                'SELECT n.name, n.file_path FROM nodes n WHERE n.name = ? AND n.label = \'File\' LIMIT 1'
              ).get(grepPattern);
              if (row) {
                graphResolved = true;
                console.log('[MONOGRAPH_HINT] file ' + grepPattern + ' found at ' + row.file_path);
              }
            }

            // Strategy 4: file path fragment (hyphenated: "scope-resolution")
            if (!graphResolved && /^[a-zA-Z0-9_-]+(\.[a-zA-Z]+)?$/.test(grepPattern)
                && grepPattern.length >= 5 && grepPattern.indexOf('-') !== -1) {
              var pathLike = '%/' + grepPattern + '%';
              var row = db.prepare(
                'SELECT n.file_path FROM nodes n WHERE n.label = \'File\' AND n.file_path LIKE ? LIMIT 1'
              ).get(pathLike);
              if (row) {
                graphResolved = true;
                console.log('[MONOGRAPH_HINT] file ' + grepPattern + ' found at ' + row.file_path);
              }
            }

            // Strategy 5: extract ≥4-char identifiers, case-insensitive match
            if (!graphResolved) {
              var identifiers = grepPattern.match(/[a-zA-Z_$][a-zA-Z0-9_$]{3,}/g) || [];
              var tried = {};
              for (var sj = 0; sj < identifiers.length && !graphResolved; sj++) {
                var id = identifiers[sj];
                if (_searchStop[id.toLowerCase()] || tried[id.toLowerCase()]) continue;
                tried[id.toLowerCase()] = 1;
                var row2 = db.prepare(
                  'SELECT n.name, n.file_path, n.start_line FROM nodes n ' +
                  'WHERE n.name = ? COLLATE NOCASE AND n.label NOT IN (\'Concept\',\'Community\',\'Folder\') ' +
                  'AND n.file_path IS NOT NULL AND n.file_path NOT LIKE \'%.md\' LIMIT 1'
                ).get(id);
                if (row2) {
                  graphResolved = true;
                  var hint2 = row2.file_path + (row2.start_line != null ? ':' + row2.start_line : '');
                  console.log('[MONOGRAPH_HINT] ' + row2.name + ' found at ' + hint2);
                }
              }
            }

            // Strategy 6: FTS5 trigram substring match (catches partial/compound names)
            if (!graphResolved && grepPattern.length >= 4) {
              try {
                var ftsQ = '"' + grepPattern.replace(/"/g, '""') + '"';
                var ftsRow = db.prepare(
                  'SELECT n.name, n.file_path, n.start_line FROM nodes_fts f ' +
                  'JOIN nodes n ON n.rowid = f.rowid ' +
                  'WHERE nodes_fts MATCH ? ' +
                  'AND n.label NOT IN (\'Concept\',\'Community\',\'Folder\') ' +
                  'AND n.file_path IS NOT NULL AND n.file_path NOT LIKE \'%.md\' LIMIT 1'
                ).get(ftsQ);
                if (ftsRow) {
                  graphResolved = true;
                  var ftsHint = ftsRow.file_path + (ftsRow.start_line != null ? ':' + ftsRow.start_line : '');
                  console.log('[MONOGRAPH_HINT] ' + ftsRow.name + ' found at ' + ftsHint);
                }
              } catch (e) { /* FTS table may not exist */ }
            }

            // Strategy 7: dotted property access (ctx.allFilesCached, cache.hashFile)
            if (!graphResolved && grepPattern.indexOf('.') !== -1 && /^[a-zA-Z_$]/.test(grepPattern)) {
              var dotParts = grepPattern.split('.').filter(function(p) { return p.length >= 4 && /^[a-zA-Z_$]/.test(p); });
              for (var di = dotParts.length - 1; di >= 0 && !graphResolved; di--) {
                var dp = dotParts[di];
                if (_searchStop[dp.toLowerCase()]) continue;
                var drow = db.prepare(
                  'SELECT n.name, n.file_path, n.start_line FROM nodes n ' +
                  'WHERE n.name = ? COLLATE NOCASE AND n.label NOT IN (\'Concept\',\'Community\',\'Folder\') ' +
                  'AND n.file_path IS NOT NULL AND n.file_path NOT LIKE \'%.md\' LIMIT 1'
                ).get(dp);
                if (drow) {
                  graphResolved = true;
                  var dhint = drow.file_path + (drow.start_line != null ? ':' + drow.start_line : '');
                  console.log('[MONOGRAPH_HINT] ' + drow.name + ' found at ' + dhint);
                }
              }
            }

            // Strategy 8: snake_case → camelCase conversion
            if (!graphResolved && grepPattern.indexOf('_') !== -1 && /^[a-z]/.test(grepPattern) && grepPattern.length >= 6) {
              var camel = grepPattern.replace(/_([a-z])/g, function(_, c) { return c.toUpperCase(); });
              if (camel !== grepPattern && !_searchStop[camel.toLowerCase()]) {
                var crow = db.prepare(
                  'SELECT n.name, n.file_path, n.start_line FROM nodes n ' +
                  'WHERE n.name = ? COLLATE NOCASE AND n.label NOT IN (\'Concept\',\'Community\',\'Folder\') ' +
                  'AND n.file_path IS NOT NULL AND n.file_path NOT LIKE \'%.md\' LIMIT 1'
                ).get(camel);
                if (crow) {
                  graphResolved = true;
                  var chint = crow.file_path + (crow.start_line != null ? ':' + crow.start_line : '');
                  console.log('[MONOGRAPH_HINT] ' + crow.name + ' found at ' + chint);
                }
              }
            }
          } catch (e) { /* non-fatal */ }
        }
      }
    } catch (e) { /* non-fatal */ }

    if (graphResolved) {
      _recordGraphTelemetry('graph_assist_search');
    } else if (tool === 'Grep') {
      _recordGraphTelemetry('grep_call');
    } else if (tool === 'Glob') {
      _recordGraphTelemetry('glob_call');
    }
  },

  'post-graph-tool': () => {
    // Record monograph MCP tool calls as graph wins
    _recordGraphTelemetry('monograph_call');
    var sessIdGate = String((hCtx.hookInput && (hCtx.hookInput.sessionId || hCtx.hookInput.session_id)) || '');
    _graphGateMarkQueried(sessIdGate);
  },

  'graph-status': () => {
    const h = require('./handlers/graph-status-handler.cjs');
    h.handle(hCtx);
  },

  'budget-status': () => {
    const h = require('./handlers/budget-status-handler.cjs');
    h.handle(hCtx);
  },

  'loops-status': () => {
    const h = require('./handlers/loops-status-handler.cjs');
    h.handle(hCtx);
  },

  'stats': async () => {
    const h = require('./handlers/stats-handler.cjs');
    await h.handle(hCtx);
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
    console.log('Usage: hook-handler.cjs <route|pre-bash|pre-search|post-edit|post-graph-tool|session-restore|session-end|pre-task|post-task|compact-manual|compact-auto|stats>');
  }
}

// Only run when executed directly (every real hook event spawns this file as a
// process). A require() — e.g. from tests verifying it loads — must not exit.
if (require.main === module) {
  main().catch(function(e) {
    console.log('[WARN] Hook handler error: ' + e.message);
  }).finally(function() {
    // Use process.exitCode if a gate set it (exit 2 = block), otherwise clean exit
    process.exit(process.exitCode || 0);
  });
}
