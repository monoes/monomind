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
      console.log('No monograph.db found. Run /monomind:understand to build.');
      return;
    }
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
      var total = wins + search + (usage.preresolve_miss || 0);
      var pct = total > 0 ? Math.round((wins / total) * 100) : 0;
      var saved = usage.dollars_saved || 0;
      console.log('Monograph: ' + n.toLocaleString() + ' nodes · ' + e.toLocaleString() + ' edges');
      console.log('Usage: ' + pct + '% graph · ' + (100 - pct) + '% grep · ' +
                  'wins=' + wins + ' search=' + search +
                  (saved > 0 ? ' · saved $' + saved.toFixed(2) : ''));
    } catch (err) { console.log('Error: ' + err.message); }
  },
};
