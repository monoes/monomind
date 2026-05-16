#!/usr/bin/env node
/**
 * Monomind Hook Handler (Cross-Platform)
 * Dispatches hook events to the appropriate helper modules.
 */

const path = require('path');
const fs = require('fs');

const helpersDir = __dirname;
const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Resolve @monoes/monograph — it lives in pnpm's virtual store, not a named symlink.
// Try common locations; fall back gracefully so all hooks remain non-fatal.
function _requireMonograph() {
  var candidates = [
    path.join(CWD, 'node_modules/.pnpm/node_modules/@monoes/monograph'),
    path.join(CWD, 'packages/node_modules/.pnpm/node_modules/@monoes/monograph'),
    path.join(CWD, 'node_modules/@monoes/monograph'),
  ];
  for (var i = 0; i < candidates.length; i++) {
    try { if (fs.existsSync(candidates[i])) return require(candidates[i]); } catch(e) {}
  }
  try { return require('@monoes/monograph'); } catch(e) {}
  return null;
}

// ── LearningService module-level singleton ─────────────────────────────────────
// Singleton contract: one LearningService instance is created per hook-handler
// process. initialize() opens the SQLite DB; consolidate() is called at
// session-end. Hoisting to module scope ensures the DB is not reopened on every
// session-end invocation (which would create a fresh in-memory-only instance
// each time, discarding any state accumulated during the session).
var _learningService = null;
async function getLearningService() {
  if (!_learningService) {
    try {
      var lsMod = await import('file://' + path.join(__dirname, 'learning-service.mjs'));
      var LearningService = lsMod.LearningService || (lsMod.default && lsMod.default.LearningService);
      if (LearningService) {
        _learningService = new LearningService();
        await _learningService.initialize();
      }
    } catch (e) {
      _learningService = null; // reset so next call retries
      throw e;
    }
  }
  return _learningService;
}

// ── Monograph LLM-context helpers ──────────────────────────────────────────────
// Used by route (pre-resolve), pre-search (Grep/Glob redirect), and post-read
// (neighbor footer). All calls are best-effort; failures are silent.

// Memoized at module scope — opening a multi-GB monograph.db can take 7-10s,
// and we call this 3+ times per route hook. Cache for the lifetime of this
// hook process. Callers should NOT close the returned handle.
var _cachedMonographDb = undefined;
function _openMonographDb() {
  if (_cachedMonographDb !== undefined) return _cachedMonographDb;
  try {
    var dbPath = path.join(CWD, '.monomind', 'monograph.db');
    if (!fs.existsSync(dbPath)) { _cachedMonographDb = null; return null; }
    var mod = _requireMonograph();
    if (!mod || !mod.openDb) { _cachedMonographDb = null; return null; }
    _cachedMonographDb = mod.openDb(dbPath);
    return _cachedMonographDb;
  } catch (e) { _cachedMonographDb = null; return null; }
}

function getMonographSuggestions(taskText, limit) {
  if (!taskText || typeof taskText !== "string") return [];
  var db = _openMonographDb();
  if (!db) return [];
  try {
    var words = String(taskText).toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || [];
    var stop = { "this":1,"that":1,"with":1,"from":1,"have":1,"into":1,"their":1,"what":1,"when":1,"where":1,"which":1,"should":1,"would":1,"could":1,"make":1,"just":1,"also":1,"them":1,"they":1,"will":1,"been":1,"were":1,"because":1,"about":1,"does":1,"work":1,"else":1,"more":1,"some":1,"like":1,"need":1,"want":1,"used":1,"using":1,"please":1,"thanks":1,"good":1,"great":1,"nice":1,"thing":1,"things":1,"better":1,"again":1,"first":1,"then":1,"only":1,"even":1 };
    var uniq = {};
    for (var i = 0; i < words.length; i++) if (!stop[words[i]]) uniq[words[i]] = 1;
    var keys = Object.keys(uniq).slice(0, 8);
    // Smart filter: free-form prompts need ≥2 content words to avoid noise.
    // Single-word inputs are allowed only when they look like a symbol/search
    // (entire string is ≤30 chars and contains letters+separators only).
    var isSymbolLookup = taskText.length <= 30 && /^[a-zA-Z0-9_\-./:]+$/.test(taskText.trim());
    if (keys.length === 0) return [];
    if (keys.length < 2 && !isSymbolLookup) return [];

    var ftsQuery = keys.map(function(k){ return '"' + k.replace(/"/g, "") + '"'; }).join(" OR ");
    var lim = Math.max(1, limit || 5);
    var rows = [];
    try {
      // BM25 ranks better than degree for keyword relevance; tie-break by deg.
      // File/Function/Class outrank Section so navigable nodes win.
      // Filter out anonymous lambdas, arrow expressions, and other unnamed
      // garbage that the AST extraction picks up but isn't navigable.
      rows = db.prepare(
        "SELECT n.id, n.name, n.label, n.file_path AS file, " +
        "bm25(nodes_fts) AS bm25_score, " +
        "(SELECT COUNT(*) FROM edges WHERE source_id=n.id OR target_id=n.id) AS deg, " +
        "CASE n.label WHEN 'File' THEN 3 WHEN 'Function' THEN 3 WHEN 'Class' THEN 3 " +
        "             WHEN 'Method' THEN 2 WHEN 'Interface' THEN 2 ELSE 1 END AS label_rank " +
        "FROM nodes_fts f JOIN nodes n ON f.rowid = n.rowid " +
        "WHERE nodes_fts MATCH ? AND n.file_path IS NOT NULL AND n.file_path != '' " +
        "AND n.label NOT IN ('Concept') " +
        "AND n.name NOT LIKE '(%' AND n.name NOT LIKE '%=>%' AND n.name != 'function' " +
        "AND length(n.name) >= 3 " +
        "ORDER BY label_rank DESC, bm25_score ASC, deg DESC LIMIT ?"
      ).all(ftsQuery, lim);
    } catch (e) {
      var likeFrag = keys.map(function(){ return "lower(n.name) LIKE ?"; }).join(" OR ");
      var likeArgs = keys.map(function(k){ return "%" + k + "%"; });
      var stmt = db.prepare(
        "SELECT n.id, n.name, n.label, n.file_path AS file, " +
        "(SELECT COUNT(*) FROM edges WHERE source_id=n.id OR target_id=n.id) AS deg " +
        "FROM nodes n WHERE (" + likeFrag + ") AND n.file_path IS NOT NULL AND n.file_path != '' " +
        "AND n.label NOT IN ('Concept') " +
        "ORDER BY deg DESC LIMIT ?"
      );
      rows = stmt.all.apply(stmt, likeArgs.concat([lim]));
    }
    return rows || [];
  } catch (e) { return []; }
  finally { /* db is shared/cached; do not close */ }
}

function getMonographNeighbors(filePath) {
  if (!filePath) return null;
  var db = _openMonographDb();
  if (!db) return null;
  try {
    var rel = filePath;
    if (filePath.indexOf(CWD) === 0) rel = filePath.slice(CWD.length + 1);
    var node = db.prepare(
      "SELECT id, name FROM nodes WHERE label='File' AND (file_path=? OR file_path=? OR name=? OR name=?) LIMIT 1"
    ).get(filePath, rel, filePath, rel);
    if (!node) return null;

    var imports = db.prepare(
      "SELECT DISTINCT n.name FROM edges e JOIN nodes n ON e.target_id = n.id " +
      "WHERE e.source_id=? AND e.relation IN ('IMPORTS','CALLS','DEPENDS_ON','CONTAINS','DEFINES') " +
      "AND n.file_path IS NOT NULL AND n.file_path != '' LIMIT 6"
    ).all(node.id).map(function(r){ return r.name; });
    var importedBy = db.prepare(
      "SELECT DISTINCT n.name FROM edges e JOIN nodes n ON e.source_id = n.id " +
      "WHERE e.target_id=? AND e.relation IN ('IMPORTS','CALLS','DEPENDS_ON','CONTAINS','DEFINES') " +
      "AND n.file_path IS NOT NULL AND n.file_path != '' LIMIT 6"
    ).all(node.id).map(function(r){ return r.name; });

    return { imports: imports, importedBy: importedBy };
  } catch (e) { return null; }
  finally { /* db is shared/cached; do not close */ }
}

// Rough per-event token + USD cost estimates. Tuned to Sonnet input pricing
// ($3/M tokens) — adjust if needed. Used by the statusline to surface savings.
var _TOKEN_PER_EVENT = {
  monograph_call:  300,   // typical monograph_query result size
  grep_call:      2000,   // typical Grep tool output across many files
  glob_call:       800,
  bash_grep_call: 2000,
  bash_find_call:  800,
};
var _DOLLAR_PER_1M_TOKENS = 3.0;

function _recordGraphTelemetry(event) {
  try {
    var metricsDir = path.join(CWD, ".monomind", "metrics");
    var f = path.join(metricsDir, "graph-usage.json");
    fs.mkdirSync(metricsDir, { recursive: true });
    var d = {};
    try { d = JSON.parse(fs.readFileSync(f, "utf-8")); } catch (e) {}
    if (typeof d !== "object" || d === null) d = {};
    d[event] = (d[event] || 0) + 1;

    // Token-saved estimator: each monograph_call avoids a grep equivalent
    // (~2000 tokens) at a cost of ~300 tokens — net ~1700 saved.
    if (event === 'monograph_call') {
      var saved = (_TOKEN_PER_EVENT.grep_call - _TOKEN_PER_EVENT.monograph_call);
      d.tokens_saved = (d.tokens_saved || 0) + saved;
      d.dollars_saved = ((d.tokens_saved / 1000000) * _DOLLAR_PER_1M_TOKENS);
    }
    // Each unprompted grep/bash_grep "wastes" the same amount vs the graph alternative.
    if (event === 'grep_call' || event === 'bash_grep_call') {
      var wasted = (_TOKEN_PER_EVENT.grep_call - _TOKEN_PER_EVENT.monograph_call);
      d.tokens_wasted = (d.tokens_wasted || 0) + wasted;
    }

    d.lastUpdated = Date.now();
    fs.writeFileSync(f, JSON.stringify(d));
  } catch (e) { /* non-fatal */ }
}

// Re-inject graph context after compaction so the LLM doesn't lose its spatial map.
// Prefers recently-edited files (session context) over pure degree centrality so
// the injected anchors match what the LLM was actually working on.
function _injectCompactGraphMap() {
  try {
    var db = _openMonographDb();
    if (!db) return;
    try {
      var nodeC = db.prepare("SELECT COUNT(*) AS c FROM nodes").get().c;
      var anchors = [];
      var seenPaths = {};

      // 1. Prefer recently-edited files (up to 5) — these are what matters NOW.
      var recentEdits = _getRecentEdits();
      for (var ri = 0; ri < Math.min(recentEdits.length, 5); ri++) {
        var rfile = recentEdits[ri].file;
        // Normalise to relative path for DB lookup
        var rrel = (rfile.indexOf(CWD) === 0) ? rfile.slice(CWD.length + 1) : rfile;
        try {
          var rnode = db.prepare(
            "SELECT n.name, n.label, n.file_path, " +
            "(SELECT COUNT(*) FROM edges WHERE source_id=n.id OR target_id=n.id) AS deg " +
            "FROM nodes n WHERE n.label='File' AND (n.file_path=? OR n.file_path=?) LIMIT 1"
          ).get(rfile, rrel);
          if (rnode && !seenPaths[rnode.file_path]) {
            seenPaths[rnode.file_path] = 1;
            anchors.push({ name: rnode.name, label: rnode.label, file_path: rnode.file_path, deg: rnode.deg, tag: '✎' });
          }
        } catch (e) { /* ignore — file may not be in graph yet */ }
      }

      // 2. Fill remaining slots (up to 8 total) with god nodes (high centrality).
      // Exclude node_modules paths (external typings like `Path [Interface]` skew rankings).
      if (anchors.length < 8) {
        var gods = db.prepare(
          "SELECT n.name, n.label, n.file_path, " +
          "(SELECT COUNT(*) FROM edges WHERE source_id=n.id OR target_id=n.id) AS deg " +
          "FROM nodes n " +
          "WHERE n.label NOT IN ('Concept') AND n.file_path IS NOT NULL AND n.file_path != '' " +
          "AND n.file_path NOT LIKE '%/node_modules/%' AND n.file_path NOT LIKE '%node_modules%' " +
          "AND n.name NOT LIKE '(%' AND n.name NOT LIKE '%=>%' AND length(n.name) >= 3 " +
          "ORDER BY deg DESC LIMIT 15"
        ).all();
        for (var gi = 0; gi < gods.length && anchors.length < 8; gi++) {
          if (!seenPaths[gods[gi].file_path]) {
            seenPaths[gods[gi].file_path] = 1;
            anchors.push({ name: gods[gi].name, label: gods[gi].label, file_path: gods[gi].file_path, deg: gods[gi].deg, tag: '' });
          }
        }
      }

      if (anchors.length > 0) {
        console.log('[COMPACT_GRAPH] ' + nodeC + ' nodes. Session context (✎ = recently edited):');
        for (var ci = 0; ci < anchors.length; ci++) {
          var g = anchors[ci];
          console.log('  ' + (g.tag || ' ') + ' ' + g.name + ' [' + g.label + '] — ' + g.file_path + ' (deg ' + g.deg + ')');
        }
        console.log('  Use mcp__monomind__monograph_suggest first when navigating.');
      }
    } finally { /* db is shared/cached; do not close */ }
  } catch (e) {}
}

// ── Recent edit history ────────────────────────────────────────────────────────
// Track last N edited file paths so compact injection and pre-resolve can surface
// the files the LLM was actively working on instead of pure centrality anchors.
function _recordRecentEdit(filePath) {
  if (!filePath) return;
  try {
    var f = path.join(CWD, '.monomind', 'metrics', 'recent-edits.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    var d = { edits: [] };
    try { d = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch (_) {}
    if (!Array.isArray(d.edits)) d.edits = [];
    // Remove stale entry for same file, then prepend fresh one
    d.edits = d.edits.filter(function(e) { return e.file !== filePath; });
    d.edits.unshift({ file: filePath, editedAt: Date.now() });
    if (d.edits.length > 10) d.edits = d.edits.slice(0, 10);
    fs.writeFileSync(f, JSON.stringify(d));
  } catch (e) { /* non-fatal */ }
}

function _getRecentEdits() {
  try {
    var f = path.join(CWD, '.monomind', 'metrics', 'recent-edits.json');
    if (!fs.existsSync(f)) return [];
    var d = JSON.parse(fs.readFileSync(f, 'utf-8'));
    if (!Array.isArray(d.edits)) return [];
    // Only return edits from the last 2 hours (session-scoped)
    var cutoff = Date.now() - 2 * 60 * 60 * 1000;
    return d.edits.filter(function(e) { return e.editedAt > cutoff; });
  } catch (e) { return []; }
}

// ── Loop drift detection ───────────────────────────────────────────────────────
// Record tool call signatures per session, warn when the same call recurs ≥3×.
function _recordToolCall(signature) {
  try {
    var f = path.join(CWD, '.monomind', 'metrics', 'tool-calls.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    var d = {};
    try { d = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch (_) {}
    if (typeof d !== 'object' || d === null) d = {};
    // Roll over every 4 hours (new session)
    if (!d.startedAt || (Date.now() - d.startedAt) > 4 * 60 * 60 * 1000) {
      d = { startedAt: Date.now(), calls: {} };
    }
    d.calls[signature] = (d.calls[signature] || 0) + 1;
    fs.writeFileSync(f, JSON.stringify(d));
    return d.calls[signature];
  } catch (e) { return 0; }
}

// ── Cost budget ────────────────────────────────────────────────────────────────
// Read today's cost from token-summary and compare against budget ceiling.
// If no budget.json exists, auto-tune from 30-day rolling mean (1.5x) so we
// don't shout BUDGET_BREACHED at users whose normal spend is above the default.
function _getBudgetStatus() {
  try {
    var budgetFile = path.join(CWD, '.monomind', 'budget.json');
    var summaryFile = path.join(CWD, '.monomind', 'metrics', 'token-summary.json');
    if (!fs.existsSync(summaryFile)) return null;
    var summary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
    var todayCost = summary.todayCost || (summary.today && summary.today.cost) || 0;
    var monthCost = summary.monthCost || (summary.month && summary.month.cost) || 0;

    var dailyLimit, monthlyLimit, autoTuned = false;
    if (fs.existsSync(budgetFile)) {
      try {
        var b = JSON.parse(fs.readFileSync(budgetFile, 'utf-8'));
        dailyLimit = b.dailyLimit;
        monthlyLimit = b.monthlyLimit;
      } catch (_) {}
    }

    // Auto-tune: monthCost / daysSoFar = avg daily; 1.5x that = limit.
    // Only auto-tune when we actually have 7+ days of data and no manual budget.
    if (!dailyLimit || !monthlyLimit) {
      var now = new Date();
      var daysIntoMonth = now.getUTCDate();
      var dailyAvg = daysIntoMonth >= 1 ? monthCost / daysIntoMonth : 0;
      if (dailyAvg > 5 && daysIntoMonth >= 7) {
        dailyLimit  = Math.max(dailyLimit  || 0, Math.ceil(dailyAvg * 1.5));
        monthlyLimit = Math.max(monthlyLimit || 0, Math.ceil(dailyAvg * 1.5 * 30));
        autoTuned = true;
        // Persist so future runs are stable and the user can edit.
        try {
          fs.mkdirSync(path.dirname(budgetFile), { recursive: true });
          fs.writeFileSync(budgetFile, JSON.stringify({
            dailyLimit: dailyLimit,
            monthlyLimit: monthlyLimit,
            autoTuned: true,
            tunedAt: now.toISOString(),
            basis: 'rolling avg $' + dailyAvg.toFixed(2) + '/day × 1.5',
            note: 'Edit these values to set a hard ceiling. Delete the file to re-tune.',
          }, null, 2));
        } catch (_) {}
      } else {
        // Fall back to sensible defaults when there's not enough history.
        dailyLimit = dailyLimit || 50;
        monthlyLimit = monthlyLimit || 1500;
      }
    }

    var dailyPct = Math.round((todayCost / dailyLimit) * 100);
    var monthlyPct = Math.round((monthCost / monthlyLimit) * 100);

    // Spike detection: today is >2x the rolling daily avg (suspicious activity)
    var rollingDaily = (new Date()).getUTCDate() >= 1 ? monthCost / (new Date()).getUTCDate() : 0;
    var spike = rollingDaily > 0 && todayCost > rollingDaily * 2.0 && todayCost > 5;

    return {
      todayCost: todayCost, monthCost: monthCost,
      dailyLimit: dailyLimit, monthlyLimit: monthlyLimit,
      dailyPct: dailyPct, monthlyPct: monthlyPct,
      autoTuned: autoTuned,
      spike: spike,
      // Alert only when either the limit is breached OR there's a real spike
      alert: dailyPct >= 80 || monthlyPct >= 80 || spike,
      breached: dailyPct >= 100 || monthlyPct >= 100,
    };
  } catch (e) { return null; }
}

// ── Test feedback (detection only — do not auto-run) ──────────────────────────
// When LLM edits a source file, find tests that import it via monograph and
// surface the list so the LLM (or user) knows what to verify.
function _findAffectedTests(filePath) {
  if (!filePath) return [];
  var db = _openMonographDb();
  if (!db) return [];
  try {
    var rel = filePath;
    if (filePath.indexOf(CWD) === 0) rel = filePath.slice(CWD.length + 1);
    // Find tests that IMPORTS any symbol whose target file_path matches our file.
    // The graph stores IMPORTS edges to symbol nodes, not file nodes — so we
    // match on the target node's file_path field instead of target_id directly.
    var rows = db.prepare(
      "SELECT DISTINCT src.file_path FROM edges e " +
      "JOIN nodes src ON e.source_id = src.id " +
      "JOIN nodes tgt ON e.target_id = tgt.id " +
      "WHERE e.relation IN ('IMPORTS','CALLS','DEPENDS_ON') " +
      "AND (tgt.file_path = ? OR tgt.file_path = ?) " +
      "AND src.file_path IS NOT NULL AND src.file_path != '' " +
      "AND (src.file_path LIKE '%test%' OR src.file_path LIKE '%.spec.%' OR src.file_path LIKE '%__tests__%') " +
      "AND src.file_path NOT LIKE '%.worktrees%' " +
      "LIMIT 5"
    ).all(filePath, rel);
    return rows.map(function(r) { return r.file_path; });
  } catch (e) { return []; }
  finally { /* db is shared/cached; do not close */ }
}

// ── Hook latency tracking ─────────────────────────────────────────────────────
function _recordHookLatency(handlerName, durationMs) {
  try {
    var f = path.join(CWD, '.monomind', 'metrics', 'hook-latency.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    var d = {};
    try { d = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch (_) {}
    if (typeof d !== 'object' || d === null) d = {};
    var entry = d[handlerName] || { count: 0, total: 0, max: 0 };
    entry.count++;
    entry.total += durationMs;
    entry.max = Math.max(entry.max, durationMs);
    entry.mean = Math.round(entry.total / entry.count);
    d[handlerName] = entry;
    d.lastUpdated = Date.now();
    fs.writeFileSync(f, JSON.stringify(d));
  } catch (e) {}
}

// ── Auto-ADR decision detection ───────────────────────────────────────────────
// Record sentence-level decision markers from user prompts to .monomind/decisions.jsonl
function _recordDecisionMarkers(promptText) {
  if (!promptText || typeof promptText !== 'string') return;
  var markers = /\b(let's go with|we (?:chose|decided|picked|will go with)|decision[:\s]|choosing|going with|prefer to|let's use)\b[^\.\n]{0,200}/gi;
  var matches = promptText.match(markers);
  if (!matches || matches.length === 0) return;
  try {
    var f = path.join(CWD, '.monomind', 'decisions.jsonl');
    var entry = JSON.stringify({
      ts: Date.now(),
      excerpts: matches.slice(0, 3),
      prompt: promptText.slice(0, 400),
    });
    fs.appendFileSync(f, entry + '\n');
  } catch (e) {}
}

// Auto-rebuild the monograph after N writes — graph staleness during heavy
// editing is the main reason suggestions go cold. Triggered by post-edit.
function _maybeRebuildMonograph() {
  try {
    var metricsDir = path.join(CWD, ".monomind", "metrics");
    fs.mkdirSync(metricsDir, { recursive: true });
    var f = path.join(metricsDir, "graph-rebuild.json");
    var d = {};
    try { d = JSON.parse(fs.readFileSync(f, "utf-8")); } catch (_) {}
    if (typeof d !== "object" || d === null) d = {};
    d.writesSinceRebuild = (d.writesSinceRebuild || 0) + 1;
    d.lastWriteAt = Date.now();
    var THRESHOLD = 20;
    var MIN_INTERVAL_MS = 5 * 60 * 1000; // never more often than every 5 min
    var dueByCount = d.writesSinceRebuild >= THRESHOLD;
    var dueByTime  = !d.lastRebuildAt || (Date.now() - d.lastRebuildAt) > MIN_INTERVAL_MS;
    if (dueByCount && dueByTime) {
      // Reset counter immediately so concurrent post-edits don't all fire.
      d.writesSinceRebuild = 0;
      d.lastRebuildAt = Date.now();
      fs.writeFileSync(f, JSON.stringify(d));
      // Fire-and-forget background freshen script (same one used by SessionStart).
      try {
        var freshenScript = path.join(CWD, '.claude', 'helpers', 'graphify-freshen.cjs');
        if (fs.existsSync(freshenScript)) {
          var spawn = require('child_process').spawn;
          var child = spawn(process.execPath, [freshenScript], {
            detached: true,
            stdio: 'ignore',
            cwd: CWD,
          });
          child.unref();
        }
      } catch (_) {}
    } else {
      fs.writeFileSync(f, JSON.stringify(d));
    }
  } catch (e) { /* non-fatal */ }
}

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

const router = safeRequire(path.join(helpersDir, 'router.cjs'));
const session = safeRequire(path.join(helpersDir, 'session.cjs'));
const memory = safeRequire(path.join(helpersDir, 'memory.cjs'));
const intelligence = safeRequire(path.join(helpersDir, 'intelligence.cjs'));

// Module-level reference to @monomind/hooks — populated at session-restore,
// then used by pre-task / post-task to bridge into the hook registry (Tasks 26, 39).
let _hooksModule = null;

// ── MicroAgent Trigger Scanner (Task 32) ────────────────────────────────────
function _triggerExtractYamlValue(raw) {
  var v = raw.trim();
  if (v.startsWith('"') && v.endsWith('"')) {
    // YAML double-quoted: unescape \\ → \ so regex patterns like "\\b" become \b (word boundary)
    v = v.slice(1, -1).replace(/\\\\/g, '\\');
  } else if (v.startsWith("'") && v.endsWith("'")) {
    v = v.slice(1, -1);
  }
  return v;
}

function _triggerFinalize(partial, agentSlug) {
  return { pattern: partial.pattern, mode: partial.mode || 'inject', priority: partial.priority || 0, agentSlug: agentSlug };
}

function _triggerExtractFromFrontmatter(content, agentSlug) {
  var fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return [];
  var block = fmMatch[1];
  var triggers = [];
  var lines = block.split('\n');
  var inTriggers = false;
  var cur = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();
    var indent = line.length - line.trimStart().length;
    if (trimmed === 'triggers:' || trimmed.startsWith('triggers:')) { inTriggers = true; continue; }
    if (inTriggers && indent === 0 && /^[a-zA-Z]/.test(trimmed)) {
      inTriggers = false;
      if (cur && cur.pattern) triggers.push(_triggerFinalize(cur, agentSlug));
      cur = null; continue;
    }
    if (!inTriggers) continue;
    if (trimmed.startsWith('- pattern:')) {
      if (cur && cur.pattern) triggers.push(_triggerFinalize(cur, agentSlug));
      cur = { pattern: _triggerExtractYamlValue(trimmed.replace(/^- pattern:\s*/, '')), agentSlug: agentSlug };
    } else if (cur && trimmed.startsWith('mode:')) {
      var mv = _triggerExtractYamlValue(trimmed.replace(/^mode:\s*/, ''));
      if (mv === 'inject' || mv === 'takeover') cur.mode = mv;
    } else if (cur && trimmed.startsWith('priority:')) {
      var pv = parseInt(trimmed.replace(/^priority:\s*/, ''), 10);
      if (!isNaN(pv)) cur.priority = pv;
    }
  }
  if (cur && cur.pattern) triggers.push(_triggerFinalize(cur, agentSlug));
  return triggers;
}

function _triggerCollectMdFiles(dir) {
  var results = [];
  try {
    var entries = fs.readdirSync(dir);
    for (var i = 0; i < entries.length; i++) {
      var full = path.join(dir, entries[i]);
      try {
        var st = fs.lstatSync(full);
        if (st.isDirectory()) results = results.concat(_triggerCollectMdFiles(full));
        else if (entries[i].endsWith('.md')) results.push(full);
      } catch (e) {}
    }
  } catch (e) {}
  return results;
}

function _triggerBuildIndex(agentDir) {
  var patterns = [];
  var files = _triggerCollectMdFiles(agentDir);
  for (var i = 0; i < files.length; i++) {
    var content;
    try { content = fs.readFileSync(files[i], 'utf-8'); } catch (e) { continue; }
    var slug = files[i].split('/').pop().replace(/\.md$/i, '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    patterns = patterns.concat(_triggerExtractFromFrontmatter(content, slug));
  }
  return patterns;
}

function scanMicroAgentTriggers(prompt) {
  if (!prompt || typeof prompt !== 'string') return { matches: [], injectAgents: [] };
  var indexPath = path.join(CWD, '.monomind', 'trigger-index.json');
  var agentDir = path.join(CWD, '.claude', 'agents');
  var patterns = [];
  var cacheLoaded = false;

  // Load cached index if fresh (< 1 hour)
  try {
    if (fs.existsSync(indexPath)) {
      var idx = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      var age = Date.now() - new Date(idx.builtAt || 0).getTime();
      if (age < 3600000 && Array.isArray(idx.patterns)) {
        patterns = idx.patterns;
        cacheLoaded = true;  // valid even when empty (no triggers defined)
      }
    }
  } catch (e) {}

  // Rebuild only when cache is missing or stale — not when it's a valid empty result
  if (!cacheLoaded) {
    patterns = _triggerBuildIndex(agentDir);
    try {
      fs.mkdirSync(path.join(CWD, '.monomind'), { recursive: true });
      fs.writeFileSync(indexPath, JSON.stringify({ patterns: patterns, builtAt: new Date().toISOString(), totalAgentsScanned: patterns.length }));
    } catch (e) {}
  }

  // Sort by descending priority
  patterns.sort(function(a, b) { return (b.priority || 0) - (a.priority || 0); });

  // Apply patterns
  var matches = [];
  var seen = {};
  for (var i = 0; i < patterns.length; i++) {
    var p = patterns[i];
    if (p.mode !== 'inject' && p.mode !== 'takeover') continue;
    if (seen[p.agentSlug]) continue;
    try {
      var re = new RegExp(p.pattern, 'i');
      var m = re.exec(prompt);
      if (m) {
        seen[p.agentSlug] = true;
        matches.push({ agentSlug: p.agentSlug, mode: p.mode, matchedText: m[0] });
        if (p.mode === 'takeover') {
          return { matches: matches, takeoverAgent: p.agentSlug, injectAgents: [] };
        }
      }
    } catch (e) {}
  }
  return { matches: matches, injectAgents: matches.map(function(m) { return m.agentSlug; }) };
}

// ── Task 28: Knowledge Base — inline CJS search + auto-indexer ─────────────
//
// Purpose: give KnowledgeRetriever a real search function and pre-populate
// the knowledge store with project documents (CLAUDE.md, todo.md, etc.) so
// retrieveForTask() actually returns useful context on session restore.
// No compiled deps required — reads/writes JSONL directly.

/**
 * Build a simple keyword-overlap search function over chunks.jsonl.
 * Returns results sorted by descending score; compatible with SearchFn signature.
 */
var _KNOWLEDGE_STOPWORDS = new Set(['the','and','or','but','if','in','on','to','is','it','be','do','of','for','not','at','by','as','we','us','an','a','i']);

function _buildKnowledgeSearchFn(knowledgeDir) {
  return async function(query, opts) {
    var chunksFile = path.join(knowledgeDir, 'chunks.jsonl');
    if (!fs.existsSync(chunksFile)) return [];
    var lines;
    try {
      lines = fs.readFileSync(chunksFile, 'utf-8').trim().split('\n').filter(Boolean);
    } catch (e) { return []; }

    var ns = (opts && opts.namespace) || null;
    var limit = (opts && opts.limit) || 10;
    var minScore = (opts && opts.minScore != null) ? opts.minScore : 0.3;
    var queryTerms = query.toLowerCase().split(/\s+/).filter(function(t) { return t.length >= 2 && !_KNOWLEDGE_STOPWORDS.has(t); });
    if (queryTerms.length === 0) return [];

    var results = [];
    for (var i = 0; i < lines.length; i++) {
      try {
        var chunk = JSON.parse(lines[i]);
        if (ns && chunk.namespace !== ns) continue;
        var textLower = (chunk.text || '').toLowerCase();
        var matchCount = queryTerms.filter(function(t) { return textLower.includes(t); }).length;
        var score = matchCount / queryTerms.length;
        if (score >= minScore) {
          results.push({ key: chunk.chunkId, value: chunk.text, score: score, metadata: chunk.metadata || {} });
        }
      } catch (e) {}
    }
    results.sort(function(a, b) { return b.score - a.score; });
    return results.slice(0, limit);
  };
}

/**
 * Index project knowledge sources into chunks.jsonl.
 * Skips re-indexing if content hasn't changed (hash-gated).
 * Returns the number of new chunks written.
 */
function _autoIndexKnowledge(knowledgeDir) {
  var crypto = require('crypto');
  var sources = [
    { filePath: path.join(CWD, 'CLAUDE.md'), label: 'project-instructions' },
    { filePath: path.join(CWD, 'docs/todo.md'), label: 'project-todo' },
    { filePath: path.join(CWD, 'CLAUDE.local.md'), label: 'local-instructions' },
  ];

  // Compute a combined hash of all source file sizes (fast proxy for content change)
  var hashInput = '';
  for (var i = 0; i < sources.length; i++) {
    try {
      if (fs.existsSync(sources[i].filePath)) {
        var st = fs.statSync(sources[i].filePath);
        hashInput += sources[i].filePath + ':' + st.size + ':' + st.mtimeMs + ';';
      }
    } catch (e) {}
  }
  // Include monograph graph build time in hash so re-index happens after graph rebuild
  try {
    var statsForHash = JSON.parse(fs.readFileSync(path.join(CWD, '.monomind', 'graph', 'stats.json'), 'utf-8'));
    hashInput += 'monograph:' + (statsForHash.builtAt || 0) + ';';
  } catch(e) {}

  var contentHash = crypto.createHash('md5').update(hashInput).digest('hex');

  var chunksFile = path.join(knowledgeDir, 'chunks.jsonl');
  var hashFile = path.join(knowledgeDir, '.index-hash');
  var existingHash = '';
  try { existingHash = fs.readFileSync(hashFile, 'utf-8').trim(); } catch (e) {}

  // Nothing changed — skip re-index
  var existingChunkCount = 0;
  try { if (fs.existsSync(chunksFile)) { existingChunkCount = fs.readFileSync(chunksFile, 'utf-8').trim().split('\n').filter(Boolean).length; } } catch (e) {}
  if (existingHash === contentHash && existingChunkCount > 0) return 0;

  // Build new chunks
  var newLines = [];
  for (var si = 0; si < sources.length; si++) {
    var src = sources[si];
    try {
      if (!fs.existsSync(src.filePath)) continue;
      var content = fs.readFileSync(src.filePath, 'utf-8');
      // Split on blank lines or markdown headers (## / ###)
      var sections = content.split(/\n{2,}|\n(?=#{1,3} )/);
      for (var ci = 0; ci < sections.length; ci++) {
        var text = sections[ci].trim();
        if (text.length < 40 || text.length > 3000) continue;
        var chunkId = crypto.createHash('md5').update(src.filePath + ':' + ci).digest('hex').slice(0, 16);
        newLines.push(JSON.stringify({
          chunkId: chunkId,
          namespace: 'knowledge:shared',
          text: text,
          metadata: { filePath: src.filePath, label: src.label, chunkIndex: ci }
        }));
      }
    } catch (e) {}
  }

  // Inject monograph graph summary as a knowledge chunk.
  // Reads from .monomind/monograph.db (SQLite, source of truth) and falls
  // back to the legacy .monomind/graph/{stats,graph}.json pair only when
  // present (older installs).
  try {
    var mgDbPath2 = path.join(CWD, '.monomind', 'monograph.db');
    var legacyStats2 = path.join(CWD, '.monomind', 'graph', 'stats.json');
    var legacyGraph2 = path.join(CWD, '.monomind', 'graph', 'graph.json');

    var summaryText = null;
    var summaryMeta = {};

    if (fs.existsSync(mgDbPath2)) {
      try {
        var sumDb = _openMonographDb();
        if (sumDb) {
          try {
            var nodeC = sumDb.prepare('SELECT COUNT(*) AS c FROM nodes').get().c;
            var edgeC = sumDb.prepare('SELECT COUNT(*) AS c FROM edges').get().c;
            var topNodes2 = sumDb.prepare(
              'SELECT n.name, n.label, n.file_path, ' +
              '(SELECT COUNT(*) FROM edges WHERE source_id=n.id OR target_id=n.id) AS deg ' +
              'FROM nodes n WHERE n.file_path IS NOT NULL AND n.file_path != "" ORDER BY deg DESC LIMIT 15'
            ).all();
            var typeRows = sumDb.prepare(
              'SELECT label, COUNT(*) AS c FROM nodes GROUP BY label ORDER BY c DESC LIMIT 8'
            ).all();
            var typeStr = typeRows.map(function(r) { return r.label + ':' + r.c; }).join(', ');
            summaryText = [
              'MONOGRAPH KNOWLEDGE GRAPH SUMMARY',
              'Source: monograph.db | Nodes: ' + nodeC + ' | Edges: ' + edgeC,
              '',
              'TOP GOD NODES (highest connectivity — start exploration here):',
              topNodes2.map(function(n) {
                return '  ' + n.name + ' [' + n.label + '] — ' + (n.file_path || '') + ' (degree: ' + n.deg + ')';
              }).join('\n'),
              '',
              'NODE TYPE DISTRIBUTION: ' + typeStr,
              '',
              'Before grepping or globbing, prefer:',
              '  mcp__monomind__monograph_suggest({ task: "<your task>" }) — ranked relevant files',
              '  mcp__monomind__monograph_query({ q: "<symbol|keyword>" }) — BM25 search with file:line',
              '  mcp__monomind__monograph_impact({ name: "<file>" }) — upstream + downstream blast radius',
            ].join('\n');
            summaryMeta = { label: 'monograph-graph-summary', source: 'monograph.db', nodes: nodeC, edges: edgeC };
          } catch (e) { /* keep summaryText if partial */ }
        }
      } catch (e) { /* fall through to legacy */ }
    }

    if (!summaryText && fs.existsSync(legacyStats2) && fs.existsSync(legacyGraph2)) {
      try {
        var lStats = JSON.parse(fs.readFileSync(legacyStats2, 'utf-8'));
        var lGraphStat = fs.statSync(legacyGraph2);
        if (lGraphStat.size < 10 * 1024 * 1024) {
          var lGraph = JSON.parse(fs.readFileSync(legacyGraph2, 'utf-8'));
          var lNodes = Array.isArray(lGraph.nodes) ? lGraph.nodes : [];
          summaryText = 'MONOGRAPH KNOWLEDGE GRAPH SUMMARY (legacy JSON)\n' +
            'Nodes: ' + (lStats.nodes || lNodes.length) + ' | Edges: ' + (lStats.edges || 0) + '\n' +
            'Use mcp__monomind__monograph_suggest to find files relevant to your task.';
          summaryMeta = { label: 'monograph-graph-summary', source: 'legacy-json', builtAt: lStats.builtAt };
        }
      } catch (e) { /* ignore */ }
    }

    if (summaryText) {
      var chunkId = crypto.createHash('md5').update('monograph-graph-summary').digest('hex').slice(0, 16);
      newLines.push(JSON.stringify({
        chunkId: chunkId,
        namespace: 'knowledge:shared',
        text: summaryText,
        metadata: summaryMeta
      }));
    }
  } catch (e) { /* graph not available yet, skip */ }

  try {
    fs.mkdirSync(knowledgeDir, { recursive: true });
    fs.writeFileSync(chunksFile, newLines.length > 0 ? newLines.join('\n') + '\n' : '', 'utf-8');
    fs.writeFileSync(hashFile, contentHash, 'utf-8');
  } catch (e) {}
  return newLines.length;
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

const handlers = {
  'route': async () => {
    // For slash commands and single-action invocations: skip routing panel output
    // but still write last-route.json so the statusline reflects the current action.
    if (isSimpleCommand(prompt)) {
      try {
        var cmdLabel = (typeof prompt === 'string' && prompt.trim().startsWith('/'))
          ? prompt.trim().split(/\s+/)[0]          // e.g. "/ts"
          : (hookInput.commandName || hookInput.command_name || 'command');
        var routeDir = path.join(CWD, '.monomind');
        fs.mkdirSync(routeDir, { recursive: true });
        fs.writeFileSync(
          path.join(routeDir, 'last-route.json'),
          JSON.stringify({
            agent: cmdLabel,
            confidence: 1.0,
            reason: 'predefined command — no routing needed',
            semanticRouting: false,
            updatedAt: new Date().toISOString(),
          }),
          'utf-8'
        );
      } catch (e) { /* non-fatal */ }
      return;
    }

    if (intelligence && intelligence.getContext) {
      try {
        const ctx = intelligence.getContext(prompt);
        if (ctx) console.log(ctx);
      } catch (e) { /* non-fatal */ }
    }
    if (router && (router.routeTaskSemantic || router.routeTask)) {
      const routeFn = router.routeTaskSemantic || router.routeTask;
      var result = await Promise.resolve(routeFn(prompt));

      // Graph-fallback override: when the router picked a low-confidence
      // non-dev specialist (marketing slugs etc) but monograph has a strong
      // graph match for the prompt, derive the agent from the top file's
      // label instead. Stops "improve the system" → China E-Commerce.
      try {
        // Don't override when the prompt has obvious non-dev keywords —
        // marketing/sales/finance asks SHOULD route to those specialists.
        var nonDevPrompt = /\b(marketing|advertis|seo|tiktok|instagram|linkedin|sales|customer|brand|blog post|content strategy|copy(?:writ|writing)|pitch|investor|hr|recruit|legal|compliance|tax|invoice|accounting|onboarding|design syst|figma|user research|persona)\b/i.test(prompt);

        var devAgents = /^(coder|tester|reviewer|planner|researcher|system-architect|backend-dev|backend-architect|mobile-dev|ml-developer|cicd-engineer|api-docs|code-analyzer|production-validator|Technical Writer)$/i;
        var pickedDev = devAgents.test(String(result.agent || '').trim()) ||
                        devAgents.test(String(result.agentSlug || '').trim());

        var resConf = (result.confidence != null ? result.confidence : 0);
        var resReason = String(result.reason || '');
        var fromKeywordStage = resReason.indexOf('Keyword 2-stage') !== -1;
        var promptIsDevish = /\b(improve|refactor|fix|bug|optimi[sz]e|implement|build|debug|deploy|test|feature|system|performance|architecture|memory|hook|graph|statusline|monograph|api|cli|skill|hooks|agent|workflow|init|module|package|registry|server|client|route|handler)\b/i.test(prompt);

        var shouldOverride = !nonDevPrompt && (
          (!pickedDev && resConf < 0.85) ||
          (fromKeywordStage && promptIsDevish)
        );
        if (shouldOverride) {
          var topGraph = getMonographSuggestions(prompt, 1)[0];
          if (topGraph) {
            var agent = 'coder';
            var file = (topGraph.file || '').toLowerCase();
            // Test files
            if (/\.(test|spec)\./.test(file) || file.includes('__tests__')) agent = 'tester';
            // Architecture/system docs → architect
            else if (/(architect|adr-|design-doc|rfc-)/.test(file))         agent = 'system-architect';
            // Pure docs → tech writer
            else if (file.endsWith('readme.md') || file.startsWith('docs/') || /\/docs\//.test(file)) agent = 'Technical Writer';
            // Other .md (skills, agents, configs) → coder (they're code-adjacent)
            else if (file.endsWith('.md'))                                  agent = 'coder';
            // Class/Interface → architect
            else if (topGraph.label === 'Class' || topGraph.label === 'Interface') agent = 'system-architect';
            // Functions, files, methods → coder
            else                                                             agent = 'coder';
            // Scale confidence by graph degree: well-connected nodes are stronger anchors.
            var topDeg = topGraph.deg || 0;
            var graphConf = topDeg > 30 ? 0.80 : (topDeg > 10 ? 0.75 : 0.70);
            result = Object.assign({}, result, {
              agent: agent,
              agentSlug: agent,
              confidence: graphConf,
              reason: 'Graph fallback: top file ' + (topGraph.name || '').substring(0, 30) + ' [' + topGraph.label + '] deg=' + topDeg,
              specificAgents: [],
              extrasMatches: [],
            });
          }
        }
      } catch (e) {}

      var output = [];
      output.push('[INFO] Routing task: ' + (prompt.substring(0, 80) || '(no prompt)'));
      output.push('');
      // Suppress the agent recommendation panel for low-confidence routes on
      // short prompts — the recommendation is almost always wrong (e.g.
      // "what else can we do" → marketing → China E-Commerce). Saves ~150
      // tokens per prompt. Skill matches and specific agents still render
      // below when confidence is decent.
      var conf = result.confidence != null ? result.confidence : 0;
      var promptShort = (prompt || '').trim().length < 60;
      var lowConf = conf < 0.70;
      var suppressPanel = lowConf && promptShort;
      if (!suppressPanel) {
        output.push('+------------- monomind | Primary Recommendation --------------+');
        output.push('| Agent: ' + (result.agent || 'unknown').substring(0, 54).padEnd(54) + '|');
        output.push('| Confidence: ' + ((result.confidence != null ? (result.confidence * 100).toFixed(1) : '?') + '%').padEnd(49) + '|');
        output.push('| Reason: ' + (result.reason || '').substring(0, 53).padEnd(53) + '|');
        output.push('+--------------------------------------------------------------+');
      }

      // ── Persist routing result for statusline display ─────────────
      try {
        var routeDir = path.join(CWD, '.monomind');
        fs.mkdirSync(routeDir, { recursive: true });
        // Always use the resolved agent name — never persist "extras"
        var resolvedAgent = result.agent;
        if (!resolvedAgent || resolvedAgent === 'extras') {
          var topExtra = result.extrasMatches && result.extrasMatches[0];
          resolvedAgent = topExtra ? topExtra.name : 'Specialist Agent';
        }
        var routePayload = {
          agent: resolvedAgent,
          agentSlug: result.agentSlug || null,
          confidence: result.confidence,
          reason: result.reason,
          semanticRouting: result.semanticRouting || false,
          llmRouting: result.llmRouting || false,
          updatedAt: new Date().toISOString(),
        };
        if (result.extrasMatches && result.extrasMatches.length > 0) {
          routePayload.extrasMatches = result.extrasMatches.map(function(e) {
            return { name: e.name, slug: e.slug, category: e.category };
          });
        }
        fs.writeFileSync(
          path.join(routeDir, 'last-route.json'),
          JSON.stringify(routePayload),
          'utf-8'
        );
      } catch (e) { /* non-fatal */ }

      // ── Dev skill suggestions ──────────────────────────────────────
      var matches = result.skillMatches || [];
      if (matches.length > 0) {
        // Check for high-confidence auto-invoke: if top skill scored >= 3 keyword
        // hits and is the dominant match, auto-invoke instead of just suggesting
        var topMatch = matches[0];
        var autoInvoke = false;
        if (topMatch && topMatch.score >= 3 && matches.length <= 2) {
          autoInvoke = true;
        } else if (topMatch && topMatch.score >= 2 && matches.length === 1 && (result.confidence ?? 0) < 0.7) {
          // Single strong skill match with weak agent routing = skill should take over
          autoInvoke = true;
        }

        if (autoInvoke) {
          output.push('');
          output.push('+======== SKILL AUTO-ACTIVATED (high confidence match) ========+');
          output.push('| ' + topMatch.invoke.substring(0, 61).padEnd(61) + '|');
          output.push('| INSTRUCTION: Invoke ' + topMatch.invoke.substring(0, 41).padEnd(41) + '|');
          output.push('| BEFORE responding. This skill matched with very high         |');
          output.push('| confidence — do not skip it.                                 |');
          output.push('+==============================================================+');
        } else {
          output.push('');
          if ((result.confidence ?? 0) < 0.8) {
            output.push('+----------- Skill Suggestions (pick one if relevant) ---------+');
            output.push('| No strong primary match — here are the best skill candidates |');
          } else {
            output.push('+----------- Matching Skills (invoke via Skill tool) ----------+');
          }
          matches.forEach(function(m, i) {
            var label = (i + 1) + '. ' + m.skill;
            var desc = (m.description || '').substring(0, 30);
            var line = '| ' + label.substring(0, 30).padEnd(30) + desc.padEnd(30) + ' |';
            output.push(line);
            output.push('|   invoke: ' + m.invoke.substring(0, 51).padEnd(51) + '|');
          });
          output.push('+--------------------------------------------------------------+');
          if ((result.confidence ?? 0) < 0.8) {
            output.push('| To use a skill: call Skill("skill-name") before responding.  |');
            output.push('+--------------------------------------------------------------+');
          }
        }
      }

      // ── Specific agent panel ──────────────────────────────────────────────────
      // Skip entirely on suppressed (low-confidence + short) prompts.
      var specificAgents = result.specificAgents || [];
      if (specificAgents.length > 0 && !suppressPanel) {
        output.push('');
        var saHdr = '------- Specific Agents (' + specificAgents.length + ' available) ';
        output.push('+' + saHdr + '-'.repeat(Math.max(1, 62 - saHdr.length)) + '+');
        specificAgents.forEach(function(a, i) {
          var label = (i + 1) + '. ' + a.label;
          var note = (a.note || '').substring(0, 26);
          output.push('| ' + label.substring(0, 33).padEnd(33) + note.padEnd(27) + ' |');
          if (a.slug) {
            output.push('|   slug: ' + a.slug.substring(0, 52).padEnd(52) + ' |');
          }
        });
        output.push('+--------------------------------------------------------------+');
        output.push('| Use: Task({ subagent_type: "<slug>" })  or  /specialagent    |');
        output.push('+--------------------------------------------------------------+');
      }

      // ── Specialist agents (non-dev domain) — only shown when specificAgents panel wasn't shown ──
      var extras = result.extrasMatches || [];
      var specificAgentsShown = (result.specificAgents || []).length > 0;
      if (extras.length > 0 && !specificAgentsShown && !suppressPanel) {
        output.push('');
        var spHdr = '------- Specialist Agents (' + extras.length + ' matched) ';
        output.push('+' + spHdr + '-'.repeat(Math.max(1, 62 - spHdr.length)) + '+');
        extras.slice(0, 5).forEach(function(e, i) {
          var label = (i + 1) + '. ' + e.name;
          var cat = '[' + e.category + ']';
          output.push('| ' + label.substring(0, 44).padEnd(44) + cat.substring(0, 16).padEnd(16) + ' |');
          output.push('|   slug: ' + e.slug.substring(0, 52).padEnd(52) + ' |');
        });
        output.push('+--------------------------------------------------------------+');
        output.push('| Use: Task({ subagent_type: "<slug>" })  or  /specialagent    |');
        output.push('+--------------------------------------------------------------+');
      }

      // ── MicroAgent Trigger Scan (Task 32) ──────────────────────────────
      try {
        var triggerResult = scanMicroAgentTriggers(typeof prompt === 'string' ? prompt : '');
        if (triggerResult.matches.length > 0) {
          output.push('');
          if (triggerResult.takeoverAgent) {
            var tAgent = triggerResult.takeoverAgent;
            var tKw = triggerResult.matches[0].matchedText;
            output.push('+============= MicroAgent TAKEOVER Detected ===================+');
            output.push('| Specialist: ' + tAgent.substring(0, 49).padEnd(49) + '|');
            output.push('| Keyword:    ' + ('"' + tKw + '"').substring(0, 49).padEnd(49) + '|');
            output.push('| Recommended: use this specialist instead of primary agent.   |');
            output.push('+==============================================================+');
          } else {
            output.push('+------- MicroAgent Specialists Triggered ---------------------+');
            triggerResult.matches.forEach(function(m) {
              var slug = m.agentSlug.substring(0, 37).padEnd(37);
              var kw = ('(match: "' + m.matchedText + '")').substring(0, 21).padEnd(21);
              output.push('| + ' + slug + kw + ' |');
            });
            output.push('+--------------------------------------------------------------+');
          }
          // Persist trigger matches alongside route result
          try {
            var routeFile = path.join(CWD, '.monomind', 'last-route.json');
            var existing = JSON.parse(fs.readFileSync(routeFile, 'utf-8'));
            existing.microAgents = { injectAgents: triggerResult.injectAgents || [], takeoverAgent: triggerResult.takeoverAgent || null };
            fs.writeFileSync(routeFile, JSON.stringify(existing), 'utf-8');
          } catch (e) {}
        }
      } catch (e) { /* non-fatal */ }

      console.log(output.join('\n'));

      // Record any decision markers in this prompt (auto-ADR pipeline).
      try { _recordDecisionMarkers(prompt); } catch (e) {}

      // Cost budget — emit amber/red banner when approaching limit.
      try {
        var budget = _getBudgetStatus();
        if (budget && budget.alert) {
          var tunedNote = budget.autoTuned ? ' (auto-tuned)' : '';
          if (budget.spike && !budget.breached) {
            console.log('[BUDGET_SPIKE] Today $' + budget.todayCost.toFixed(2) + ' is >2x your rolling daily avg. Unusual spend — review .monomind/metrics/token-summary.json.');
          } else if (budget.breached) {
            console.log('[BUDGET_BREACHED] Daily $' + budget.todayCost.toFixed(2) + '/$' + budget.dailyLimit + ' (' + budget.dailyPct + '%) · Monthly $' + budget.monthCost.toFixed(2) + '/$' + budget.monthlyLimit + ' (' + budget.monthlyPct + '%)' + tunedNote + '. Switch to Haiku with /model haiku or edit .monomind/budget.json.');
          } else {
            console.log('[BUDGET_ALERT] Daily ' + budget.dailyPct + '% of $' + budget.dailyLimit + ' · Monthly ' + budget.monthlyPct + '% of $' + budget.monthlyLimit + tunedNote + '.');
          }
        }
      } catch (e) {}

      // Inject monograph hint for complex tasks.
      // Source of truth is .monomind/monograph.db (SQLite). Legacy stats.json
      // is no longer written by the build, so it is checked only as a fallback.
      try {
        var monographDb = path.join(CWD, '.monomind', 'monograph.db');
        var legacyStats = path.join(CWD, '.monomind', 'graph', 'stats.json');
        var nodeCount = 0;
        if (fs.existsSync(monographDb)) {
          try {
            var hintDb = _openMonographDb();
            if (hintDb) {
              nodeCount = hintDb.prepare('SELECT COUNT(*) AS c FROM nodes').get().c;
            }
          } catch (e) { /* ignore — fall back to legacy */ }
        }
        if (nodeCount === 0 && fs.existsSync(legacyStats)) {
          try {
            var gStats = JSON.parse(fs.readFileSync(legacyStats, 'utf-8'));
            nodeCount = gStats.nodes || 0;
          } catch (e) { /* ignore */ }
        }
        if (nodeCount > 100) {
          // Pre-resolve top-5 relevant files for the user's prompt — the LLM
          // sees the answer inline instead of being told to call a tool.
          var suggestions = getMonographSuggestions(prompt, 5);

          // Boost recently-edited files to the top of pre-resolve suggestions.
          // Even when the FTS index hasn't caught up to the latest edits, the
          // LLM should see the files it just modified as the primary context.
          try {
            var recentEditsForRoute = _getRecentEdits();
            if (recentEditsForRoute.length > 0) {
              // Extract prompt keywords for relevance gating
              var promptWords = (prompt || '').toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [];
              var promptWordSet = {};
              for (var pw = 0; pw < promptWords.length; pw++) promptWordSet[promptWords[pw]] = 1;

              var existingFiles = {};
              for (var se = 0; se < suggestions.length; se++) existingFiles[suggestions[se].file || ''] = 1;

              var editBoosts = [];
              for (var re = 0; re < recentEditsForRoute.length && editBoosts.length < 2; re++) {
                var reFile = recentEditsForRoute[re].file;
                // Skip if already in suggestions
                if (existingFiles[reFile]) continue;
                var reName = path.basename(reFile, path.extname(reFile)).toLowerCase();
                // Only boost if filename shares a keyword with the prompt OR the edit is very recent (<3 min)
                var veryRecent = (Date.now() - recentEditsForRoute[re].editedAt) < 3 * 60 * 1000;
                var matches = promptWordSet[reName] || veryRecent;
                if (matches) {
                  editBoosts.push({ name: path.basename(reFile), label: 'File', file: reFile, deg: 0, _editBoost: true });
                }
              }
              if (editBoosts.length > 0) {
                suggestions = editBoosts.concat(suggestions).slice(0, 5);
              }
            }
          } catch (e) { /* non-fatal */ }

          if (suggestions.length > 0) {
            console.log('\n[MONOGRAPH] ' + nodeCount + ' nodes indexed. Top files for this task (pre-resolved from graph):');
            for (var si = 0; si < suggestions.length; si++) {
              var s = suggestions[si];
              var editTag = s._editBoost ? ' ✎' : '';
              console.log('  · ' + s.name + ' [' + s.label + '] — ' + (s.file || '') + (s.deg ? ' (deg ' + s.deg + ')' : '') + editTag);
            }
            console.log('  Use mcp__monomind__monograph_query / monograph_impact for deeper drill-down.');
            _recordGraphTelemetry('preresolve_hit');
          } else {
            console.log('\n[MONOGRAPH] ' + nodeCount + ' nodes indexed. Call mcp__monomind__monograph_suggest first to find relevant files without grepping.');
            _recordGraphTelemetry('preresolve_miss');
          }
        }
      } catch(e) {}

      // Swarm mode selection is available on-demand via /mastermind slash command.
    } else {
      console.log('[INFO] Router not available, using default routing');
    }

    // Task 22: TeamRoutingModes — only log when an explicit swarm config is present
    try {
      var swarmCfgPath = path.join(CWD, '.monomind', 'swarm-config.json');
      if (fs.existsSync(swarmCfgPath)) {
        var topology22 = JSON.parse(fs.readFileSync(swarmCfgPath, 'utf-8')).topology || 'mesh';
        var mode22 = topology22 === 'hierarchical' ? 'route' : 'coordinate';
        console.log('[ROUTING_MODE] topology=' + topology22 + ' → mode=' + mode22);
      }
    } catch (e) { /* non-fatal */ }
  },

  'load-agent': () => {
    // Load and print full agent text so Claude can adopt its identity
    const slug = args.join(' ').trim() || (typeof prompt === 'string' ? prompt.trim() : '');
    if (!router || !router.loadExtrasAgent) {
      console.error('[ERROR] Router does not support loadExtrasAgent');
      process.exit(1);
    }
    const agent = router.loadExtrasAgent(slug);
    if (!agent) {
      console.error('[ERROR] Extras agent not found: ' + slug);
      console.error('Run: node .claude/helpers/router.cjs --load-agent <slug>  to check available slugs');
      process.exit(1);
    }
    console.log('=== AGENT ACTIVATED: ' + agent.name + ' [' + agent.category + '] ===');
    console.log('');
    console.log(agent.content);
    console.log('');
    console.log('=== END AGENT: ' + agent.name + ' ===');
    console.log('INSTRUCTION: You are now ' + agent.name + '. Adopt the identity, tone, and expertise described above for the remainder of this task.');

    // Persist active agent for statusline
    try {
      var routeDir = path.join(CWD, '.monomind');
      fs.mkdirSync(routeDir, { recursive: true });
      fs.writeFileSync(
        path.join(routeDir, 'last-route.json'),
        JSON.stringify({
          agent: agent.slug,
          name: agent.name,
          category: agent.category,
          confidence: 1.0,
          reason: 'manually activated via load-agent',
          activated: true,
          updatedAt: new Date().toISOString(),
        }),
        'utf-8'
      );
    } catch (e) { /* non-fatal */ }
  },

  'list-extras': () => {
    if (!router || !router.loadExtrasRegistry) {
      console.error('[ERROR] Extras registry not available');
      process.exit(1);
    }
    const registry = router.loadExtrasRegistry();
    const category = args[0] || '';
    const entries = category
      ? registry.extras.filter(e => e.category === category)
      : registry.extras;
    const byCategory = {};
    for (const e of entries) {
      if (!byCategory[e.category]) byCategory[e.category] = [];
      byCategory[e.category].push(e);
    }
    for (const [cat, agents] of Object.entries(byCategory)) {
      console.log('\n[' + cat.toUpperCase() + ']');
      for (const a of agents) {
        console.log('  ' + a.slug.padEnd(45) + a.name);
      }
    }
    console.log('\nTotal: ' + entries.length + ' extras agents');
  },

  'pre-bash': () => {
    var _rawCmd = hookInput.command || prompt;
    var rawCmdStr = (typeof _rawCmd === 'string' ? _rawCmd : String(_rawCmd || ''));
    var cmd = rawCmdStr.toLowerCase();
    var dangerous = ['rm -rf /', 'rm -rf/', 'format c:', 'del /s /q c:\\', ':(){:|:&};:'];
    for (var i = 0; i < dangerous.length; i++) {
      if (cmd.includes(dangerous[i])) {
        console.error('[BLOCKED] Dangerous command detected: ' + dangerous[i]);
        process.exit(1);
      }
    }

    // Intercept Bash-side grep/rg/find/ag — close the loophole where LLM
    // bypasses the Grep tool by shelling out. Same monograph hint shape as pre-search.
    try {
      // Match: grep <flags> <pattern>, rg <flags> <pattern>, ag <pattern>, find . -name <pattern>
      var grepMatch = rawCmdStr.match(/\b(?:grep|rg|ag)\b(?:\s+-[a-zA-Z]+)*\s+(?:"([^"]+)"|'([^']+)'|([^\s|;&<>]+))/);
      var findMatch = rawCmdStr.match(/\bfind\b.*?-name\s+(?:"([^"]+)"|'([^']+)'|([^\s|;&<>]+))/);
      var pattern = '';
      if (grepMatch) {
        pattern = grepMatch[1] || grepMatch[2] || grepMatch[3] || '';
        _recordGraphTelemetry('bash_grep_call');
      } else if (findMatch) {
        pattern = findMatch[1] || findMatch[2] || findMatch[3] || '';
        _recordGraphTelemetry('bash_find_call');
      }
      if (pattern && pattern.length >= 3) {
        var sigB = 'Bash-grep:' + pattern.slice(0, 60);
        var countB = _recordToolCall(sigB);
        if (countB >= 3) {
          console.log('[LOOP_DRIFT] You\'ve grepped "' + pattern.slice(0, 40) + '" ' + countB + 'x — switch to monograph_query.');
        }
      }
      if (pattern && pattern.length >= 3) {
        var clean = pattern.replace(/[\\^$.*+?()\[\]{}|]/g, ' ').trim();
        if (clean.length >= 3) {
          var hits = getMonographSuggestions(clean, 5);
          if (hits.length > 0) {
            _recordGraphTelemetry('graph_assist_search');
            console.log('[MONOGRAPH_HIT] Graph has ' + hits.length + ' file(s) for "' + clean.slice(0, 40) + '" — consider monograph_query instead of shell grep:');
            for (var j = 0; j < hits.length; j++) {
              var h = hits[j];
              console.log('  · ' + h.name + ' [' + h.label + '] — ' + (h.file || ''));
            }
          }
        }
      }
    } catch (e) { /* non-fatal */ }

    console.log('[OK] Command validated');
  },

  // Intercept Grep/Glob: run monograph_query on the same pattern first and
  // surface graph hits so the LLM can read file:line directly without paying
  // for a full Grep scan when the graph already knows the answer.
  'pre-search': () => {
    try {
      _recordGraphTelemetry(toolName === 'Grep' ? 'grep_call' : 'glob_call');
      var pattern = toolInput.pattern || toolInput.path || '';
      if (typeof pattern !== 'string' || pattern.length < 3) return;
      var clean = pattern.replace(/[\\^$.*+?()\[\]{}|]/g, ' ').trim();
      if (clean.length < 3) return;

      var sig = (toolName || 'Search') + ':' + clean.slice(0, 60);
      var count = _recordToolCall(sig);
      if (count >= 3) {
        console.log('[LOOP_DRIFT] You\'ve searched "' + clean.slice(0, 40) + '" ' + count + 'x this session — try monograph_query or monograph_impact for a structural answer.');
      }
      var suggestions = getMonographSuggestions(clean, 5);
      if (suggestions.length === 0) return;
      // Successful intercept — count as a "graph assist" so the ratio reflects
      // server-side wins, not just LLM-initiated MCP calls.
      _recordGraphTelemetry('graph_assist_search');
      console.log('[MONOGRAPH_HIT] Graph already knows ' + suggestions.length + ' file(s) matching "' + clean.slice(0, 40) + '":');
      for (var i = 0; i < suggestions.length; i++) {
        var s = suggestions[i];
        console.log('  · ' + s.name + ' [' + s.label + '] — ' + (s.file || '') + ' (deg ' + s.deg + ')');
      }
      console.log('  Prefer mcp__monomind__monograph_query for symbol lookup (file:line, no scan).');
    } catch (e) { /* non-fatal */ }
  },

  // After Read: append a graph neighbor footer so the LLM gets free
  // architectural context — what imports this file and what it imports.
  'post-read': () => {
    try {
      var filePath = toolInput.file_path || toolInput.path || '';
      if (!filePath || typeof filePath !== 'string') return;
      var n = getMonographNeighbors(filePath);
      if (!n) return;
      var parts = [];
      if (n.importedBy.length > 0) parts.push('imported-by: ' + n.importedBy.slice(0, 4).join(', '));
      if (n.imports.length > 0)    parts.push('imports: '    + n.imports.slice(0, 4).join(', '));
      if (parts.length === 0) return;
      _recordGraphTelemetry('graph_assist_neighbors');
      console.log('[MONOGRAPH_NEIGHBORS] ' + parts.join(' · '));
    } catch (e) { /* non-fatal */ }
  },

  // PostToolUse for monograph_* — increment graph usage counter for telemetry.
  'post-graph-tool': () => {
    try {
      if (toolName && toolName.indexOf('monograph_') !== -1) {
        _recordGraphTelemetry('monograph_call');
      }
    } catch (e) {}
  },

  'post-edit': async () => {
    if (session && session.metric) {
      try { session.metric('edits'); } catch (e) { /* no active session */ }
    }
    if (intelligence && intelligence.recordEdit) {
      try {
        var file = hookInput.file_path || toolInput.file_path
          || process.env.TOOL_INPUT_file_path || args[0] || '';
        intelligence.recordEdit(file);
      } catch (e) { /* non-fatal */ }
    }
    // Track recently-edited files for compact injection and pre-resolve boosting.
    try {
      var editedForRecent = hookInput.file_path || toolInput.file_path
        || process.env.TOOL_INPUT_file_path || args[0] || '';
      if (editedForRecent) _recordRecentEdit(editedForRecent);
    } catch (e) { /* non-fatal */ }
    // Increment write counter and rebuild monograph when threshold hit.
    _maybeRebuildMonograph();

    // Test feedback (detection-only): when editing a source file, list tests
    // that import it so the LLM/user knows what to verify next.
    try {
      var editedFile = hookInput.file_path || toolInput.file_path
        || process.env.TOOL_INPUT_file_path || args[0] || '';
      if (editedFile && !editedFile.match(/\.(test|spec)\./) && !editedFile.includes('__tests__')) {
        var affectedTests = _findAffectedTests(editedFile);
        if (affectedTests.length > 0) {
          console.log('[AFFECTED_TESTS] ' + affectedTests.length + ' test(s) cover this file:');
          for (var ti = 0; ti < Math.min(5, affectedTests.length); ti++) {
            console.log('  · ' + affectedTests[ti]);
          }
        }
      }
    } catch (e) {}
    // ── Security-Sensitive File Auto-Alert ────────────────────────────────
    // When editing auth, security, crypto, or env-related files, flag it
    try {
      var editFile = (hookInput.file_path || toolInput.file_path
        || process.env.TOOL_INPUT_file_path || args[0] || '').toLowerCase();
      var securityPatterns = /\b(auth|security|crypto|secret|credential|token|password|\.env|permission|acl|rbac|jwt|oauth|session|cookie)\b/;
      if (securityPatterns.test(editFile) || editFile.includes('/security/') || editFile.includes('/auth/')) {
        console.log('[SECURITY_EDIT] Security-sensitive file modified: ' + path.basename(editFile));
        console.log('[SECURITY_EDIT] INSTRUCTION: Consider running a security review. Invoke Skill("code-review:code-review") with security focus, or run: npx monomind security scan --path "' + editFile + '"');
      }
    } catch (e) { /* non-fatal */ }

    // ── Smart Test/Build Suggestions (PE-001) ───────────────────────────
    try {
      var editFile = (hookInput.file_path || toolInput.file_path
        || process.env.TOOL_INPUT_file_path || args[0] || '');
      var editBase = path.basename(editFile).toLowerCase();
      var editDir = path.dirname(editFile);
      if (/\.(test|spec)\.(ts|js|tsx|jsx)$/.test(editBase)) {
        console.log('[AUTO_SUGGEST] Test file modified — run: npm test -- --testPathPattern="' + path.basename(editFile) + '"');
      } else if (editBase === 'package.json') {
        console.log('[AUTO_SUGGEST] package.json changed — consider running: npm install');
      } else if (editBase === 'tsconfig.json' || editBase === 'tsconfig.base.json') {
        console.log('[AUTO_SUGGEST] TypeScript config changed — consider running: npm run build');
      }
    } catch (e) { /* non-fatal */ }

    // ── Monograph Incremental Rebuild ─────────────────────────────────────
    // After every code file edit, trigger a background monograph rebuild so
    // the knowledge graph stays current. Debounced via a lock file (5s cooldown).
    try {
      var editedFile = (hookInput.file_path || toolInput.file_path
        || process.env.TOOL_INPUT_file_path || args[0] || '');
      var codeExts = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|cpp|c|rb|swift|php)$/i;
      if (editedFile && codeExts.test(editedFile)) {
        var lockFile = path.join(CWD, '.monomind', 'graph', '.rebuild-lock');
        var now = Date.now();
        var lastBuild = 0;
        try { lastBuild = parseInt(fs.readFileSync(lockFile, 'utf-8').trim(), 10) || 0; } catch (e) {}
        var COOLDOWN_MS = 5000; // 5-second debounce
        if (now - lastBuild > COOLDOWN_MS) {
          fs.writeFileSync(lockFile, String(now), 'utf-8');
          var { spawn: spawnRebuild } = require('child_process');
          var rebuildScript = "import { buildAsync } from '@monoes/monograph'; await buildAsync(" + JSON.stringify(CWD) + ");";
          var graphDir = path.join(CWD, '.monomind', 'graph');
          var logPath = path.join(graphDir, 'build.log');
          var logFd;
          try { logFd = fs.openSync(logPath, 'a'); } catch(e) { logFd = 'ignore'; }
          var child = spawnRebuild(process.execPath, ['--input-type=module', '--eval', rebuildScript], {
            detached: true, stdio: ['ignore', logFd, logFd], cwd: CWD,
          });
          child.unref();
          console.log('[MONOGRAPH] Incremental rebuild triggered for ' + path.basename(editedFile));

          // Option C: fire ua-enrich.mjs in background after monograph rebuild
          var uaEnrichScript = path.join(CWD, 'scripts', 'ua-enrich.mjs');
          if (fs.existsSync(uaEnrichScript)) {
            var uaChild = spawnRebuild(process.execPath, [uaEnrichScript, '--dir', CWD, '--file', editedFile, '--db', path.join(CWD, '.monomind', 'monograph.db')], {
              detached: true, stdio: 'ignore', cwd: CWD,
            });
            uaChild.unref();
          }
        }
        // Show importers of the edited file so Claude sees blast radius
        try {
          var mgDbPath4 = path.join(CWD, '.monomind', 'monograph.db');
          if (fs.existsSync(mgDbPath4)) {
            var mgMod4 = null;
            mgMod4 = _requireMonograph();
            if (mgMod4 && mgMod4.openDb) {
              var db4 = mgMod4.openDb(mgDbPath4);
              try {
                var editedBase4 = path.basename(editedFile).replace(/\.[^.]+$/, '');
                var editNode4 = db4.prepare("SELECT id, name, label FROM nodes WHERE file_path LIKE ? OR name = ? LIMIT 1")
                  .get('%' + path.sep + path.basename(editedFile), editedBase4);
                if (editNode4) {
                  var editImporters4 = db4.prepare(
                    'SELECT n2.name FROM edges e JOIN nodes n2 ON n2.id = e.source_id WHERE e.target_id = ? LIMIT 8'
                  ).all(editNode4.id);
                  if (editImporters4.length > 0) {
                    console.log('[MONOGRAPH_IMPACT] ' + editNode4.name + ' (' + editNode4.label + ') is depended on by: ' +
                      editImporters4.map(function(i) { return i.name; }).join(', '));
                  }
                }
              } finally { if (mgMod4.closeDb) mgMod4.closeDb(db4); }
            }
          }
        } catch(e) { /* non-fatal */ }
      }
    } catch (e) { /* non-fatal */ }

    console.log('[OK] Edit recorded');
  },

  'session-restore': async () => {
    try {
      if (session) {
        var existing = session.restore && session.restore();
        if (!existing) {
          session.start && session.start();
        }
      } else {
        console.log('[OK] Session restored: session-' + Date.now());
      }
    } catch (e) { console.log('[WARN] Session restore failed: ' + e.message); }

    // Stale helper detection — compare local helper hashes against the
    // bundled (npm-installed) monomind copy and warn if they drift. This
    // is what alerts the user that 'monomind init upgrade' would pick up
    // new features (graph fallback routing, telemetry counters, etc).
    try {
      var crypto = require('crypto');
      // Walk up from this file to find the monomind package root (looks for
      // package.json with name === 'monomind' or '@monomind/cli').
      function _findBundledHelpers() {
        var helperPaths = [
          path.join(__dirname),
          path.join(CWD, 'node_modules', 'monomind', '.claude', 'helpers'),
          path.join(CWD, 'node_modules', '@monoes', 'monomindcli', '.claude', 'helpers'),
        ];
        try {
          var globalRoot = require('child_process')
            .execSync('npm root -g 2>/dev/null', { encoding: 'utf-8', timeout: 2000 })
            .trim();
          if (globalRoot) {
            helperPaths.push(path.join(globalRoot, 'monomind', '.claude', 'helpers'));
            helperPaths.push(path.join(globalRoot, '@monoes', 'monomindcli', '.claude', 'helpers'));
          }
        } catch (_) {}
        for (var i = 0; i < helperPaths.length; i++) {
          if (fs.existsSync(path.join(helperPaths[i], 'hook-handler.cjs')) &&
              helperPaths[i] !== path.join(CWD, '.claude', 'helpers')) {
            return helperPaths[i];
          }
        }
        return null;
      }

      var bundledDir = _findBundledHelpers();
      if (bundledDir) {
        var helpersToCheck = ['hook-handler.cjs', 'statusline.cjs'];
        var stale = [];
        for (var hi = 0; hi < helpersToCheck.length; hi++) {
          var hName = helpersToCheck[hi];
          var localF   = path.join(CWD, '.claude', 'helpers', hName);
          var bundledF = path.join(bundledDir, hName);
          if (!fs.existsSync(localF) || !fs.existsSync(bundledF)) continue;
          try {
            var hashL = crypto.createHash('sha256').update(fs.readFileSync(localF)).digest('hex');
            var hashB = crypto.createHash('sha256').update(fs.readFileSync(bundledF)).digest('hex');
            if (hashL !== hashB) stale.push(hName);
          } catch (_) {}
        }
        if (stale.length > 0) {
          console.log('[STALE_HELPERS] Project helpers differ from bundled version: ' + stale.join(', '));
          console.log('  Run `npx monomind@latest init upgrade` to refresh and pick up the latest features.');
        }
      }
    } catch (e) { /* non-fatal */ }
    // Initialize intelligence (with timeout — #1530)
    // Respects monomind.neural.enabled kill switch from settings.json
    var neuralEnabled = true;
    try {
      var settingsPath = path.join(CWD, '.claude', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        var settingsData = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (settingsData.monomind && settingsData.monomind.neural && settingsData.monomind.neural.enabled === false) {
          neuralEnabled = false;
          console.log('[NEURAL] Disabled via monomind.neural.enabled=false');
        }
      }
    } catch (e) { /* non-fatal */ }
    if (neuralEnabled && intelligence && intelligence.init) {
      var initResult = await runWithTimeout(function() { return intelligence.init(); }, 'intelligence.init()');
      if (initResult && initResult.nodes > 0) {
        console.log('[INTELLIGENCE] Loaded ' + initResult.nodes + ' patterns, ' + initResult.edges + ' edges');
      }
    }
    // GAP-001: Bridge hook-handler.cjs to @monomind/hooks compiled packages.
    // Dynamic import() resolves ESM packages even from CJS — failures are silent.
    try {
      var hooksModule = await import('@monomind/hooks');
      if (hooksModule && hooksModule.initDefaultWorkers) {
        await runWithTimeout(function() { return hooksModule.initDefaultWorkers(); }, '@monomind/hooks.initDefaultWorkers()');
        // Store reference so pre-task / post-task can call executeHooks (Tasks 26, 39)
        _hooksModule = hooksModule;
        console.log('[INFO] @monomind/hooks workers initialized');
      }
    } catch (e) { /* @monomind/hooks not compiled yet — skip */ }

    // ── Context Persistence Auto-Restore ───────────────────────────────────
    // Restore archived conversation context from previous sessions
    try {
      var cpHook = await import('file://' + path.join(__dirname, 'context-persistence-hook.mjs'));
      var restoreFn = (cpHook && cpHook.restore) || (cpHook && cpHook.default && cpHook.default.restore);
      if (restoreFn) {
        var restored = await runWithTimeout(function() { return restoreFn(); }, 'context-persistence.restore()');
        if (restored && restored.turns > 0) {
          console.log('[CONTEXT_RESTORED] ' + restored.turns + ' turns from previous session');
        }
      }
    } catch (e) { /* non-fatal — context-persistence may not be available */ }

    // Task 28: AgentKnowledgeBase — preload shared knowledge context on session restore.
    // Self-contained: auto-indexes project docs into chunks.jsonl, then keyword-searches
    // them. Works without @monomind/memory being compiled. Falls back to KnowledgeRetriever
    // if the compiled package IS available (richer dedup + formatting).
    try {
      var knowledgeDir = path.join(CWD, '.monomind', 'knowledge');
      var indexed = _autoIndexKnowledge(knowledgeDir);
      if (indexed > 0) {
        console.log('[KNOWLEDGE_INDEXED] ' + indexed + ' chunks written from project sources');
      }

      var kSearchFn = _buildKnowledgeSearchFn(knowledgeDir);
      var sessionCtx = (hookInput && (hookInput.sessionId || hookInput.session_id))
        ? 'session context: ' + (hookInput.sessionId || hookInput.session_id)
        : 'project context general';

      // Prefer compiled KnowledgeRetriever for dedup + formatting; inline fallback otherwise
      var memoryMod = null;
      try { memoryMod = await import('@monomind/memory'); } catch (e) {}

      if (memoryMod && memoryMod.KnowledgeStore && memoryMod.KnowledgeRetriever) {
        var kStore = new memoryMod.KnowledgeStore(knowledgeDir);
        var kRetriever = new memoryMod.KnowledgeRetriever(kSearchFn, kStore);
        var kResult = await kRetriever.retrieveForTask('shared', sessionCtx, 5);
        if (kResult.excerpts.length > 0) {
          console.log('[KNOWLEDGE_PRELOADED] ' + kResult.excerpts.length + ' excerpts (KnowledgeRetriever)');
        }
      } else {
        // Inline fallback — no compiled deps needed
        var directResults = await kSearchFn(sessionCtx, { namespace: 'knowledge:shared', limit: 5, minScore: 0.3 });
        if (directResults.length > 0) {
          console.log('[KNOWLEDGE_PRELOADED] ' + directResults.length + ' excerpts (direct keyword search)');
        }
      }
    } catch (e) { /* non-fatal */ }

    // ── Monograph Context Injection ──────────────────────────────────────────
    // On session start, query monograph DB for god nodes, inject as context,
    // and write them into knowledge/chunks.jsonl for semantic search recall.
    try {
      var mgDbPath = path.join(CWD, '.monomind', 'monograph.db');
      if (fs.existsSync(mgDbPath)) {
        var mgDb = _openMonographDb();
        if (mgDb) {
          try {
            var mgNodeCount = mgDb.prepare('SELECT COUNT(*) AS c FROM nodes').get().c;
            var mgEdgeCount = mgDb.prepare('SELECT COUNT(*) AS c FROM edges').get().c;
            var mgGodNodes = mgDb.prepare(
              "SELECT n.name, n.label, n.file_path, " +
              "(SELECT COUNT(*) FROM edges WHERE source_id=n.id OR target_id=n.id) AS deg " +
              "FROM nodes n " +
              "WHERE n.label NOT IN ('Concept') " +
              "AND n.file_path IS NOT NULL AND n.file_path != '' " +
              "AND n.file_path NOT LIKE '%/node_modules/%' AND n.file_path NOT LIKE '%node_modules%' " +
              "ORDER BY deg DESC LIMIT 12"
            ).all();

            // Check graph staleness: compare stored commit hash with current HEAD.
            var mgStaleIndicator = '';
            try {
              var mgLastCommitRow = null;
              try { mgLastCommitRow = mgDb.prepare("SELECT value FROM index_meta WHERE key='ua_last_commit'").get(); } catch (_) {}
              if (mgLastCommitRow && mgLastCommitRow.value) {
                var { execFileSync: mgExec } = require('child_process');
                var currentHead = '';
                try { currentHead = mgExec('git', ['rev-parse', 'HEAD'], { cwd: CWD, encoding: 'utf-8' }).trim(); } catch (_) {}
                if (currentHead && currentHead !== mgLastCommitRow.value) {
                  var commitsBehind = 0;
                  try {
                    var revList = mgExec('git', ['rev-list', '--count', mgLastCommitRow.value + '..' + currentHead], { cwd: CWD, encoding: 'utf-8' }).trim();
                    commitsBehind = parseInt(revList, 10) || 0;
                  } catch (_) {}
                  if (commitsBehind > 0) {
                    mgStaleIndicator = ' [⚡ graph ' + commitsBehind + ' commit' + (commitsBehind === 1 ? '' : 's') + ' behind — run: npx monomind monograph build]';
                  }
                }
              }
            } catch (_) {}

            if (mgGodNodes.length > 0) {
              var mgGodStr = mgGodNodes.slice(0, 8).map(function(n) {
                return n.name + ' (' + n.label + ', ' + n.deg + ' links)';
              }).join(', ');
              console.log('[MONOGRAPH_CONTEXT] ' + mgNodeCount + ' nodes · ' + mgEdgeCount + ' edges. Key nodes: ' + mgGodStr + mgStaleIndicator);
              // Write god nodes into knowledge chunks so semantic search finds them
              var mgKnowledgeDir = path.join(CWD, '.monomind', 'knowledge');
              var mgChunksFile = path.join(mgKnowledgeDir, 'chunks.jsonl');
              try {
                fs.mkdirSync(mgKnowledgeDir, { recursive: true });
                var mgGodChunk = JSON.stringify({
                  id: 'monograph-god-nodes',
                  text: 'Codebase architecture — high-centrality nodes (most depended-on): ' + mgGodNodes.map(function(n) {
                    return n.name + ' [' + n.label + '] at ' + (n.file_path || '') + ' (' + n.deg + ' connections)';
                  }).join('; '),
                  namespace: 'knowledge:monograph',
                  metadata: { label: 'monograph-god-nodes', nodes: mgNodeCount, edges: mgEdgeCount }
                });
                var mgExisting = [];
                try { mgExisting = fs.readFileSync(mgChunksFile, 'utf-8').trim().split('\n').filter(Boolean); } catch(e) {}
                mgExisting = mgExisting.filter(function(line) {
                  try { return JSON.parse(line).id !== 'monograph-god-nodes'; } catch(e) { return true; }
                });
                mgExisting.push(mgGodChunk);
                fs.writeFileSync(mgChunksFile, mgExisting.join('\n') + '\n');
              } catch(e) {}
            }
          } catch(e) { /* non-fatal */ }
        }
      }
    } catch(e) { /* non-fatal */ }

    // Task 23: SharedInstructions — auto-load .agents/shared_instructions.md on session restore
    // Hard limit: 1500 chars (~375 tokens). Content beyond this is truncated and flagged.
    var SI_CHAR_LIMIT = 1500;
    var applySharedInstrLimit = function(content, source) {
      if (content.length > SI_CHAR_LIMIT) {
        console.warn('[SHARED_INSTRUCTIONS_OVERLIMIT] ' + content.length + ' chars exceeds limit of ' + SI_CHAR_LIMIT +
          ' — truncating. Edit ' + source + ' to stay under limit.');
        return content.slice(0, SI_CHAR_LIMIT) + '\n… [truncated — file exceeds ' + SI_CHAR_LIMIT + ' char limit]';
      }
      return content;
    };
    try {
      var siMod = await import('file://' + path.join(CWD, 'packages/@monomind/cli/dist/src/agents/shared-instructions-loader.js'));
      var loader = siMod.sharedInstructionsLoader || (siMod.SharedInstructionsLoader ? new siMod.SharedInstructionsLoader() : null);
      if (loader) {
        var sharedInstr = loader.getSharedInstructions(CWD);
        if (sharedInstr) {
          var sharedInstrSafe = applySharedInstrLimit(sharedInstr, '.agents/shared_instructions.md');
          console.log('[SHARED_INSTRUCTIONS] Loaded ' + sharedInstrSafe.length + ' chars from .agents/shared_instructions.md');
          console.log(sharedInstrSafe);
        }
      }
    } catch (e) {
      // Try direct filesystem fallback
      try {
        var siPath = path.join(CWD, '.agents', 'shared_instructions.md');
        if (fs.existsSync(siPath)) {
          var siContent = fs.readFileSync(siPath, 'utf-8');
          var siContentSafe = applySharedInstrLimit(siContent, siPath);
          console.log('[SHARED_INSTRUCTIONS] Loaded ' + siContentSafe.length + ' chars from .agents/shared_instructions.md');
          console.log(siContentSafe);
        }
      } catch (e2) { /* non-fatal */ }
    }

    // Memory Palace — inject L0 (identity) + L1 (essential story) into session context
    try {
      var palace = require('./memory-palace.cjs');
      var palaceContext = palace.wakeUp(CWD);
      if (palaceContext) {
        console.log(palaceContext);
      }
    } catch (e) { /* non-fatal — palace not available */ }

    // ── Periodic Update Check (once per day) ──────────────────────────────
    try {
      var updateCheckFile = path.join(CWD, '.monomind', 'last-update-check.json');
      var shouldCheck = true;
      if (fs.existsSync(updateCheckFile)) {
        var lastCheck = JSON.parse(fs.readFileSync(updateCheckFile, 'utf-8'));
        var hoursSince = (Date.now() - new Date(lastCheck.timestamp).getTime()) / (1000 * 60 * 60);
        if (hoursSince < 24) shouldCheck = false;
      }
      if (shouldCheck) {
        // Non-blocking: write marker immediately, check asynchronously
        fs.mkdirSync(path.join(CWD, '.monomind'), { recursive: true });
        fs.writeFileSync(updateCheckFile, JSON.stringify({ timestamp: new Date().toISOString() }), 'utf-8');
        try {
          var localPkg = path.join(CWD, 'packages/@monomind/cli/package.json');
          if (fs.existsSync(localPkg)) {
            var localVer = JSON.parse(fs.readFileSync(localPkg, 'utf-8')).version;
            if (localVer) {
              // Non-blocking spawn — never holds the event loop during hook execution
              var spawnFn = require('child_process').spawn;
              var child = spawnFn('npm', ['view', '@monomind/cli', 'version'], {
                stdio: ['ignore', 'pipe', 'ignore'],
                shell: false,
              });
              // Required: without an error listener, ENOENT (npm not in PATH) crashes the process
              child.on('error', function() {});
              var out = '';
              child.stdout.on('data', function(d) { out += d; });
              child.on('close', function() {
                var current = out.trim();
                var pendingUpdatePath = path.join(CWD, '.monomind', 'pending-update.json');
                if (current && current !== localVer) {
                  // Write result to a sidecar file — picked up on next session-start
                  try {
                    fs.writeFileSync(
                      pendingUpdatePath,
                      JSON.stringify({ from: localVer, to: current, checkedAt: new Date().toISOString() }),
                      'utf-8'
                    );
                  } catch (e2) {}
                } else if (current) {
                  // Versions match — clear any stale notification so it doesn't show forever
                  try { fs.unlinkSync(pendingUpdatePath); } catch (e2) {}
                }
              });
              child.unref();
            }
          }
        } catch (e) { /* npm not available — skip silently */ }
      }
      // Surface any previously-detected update on every session restore (not just on check day)
      try {
        var pendingUpdate = path.join(CWD, '.monomind', 'pending-update.json');
        if (fs.existsSync(pendingUpdate)) {
          var upd = JSON.parse(fs.readFileSync(pendingUpdate, 'utf-8'));
          if (upd && upd.from && upd.to && upd.from !== upd.to) {
            console.log('[UPDATE_AVAILABLE] @monomind/cli ' + upd.from + ' → ' + upd.to + ' (run: npx monomind update)');
          }
        }
      } catch (e) {}
    } catch (e) { /* non-fatal */ }

    // ── Daemon Auto-Start Check ────────────────────────────────────────────
    // If daemon is not running, suggest starting it (or auto-start if config says so)
    try {
      var daemonPid = path.join(CWD, '.monomind', 'daemon.pid');
      var daemonRunning = false;
      if (fs.existsSync(daemonPid)) {
        try {
          var pid = parseInt(fs.readFileSync(daemonPid, 'utf-8').trim(), 10);
          process.kill(pid, 0); // throws if process doesn't exist
          daemonRunning = true;
        } catch (e) { /* pid stale */ }
      }
      if (!daemonRunning) {
        // Check config for autoStart preference
        var daemonCfg = {};
        try {
          var cfgPath = path.join(CWD, 'monomind.config.json');
          if (fs.existsSync(cfgPath)) daemonCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')).daemon || {};
        } catch (e) {}
        if (daemonCfg.autoStart) {
          // Auto-start daemon in background
          var spawn = require('child_process').spawn;
          var child = spawn('npx', ['monomind', 'daemon', 'start'], {
            cwd: CWD, detached: true, stdio: 'ignore'
          });
          child.on('error', function() {});
          child.unref();
          console.log('[DAEMON_AUTOSTART] Background daemon started (pid ' + child.pid + ')');
        } else {
          console.log('[DAEMON_STOPPED] Background daemon is not running. To auto-start, set daemon.autoStart=true in monomind.config.json or run: npx monomind daemon start');
        }
      }
    } catch (e) { /* non-fatal */ }

    // Token Usage — inject daily/monthly cost summary from JSONL session logs
    try {
      var tokenTracker = require('./token-tracker.cjs');
      var tokenSummary = tokenTracker.quickSummary();
      if (tokenSummary) {
        console.log(tokenSummary);
      }
      // Write structured cache for statusline (best-effort, non-blocking)
      try {
        var tokenData = tokenTracker.quickSummaryData();
        if (tokenData) {
          var metricsDir = path.join(CWD, '.monomind', 'metrics');
          if (!fs.existsSync(metricsDir)) fs.mkdirSync(metricsDir, { recursive: true });
          tokenData.cachedAt = new Date().toISOString();
          fs.writeFileSync(path.join(metricsDir, 'token-summary.json'), JSON.stringify(tokenData), 'utf-8');
        }
      } catch (_) { /* ignore cache write failure */ }
    } catch (e) { /* non-fatal — token tracker not available */ }

    // ── Registry Surfacing (SR-001) ─────────────────────────────────────
    // Show agent registry summary so users know what's available
    try {
      var regPath = path.join(CWD, '.monomind', 'registry.json');
      if (fs.existsSync(regPath)) {
        var reg = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
        var agentCount = (reg.agents || []).length;
        if (agentCount > 0) {
          console.log('[REGISTRY] ' + agentCount + ' agents available in registry');
        }
      }
    } catch (e) { /* non-fatal */ }

    // ── Monomind Control UI Status ────────────────────────────────────────
    try {
      var http = require('http');
      var controlPort = 4242;
      var req = http.get('http://localhost:' + controlPort + '/', function(res) {
        if (res.statusCode === 200) {
          console.log('[CONTROL_UI] UP — http://localhost:' + controlPort);
        }
        res.resume();
      });
      req.on('error', function() {
        console.log('[CONTROL_UI] offline — run: npx monomind mcp start');
      });
      req.setTimeout(800, function() { req.destroy(); });
    } catch (e) { /* non-fatal */ }

    // ── Worker Queue Resume (SR-003) ────────────────────────────────────
    try {
      var dispatchDir = path.join(CWD, '.monomind', 'worker-dispatch');
      if (fs.existsSync(dispatchDir)) {
        var pendingFiles = fs.readdirSync(dispatchDir).filter(function(f) { return f.startsWith('pending-'); });
        if (pendingFiles.length > 0) {
          console.log('[WORKER_RESUME] ' + pendingFiles.length + ' worker dispatch(es) pending from prior session');
        }
      }
    } catch (e) { /* non-fatal */ }
  },

  'session-end': async () => {
    // Consolidate intelligence (with timeout — #1530)
    if (intelligence && intelligence.consolidate) {
      var consResult = await runWithTimeout(function() { return intelligence.consolidate(); }, 'intelligence.consolidate()');
      if (consResult && consResult.entries > 0) {
        var msg = '[INTELLIGENCE] Consolidated: ' + consResult.entries + ' entries, ' + consResult.edges + ' edges';
        if (consResult.newEntries > 0) msg += ', ' + consResult.newEntries + ' new';
        msg += ', PageRank recomputed';
        console.log(msg);
      }
    }
    try {
      if (session && session.end) {
        session.end();
      } else {
        console.log('[OK] Session ended');
      }
    } catch (e) { console.log('[WARN] Session end failed: ' + e.message); }

    // ── Routing Feedback Loop (SE-001) ────────────────────────────────────
    // Persist routing accuracy feedback so the router improves over sessions
    try {
      var feedbackPath = path.join(CWD, '.monomind', 'routing-feedback.jsonl');
      var lastRoutePath = path.join(CWD, '.monomind', 'last-route.json');
      if (fs.existsSync(lastRoutePath)) {
        var lastRoute = JSON.parse(fs.readFileSync(lastRoutePath, 'utf-8'));
        var feedbackEntry = {
          timestamp: new Date().toISOString(),
          suggestedAgent: lastRoute.agent,
          confidence: lastRoute.confidence,
          sessionId: hookInput.sessionId || hookInput.session_id || '',
          // If intelligence gave feedback during session, it's recorded here
          intelligenceFeedback: (intelligence && intelligence.getSessionStats) ? intelligence.getSessionStats() : null,
        };
        fs.appendFileSync(feedbackPath, JSON.stringify(feedbackEntry) + '\n', 'utf-8');
        // Rotate: keep last 1000 lines to prevent unbounded growth
        try {
          var raw = fs.readFileSync(feedbackPath, 'utf-8');
          var lines = raw.split('\n').filter(Boolean);
          if (lines.length > 1000) {
            fs.writeFileSync(feedbackPath, lines.slice(-1000).join('\n') + '\n', 'utf-8');
          }
        } catch (e2) { /* rotation is best-effort */ }
      }
    } catch (e) { /* non-fatal */ }

    // Memory Palace tombstone writes removed — redundant with raw session JSONL

    // ── Learning Service Auto-Consolidation ─────────────────────────────
    // Consolidate learned patterns from short-term to long-term storage.
    // Uses module-level singleton (getLearningService) so the DB is not
    // reopened on every session-end — state accumulated during the session
    // is preserved and consolidated in a single pass.
    try {
      var ls = await getLearningService();
      if (ls && ls.consolidate) {
        var lResult = await runWithTimeout(function() { return ls.consolidate(); }, 'learning.consolidate()');
        if (lResult && lResult.promoted > 0) {
          console.log('[LEARNING] Consolidated: ' + lResult.promoted + ' patterns promoted to long-term');
        }
      }
    } catch (e) { /* non-fatal — learning-service may need better-sqlite3 */ }

    // ── Context Persistence Auto-Archive ─────────────────────────────────
    // Archive conversation context so it survives compaction and new sessions
    try {
      var cpHook = await import('file://' + path.join(__dirname, 'context-persistence-hook.mjs'));
      if (cpHook && cpHook.archive) {
        await runWithTimeout(function() { return cpHook.archive(); }, 'context-persistence.archive()');
        console.log('[CONTEXT_PERSIST] Session transcript archived');
      } else if (cpHook && cpHook.default && cpHook.default.archive) {
        await runWithTimeout(function() { return cpHook.default.archive(); }, 'context-persistence.archive()');
        console.log('[CONTEXT_PERSIST] Session transcript archived');
      }
    } catch (e) { /* non-fatal — context-persistence may not export archive() */ }

    // ── Worker Queue Cleanup ─────────────────────────────────────────────
    // Process and clean up any pending worker dispatch files
    try {
      var dispatchDir = path.join(CWD, '.monomind', 'worker-dispatch');
      if (fs.existsSync(dispatchDir)) {
        var pending = fs.readdirSync(dispatchDir).filter(function(f) { return f.startsWith('pending-'); });
        if (pending.length > 0) {
          console.log('[WORKER_CLEANUP] ' + pending.length + ' worker dispatch(es) pending from this session');
        }
        // Move to processed
        var processedDir = path.join(dispatchDir, 'processed');
        fs.mkdirSync(processedDir, { recursive: true });
        pending.forEach(function(f) {
          try {
            fs.renameSync(path.join(dispatchDir, f), path.join(processedDir, f));
          } catch (e) { /* ignore */ }
        });
        // Trim processed/ to last 200 files to prevent unbounded growth
        try {
          var processedFiles = fs.readdirSync(processedDir)
            .filter(function(f) { return f.startsWith('pending-'); })
            .map(function(f) { var fp = path.join(processedDir, f); var mt = 0; try { mt = fs.statSync(fp).mtimeMs; } catch(e2){} return { f: f, mt: mt }; })
            .sort(function(a, b) { return a.mt - b.mt; });
          if (processedFiles.length > 200) {
            processedFiles.slice(0, processedFiles.length - 200).forEach(function(item) {
              try { fs.unlinkSync(path.join(processedDir, item.f)); } catch (e2) { /* ignore */ }
            });
          }
        } catch (e2) { /* non-fatal */ }
      }
    } catch (e) { /* non-fatal */ }
  },

  'pre-task': async () => {
    if (session && session.metric) {
      try { session.metric('tasks'); } catch (e) { /* no active session */ }
    }

    // ── Task 27: PerRunModelTier — inline complexity scoring ───────────────
    var taskStr = typeof prompt === 'string' ? prompt : '';
    if (taskStr) {
      var score = 50;
      var lower = taskStr.toLowerCase();
      var words = taskStr.trim().split(/\s+/).length;
      if (words < 20) score -= 20;
      if (words > 100) score += 20;
      if (words > 200) score += 10;
      var highKw = ['architecture','distributed','security audit','cve','consensus','fault-tolerant','migrate','refactor across','orchestrat','design system','database schema','performance optim','threat model','encryption','zero-knowledge'];
      var lowKwRe = /\b(format|list|rename|sort|typo|lint|log|comment|print|echo|delete unused|remove import)\b/i;
      if (highKw.some(function(k) { return lower.includes(k); })) score += 10;
      if (lowKwRe.test(lower)) score -= 10;
      if (/(?:step\s*\d|first[\s,].*then[\s,]|phase\s*\d)/i.test(taskStr)) score += 10;
      if (/```[\s\S]*?```/.test(taskStr) || /\b[\w.-]+\/[\w./-]+\b/.test(taskStr)) score += 5;
      score = Math.max(0, Math.min(100, score));
      var tier = score < 30 ? 'haiku' : score > 70 ? 'opus' : 'sonnet';
      console.log('[TASK_MODEL_RECOMMENDATION] Use model="' + tier + '" (complexity=' + score + ')');
    }
    // Task 06: AutoRetry — signal retry policy only if coordinator path is active
    if (hookInput.swarmCoordinator || hookInput.coordinator || hookInput.useRetry) {
      console.log('[AUTO_RETRY_ENABLED] maxAttempts=3 strategy=exponential-backoff backoffMs=1000');
    }

    if (router && prompt) {
      var routeFn = router.routeTaskSemantic || router.routeTask;
      var result = await Promise.resolve(routeFn(prompt));
      console.log('[INFO] Task routed to: ' + result.agent + ' (confidence: ' + result.confidence + ')');
    } else {
      console.log('[OK] Task started');
    }

    // Task 24: PromptVersioning — resolve prompt variant before agent spawn
    try {
      var memMod = await import('@monomind/memory');
      if (memMod && memMod.PromptVersionStore) {
        var pvStore = new memMod.PromptVersionStore(path.join(CWD, '.monomind', 'prompt-versions'));
        var pvMod = await import('file://' + path.join(CWD, 'packages/@monomind/cli/dist/src/agents/prompt-experiment.js'));
        if (pvMod && pvMod.PromptExperimentRouter) {
          var pvRouter = new pvMod.PromptExperimentRouter(pvStore);
          var agentSlug24 = hookInput.agentSlug || hookInput.agentType || hookInput.agent_type || 'unknown';
          if (agentSlug24 !== 'unknown') {
            var resolved = pvRouter.resolvePromptForSpawn(agentSlug24);
            if (resolved.version) {
              console.log('[PROMPT_VERSION] ' + agentSlug24 + ' v' + resolved.version + (resolved.isCandidate ? ' (experiment candidate)' : ''));
            }
          }
        }
      }
    } catch (e) { /* not available or no experiment */ }

    // Monograph impact — detect changed files and surface their dependents
    try {
      var mgDbPath1 = path.join(CWD, '.monomind', 'monograph.db');
      if (fs.existsSync(mgDbPath1)) {
        var execSync1 = require('child_process').execSync;
        var changedFiles1 = '';
        try { changedFiles1 = execSync1('git diff --name-only HEAD 2>/dev/null || git diff --name-only 2>/dev/null', { cwd: CWD, timeout: 3000, shell: true }).toString().trim(); } catch(e) {}
        if (changedFiles1) {
          var mgMod1 = null;
          mgMod1 = _requireMonograph();
          if (mgMod1 && mgMod1.openDb) {
            var db1 = mgMod1.openDb(mgDbPath1);
            try {
              var fileList1 = changedFiles1.split('\n').filter(Boolean).slice(0, 8);
              var impacted1 = [];
              for (var fi = 0; fi < fileList1.length; fi++) {
                var fBase = path.basename(fileList1[fi]);
                var fNode = db1.prepare("SELECT id, name, label FROM nodes WHERE file_path LIKE ? LIMIT 1").get('%' + fBase);
                if (fNode) {
                  var fImporters = db1.prepare(
                    'SELECT n2.name FROM edges e JOIN nodes n2 ON n2.id = e.source_id WHERE e.target_id = ? LIMIT 5'
                  ).all(fNode.id);
                  var entry = fNode.name + ' (' + fNode.label + ')';
                  if (fImporters.length) entry += ' ← ' + fImporters.map(function(i){ return i.name; }).join(', ');
                  impacted1.push(entry);
                }
              }
              if (impacted1.length > 0) {
                console.log('[MONOGRAPH_IMPACT] Changed files and their dependents: ' + impacted1.join(' | '));
              }

              // Effective blast radius — second pass using first impacted node
              try {
                if (fileList1.length > 0 && mgMod1.effectiveBlastRadius) {
                  var firstFile1 = path.basename(fileList1[0]);
                  var firstNode1 = db1.prepare("SELECT id, name, label FROM nodes WHERE file_path LIKE ? LIMIT 1").get('%' + firstFile1);
                  if (firstNode1) {
                    var blastResults1 = mgMod1.effectiveBlastRadius(db1, firstNode1.id, { maxDepth: 4 });
                    if (blastResults1 && blastResults1.length > 0) {
                      var bwdCount1 = blastResults1.filter(function(r){ return r.direction === 'backward' || r.direction === 'both'; }).length;
                      var fwdCount1 = blastResults1.filter(function(r){ return r.direction === 'forward' || r.direction === 'both'; }).length;
                      var topBlast1 = blastResults1.slice(0, 8).map(function(r){
                        return '[' + r.direction + ':' + r.hops + '] ' + r.nodeName + ' (' + r.nodeLabel + ')';
                      });
                      console.log('[MONOGRAPH_BLAST_RADIUS] Node: ' + firstNode1.name + ' | forward=' + fwdCount1 + ' backward=' + bwdCount1 + ' | ' + topBlast1.join(', '));
                    }
                  }
                }
              } catch(blastErr) { /* non-fatal */ }
            } finally { if (mgMod1.closeDb) mgMod1.closeDb(db1); }
          }
        }
      }
    } catch(e) { /* non-fatal */ }

    // Bridge to @monomind/hooks registry — fires Tasks 26 (PromptAssembler) and any other PreTask hooks
    if (_hooksModule && _hooksModule.executeHooks && _hooksModule.HookEvent) {
      try {
        await _hooksModule.executeHooks(_hooksModule.HookEvent.PreTask, {
          task: typeof prompt === 'string' ? { description: prompt, id: hookInput.taskId || '' } : null,
          sessionId: hookInput.sessionId || hookInput.session_id || 'default',
        }, { continueOnError: true, timeout: 2000 });
      } catch (e) { /* non-fatal */ }
    }
  },

  'post-task': async () => {
    var taskSuccess = hookInput.success !== false && hookInput.status !== 'failed';
    if (intelligence && intelligence.feedback) {
      try {
        intelligence.feedback(true);
      } catch (e) { /* non-fatal */ }
    }
    // Each TeammateIdle/TaskCompleted = one agent done → remove oldest registration (FIFO)
    const regDir = path.join(CWD, '.monomind', 'agents', 'registrations');
    try {
      if (fs.existsSync(regDir)) {
        const files = fs.readdirSync(regDir).filter(f => f.endsWith('.json'));
        if (files.length > 0) {
          // Sort by mtime ascending (oldest first) and remove the oldest one
          const sorted = files
            .map(f => ({ f, mtime: (() => { try { return fs.statSync(path.join(regDir, f)).mtimeMs; } catch { return 0; } })() }))
            .sort((a, b) => a.mtime - b.mtime);
          try { fs.unlinkSync(path.join(regDir, sorted[0].f)); } catch { /* ignore */ }
        }
        // Also purge any stragglers older than 30 min
        const now = Date.now();
        for (const f of fs.readdirSync(regDir).filter(f => f.endsWith('.json'))) {
          try { if (now - fs.statSync(path.join(regDir, f)).mtimeMs > 30 * 60 * 1000) fs.unlinkSync(path.join(regDir, f)); } catch { /* ignore */ }
        }
        const remaining = fs.readdirSync(regDir).filter(f => f.endsWith('.json')).length;
        const _actPath = path.join(CWD, '.monomind', 'metrics', 'swarm-activity.json');
        let _prevLastActive = 0;
        try { _prevLastActive = (JSON.parse(fs.readFileSync(_actPath, 'utf-8'))?.swarm?.lastActive) || 0; } catch { /* ignore */ }
        fs.writeFileSync(_actPath, JSON.stringify({
          timestamp: new Date().toISOString(),
          swarm: {
            active: remaining > 0,
            agent_count: remaining,
            coordination_active: remaining > 0,
            lastActive: Math.max(remaining, _prevLastActive), // preserve peak across completion
          },
        }));
      }
    } catch (e) { /* non-fatal */ }
    // Bridge to @monomind/hooks registry — fires Tasks 39 (SpecializationScorer) and any other PostTask hooks
    if (_hooksModule && _hooksModule.executeHooks && _hooksModule.HookEvent) {
      try {
        await _hooksModule.executeHooks(_hooksModule.HookEvent.PostTask, {
          task: {
            id: hookInput.taskId || hookInput.task_id || '',
            status: taskSuccess ? 'completed' : 'failed',
            agentSlug: hookInput.agentSlug || hookInput.agent_slug || 'unknown',
            type: hookInput.taskType || hookInput.task_type || 'general',
          },
          success: taskSuccess,
          latencyMs: hookInput.latencyMs || hookInput.latency_ms || 0,
          qualityScore: hookInput.qualityScore || hookInput.quality_score,
        }, { continueOnError: true, timeout: 2000 });
      } catch (e) { /* non-fatal */ }
    }
    // Task 35: TerminationConditions — detect halted swarms via halt-signal
    try {
      var haltMod = await import('file://' + path.join(CWD, 'packages/@monomind/cli/dist/src/agents/halt-signal.js'));
      if (haltMod && haltMod.isHalted) {
        var swarmId35 = hookInput.swarmId || hookInput.swarm_id || 'default';
        if (haltMod.isHalted(swarmId35)) {
          console.warn('[HALT_DETECTED] Swarm ' + swarmId35 + ' has an active halt signal — agents should stop');
        }
      }
    } catch (e) {
      // Try direct file check
      try {
        var haltFile = path.join(CWD, 'data', 'halt-signals.jsonl');
        if (fs.existsSync(haltFile)) {
          var haltLines = fs.readFileSync(haltFile, 'utf-8').trim().split('\n').filter(Boolean);
          if (haltLines.length > 0) {
            console.warn('[HALT_DETECTED] ' + haltLines.length + ' halt signal(s) present');
          }
        }
      } catch (e2) { /* non-fatal */ }
    }

    // Task 37: DeadLetterQueue — enqueue failed tasks when retries exhausted
    try {
      if (!taskSuccess) {
        var dlqMod = await import('file://' + path.join(CWD, 'packages/@monomind/cli/dist/src/dlq/dlq-writer.js'));
        if (dlqMod && dlqMod.DLQWriter) {
          var dlqDir = path.join(CWD, '.monomind', 'dlq');
          var dlqWriter = new dlqMod.DLQWriter(dlqDir);
          dlqWriter.enqueue({
            toolName: 'post-task',
            originalPayload: { taskId: hookInput.taskId || '', agentSlug: hookInput.agentSlug || 'unknown' },
            deliveryAttempts: [{ attempt: 1, timestamp: new Date().toISOString(), error: hookInput.error || 'task failed' }],
            agentId: hookInput.agentSlug || hookInput.agent_slug,
            swarmId: hookInput.swarmId || hookInput.swarm_id,
          });
          console.log('[DLQ_ENQUEUED] Failed task ' + (hookInput.taskId || 'unknown') + ' sent to dead-letter queue');
        }
      }
    } catch (e) { /* non-fatal */ }

    // Memory Palace task drawer writes removed — use auto-memory files for task context

    // ── Worker Auto-Dispatch ──────────────────────────────────────────────
    // Auto-dispatch background workers based on task outcome
    try {
      var taskDesc = (typeof prompt === 'string' ? prompt : hookInput.description || '').toLowerCase();
      var workersToDispatch = [];

      // Always consolidate memory after any task
      workersToDispatch.push('consolidate');

      // Security-related task → dispatch audit worker
      if (/\b(security|auth|vuln|cve|threat|token|permission|crypto)\b/.test(taskDesc)) {
        workersToDispatch.push('audit');
      }
      // Performance-related → dispatch benchmark worker
      if (/\b(performance|optimiz|benchmark|latency|throughput)\b/.test(taskDesc)) {
        workersToDispatch.push('benchmark');
      }
      // Code changes → dispatch testgaps worker
      if (/\b(implement|feature|refactor|fix|build|add|create|modify)\b/.test(taskDesc)) {
        workersToDispatch.push('testgaps');
      }
      // Any significant task → dispatch map worker for codebase indexing
      if (taskDesc.length > 50) {
        workersToDispatch.push('map');
      }

      // Dispatch via @monomind/hooks if available, otherwise write dispatch file
      if (workersToDispatch.length > 0) {
        var dispatchDir = path.join(CWD, '.monomind', 'worker-dispatch');
        fs.mkdirSync(dispatchDir, { recursive: true });
        var dispatchPayload = {
          workers: workersToDispatch,
          trigger: 'post-task',
          taskDesc: taskDesc.substring(0, 100),
          success: taskSuccess,
          timestamp: new Date().toISOString(),
        };
        fs.writeFileSync(
          path.join(dispatchDir, 'pending-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.json'),
          JSON.stringify(dispatchPayload), 'utf-8'
        );
        console.log('[WORKER_DISPATCH] Queued: ' + workersToDispatch.join(', '));
      }
    } catch (e) { /* non-fatal */ }

    // ── ADR Auto-Generation ────────────────────────────────────────────────
    // When adr.autoGenerate is true and task involved architect-level work,
    // create an ADR stub in the configured directory
    try {
      var settingsPath = path.join(CWD, '.claude', 'settings.json');
      var adrCfg = {};
      if (fs.existsSync(settingsPath)) {
        var s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        adrCfg = (s.monomind && s.monomind.adr) || {};
      }
      if (adrCfg.autoGenerate) {
        var taskAgent = hookInput.agentSlug || hookInput.agent_slug || '';
        var taskDescAdr = (typeof prompt === 'string' ? prompt : hookInput.description || '').toLowerCase();
        var isArchitectLevel = ['architect', 'system-architect', 'software-architect'].includes(taskAgent)
          || /\b(architecture|design decision|adr|trade-?off|migration strategy)\b/.test(taskDescAdr);
        if (isArchitectLevel && taskDescAdr.length > 30) {
          var adrDir = path.join(CWD, adrCfg.directory || 'docs/adrs');
          fs.mkdirSync(adrDir, { recursive: true });
          var adrNum = (fs.readdirSync(adrDir).filter(function(f) { return f.endsWith('.md'); }).length + 1)
            .toString().padStart(4, '0');
          var adrTitle = taskDescAdr.substring(0, 60).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          var adrFile = path.join(adrDir, 'ADR-' + adrNum + '-' + adrTitle + '.md');
          if (!fs.existsSync(adrFile)) {
            var adrContent = '# ADR-' + adrNum + ': ' + (typeof prompt === 'string' ? prompt.substring(0, 80) : adrTitle) + '\n\n'
              + '**Date:** ' + new Date().toISOString().slice(0, 10) + '\n'
              + '**Status:** Accepted\n'
              + '**Agent:** ' + (taskAgent || 'unknown') + '\n\n'
              + '## Context\n\nAuto-generated from task completion.\n\n'
              + '## Decision\n\n_Fill in the decision made._\n\n'
              + '## Consequences\n\n_Fill in the consequences._\n';
            fs.writeFileSync(adrFile, adrContent, 'utf-8');
            console.log('[ADR_GENERATED] ' + path.basename(adrFile));
          }
        }
      }
    } catch (e) { /* non-fatal */ }

    console.log('[OK] Task completed');
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
