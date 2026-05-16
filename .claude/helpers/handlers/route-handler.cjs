'use strict';
// Extracted from hook-handler.cjs — receives hCtx from dispatcher.
// hCtx (hook context) contains all shared state and utility functions:
//   hCtx.hookInput, hCtx.toolInput, hCtx.toolName, hCtx.prompt, hCtx.args, hCtx.CWD
//   hCtx.session, hCtx.router, hCtx.intelligence
//   hCtx.isSimpleCommand — function defined in main(), passed via hCtx
//   hCtx._hooksModule — module-level singleton reference
//   hCtx.getLearningService — async factory for LearningService singleton
//   Utility fns: _recordRecentEdit, _findAffectedTests, _recordHookLatency,
//     _getBudgetStatus, _injectCompactGraphMap, _maybeRebuildMonograph,
//     _buildKnowledgeSearchFn, getMonographSuggestions, getMonographNeighbors,
//     runWithTimeout, safeRequire, scanMicroAgentTriggers, _recordGraphTelemetry,
//     _recordDecisionMarkers, _recordToolCall, _openMonographDb,
//     _triggerExtractYamlValue, _triggerFinalize, _triggerExtractFromFrontmatter,
//     _triggerCollectMdFiles, _triggerBuildIndex, fs, path
//
// NOTE: The 'route' handler has a local variable named 'ctx' (from intelligence.getContext).
// The dispatcher passes the hook context as 'hCtx' to avoid collision.
module.exports = {
  handle: async function(hCtx) {
    throw new Error('Not yet implemented');
  }
};
