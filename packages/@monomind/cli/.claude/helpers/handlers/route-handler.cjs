'use strict';
// Extracted from hook-handler.cjs — receives hCtx from dispatcher.
// Behavioral equivalence verified: 133 routing tests pass post-extraction.
// hCtx (hook context) contains all shared state and utility functions:
//   hCtx.hookInput, hCtx.toolInput, hCtx.toolName, hCtx.prompt, hCtx.args, hCtx.CWD
//   hCtx.session, hCtx.router, hCtx.intelligence
//   hCtx.isSimpleCommand — function defined in main(), passed via hCtx
//   hCtx.getLearningService — async factory for LearningService singleton
//   Utility fns: _recordRecentEdit, _findAffectedTests, _recordHookLatency,
//     _getBudgetStatus, _injectCompactGraphMap, _maybeRebuildMonograph,
//     _buildKnowledgeSearchFn, getMonographSuggestions, getMonographNeighbors,
//     runWithTimeout, safeRequire, scanMicroAgentTriggers, _recordGraphTelemetry,
//     _recordDecisionMarkers, _recordToolCall, _openMonographDb, fs, path
//
// NOTE: The 'route' handler has a local variable named 'ctx' (from intelligence.getContext).
// The dispatcher passes the hook context as 'hCtx' to avoid collision.

const path = require('path');
const fs = require('fs');

module.exports = {
  handle: async function(hCtx) {
    var prompt = hCtx.prompt;
    var hookInput = hCtx.hookInput;
    var router = hCtx.router;
    var intelligence = hCtx.intelligence;
    var CWD = hCtx.CWD;

    // For slash commands and single-action invocations: skip routing panel output
    // but still write last-route.json so the statusline reflects the current action.
    if (hCtx.isSimpleCommand(prompt)) {
      try {
        var cmdLabel = (typeof prompt === 'string' && prompt.trim().startsWith('/'))
          ? prompt.trim().split(/\s+/)[0]          // e.g. "/ts"
          : (hookInput.commandName || hookInput.command_name || 'command');
        var routeDir = path.join(CWD, '.monomind');
        fs.mkdirSync(routeDir, { recursive: true });
        fs.writeFileSync(
          path.join(routeDir, 'last-route.json'),
          JSON.stringify({
            agent: cmdLabel,
            confidence: 1.0,
            reason: 'predefined command — no routing needed',
            semanticRouting: false,
            updatedAt: new Date().toISOString(),
          }),
          'utf-8'
        );
      } catch (e) { /* non-fatal */ }
      return;
    }

    if (intelligence && intelligence.getContext) {
      try {
        // Each hook event runs as a fresh node process, so the module-level
        // _entries cache is always empty here — without init() getContext()
        // returns null on every prompt and stored patterns are never recalled.
        // init() reads one small JSON file (auto-memory-store.json), so the
        // per-prompt cost is negligible.
        if (intelligence.init) {
          try { intelligence.init(); } catch (e) { /* non-fatal */ }
        }
        // Bootstrap intelligence from monograph on first prompt if store is sparse
        if (intelligence.bootstrapFromDb) {
          try {
            var bDb = hCtx._openMonographDb();
            if (bDb) {
              var bootstrapped = intelligence.bootstrapFromDb(bDb);
              if (bootstrapped > 0) console.log('[INTELLIGENCE] Bootstrapped ' + bootstrapped + ' hub nodes from knowledge graph');
            }
          } catch (e) { /* non-fatal */ }
        }
        const ctx = intelligence.getContext(prompt);
        if (ctx) console.log(ctx);
      } catch (e) { /* non-fatal */ }
    }
    if (router && (router.routeTaskSemantic || router.routeTask)) {
      const routeFn = router.routeTaskSemantic || router.routeTask;
      var result = await Promise.resolve(routeFn(prompt));

      // ── Enrichment: when router.cjs falls to the broad "coder" catch-all,
      //    try @monomind/routing's richer keyword pre-filter (30+ specialized
      //    rules for Solidity, game engines, DevOps, embedded, etc.) for a
      //    more specific agent match. This bridges the hooks layer (router.cjs)
      //    with the CLI routing package without requiring ESM imports. ─────────
      if (result && result.agentSlug === 'coder' && result.confidence <= 0.8) {
        try {
          var routingPkgPath = path.resolve(
            CWD, 'packages', '@monomind', 'routing', 'dist', 'keyword-pre-filter.js'
          );
          // Also check CLI's node_modules (symlinked workspace)
          if (!fs.existsSync(routingPkgPath)) {
            routingPkgPath = path.resolve(
              CWD, 'packages', '@monomind', 'cli', 'node_modules',
              '@monomind', 'routing', 'dist', 'keyword-pre-filter.js'
            );
          }
          if (fs.existsSync(routingPkgPath)) {
            var routingMod = await import(routingPkgPath);
            var enrichRules = routingMod.DEFAULT_KEYWORD_ROUTES;
            if (enrichRules && enrichRules.length > 0) {
              for (var eri = 0; eri < enrichRules.length; eri++) {
                var erRule = enrichRules[eri];
                if (erRule.pattern && erRule.pattern.test(prompt)) {
                  result.agent = erRule.routeName || erRule.agentSlug;
                  result.agentSlug = erRule.agentSlug;
                  result.confidence = 0.90;
                  result.reason = 'Enriched: ' + (erRule.description || erRule.routeName);
                  result.enrichedFrom = 'routing-keyword-pre-filter';
                  break;
                }
              }
            }
          }
        } catch (e) { /* non-fatal — routing package may not be available */ }
      }

      // ── Agent success pattern lookup ──────────────────────────
      try {
        var patternDb = hCtx._openMonographDb();
        if (patternDb) {
          var cutoff = Date.now() - 30 * 86400000;
          var patterns = patternDb.prepare(
            'SELECT agent_type, COUNT(*) as total, SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as wins FROM agent_interactions WHERE timestamp > @cutoff GROUP BY agent_type HAVING total >= 3'
          ).all({ cutoff: cutoff });
          if (patterns.length > 0) {
            var patternMap = {};
            for (var pi = 0; pi < patterns.length; pi++) {
              patternMap[patterns[pi].agent_type] = {
                total: patterns[pi].total,
                successRate: Math.round(patterns[pi].wins / patterns[pi].total * 100)
              };
            }
            var routedAgent = result.agent || 'coder';
            var routedPattern = patternMap[routedAgent];
            // Find if there's a clearly better agent
            if (routedPattern && routedPattern.successRate < 50) {
              var best = patterns.reduce(function(a, b) { return (b.wins/b.total) > (a.wins/a.total) ? b : a; });
              if (best.wins / best.total > 0.8 && best.agent_type !== routedAgent) {
                console.log('[AGENT_PATTERN] Historical: ' + best.agent_type + ' (' + Math.round(best.wins/best.total*100) + '% success, n=' + best.total + ') outperforms ' + routedAgent + ' (' + routedPattern.successRate + '%)');
              }
            }
            result.historicalPattern = patternMap;
          }
        }
      } catch (e) { /* non-fatal — agent_interactions table may not exist */ }

      // ── Routing feedback accuracy check ──────────────────────
      try {
        var rfPath = path.join(CWD, '.monomind', 'routing-feedback.jsonl');
        var MAX_RF = 256 * 1024;
        if (fs.existsSync(rfPath) && fs.statSync(rfPath).size <= MAX_RF) {
          var rfLines = fs.readFileSync(rfPath, 'utf-8').trim().split('\n').filter(Boolean);
          // Check last 50 entries for this agent's feedback
          var routedAgent = result.agent || 'coder';
          var recentRf = rfLines.slice(-50);
          var agentFeedback = [];
          for (var ri = 0; ri < recentRf.length; ri++) {
            try {
              var rfEntry = JSON.parse(recentRf[ri]);
              if (rfEntry.suggestedAgent === routedAgent && typeof rfEntry.intelligenceFeedback === 'boolean') {
                agentFeedback.push(rfEntry.intelligenceFeedback);
              }
            } catch (e) {}
          }
          if (agentFeedback.length >= 3) {
            var successes = agentFeedback.filter(function(f) { return f === true; }).length;
            var accuracy = Math.round(successes / agentFeedback.length * 100);
            if (accuracy < 60) {
              console.log('[ROUTING] Warning: ' + routedAgent + ' routing accuracy ' + accuracy + '% over last ' + agentFeedback.length + ' sessions');
            }
            result.routingAccuracy = accuracy;
          }
        }
      } catch (e) { /* non-fatal */ }

      // monolean: graph-fallback override removed — it compensated for bad agent
      // recommendations that are no longer injected into context. The statusline
      // just shows the keyword router's pick; no need for 50 lines of overrides.

      // ── Dispatch dedup: suppress re-recommending the same agent just dispatched ──
      // agent-start-handler writes last-dispatch.json on SubagentStart.
      // If the router picks the same agent within 60s, it's likely the parent re-routing
      // the same prompt — log a note so the LLM can vary its approach.
      try {
        var dispatchPath = path.join(CWD, '.monomind', 'last-dispatch.json');
        var MAX_DISPATCH = 4096;
        if (fs.existsSync(dispatchPath) && fs.statSync(dispatchPath).size <= MAX_DISPATCH) {
          var lastDispatch = JSON.parse(fs.readFileSync(dispatchPath, 'utf-8'));
          var dispatchAge = Date.now() - new Date(lastDispatch.dispatchedAt || 0).getTime();
          if (dispatchAge < 60000 && lastDispatch.agentType === (result.agentSlug || result.agent)) {
            result.recentlyDispatched = true;
            console.log('[DISPATCH_DEDUP] ' + lastDispatch.agentType + ' was dispatched ' + Math.round(dispatchAge / 1000) + 's ago — consider a different specialist or direct implementation');
          }
        }
      } catch (e) { /* non-fatal */ }

      var output = [];
      var conf = result.confidence != null ? result.confidence : 0;

      // ── Persist routing result for statusline display ─────────────
      try {
        var routeDir = path.join(CWD, '.monomind');
        fs.mkdirSync(routeDir, { recursive: true });
        fs.writeFileSync(
          path.join(routeDir, 'last-route.json'),
          JSON.stringify({
            agent: result.agent || 'coder',
            agentSlug: result.agentSlug || null,
            confidence: result.confidence,
            reason: result.reason,
            prompt: (prompt || '').slice(0, 500),
            historicalPattern: result.historicalPattern || null,
            updatedAt: new Date().toISOString(),
          }),
          'utf-8'
        );
      } catch (e) { /* non-fatal */ }

      // ── Skill auto-activation (the one thing the hook does better than Claude) ──
      var matches = result.skillMatches || [];
      if (matches.length > 0) {
        var topMatch = matches[0];
        // Auto-activate when one skill clearly dominates:
        //   - score >= 2 with at most 2 matches (strong multi-keyword signal), or
        //   - single match with score >= 2 and low agent confidence (skill is better fit)
        var autoInvoke = (topMatch && topMatch.score >= 2 && matches.length <= 2) ||
          (topMatch && topMatch.score >= 2 && matches.length === 1 && conf < 0.7);

        if (autoInvoke) {
          output.push('+======== SKILL AUTO-ACTIVATED ========+');
          output.push('| ' + topMatch.invoke.padEnd(36) + ' |');
          output.push('+======================================+');
        } else {
          output.push('+----------- Matching Skills (invoke via Skill tool) ----------+');
          matches.forEach(function(m, i) {
            output.push('| ' + (i + 1) + '. ' + m.skill.padEnd(28) + (m.description || '').substring(0, 30).padEnd(30) + ' |');
            output.push('|   invoke: ' + m.invoke.substring(0, 51).padEnd(51) + '|');
          });
          output.push('+--------------------------------------------------------------+');
        }
      }

      if (output.length > 0) console.log(output.join('\n'));

      // Record any decision markers in this prompt (auto-ADR pipeline).
      try { hCtx._recordDecisionMarkers(prompt); } catch (e) {}

      // Cost budget — emit amber/red banner when approaching limit.
      try {
        var budget = hCtx._getBudgetStatus();
        if (budget && budget.alert) {
          var tunedNote = budget.autoTuned ? ' (auto-tuned)' : '';
          if (budget.spike && !budget.breached) {
            console.log('[BUDGET_SPIKE] Today $' + budget.todayCost.toFixed(2) + ' is >2x your rolling daily avg. Unusual spend — review .monomind/metrics/token-summary.json.');
          } else if (budget.breached) {
            console.log('[BUDGET_BREACHED] Daily $' + budget.todayCost.toFixed(2) + '/$' + budget.dailyLimit + ' (' + budget.dailyPct + '%) · Monthly $' + budget.monthCost.toFixed(2) + '/$' + budget.monthlyLimit + ' (' + budget.monthlyPct + '%)' + tunedNote + '. Switch to Haiku with /model haiku or edit .monomind/budget.json.');
          } else {
            console.log('[BUDGET_ALERT] Daily ' + budget.dailyPct + '% of $' + budget.dailyLimit + ' · Monthly ' + budget.monthlyPct + '% of $' + budget.monthlyLimit + tunedNote + '.');
          }
        }
      } catch (e) {}

      // ── Surface daemon metrics warnings (hook latency, token spikes) ──
      try {
        var metricsDir = path.join(CWD, '.monomind', 'metrics');
        // Hook latency warnings
        var latencyFile = path.join(metricsDir, 'hook-latency.json');
        if (fs.existsSync(latencyFile) && fs.statSync(latencyFile).size < 32768) {
          var latencyData = JSON.parse(fs.readFileSync(latencyFile, 'utf-8'));
          if (latencyData && latencyData.avgMs > 500) {
            console.log('[PERF] Hook latency avg ' + Math.round(latencyData.avgMs) + 'ms (target <500ms). Slowest: ' + (latencyData.slowest || 'unknown'));
          }
        }
        // Token usage check — surface only when spend is high
        var tokenFile = path.join(metricsDir, 'token-summary.json');
        if (fs.existsSync(tokenFile) && fs.statSync(tokenFile).size < 32768) {
          var tokenData = JSON.parse(fs.readFileSync(tokenFile, 'utf-8'));
          if (tokenData && tokenData.todayCost > 50) {
            console.log('[COST] Today: $' + (tokenData.todayCost || 0).toFixed(2) + ' (' + (tokenData.todayCalls || 0) + ' calls)');
          }
        }
        // Security audit findings
        var secAuditFile = path.join(metricsDir, 'security-audit.json');
        if (fs.existsSync(secAuditFile) && fs.statSync(secAuditFile).size < 32768) {
          var secData = JSON.parse(fs.readFileSync(secAuditFile, 'utf-8'));
          if (secData && secData.findings && secData.findings.length > 0) {
            console.log('[SECURITY] ' + secData.findings.length + ' findings from background scan. Review .monomind/metrics/security-audit.json');
          }
        }
        // Codebase map top files (high-centrality god nodes from monograph)
        var mapFile = path.join(metricsDir, 'codebase-map.json');
        if (fs.existsSync(mapFile) && fs.statSync(mapFile).size < 32768) {
          var mapData = JSON.parse(fs.readFileSync(mapFile, 'utf-8'));
          if (mapData && mapData.topFiles && mapData.topFiles.length > 0) {
            console.log('[CODEBASE] ' + mapData.topFiles.length + ' high-centrality files. Top: ' + (mapData.topFiles[0].ref || 'unknown') + ' (degree ' + (mapData.topFiles[0].degree || '?') + ')');
          }
          if (mapData && mapData.graphStaleness && mapData.graphStaleness.commitsBehind > 10) {
            console.log('[CODEBASE] Graph index ' + mapData.graphStaleness.commitsBehind + ' commits behind HEAD — run monograph build');
          }
        }
        // Deep dive findings (god nodes, high-degree files from background analysis)
        var deepdiveFile = path.join(metricsDir, 'deepdive.json');
        if (fs.existsSync(deepdiveFile) && fs.statSync(deepdiveFile).size < 32768) {
          var ddData = JSON.parse(fs.readFileSync(deepdiveFile, 'utf-8'));
          if (ddData && ddData.findings && ddData.findings.length > 0) {
            for (var di = 0; di < ddData.findings.length; di++) {
              var finding = ddData.findings[di];
              if (finding.category === 'god_nodes' && finding.items && finding.items.length > 0) {
                var topGod = finding.items[0];
                console.log('[DEEPDIVE] ' + finding.items.length + ' god nodes. Top: ' + (topGod.name || 'unknown') + ' (degree ' + (topGod.degree || '?') + ') in ' + (topGod.file || 'unknown'));
              }
            }
          }
        }
        // Ultralearn insights (bridge nodes crossing community boundaries)
        var ultralearnFile = path.join(metricsDir, 'ultralearn.json');
        if (fs.existsSync(ultralearnFile) && fs.statSync(ultralearnFile).size < 32768) {
          var ulData = JSON.parse(fs.readFileSync(ultralearnFile, 'utf-8'));
          if (ulData && ulData.insightsGained && ulData.insightsGained.length > 0) {
            for (var ui = 0; ui < ulData.insightsGained.length; ui++) {
              var insight = ulData.insightsGained[ui];
              if (insight.category === 'bridge_nodes' && insight.items && insight.items.length > 0) {
                var topBridge = insight.items[0];
                console.log('[ARCHITECTURE] ' + insight.items.length + ' bridge nodes crossing community boundaries. Top: ' + (topBridge.name || 'unknown') + ' (' + (topBridge.crossCommunityEdges || '?') + ' cross-edges) in ' + (topBridge.location || 'unknown'));
              }
            }
          }
        }
        // Performance metrics (optimize worker — a one-shot process, not a daemon)
        var perfFile = path.join(metricsDir, 'performance.json');
        if (fs.existsSync(perfFile) && fs.statSync(perfFile).size < 32768) {
          var perfData = JSON.parse(fs.readFileSync(perfFile, 'utf-8'));
          if (perfData && perfData.workerProcessMemoryUsage) {
            var rssBytes = perfData.workerProcessMemoryUsage.rss || 0;
            var rssMB = Math.round(rssBytes / (1024 * 1024));
            if (rssMB > 512) {
              console.log('[PERF] optimize worker RSS ' + rssMB + 'MB (>512MB threshold) at last run — reflects that one-shot process, not a persistent daemon');
            }
          }
        }
        // Memory consolidation health
        var consolFile = path.join(metricsDir, 'consolidation.json');
        if (fs.existsSync(consolFile) && fs.statSync(consolFile).size < 32768) {
          var consolData = JSON.parse(fs.readFileSync(consolFile, 'utf-8'));
          if (consolData && consolData.patternsConsolidated > 0) {
            console.log('[MEMORY] ' + consolData.patternsConsolidated + ' patterns consolidated into ' + consolData.clustersCreated + ' RAPTOR clusters');
          }
        }
        // Benchmark worker RSS (manual-trigger `daemon trigger -w benchmark`)
        var benchFile = path.join(metricsDir, 'benchmark.json');
        if (fs.existsSync(benchFile) && fs.statSync(benchFile).size < 32768) {
          var benchData = JSON.parse(fs.readFileSync(benchFile, 'utf-8'));
          if (benchData && benchData.benchmarks && benchData.benchmarks.memoryUsage) {
            var benchRssMB = Math.round((benchData.benchmarks.memoryUsage.rss || 0) / (1024 * 1024));
            if (benchRssMB > 512) {
              console.log('[PERF] Benchmark snapshot RSS ' + benchRssMB + 'MB (>512MB threshold) at last `daemon trigger -w benchmark` run');
            }
          }
        }
      } catch (e) { /* non-fatal */ }

      // ── Memory: surface relevant past session context ──────────
      try {
        var epFile = path.join(CWD, '.monomind', 'episodic', 'episodes.jsonl');
        var MAX_EP = 256 * 1024;
        if (fs.existsSync(epFile) && fs.statSync(epFile).size <= MAX_EP) {
          var epRaw = fs.readFileSync(epFile, 'utf-8').trim().split('\n').filter(Boolean);
          if (epRaw.length > 0) {
            // Simple keyword matching against episode summaries
            var promptLower = (prompt || '').toLowerCase();
            var promptTokens = promptLower.match(/[a-z][a-z0-9_-]{2,}/g) || [];
            if (promptTokens.length > 0) {
              var matches = [];
              // Truncate at the last space before maxLen so fragments never
              // end mid-word (falls back to a hard cut for space-less text).
              var truncAtWord = function(s, maxLen) {
                s = String(s || '');
                if (s.length <= maxLen) return s;
                var cut = s.slice(0, maxLen);
                var sp = cut.lastIndexOf(' ');
                return sp > 40 ? cut.slice(0, sp) : cut;
              };
              // Only search last 200 episodes
              var searchEps = epRaw.slice(-200);
              for (var ei = 0; ei < searchEps.length; ei++) {
                try {
                  var ep = JSON.parse(searchEps[ei]);
                  var sumLower = (ep.summary || '').toLowerCase();
                  // Skip if from current session
                  var currentSessId = process.env.CLAUDE_SESSION_ID || '';
                  if (ep.sessionId === currentSessId) continue;
                  // Count keyword overlap
                  var hits = 0;
                  for (var ti = 0; ti < promptTokens.length; ti++) {
                    if (sumLower.includes(promptTokens[ti])) hits++;
                  }
                  var relevance = promptTokens.length > 0 ? hits / promptTokens.length : 0;
                  if (relevance >= 0.3 && hits >= 2) {
                    matches.push({ summary: truncAtWord(ep.summary || '', 120), relevance: relevance, ts: ep.endedAt || 0 });
                  }
                } catch (e) {}
              }
              // Show top 2 most relevant matches — dedupe by fragment text so
              // two episodes from the same conversation don't inject the same
              // truncated snippet twice.
              if (matches.length > 0) {
                matches.sort(function(a, b) { return b.relevance - a.relevance; });
                var topMatches = [];
                var seenFrags = {};
                for (var tmi = 0; tmi < matches.length && topMatches.length < 2; tmi++) {
                  var frag = matches[tmi].summary.replace(/\n/g, ' ').trim();
                  if (seenFrags[frag]) continue;
                  seenFrags[frag] = true;
                  topMatches.push(matches[tmi]);
                }
                var memLines = ['[MEMORY] Relevant past sessions:'];
                for (var mi = 0; mi < topMatches.length; mi++) {
                  var ago = topMatches[mi].ts ? Math.round((Date.now() - topMatches[mi].ts) / 3600000) + 'h ago' : '';
                  memLines.push('  ' + topMatches[mi].summary.replace(/\n/g, ' ').trim() + (ago ? ' (' + ago + ')' : ''));
                }
                console.log(memLines.join('\n'));
              }
            }
          }
        }
      } catch (e) { /* non-fatal */ }

      // Inject monograph hint for complex tasks.
      // Source of truth is .monomind/monograph.db (SQLite). Legacy stats.json
      // is no longer written by the build, so it is checked only as a fallback.
      try {
        var legacyStats = path.join(CWD, '.monomind', 'graph', 'stats.json');
        var nodeCount = 0;
        try {
          var hintDb = hCtx._openMonographDb();
          if (hintDb) {
            nodeCount = hintDb.prepare('SELECT COUNT(*) AS c FROM nodes').get().c;
          }
        } catch (e) { /* ignore — fall back to legacy */ }
        if (nodeCount === 0 && fs.existsSync(legacyStats)) {
          try {
            var legacyStatsSt = fs.statSync(legacyStats);
            if (legacyStatsSt.size <= 1024 * 1024) {
              var gStats = JSON.parse(fs.readFileSync(legacyStats, 'utf-8'));
              nodeCount = gStats.nodes || 0;
            }
          } catch (e) { /* ignore */ }
        }
        if (nodeCount > 100 && hCtx._isGraphFresh()) {
          // Pre-resolve top-3 relevant files for the user's prompt — the LLM
          // sees the answer inline instead of being told to call a tool.
          // 3 is enough signal; more files inflate token cost on every prompt.
          var suggestions = hCtx.getMonographSuggestions(prompt, 3);

          // Boost recently-edited files to the top of pre-resolve suggestions.
          // Even when the FTS index hasn't caught up to the latest edits, the
          // LLM should see the files it just modified as the primary context.
          try {
            var recentEditsForRoute = hCtx._getRecentEdits();
            if (recentEditsForRoute.length > 0) {
              // Extract prompt keywords for relevance gating
              var promptWords = (prompt || '').toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [];
              var promptWordSet = {};
              for (var pw = 0; pw < promptWords.length; pw++) promptWordSet[promptWords[pw]] = 1;

              var existingFiles = {};
              for (var se = 0; se < suggestions.length; se++) existingFiles[suggestions[se].file || ''] = 1;

              var editBoosts = [];
              for (var re = 0; re < recentEditsForRoute.length && editBoosts.length < 2; re++) {
                var reFile = recentEditsForRoute[re].file;
                // Skip if already in suggestions
                if (existingFiles[reFile]) continue;
                var reName = path.basename(reFile, path.extname(reFile)).toLowerCase();
                // Only boost if filename shares a keyword with the prompt OR the edit is very recent (<3 min)
                var veryRecent = (Date.now() - recentEditsForRoute[re].editedAt) < 3 * 60 * 1000;
                var editMatches = promptWordSet[reName] || veryRecent;
                if (editMatches) {
                  editBoosts.push({ name: path.basename(reFile), label: 'File', file: reFile, deg: 0, _editBoost: true });
                }
              }
              if (editBoosts.length > 0) {
                suggestions = editBoosts.concat(suggestions).slice(0, 3);
              }
            }
          } catch (e) { /* non-fatal */ }

          if (suggestions.length > 0) {
            // Compact single-line format: "[MONOGRAPH] N nodes. Top files: name [Label] — path:line, ..."
            // Matches the agent-start-handler pattern — keeps per-prompt token cost minimal.
            var hintParts = suggestions.map(function(s) {
              var editTag = s._editBoost ? ' ✎' : '';
              var fileLoc = (s.file || '');
              if (fileLoc && s.startLine != null) fileLoc = fileLoc + ':' + s.startLine;
              return s.name + ' [' + s.label + '] — ' + fileLoc + editTag;
            });
            console.log('[MONOGRAPH] ' + nodeCount + ' nodes. Top files: ' + hintParts.join(' · '));
            hCtx._recordGraphTelemetry('preresolve_hit');
          } else {
            console.log('[MONOGRAPH] ' + nodeCount + ' nodes. Call mcp__monomind__monograph_suggest to find relevant files.');
            hCtx._recordGraphTelemetry('preresolve_miss');
          }
        }
      } catch(e) {}

      // Swarm mode selection is available on-demand via /mastermind slash command.
    } else {
      console.log('[INFO] Router not available, using default routing');
    }

    // Task 22: TeamRoutingModes — only log when an explicit swarm config is present
    try {
      var swarmCfgPath = path.join(CWD, '.monomind', 'swarm-config.json');
      if (fs.existsSync(swarmCfgPath)) {
        var swarmCfgSt = fs.statSync(swarmCfgPath);
        var topology22 = swarmCfgSt.size <= 1024 * 1024 ? (JSON.parse(fs.readFileSync(swarmCfgPath, 'utf-8')).topology || 'mesh') : 'mesh';
        var mode22 = topology22 === 'hierarchical' ? 'route' : 'coordinate';
        console.log('[ROUTING_MODE] topology=' + topology22 + ' → mode=' + mode22);
      }
    } catch (e) { /* non-fatal */ }
  }
};
