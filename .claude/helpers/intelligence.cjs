#!/usr/bin/env node
/**
 * Intelligence Layer Stub (ADR-050)
 * Minimal fallback — full version is copied from package source.
 * Provides: init, getContext, recordEdit, feedback, consolidate
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(process.cwd(), '.monobrain', 'data');
const STORE_PATH = path.join(DATA_DIR, 'auto-memory-store.json');
const RANKED_PATH = path.join(DATA_DIR, 'ranked-context.json');
const PENDING_PATH = path.join(DATA_DIR, 'pending-insights.jsonl');
const SESSION_DIR = path.join(process.cwd(), '.monobrain', 'sessions');
const SESSION_FILE = path.join(SESSION_DIR, 'current.json');

// ── Safety limits (fixes #1530, #1531) ─────────────────────────────────────
var MAX_DATA_FILE_SIZE = 10 * 1024 * 1024; // 10 MB — skip files larger than this
var MAX_GRAPH_NODES = 5000;                 // skip PageRank if graph exceeds this

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJSON(p) {
  // Safety: skip files exceeding MAX_DATA_FILE_SIZE (#1531)
  try { var stat = fs.statSync(p); if (stat.size > MAX_DATA_FILE_SIZE) { process.stderr.write("[INTELLIGENCE] WARN: Skipping " + path.basename(p) + " (" + Math.round(stat.size / 1048576) + "MB exceeds 10MB limit)\n"); return null; } } catch(e) { /* file may not exist */ }
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : null; }
  catch { return null; }
}

function writeJSON(p, data) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function sessionGet(key) {
  var session = readJSON(SESSION_FILE);
  if (!session) return null;
  return key ? (session.context || {})[key] : session.context;
}

function sessionSet(key, value) {
  var session = readJSON(SESSION_FILE);
  if (!session) return;
  if (!session.context) session.context = {};
  session.context[key] = value;
  writeJSON(SESSION_FILE, session);
}

function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(function(w) { return w.length > 2; });
}

// ── Deduplication helper (fixes #1518) ──────────────────────────────────────
function deduplicateById(entries) {
  if (!entries || !Array.isArray(entries)) return entries;
  var seen = new Map();
  for (var i = 0; i < entries.length; i++) {
    var id = entries[i].id || entries[i].key;
    if (id) {
      seen.set(id, entries[i]);
    } else {
      seen.set('__no_id_' + seen.size, entries[i]);
    }
  }
  return Array.from(seen.values());
}

function bootstrapFromMemoryFiles() {
  var entries = [];
  // Scope to current project only (not all 51+ project dirs)
  var projectSlug = process.cwd().replace(/^\//, '').replace(/\//g, '-');
  var candidates = [
    path.join(os.homedir(), ".claude", "projects", projectSlug, "memory"),
    path.join(process.cwd(), ".monobrain", "memory"),
    path.join(process.cwd(), ".claude", "memory"),
  ];
  for (var i = 0; i < candidates.length; i++) {
    try {
      if (!fs.existsSync(candidates[i])) continue;
      var files = [];
      try {
        var items = fs.readdirSync(candidates[i], { withFileTypes: true, recursive: true });
        for (var j = 0; j < items.length; j++) {
          if (items[j].name === "MEMORY.md") {
            var parentDir = items[j].parentPath || items[j].path || candidates[i];
            var fp = path.join(parentDir, items[j].name);
            files.push(fp);
          }
        }
      } catch (e) { continue; }
      for (var k = 0; k < files.length; k++) {
        try {
          var content = fs.readFileSync(files[k], "utf-8");
          var sections = content.split(/^##\s+/m).filter(function(s) { return s.trim().length > 20; });
          for (var s = 0; s < sections.length; s++) {
            var lines = sections[s].split("\n");
            var title = lines[0] ? lines[0].trim() : "section-" + s;
            entries.push({
              id: "mem-" + entries.length,
              content: sections[s].substring(0, 500),
              summary: title.substring(0, 100),
              category: "memory",
              confidence: 0.5,
              sourceFile: files[k],
              words: tokenize(sections[s].substring(0, 500)),
            });
          }
        } catch (e) { /* skip */ }
      }
    } catch (e) { /* skip */ }
  }
  return entries;
}

function loadEntries() {
  var store = readJSON(STORE_PATH);
  // Support both formats: flat array or { entries: [...] }
  var entries = null;
  if (store) {
    if (Array.isArray(store) && store.length > 0) {
      entries = store;
    } else if (store.entries && store.entries.length > 0) {
      entries = store.entries;
    }
  }
  if (entries) {
    return entries.map(function(e, i) {
      return {
        id: e.id || ("entry-" + i),
        content: e.content || e.value || "",
        summary: e.summary || e.key || "",
        category: e.category || e.namespace || "default",
        confidence: e.confidence || 0.5,
        sourceFile: e.sourceFile || (e.metadata && e.metadata.sourceFile) || "",
        words: tokenize((e.content || e.value || "") + " " + (e.summary || e.key || "")),
      };
    });
  }
  return bootstrapFromMemoryFiles();
}

function matchScore(promptWords, entryWords) {
  if (!promptWords.length || !entryWords.length) return 0;
  var entrySet = {};
  for (var i = 0; i < entryWords.length; i++) entrySet[entryWords[i]] = true;
  var overlap = 0;
  for (var j = 0; j < promptWords.length; j++) {
    if (entrySet[promptWords[j]]) overlap++;
  }
  var union = Object.keys(entrySet).length + promptWords.length - overlap;
  return union > 0 ? overlap / union : 0;
}

var cachedEntries = null;

module.exports = {
  init: function() {
    cachedEntries = deduplicateById(loadEntries());
    var ranked = cachedEntries.map(function(e) {
      return { id: e.id, content: e.content, summary: e.summary, category: e.category, confidence: e.confidence, words: e.words };
    });
    writeJSON(RANKED_PATH, { version: 1, computedAt: Date.now(), entries: ranked });
    return { nodes: cachedEntries.length, edges: 0 };
  },

  getContext: function(prompt) {
    if (!prompt) return null;
    var ranked = readJSON(RANKED_PATH);
    var entries = (ranked && ranked.entries) || (cachedEntries || []);
    if (!entries.length) return null;
    var promptWords = tokenize(prompt);
    if (!promptWords.length) return null;
    var scored = entries.map(function(e) {
      return { entry: e, score: matchScore(promptWords, e.words || tokenize(e.content + " " + e.summary)) };
    }).filter(function(s) { return s.score > 0.05; });
    scored.sort(function(a, b) { return b.score - a.score; });
    var top = scored.slice(0, 5);
    if (!top.length) return null;
    var prevMatched = sessionGet("lastMatchedPatterns");
    var matchedIds = top.map(function(s) { return s.entry.id; });
    sessionSet("lastMatchedPatterns", matchedIds);
    var lines = ["[INTELLIGENCE] Relevant patterns for this task:"];
    for (var j = 0; j < top.length; j++) {
      var e = top[j];
      var conf = e.entry.confidence || 0.5;
      var summary = (e.entry.summary || e.entry.content || "").substring(0, 80);
      lines.push("  * (" + conf.toFixed(2) + ") " + summary);
    }
    return lines.join("\n");
  },

  recordEdit: function(file) {
    if (!file) return;
    ensureDir(DATA_DIR);
    var line = JSON.stringify({ type: "edit", file: file, timestamp: Date.now() }) + "\n";
    fs.appendFileSync(PENDING_PATH, line, "utf-8");
  },

  feedback: function(success) {
    // Stub: no-op in minimal version
  },

  consolidate: function() {
    var count = 0;
    if (fs.existsSync(PENDING_PATH)) {
      try {
        var content = fs.readFileSync(PENDING_PATH, "utf-8").trim();
        count = content ? content.split("\n").length : 0;
        fs.writeFileSync(PENDING_PATH, "", "utf-8");
      } catch (e) { /* skip */ }
    }
    return { entries: count, edges: 0, newEntries: 0 };
  },

  stats: function(json) {
    var ranked = readJSON(RANKED_PATH);
    var count = ranked && ranked.entries ? ranked.entries.length : 0;
    if (json) {
      console.log(JSON.stringify({ entries: count, computedAt: ranked ? ranked.computedAt : null }));
    } else {
      console.log('[INTELLIGENCE] Stats: ' + count + ' entries loaded');
    }
  },
};
