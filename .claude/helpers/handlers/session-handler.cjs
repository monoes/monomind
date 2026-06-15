'use strict';
// Extracted from hook-handler.cjs — receives hCtx from dispatcher.
// Handles 'session-end' hook event.
// See route-handler.cjs for full hCtx field documentation.

const path = require('path');
const fs = require('fs');

module.exports = {
  handleEnd: async function(hCtx) {
    var hookInput = hCtx.hookInput;
    var intelligence = hCtx.intelligence;
    var session = hCtx.session;
    var CWD = hCtx.CWD;

    // Check if daemon is holding the consolidation lock — if so, skip synchronous consolidation
    // to avoid duplicate work and potential index corruption
    var consolidationLockPath = path.join(CWD, '.monomind', 'consolidation.lock');
    var daemonHoldsLock = fs.existsSync(consolidationLockPath);

    if (daemonHoldsLock) {
      console.log('[SESSION] Skipping consolidation — daemon holds lock');
    }

    // Consolidate intelligence (with timeout — #1530)
    if (!daemonHoldsLock && intelligence && intelligence.consolidate) {
      var consResult = await hCtx.runWithTimeout(function() { return intelligence.consolidate(); }, 'intelligence.consolidate()');
      if (consResult && consResult.entries > 0) {
        var msg = '[INTELLIGENCE] Consolidated: ' + consResult.entries + ' entries, ' + consResult.edges + ' edges';
        if (consResult.newEntries > 0) msg += ', ' + consResult.newEntries + ' new';
        msg += ', PageRank recomputed';
        console.log(msg);
      }
    }
    try {
      if (session && session.end) {
        session.end();
      } else {
        console.log('[OK] Session ended');
      }
    } catch (e) { console.log('[WARN] Session end failed: ' + e.message); }

    // ── Routing Feedback Loop (SE-001) ────────────────────────────────────
    // Persist routing accuracy feedback so the router improves over sessions.
    // sessionSuccess is derived from intelligence-outcomes.jsonl entries written
    // during this session (last 30 minutes). A session is marked failed when the
    // majority of feedback() calls carried success=false in that window.
    try {
      var feedbackPath = path.join(CWD, '.monomind', 'routing-feedback.jsonl');
      var lastRoutePath = path.join(CWD, '.monomind', 'last-route.json');
      var MAX_ROUTE = 64 * 1024; // 64 KiB
      if (fs.existsSync(lastRoutePath) && (function() { try { return fs.statSync(lastRoutePath).size <= MAX_ROUTE; } catch(_) { return false; } }())) {
        var lastRoute = JSON.parse(fs.readFileSync(lastRoutePath, 'utf-8'));

        // Derive sessionSuccess from intelligence-outcomes.jsonl
        var sessionSuccess = true; // optimistic default when no signal exists
        try {
          var outcomesPath = path.join(CWD, '.monomind', 'intelligence-outcomes.jsonl');
          var MAX_OUTCOMES = 512 * 1024; // 512 KiB
          if (fs.existsSync(outcomesPath) && (function() { try { return fs.statSync(outcomesPath).size <= MAX_OUTCOMES; } catch(_) { return false; } }())) {
            var windowMs = 30 * 60 * 1000; // 30-minute session window
            var cutoff = Date.now() - windowMs;
            var outcomeLines = fs.readFileSync(outcomesPath, 'utf-8').trim().split('\n').filter(Boolean);
            var recent = outcomeLines.map(function(l) {
              try { return JSON.parse(l); } catch { return null; }
            }).filter(function(e) { return e && e.ts && e.ts >= cutoff; });
            if (recent.length > 0) {
              var failures = recent.filter(function(e) { return e.success === false; }).length;
              // Majority-vote: session fails only if more than half the recent signals are failures
              sessionSuccess = failures / recent.length < 0.5;
            }
          }
        } catch (e) { /* non-critical — keep optimistic default */ }

        if (intelligence && intelligence.feedback) {
          try { intelligence.feedback(sessionSuccess); } catch (e) { /* non-fatal */ }
        }
        var feedbackEntry = {
          timestamp: new Date().toISOString(),
          suggestedAgent: lastRoute.agent,
          confidence: lastRoute.confidence,
          sessionId: String(hookInput.sessionId || hookInput.session_id || '').slice(0, 128),
          intelligenceFeedback: sessionSuccess,
        };
        fs.appendFileSync(feedbackPath, JSON.stringify(feedbackEntry) + '\n', 'utf-8');
        // Rotate: keep last 1000 lines to prevent unbounded growth
        try {
          var MAX_FEEDBACK = 512 * 1024; // 512 KiB
          if (fs.existsSync(feedbackPath) && fs.statSync(feedbackPath).size > MAX_FEEDBACK) {
            // File too large — emergency trim without full read
            throw new Error('skip-rotation');
          }
          var raw = fs.readFileSync(feedbackPath, 'utf-8');
          var lines = raw.split('\n').filter(Boolean);
          if (lines.length > 1000) {
            fs.writeFileSync(feedbackPath, lines.slice(-1000).join('\n') + '\n', 'utf-8');
          }
        } catch (e2) { /* rotation is best-effort */ }
      }
    } catch (e) { /* non-fatal */ }

    // Memory Palace tombstone writes removed — redundant with raw session JSONL

    // ── Learning Service Auto-Consolidation ─────────────────────────────
    // Consolidate learned patterns from short-term to long-term storage.
    // Uses module-level singleton (getLearningService) so the DB is not
    // reopened on every session-end — state accumulated during the session
    // is preserved and consolidated in a single pass.
    if (!daemonHoldsLock) {
      try {
        var ls = await hCtx.getLearningService();
        if (ls && ls.consolidate) {
          var lResult = await hCtx.runWithTimeout(function() { return ls.consolidate(); }, 'learning.consolidate()');
          if (lResult && lResult.promoted > 0) {
            console.log('[LEARNING] Consolidated: ' + lResult.promoted + ' patterns promoted to long-term');
          }
        }
        if (ls && ls.promoteEpisodic) {
          try {
            var promResult = await hCtx.runWithTimeout(function() { return ls.promoteEpisodic(); }, 'learning.promoteEpisodic()');
            if (promResult && promResult.promoted > 0) {
              console.log('[LEARNING] Promoted ' + promResult.promoted + ' episodic patterns to semantic memory');
            }
          } catch (e) { /* non-fatal */ }
        }
      } catch (e) { /* non-fatal — learning-service may need better-sqlite3 */ }
    }

    // ── Context Persistence Auto-Archive ─────────────────────────────────
    // Archive conversation context so it survives compaction and new sessions
    try {
      var cpHook = await import('file://' + path.join(__dirname, '..', 'context-persistence-hook.mjs'));
      if (cpHook && cpHook.archive) {
        await hCtx.runWithTimeout(function() { return cpHook.archive(); }, 'context-persistence.archive()');
        console.log('[CONTEXT_PERSIST] Session transcript archived');
      } else if (cpHook && cpHook.default && cpHook.default.archive) {
        await hCtx.runWithTimeout(function() { return cpHook.default.archive(); }, 'context-persistence.archive()');
        console.log('[CONTEXT_PERSIST] Session transcript archived');
      }
    } catch (e) { /* non-fatal — context-persistence may not export archive() */ }

    // ── Worker Queue Cleanup ─────────────────────────────────────────────
    // Process and clean up any pending worker dispatch files
    try {
      var dispatchDir = path.join(CWD, '.monomind', 'worker-dispatch');
      if (fs.existsSync(dispatchDir)) {
        var pending = fs.readdirSync(dispatchDir).filter(function(f) { return f.startsWith('pending-'); }).slice(0, 500);
        if (pending.length > 0) {
          console.log('[WORKER_CLEANUP] ' + pending.length + ' worker dispatch(es) pending from this session');
        }
        // Move to processed
        var processedDir = path.join(dispatchDir, 'processed');
        fs.mkdirSync(processedDir, { recursive: true });
        pending.forEach(function(f) {
          try {
            fs.renameSync(path.join(dispatchDir, f), path.join(processedDir, f));
          } catch (e) { /* ignore */ }
        });
        // Trim processed/ to last 200 files to prevent unbounded growth
        try {
          var processedFiles = fs.readdirSync(processedDir)
            .filter(function(f) { return f.startsWith('pending-'); })
            .map(function(f) { var fp = path.join(processedDir, f); var mt = 0; try { mt = fs.statSync(fp).mtimeMs; } catch(e2){} return { f: f, mt: mt }; })
            .sort(function(a, b) { return a.mt - b.mt; });
          if (processedFiles.length > 200) {
            processedFiles.slice(0, processedFiles.length - 200).forEach(function(item) {
              try { fs.unlinkSync(path.join(processedDir, item.f)); } catch (e2) { /* ignore */ }
            });
          }
        } catch (e2) { /* non-fatal */ }
      }
    } catch (e) { /* non-fatal */ }
  }
};
