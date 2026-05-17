'use strict';
// Extracted from hook-handler.cjs — handles 'compact-manual' and 'compact-auto' events.
// Receives hCtx and mode ('manual'|'auto') from dispatcher.

const path = require('path');
const fs = require('fs');

module.exports = {
  handle: async function(hCtx, mode) {
    var intelligence = hCtx.intelligence;
    var runWithTimeout = hCtx.runWithTimeout;
    var _injectCompactGraphMap = hCtx._injectCompactGraphMap;
    var CWD = hCtx.CWD;

    if (intelligence && intelligence.consolidate) {
      try { await runWithTimeout(function() { return intelligence.consolidate(); }, 'intelligence.consolidate()'); } catch (e) { /* non-fatal */ }
    }
    try {
      var lastRoute = path.join(CWD, '.monomind', 'last-route.json');
      if (fs.existsSync(lastRoute)) {
        var route = JSON.parse(fs.readFileSync(lastRoute, 'utf-8'));
        console.log('[COMPACT_CONTEXT] Last route: ' + route.agent + ' (' + (route.confidence != null ? (route.confidence * 100).toFixed(0) : '?') + '%)');
      }
    } catch (e) { /* non-fatal */ }
    _injectCompactGraphMap();
    if (mode === 'auto') {
      console.log('[COMPACT] Auto compaction — intelligence consolidated, context preserved');
      console.log('GOLDEN RULE: 1 message = all parallel operations');
    } else {
      console.log('[COMPACT] Manual compaction — intelligence consolidated, context preserved');
    }
  },
};
