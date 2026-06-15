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

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB guard
const RING_BUFFER_MAX = 50;

var _entries = [];        // deduplicated memory entries loaded from store
var _recentEdits = [];    // ring buffer of recently edited paths

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

  var promptWords = prompt.toLowerCase().split(/\W+/).filter(Boolean);
  var promptSet = new Set(promptWords);

  var matches = _entries.filter(function(e) {
    var content = ((e.content || '') + ' ' + (e.summary || '')).toLowerCase();
    var words = content.split(/\W+/).filter(Boolean);
    return words.some(function(w) { return promptSet.has(w); });
  });

  if (matches.length === 0) return null;

  var top = matches[0];
  return '[INTELLIGENCE] ' + (top.summary || top.content || top.id || 'context match');
}

// ── recordEdit ────────────────────────────────────────────────────────────────

function recordEdit(filePath) {
  _recentEdits.push({ path: String(filePath || ''), ts: Date.now() });
  if (_recentEdits.length > RING_BUFFER_MAX) {
    _recentEdits = _recentEdits.slice(-RING_BUFFER_MAX);
  }
}

// ── consolidate ───────────────────────────────────────────────────────────────

function consolidate() {
  ensureDataDir();
  var lines = safeReadLines(PENDING_FILE);
  var count = lines.length;

  // Clear the pending file
  try { fs.writeFileSync(PENDING_FILE, '', 'utf-8'); } catch (_) {}

  return { entries: count, edges: 0, newEntries: count };
}

// ── feedback ──────────────────────────────────────────────────────────────────

function feedback(success) {
  ensureDataDir();
  var record = JSON.stringify({
    ts: Date.now(),
    success: !!success,
    context: null,
    recentEdits: _recentEdits.slice(),
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

module.exports = { init, getContext, recordEdit, consolidate, feedback, stats, logTrajectory, storePattern };
