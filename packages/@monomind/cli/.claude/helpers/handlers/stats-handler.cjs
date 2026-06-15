'use strict';
// Extracted from hook-handler.cjs — handles 'stats' command.

module.exports = {
  handle: async function(hCtx) {
    var intelligence = hCtx.intelligence;
    var args = hCtx.args;
    if (intelligence && intelligence.stats) {
      try { await Promise.resolve(intelligence.stats(args.includes('--json'))); } catch (e) { /* non-fatal */ }
    } else {
      console.log('[WARN] Intelligence module not available. Run session-restore first.');
    }
  },
};
