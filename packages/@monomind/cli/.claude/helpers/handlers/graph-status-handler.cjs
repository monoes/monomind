'use strict';
// Extracted from hook-handler.cjs — handles 'graph-status' command.
// Shows monograph node/edge counts and graph-vs-grep usage ratio.
// Receives hCtx from dispatcher. See route-handler.cjs for hCtx field docs.

const path = require('path');
const fs = require('fs');

module.exports = {
  handle: function(hCtx) {
    var CWD = hCtx.CWD;
    var _openMonographDb = hCtx._openMonographDb;

    var db = _openMonographDb();
    if (!db) {
      console.log('No monograph.db found. Run /mastermind:understand to build.');
      return;
    }
    try {
      var n = db.prepare("SELECT COUNT(*) AS c FROM nodes").get().c;
      var e = db.prepare("SELECT COUNT(*) AS c FROM edges").get().c;
      var usage = (function() {
        try {
          var gup = path.join(CWD, '.monomind', 'metrics', 'graph-usage.json');
          var MAX_USAGE = 64 * 1024; // 64 KiB
          if (fs.statSync(gup).size > MAX_USAGE) return {};
          return JSON.parse(fs.readFileSync(gup, 'utf-8'));
        }
        catch (_) { return {}; }
      })();
      function safeNum(v) { var n = Number(v); return isFinite(n) ? n : 0; }
      var wins = safeNum(usage.monograph_call) + safeNum(usage.preresolve_hit)
               + safeNum(usage.graph_assist_search) + safeNum(usage.graph_assist_neighbors);
      var search = safeNum(usage.grep_call) + safeNum(usage.glob_call)
                 + safeNum(usage.bash_grep_call) + safeNum(usage.bash_find_call);
      var total = wins + search + safeNum(usage.preresolve_miss);
      var pct = total > 0 ? Math.round((wins / total) * 100) : 0;
      var saved = safeNum(usage.dollars_saved);
      console.log('Monograph: ' + n.toLocaleString() + ' nodes · ' + e.toLocaleString() + ' edges');
      console.log('Usage: ' + pct + '% graph · ' + (100 - pct) + '% grep · ' +
                  'wins=' + wins + ' search=' + search +
                  (saved > 0 ? ' · saved $' + saved.toFixed(2) : ''));
    } catch (err) { console.log('Error: ' + String(err.message || err).slice(0, 200)); }
  },
};
