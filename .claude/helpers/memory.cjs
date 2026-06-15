'use strict';
/**
 * Memory context bridge for hook-handler.cjs
 * Bridges to the CLI memory subsystem via file-based storage fallback.
 * Used by handlers to retrieve relevant context and store outcomes.
 */

const path = require('path');
const fs = require('fs');

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MEMORY_DIR = path.join(CWD, '.monomind', 'memory');
const MEMORY_INDEX = path.join(MEMORY_DIR, 'hook-memory.json');

function ensureDir() {
  try { fs.mkdirSync(MEMORY_DIR, { recursive: true }); } catch (_) {}
}

var MAX_INDEX_SIZE = 50 * 1024 * 1024; // 50 MiB guard

function loadIndex() {
  try {
    if (!fs.existsSync(MEMORY_INDEX)) return [];
    var st = fs.statSync(MEMORY_INDEX);
    if (st.size > MAX_INDEX_SIZE) return [];
    return JSON.parse(fs.readFileSync(MEMORY_INDEX, 'utf-8'));
  } catch (_) {
    return [];
  }
}

function saveIndex(entries) {
  ensureDir();
  try {
    // Keep most recent 500 entries
    var trimmed = entries.slice(-500);
    fs.writeFileSync(MEMORY_INDEX, JSON.stringify(trimmed, null, 2), 'utf-8');
  } catch (_) {}
}

function store(key, value, namespace) {
  var entries = loadIndex();
  var ns = String(namespace || 'default').slice(0, 128);
  key = String(key || '').slice(0, 512);
  // Remove existing entry with same key+namespace
  entries = entries.filter(function(e) { return !(e.key === key && e.namespace === ns); });
  entries.push({ key: key, value: value, namespace: ns, storedAt: new Date().toISOString() });
  saveIndex(entries);
}

function retrieve(query, namespace) {
  var entries = loadIndex();
  var ns = namespace || null;
  if (ns) entries = entries.filter(function(e) { return e.namespace === ns; });
  if (!query) return entries.slice(-10);
  // Simple keyword search
  var q = String(query).toLowerCase();
  var scored = entries.map(function(e) {
    var text = (e.key + ' ' + JSON.stringify(e.value || '')).toLowerCase();
    var score = 0;
    var words = q.split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      if (words[i] && text.includes(words[i])) score++;
    }
    return { entry: e, score: score };
  });
  return scored
    .filter(function(s) { return s.score > 0; })
    .sort(function(a, b) { return b.score - a.score; })
    .slice(0, 10)
    .map(function(s) { return s.entry; });
}

module.exports = { store, retrieve };
