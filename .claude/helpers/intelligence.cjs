'use strict';
/**
 * Intelligence context module for hook-handler.cjs
 * Provides context injection, trajectory logging, feedback recording,
 * edit tracking, consolidation, and stats.
 *
 * Data directory: $CLAUDE_PROJECT_DIR/.monomind/data/
 *   auto-memory-store.json      — persisted memory entries
 *   ranked-context.json         — ranked view written by init()
 *   pending-insights.jsonl      — pending entries to consolidate
 *   intelligence-outcomes.jsonl — feedback records
 */

const path = require('path');
const fs = require('fs');

// Resolve base dir at require-time so tests can inject CLAUDE_PROJECT_DIR
// per fresh require() call.
const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const DATA_DIR = path.join(CWD, '.monomind', 'data');
const STORE_FILE = path.join(DATA_DIR, 'auto-memory-store.json');
const RANKED_FILE = path.join(DATA_DIR, 'ranked-context.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending-insights.jsonl');
const OUTCOMES_FILE = path.join(DATA_DIR, 'intelligence-outcomes.jsonl');
const RECENT_EDITS_FILE = path.join(DATA_DIR, 'recent-edits.jsonl');

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB guard
const RING_BUFFER_MAX = 50;

var _entries = [];        // deduplicated memory entries loaded from store
var _recentEdits = [];    // ring buffer of recently edited paths (in-memory, may be empty across subprocesses)
var _lastContext = null;  // last non-null context returned by getContext()

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
}

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    var st = fs.statSync(filePath);
    if (st.size > MAX_FILE_SIZE) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) { return null; }
}

function safeReadLines(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    var st = fs.statSync(filePath);
    if (st.size > MAX_FILE_SIZE) return [];
    return fs.readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter(function(l) { return l.trim().length > 0; });
  } catch (_) { return []; }
}

// ── init ───────────────────────────────────────────────────────────────────────

function init() {
  ensureDataDir();

  // Load entries from store, deduplicate by id
  var raw = safeReadJson(STORE_FILE);
  var arr = Array.isArray(raw) ? raw : [];
  var seen = new Set();
  _entries = arr.filter(function(e) {
    var key = e && e.id ? String(e.id) : null;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Bootstrap from monograph when store is sparse — called externally via bootstrapFromDb(db)

  // Write ranked-context.json (sorted by confidence desc) with version envelope
  var ranked = _entries.slice().sort(function(a, b) {
    return (b.confidence || 0) - (a.confidence || 0);
  });
  try {
    fs.writeFileSync(RANKED_FILE, JSON.stringify({ version: 1, entries: ranked }, null, 2), 'utf-8');
  } catch (_) {}

  return { nodes: _entries.length, edges: 0 };
}

// ── getContext ─────────────────────────────────────────────────────────────────

function getContext(prompt) {
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') return null;
  if (_entries.length === 0) return null;

  var promptWords = prompt.toLowerCase().split(/\W+/).filter(function(w) { return w.length >= 3; });
  var promptSet = new Set(promptWords);
  if (promptSet.size < 2) return null; // need at least 2 meaningful words

  var scored = [];
  for (var i = 0; i < _entries.length; i++) {
    var e = _entries[i];
    var content = ((e.content || '') + ' ' + (e.summary || '')).toLowerCase();
    var words = content.split(/\W+/).filter(function(w) { return w.length >= 3; });
    var hits = 0;
    for (var j = 0; j < words.length; j++) {
      if (promptSet.has(words[j])) hits++;
    }
    // Require at least 2 distinct word matches to reduce false positives
    if (hits >= 2) {
      scored.push({ entry: e, hits: hits });
    }
  }

  if (scored.length === 0) return null;

  // Sort by hit count descending, then by confidence
  scored.sort(function(a, b) {
    if (b.hits !== a.hits) return b.hits - a.hits;
    return (b.entry.confidence || 0) - (a.entry.confidence || 0);
  });

  var top = scored[0].entry;
  var result = '[INTELLIGENCE] ' + (top.summary || top.content || top.id || 'context match');
  _lastContext = result;
  return result;
}

// ── recordEdit ────────────────────────────────────────────────────────────────

function recordEdit(filePath) {
  var entry = { path: String(filePath || ''), ts: Date.now() };
  _recentEdits.push(entry);
  if (_recentEdits.length > RING_BUFFER_MAX) {
    _recentEdits = _recentEdits.slice(-RING_BUFFER_MAX);
  }
  // Persist to disk so other subprocesses (e.g. feedback()) can read edits
  ensureDataDir();
  try { fs.appendFileSync(RECENT_EDITS_FILE, JSON.stringify(entry) + '\n', 'utf-8'); } catch (_) {}
}

// ── consolidate ───────────────────────────────────────────────────────────────

function consolidate() {
  ensureDataDir();
  var lines = safeReadLines(PENDING_FILE);
  var count = lines.length;

  // Clear the pending file
  try { fs.writeFileSync(PENDING_FILE, '', 'utf-8'); } catch (_) {}

  // Read accumulated session edits (not yet consumed by feedback)
  var sessionEdits = [];
  var editLines = safeReadLines(RECENT_EDITS_FILE);
  for (var ei = 0; ei < editLines.length; ei++) {
    try { sessionEdits.push(JSON.parse(editLines[ei])); } catch (_) {}
  }
  // Clear recent-edits after consolidation (session boundary)
  try { fs.writeFileSync(RECENT_EDITS_FILE, '', 'utf-8'); } catch (_) {}

  // Synthesize successful patterns from outcomes into auto-memory-store.json
  var outcomeLines = safeReadLines(OUTCOMES_FILE);
  var newStoreEntries = [];
  for (var i = 0; i < outcomeLines.length; i++) {
    try {
      var outcome = JSON.parse(outcomeLines[i]);
      if (!outcome.success) continue;
      // Use outcome's own edits if present, otherwise use session-level edits
      var edits = (Array.isArray(outcome.recentEdits) && outcome.recentEdits.length > 0)
        ? outcome.recentEdits
        : sessionEdits;
      if (edits.length === 0) continue;
      var editPaths = edits.map(function(e) {
        // e is either { path: '...', ts: ... } or a raw string
        if (typeof e === 'string') return e;
        // Use e.path if it's a non-empty string; skip objects without a valid path
        return (e && typeof e.path === 'string' && e.path.length > 0) ? e.path : null;
      }).filter(function(p) { return p !== null; });
      // Deduplicate paths
      var uniquePaths = [];
      var pathSeen = {};
      for (var pi = 0; pi < editPaths.length; pi++) {
        var p = String(editPaths[pi]);
        if (!pathSeen[p]) { pathSeen[p] = true; uniquePaths.push(p); }
      }
      newStoreEntries.push({
        id: 'auto-' + (outcome.ts || Date.now()) + '-' + i,
        type: 'pattern',
        content: 'Successful edit pattern: ' + uniquePaths.map(function(p) { return path.basename(p); }).join(', '),
        summary: outcome.context || 'Successful task editing ' + uniquePaths.length + ' files: ' + uniquePaths.slice(0, 5).map(function(p) { return path.basename(p); }).join(', '),
        confidence: 0.6,
        files: uniquePaths,
        ts: outcome.ts || Date.now(),
      });
    } catch (_) {}
  }

  if (newStoreEntries.length > 0) {
    // Merge with existing store entries
    var existing = safeReadJson(STORE_FILE);
    var store = Array.isArray(existing) ? existing : [];
    var existingIds = new Set(store.map(function(e) { return e && e.id; }));
    for (var j = 0; j < newStoreEntries.length; j++) {
      if (!existingIds.has(newStoreEntries[j].id)) {
        store.push(newStoreEntries[j]);
      }
    }
    // Cap store at 200 entries to prevent unbounded growth
    if (store.length > 200) {
      store.sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); });
      store = store.slice(0, 200);
    }
    try {
      fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
    } catch (_) {}
    count += newStoreEntries.length;
  }

  // Rotate outcomes: keep last 500 lines to prevent unbounded growth
  if (outcomeLines.length > 500) {
    try {
      fs.writeFileSync(OUTCOMES_FILE, outcomeLines.slice(-500).join('\n') + '\n', 'utf-8');
    } catch (_) {}
  }

  return { entries: count, edges: 0, newEntries: newStoreEntries.length };
}

// ── feedback ──────────────────────────────────────────────────────────────────

function feedback(success) {
  ensureDataDir();
  // Read persisted edits from disk (survives subprocess boundaries).
  // We intentionally do NOT clear recent-edits.jsonl here — that is done by
  // consolidate() at session-end. This prevents post-task (subagent completion)
  // from clearing edits that belong to the broader session's work.
  var diskEdits = [];
  var diskLines = safeReadLines(RECENT_EDITS_FILE);
  for (var i = 0; i < diskLines.length; i++) {
    try { diskEdits.push(JSON.parse(diskLines[i])); } catch (_) {}
  }
  // Use disk edits if available, fall back to in-memory buffer
  var edits = diskEdits.length > 0 ? diskEdits.slice(-RING_BUFFER_MAX) : _recentEdits.slice();
  var record = JSON.stringify({
    ts: Date.now(),
    success: !!success,
    context: _lastContext,
    recentEdits: edits,
  }) + '\n';
  try { fs.appendFileSync(OUTCOMES_FILE, record, 'utf-8'); } catch (_) {}
}

// ── stats ─────────────────────────────────────────────────────────────────────

function stats(asJson) {
  var result = {
    entries: _entries.length,
    recentEdits: _recentEdits.length,
    pending: safeReadLines(PENDING_FILE).length,
  };
  if (asJson) return JSON.stringify(result);
  return result;
}

// ── legacy ────────────────────────────────────────────────────────────────────

function logTrajectory(step) {
  // no-op stub for backward compatibility
  void step;
}

function storePattern(pattern) {
  // no-op stub for backward compatibility
  void pattern;
}

// ── AutoMem bridges — lazy-load the compiled intelligence module and expose ──
// ── its pattern-recall/decision-recording helpers to the .cjs hook handlers ──

var _intelligenceMod = null;

async function _loadIntelligenceMod() {
  if (_intelligenceMod) return _intelligenceMod;
  try {
    _intelligenceMod = await import('file://' + path.join(CWD, 'packages/@monomind/cli/dist/src/memory/intelligence.js'));
  } catch (_) {
    _intelligenceMod = null;
  }
  return _intelligenceMod;
}

async function findSimilarPatterns(query, options) {
  var mod = await _loadIntelligenceMod();
  if (mod && mod.findSimilarPatterns) return mod.findSimilarPatterns(query, options);
  return [];
}

async function recordMemoryDecision(input) {
  var mod = await _loadIntelligenceMod();
  if (mod && mod.recordMemoryDecision) return mod.recordMemoryDecision(input);
}

// Bootstrap intelligence store from an already-open monograph DB handle.
// Called from route-handler on first prompt when store is sparse.
function bootstrapFromDb(db) {
  if (!db || _entries.length >= 5) return 0;
  try {
    var hubs = db.prepare(
      "SELECT n.name, n.label, n.file, COUNT(e.id) AS deg " +
      "FROM nodes n JOIN edges e ON (e.source = n.id OR e.target = n.id) " +
      "WHERE n.label IN ('File','Function','Class') AND n.file NOT LIKE '%node_modules%' AND n.file NOT LIKE '%dist/%' " +
      "GROUP BY n.id ORDER BY deg DESC LIMIT 10"
    ).all();
    if (hubs.length === 0) return 0;
    var existingIds = new Set(_entries.map(function(e) { return e.id; }));
    var added = 0;
    for (var hi = 0; hi < hubs.length; hi++) {
      var h = hubs[hi];
      var bId = 'bootstrap-hub-' + hi;
      if (existingIds.has(bId)) continue;
      _entries.push({
        id: bId,
        type: 'hub',
        content: h.name + ' (' + h.label + ') — ' + (h.file || '').replace(CWD + '/', '') + ' (' + h.deg + ' connections)',
        summary: 'Key codebase hub: ' + h.name + ' with ' + h.deg + ' dependencies',
        confidence: 0.4,
        files: h.file ? [h.file] : [],
        ts: Date.now(),
      });
      added++;
    }
    if (added > 0) {
      ensureDataDir();
      try { fs.writeFileSync(STORE_FILE, JSON.stringify(_entries, null, 2), 'utf-8'); } catch (_) {}
    }
    return added;
  } catch (_) { return 0; }
}

module.exports = { init, getContext, recordEdit, consolidate, feedback, stats, logTrajectory, storePattern, findSimilarPatterns, recordMemoryDecision, bootstrapFromDb };
