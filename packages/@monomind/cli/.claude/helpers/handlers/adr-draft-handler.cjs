'use strict';
// Extracted from hook-handler.cjs — handles 'adr-draft' command.
// Drafts an ADR from accumulated decision markers in .monomind/decisions.jsonl.
// Receives hCtx from dispatcher. See route-handler.cjs for hCtx field docs.

const path = require('path');
const fs = require('fs');

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
    body += '## Consequences\n\n_(fill in after review)_\n\n' +
            '## Status\n\nProposed — awaiting human review and refinement.\n';
    fs.writeFileSync(outPath, body);
    console.log('[ADR_DRAFT] Wrote ' + recent.length + ' decision(s) to ' + outPath);
    console.log('  Edit the file to fill in Context and Consequences, then change Status to Accepted/Rejected.');
  },
};
