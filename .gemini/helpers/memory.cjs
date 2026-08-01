'use strict';
/**
 * Memory context bridge for hook-handler.cjs
 * Also usable as a CLI script: node memory.cjs [get|set|delete|clear|keys] [args...]
 *
 * CLI data path: $CLAUDE_PROJECT_DIR/.monomind/data/memory.json  (or process.cwd())
 * Module API:    store(key, value, namespace), retrieve(query, namespace)
 */

const path = require('path');
const fs = require('fs');

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// ── CLI storage (flat JSON key→value map) ─────────────────────────────────────

const DATA_DIR = path.join(CWD, '.monomind', 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
}

function loadMemory() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) return {};
    var st = fs.statSync(MEMORY_FILE);
    if (st.size > 10 * 1024 * 1024) return {};
    return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
  } catch (_) {
    return {};
  }
}

function saveMemory(data) {
  ensureDataDir();
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (_) {}
}

// ── CLI commands ──────────────────────────────────────────────────────────────

function cmdGet(key) {
  var data = loadMemory();
  if (!key) {
    // Return all non-internal keys
    var out = {};
    for (var k in data) {
      if (!k.startsWith('_')) out[k] = data[k];
    }
    process.stdout.write(JSON.stringify(out) + '\n');
    return;
  }
  if (Object.prototype.hasOwnProperty.call(data, key)) {
    process.stdout.write(JSON.stringify(data[key]) + '\n');
  } else {
    process.stdout.write('undefined\n');
  }
  process.exit(0);
}

function cmdSet(key, value) {
  if (!key) {
    process.stderr.write('Key required\n');
    process.exit(1);
  }
  var data = loadMemory();
  data[key] = value;
  data._updated = new Date().toISOString();
  saveMemory(data);
  process.stdout.write('Set: ' + key + '\n');
  process.exit(0);
}

function cmdDelete(key) {
  if (!key) {
    process.stderr.write('Key required\n');
    process.exit(1);
  }
  var data = loadMemory();
  delete data[key];
  data._updated = new Date().toISOString();
  saveMemory(data);
  process.stdout.write('Deleted: ' + key + '\n');
  process.exit(0);
}

function cmdClear() {
  saveMemory({});
  process.stdout.write('Memory cleared\n');
  process.exit(0);
}

function cmdKeys() {
  var data = loadMemory();
  var keys = Object.keys(data).filter(function(k) { return !k.startsWith('_'); });
  if (keys.length > 0) {
    process.stdout.write(keys.join('\n') + '\n');
  } else {
    process.stdout.write('');
  }
  process.exit(0);
}

function cmdUsage() {
  process.stdout.write(
    'Usage: memory.cjs [get|set|delete|clear|keys] [key] [value...]\n' +
    '  get [key]         — get a key or all keys\n' +
    '  set <key> <value> — set a key\n' +
    '  delete <key>      — delete a key\n' +
    '  clear             — clear all keys\n' +
    '  keys              — list all user-defined keys\n'
  );
  process.exit(0);
}

// ── Module API (for hook-handler.cjs require()) ───────────────────────────────

const HOOK_MEMORY_DIR = path.join(CWD, '.monomind', 'memory');
const HOOK_MEMORY_INDEX = path.join(HOOK_MEMORY_DIR, 'hook-memory.json');
var MAX_INDEX_SIZE = 50 * 1024 * 1024;

function ensureHookDir() {
  try { fs.mkdirSync(HOOK_MEMORY_DIR, { recursive: true }); } catch (_) {}
}

function loadIndex() {
  try {
    if (!fs.existsSync(HOOK_MEMORY_INDEX)) return [];
    var st = fs.statSync(HOOK_MEMORY_INDEX);
    if (st.size > MAX_INDEX_SIZE) return [];
    return JSON.parse(fs.readFileSync(HOOK_MEMORY_INDEX, 'utf-8'));
  } catch (_) {
    return [];
  }
}

function saveIndex(entries) {
  ensureHookDir();
  try {
    var trimmed = entries.slice(-500);
    fs.writeFileSync(HOOK_MEMORY_INDEX, JSON.stringify(trimmed, null, 2), 'utf-8');
  } catch (_) {}
}

function store(key, value, namespace) {
  var entries = loadIndex();
  var ns = String(namespace || 'default').slice(0, 128);
  key = String(key || '').slice(0, 512);
  entries = entries.filter(function(e) { return !(e.key === key && e.namespace === ns); });
  entries.push({ key: key, value: value, namespace: ns, storedAt: new Date().toISOString() });
  saveIndex(entries);
}

function retrieve(query, namespace) {
  var entries = loadIndex();
  var ns = namespace || null;
  if (ns) entries = entries.filter(function(e) { return e.namespace === ns; });
  if (!query) return entries.slice(-10);
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

// ── Entry point: run CLI when spawned directly ────────────────────────────────

if (require.main === module) {
  var args = process.argv.slice(2);
  var cmd = args[0];
  switch (cmd) {
    case 'get':    cmdGet(args[1]); break;
    case 'set':    cmdSet(args[1], args.slice(2).join(' ')); break;
    case 'delete': cmdDelete(args[1]); break;
    case 'clear':  cmdClear(); break;
    case 'keys':   cmdKeys(); break;
    default:       cmdUsage(); break;
  }
}

module.exports = { store, retrieve };
