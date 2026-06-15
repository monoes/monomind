'use strict';
// Extracted from hook-handler.cjs — handles 'adr-draft' command.
// Drafts an ADR from accumulated decision markers in .monomind/decisions.jsonl.
// Receives hCtx from dispatcher. See route-handler.cjs for hCtx field docs.

const path = require('path');
const fs = require('fs');

/**
 * Query the monograph knowledge graph for symbols relevant to the decision text.
 * Returns up to maxResults file:line strings, or an empty array if unavailable.
 *
 * Uses the monograph FTS5 index directly via better-sqlite3 so there is no
 * network call and no dependency on the MCP server being running.
 *
 * @param {string} CWD  - Project root
 * @param {string} query - Keyword query extracted from decision excerpts
 * @param {number} maxResults - Maximum hits to return (default 5)
 * @returns {string[]} Array of "[label] name  file:line" strings
 */
function queryMonographHints(CWD, query, maxResults) {
  try {
    var dbPath = path.join(CWD, '.monomind', 'monograph.db');
    var st;
    try { st = fs.statSync(dbPath); } catch (_) { return []; }
    if (!st.isFile()) return [];
    // Try to load better-sqlite3 from the CLI package
    var Database;
    try { Database = require('better-sqlite3'); } catch (_) { return []; }
    var db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      // Cap query length to avoid FTS parser stress
      var safeQuery = String(query).slice(0, 512).replace(/['"*()[\]{}<>]/g, ' ').trim();
      if (!safeQuery) return [];
      var rows = db.prepare(
        'SELECT n.label, n.name, n.file_path, n.start_line ' +
        'FROM nodes_fts f JOIN nodes n ON n.id = f.rowid ' +
        "WHERE nodes_fts MATCH ? AND n.label NOT IN ('File','Folder','Community','Concept') " +
        'ORDER BY rank LIMIT ?'
      ).all(safeQuery, Math.min(maxResults || 5, 20));
      return rows.map(function(r) {
        var loc = r.file_path ? (r.start_line != null ? r.file_path + ':' + r.start_line : r.file_path) : '';
        return '[' + r.label + '] ' + r.name + (loc ? '  ' + loc : '');
      });
    } finally {
      try { db.close(); } catch (_) {}
    }
  } catch (_) {
    return [];
  }
}

module.exports = {
  handle: function(hCtx) {
    var CWD = hCtx.CWD;

    var jsonl = path.join(CWD, '.monomind', 'decisions.jsonl');
    if (!fs.existsSync(jsonl)) {
      console.log('[ADR] No decisions recorded yet. Type prompts containing markers like "let\'s go with X", "we chose Y", "decision: Z" to populate the log.');
      return;
    }
    var MAX_JSONL = 512 * 1024; // 512 KiB
    try { if (fs.statSync(jsonl).size > MAX_JSONL) { console.error('[ADR] decisions.jsonl exceeds 512 KiB — skipping to prevent OOM'); return; } } catch (_) { return; }
    var lines = fs.readFileSync(jsonl, 'utf-8').trim().split('\n').filter(Boolean);
    if (lines.length === 0) {
      console.log('[ADR] decisions.jsonl is empty.');
      return;
    }
    // Group decisions captured in the last 7 days.
    var cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    var MAX_RECORDS = 200;
    var recent = lines
      .map(function(l) { try { return JSON.parse(l); } catch (_) { return null; } })
      .filter(function(d) { return d && d.ts >= cutoff; })
      .slice(0, MAX_RECORDS);
    if (recent.length === 0) {
      console.log('[ADR] No decisions in the last 7 days. Older entries: ' + lines.length + '.');
      return;
    }

    var adrsDir = path.resolve(CWD, 'docs', 'adrs');
    if (!adrsDir.startsWith(path.resolve(CWD) + path.sep) && adrsDir !== path.resolve(CWD)) {
      console.error('[ADR] adrsDir resolved outside CWD — aborting'); return;
    }
    try { fs.mkdirSync(adrsDir, { recursive: true }); } catch (_) {}
    // Use lstatSync to avoid following symlinks when listing existing ADRs
    var existing = [];
    try {
      existing = fs.readdirSync(adrsDir).filter(function(f) {
        if (!/^ADR-\d{4}/.test(f)) return false;
        try { var st = fs.lstatSync(path.join(adrsDir, f)); return st.isFile(); } catch (_) { return false; }
      });
    } catch (_) {}
    var nextNum = existing.length + 1;
    var num = String(nextNum).padStart(4, '0');
    var stamp = new Date().toISOString().slice(0, 10);
    var fname = 'ADR-' + num + '-' + stamp + '-session-decisions.md';
    var outPath = path.join(adrsDir, fname);

    var body = '# ADR-' + num + ': Session decisions (' + stamp + ')\n\n' +
               '**Status:** Proposed\n**Date:** ' + stamp + '\n\n' +
               '## Context\n\n' +
               'During recent sessions, the following decision markers were captured ' +
               'from user prompts. Each excerpt is the surrounding sentence at the time.\n\n' +
               '## Decisions\n\n';
    for (var i = 0; i < recent.length; i++) {
      var d = recent[i];
      var date = new Date(d.ts).toISOString().slice(0, 16).replace('T', ' ');
      body += '### ' + (i + 1) + '. ' + date + '\n\n';
      var excerpts = Array.isArray(d.excerpts) ? d.excerpts.slice(0, 20) : [];
      for (var j = 0; j < excerpts.length; j++) {
        body += '> ' + String(excerpts[j]).slice(0, 500).trim() + '\n\n';
      }
      if (d.prompt) body += '_Prompt:_ ' + d.prompt.slice(0, 200) + (d.prompt.length > 200 ? '…' : '') + '\n\n';
    }
    body += '## Consequences\n\n_(fill in after review)_\n\n';

    // Enrich ADR with monograph code references.
    // Build a keyword query from all excerpts and prompts in the batch,
    // then surface the top-5 most relevant code symbols as navigation hints.
    var allText = recent.map(function(d) {
      var parts = [];
      if (Array.isArray(d.excerpts)) {
        d.excerpts.slice(0, 5).forEach(function(e) { parts.push(String(e).slice(0, 200)); });
      }
      if (d.prompt) parts.push(d.prompt.slice(0, 200));
      return parts.join(' ');
    }).join(' ');
    // Extract meaningful words (4+ chars, not common stopwords)
    var stopWords = new Set(['with','this','that','from','have','will','would','could','should','into','then','than','when','where','which','there','their','what','about','more','some','also','just','only','other','very','after','most','such','decision','using','being','were','they','them']);
    var queryWords = allText.toLowerCase()
      .split(/[\s\-_.,;:!?'"()\[\]{}]+/)
      .filter(function(w) { return w.length >= 4 && !stopWords.has(w); })
      .filter(function(w, i, arr) { return arr.indexOf(w) === i; })
      .slice(0, 8);
    if (queryWords.length > 0) {
      var hints = queryMonographHints(CWD, queryWords.join(' '), 5);
      if (hints.length > 0) {
        body += '## Code References\n\n';
        body += '_Relevant symbols found in the knowledge graph (monograph):_\n\n';
        hints.forEach(function(h) { body += '- `' + h + '`\n'; });
        body += '\n';
      }
    }

    body += '## Status\n\nProposed — awaiting human review and refinement.\n';
    fs.writeFileSync(outPath, body);
    console.log('[ADR_DRAFT] Wrote ' + recent.length + ' decision(s) to ' + outPath);
    console.log('  Edit the file to fill in Context and Consequences, then change Status to Accepted/Rejected.');
  },
};
