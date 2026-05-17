'use strict';
// Extracted from hook-handler.cjs — handles 'loops-status' command.

const path = require('path');
const fs = require('fs');

module.exports = {
  handle: function(hCtx) {
    var CWD = hCtx.CWD;
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
};
