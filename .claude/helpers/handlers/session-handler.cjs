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

    // ── Session-end feedback BEFORE consolidation ──────────────────────────
    // IMPORTANT: feedback() must run BEFORE consolidate() so that the session-end
    // outcome record captures recentEdits from disk. consolidate() clears
    // recent-edits.jsonl, so calling it first leaves the outcome empty.
    // (Fixed: all outcomes previously had recentEdits: [].)

    // ── Routing Feedback Loop (SE-001) ────────────────────────────────────
    // Persist routing accuracy feedback so the router improves over sessions.
    // sessionSuccess is derived from intelligence-outcomes.jsonl entries written
    // during this session (last 30 minutes). A session is marked failed when the
    // majority of feedback() calls carried success=false in that window.
    var sessionSuccess = null; // null = no evidence; only set to a boolean from real signals
    try {
      var feedbackPath = path.join(CWD, '.monomind', 'routing-feedback.jsonl');
      var lastRoutePath = path.join(CWD, '.monomind', 'last-route.json');
      var MAX_ROUTE = 64 * 1024; // 64 KiB
      if (fs.existsSync(lastRoutePath) && (function() { try { return fs.statSync(lastRoutePath).size <= MAX_ROUTE; } catch(_) { return false; } }())) {
        var lastRoute = JSON.parse(fs.readFileSync(lastRoutePath, 'utf-8'));

        // Derive sessionSuccess from git commits (strongest signal: user committed = success)
        try {
          var execSync = require('child_process').execSync;
          var recentCommits = execSync('git log --oneline --since="30 minutes ago" 2>/dev/null || true', { cwd: CWD, timeout: 3000, encoding: 'utf-8' }).trim();
          if (recentCommits.length > 0) {
            sessionSuccess = true;
          } else {
            // No commits — check if files were modified (work in progress, not failure)
            var gitStatus = execSync('git diff --name-only 2>/dev/null || true', { cwd: CWD, timeout: 3000, encoding: 'utf-8' }).trim();
            // Modified files = probably still working; no changes at all = exploration or failure
            if (gitStatus.length === 0) {
              // Fall back to intelligence-outcomes as a weak signal
              var outcomesPath = path.join(CWD, '.monomind', 'data', 'intelligence-outcomes.jsonl');
              var MAX_OUTCOMES = 512 * 1024;
              if (fs.existsSync(outcomesPath) && (function() { try { return fs.statSync(outcomesPath).size <= MAX_OUTCOMES; } catch(_) { return false; } }())) {
                var windowMs = 30 * 60 * 1000;
                var cutoff = Date.now() - windowMs;
                var outcomeLines = fs.readFileSync(outcomesPath, 'utf-8').trim().split('\n').filter(Boolean);
                var recent = outcomeLines.map(function(l) {
                  try { return JSON.parse(l); } catch { return null; }
                }).filter(function(e) { return e && e.ts && e.ts >= cutoff; });
                if (recent.length > 0) {
                  var failures = recent.filter(function(e) { return e.success === false; }).length;
                  sessionSuccess = failures / recent.length < 0.5;
                }
              }
            }
            // else: modified files exist — work in progress, not evidence either way (leave null)
          }
        } catch (e) { /* non-critical — leave null (no evidence) */ }

        // Record session-end feedback WITH recentEdits (before consolidate clears them)
        if (intelligence && intelligence.feedback && typeof sessionSuccess === 'boolean') {
          try { intelligence.feedback(sessionSuccess); } catch (e) { /* non-fatal */ }
        }
        // Normalize agent label to a lowercase slug ("Coder" → "coder", "backend dev" → "backend-dev")
        var agentSlug = String(lastRoute.agent || '').trim().toLowerCase().replace(/\s+/g, '-');
        // Skip non-agent placeholders — "AI selecting" etc. carry no routing signal
        if (agentSlug && agentSlug !== 'ai-selecting' && agentSlug !== 'unknown') {
          var feedbackEntry = {
            timestamp: new Date().toISOString(),
            suggestedAgent: agentSlug,
            confidence: lastRoute.confidence,
            sessionId: String(hookInput.sessionId || hookInput.session_id || '').slice(0, 128),
          };
          // Only write the success flag when derived from actual evidence (commits, outcomes)
          if (typeof sessionSuccess === 'boolean') feedbackEntry.intelligenceFeedback = sessionSuccess;
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
      }
    } catch (e) { /* non-fatal */ }

    // Now consolidate AFTER feedback has been recorded (so the outcome has recentEdits)
    if (!daemonHoldsLock && intelligence && intelligence.consolidate) {
      var consResult = await hCtx.runWithTimeout(function() { return intelligence.consolidate(); }, 'intelligence.consolidate()');
      if (consResult && consResult.entries > 0) {
        var msg = '[INTELLIGENCE] Consolidated: ' + consResult.entries + ' entries';
        if (consResult.newEntries > 0) msg += ', ' + consResult.newEntries + ' new patterns learned';
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

    // Bridge to @monomind/hooks registry — fires SessionEnd hooks (episode-binner closeEpisode, observability bus).
    // Each hook event runs in a fresh process, so hCtx._hooksModule set by session-restore in an
    // earlier invocation is never visible here — must (re)load lazily via _ensureHooksModule().
    var _hooksModule = hCtx._hooksModule || (hCtx._ensureHooksModule ? await hCtx._ensureHooksModule() : null);
    if (_hooksModule && _hooksModule.executeHooks && _hooksModule.HookEvent) {
      try {
        await _hooksModule.executeHooks(_hooksModule.HookEvent.SessionEnd, {
          session: {
            id: String(hookInput.sessionId || hookInput.session_id || ''),
            startedAt: new Date(),
          },
          success: sessionSuccess !== false, // null (no evidence) still counts as non-failure here
        }, { continueOnError: true, timeout: 2000 });
      } catch (e) { /* non-fatal */ }
    }

    // Memory Palace tombstone writes removed — redundant with raw session JSONL

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

    // ── Auto-populate: write session episode for every session ─────
    // Even solo sessions (no subagents) produce an episode so the
    // route handler can surface relevant past sessions.
    try {
      var episodicDir = path.join(CWD, '.monomind', 'episodic');
      fs.mkdirSync(episodicDir, { recursive: true });
      var epPath = path.join(episodicDir, 'episodes.jsonl');

      // Collect session context
      var sessId = String(hookInput.sessionId || hookInput.session_id || process.env.CLAUDE_SESSION_ID || '');
      var lastRouteFile = path.join(CWD, '.monomind', 'last-route.json');
      var routeAgent = 'unknown';
      var routePrompt = '';
      try {
        if (fs.existsSync(lastRouteFile) && fs.statSync(lastRouteFile).size < 16384) {
          var lr = JSON.parse(fs.readFileSync(lastRouteFile, 'utf-8'));
          routeAgent = lr.agent || 'unknown';
          routePrompt = lr.prompt || '';
        }
      } catch (e) {}

      // Strip system noise (task notifications, XML tags) from prompt
      if (routePrompt && (routePrompt.includes('<task-notification>') || routePrompt.includes('<system-reminder>'))) {
        routePrompt = '';
      }

      // Determine session success from git commits (strongest signal)
      var sessionOutcome = 'unknown';
      var commitMessages = [];
      var editedFiles = [];
      try {
        var execSync = require('child_process').execSync;
        // Get recent commits as success signal
        var commitLog = execSync('git log --oneline --since="30 minutes ago" 2>/dev/null || true', { cwd: CWD, timeout: 3000, encoding: 'utf-8' }).trim();
        if (commitLog.length > 0) {
          sessionOutcome = 'success';
          commitMessages = commitLog.split('\n').filter(Boolean).map(function(l) {
            return l.replace(/^[a-f0-9]+ /, '');
          }).slice(0, 5);
        }
        // Get modified files from working tree
        var diffOut = execSync('git diff --name-only HEAD 2>/dev/null || true', { cwd: CWD, timeout: 3000, encoding: 'utf-8' });
        editedFiles = diffOut.trim().split('\n').filter(Boolean).map(function(f) { return path.basename(f); }).slice(0, 15);
        if (sessionOutcome === 'unknown' && editedFiles.length > 0) {
          sessionOutcome = 'in-progress';
        }
      } catch (e) {}

      // Write episode with rich searchable content (commit messages are the user's own words)
      var summaryParts = [];
      if (routePrompt) summaryParts.push(routePrompt.slice(0, 300));
      if (commitMessages.length > 0) summaryParts.push('Commits: ' + commitMessages.join('; '));
      if (editedFiles.length > 0) summaryParts.push('Modified: ' + editedFiles.join(', '));
      if (sessionOutcome !== 'unknown') summaryParts.push('Outcome: ' + sessionOutcome);
      if (summaryParts.length === 0) summaryParts.push('Session with ' + routeAgent);

      var soloEpisode = {
        episodeId: require('crypto').randomUUID(),
        sessionId: sessId,
        runIds: [sessId],
        summary: summaryParts.join('\n'),
        startedAt: Date.now() - 300000,
        endedAt: Date.now(),
        agentSlugs: [routeAgent],
        taskTypes: [routeAgent],
        tokenEstimate: 0
      };
      fs.appendFileSync(epPath, JSON.stringify(soloEpisode) + '\n', 'utf-8');

      // Rotate: keep last 500 episodes
      try {
        var epStat = fs.statSync(epPath);
        if (epStat.size > 256 * 1024) {
          var epLines = fs.readFileSync(epPath, 'utf-8').trim().split('\n').filter(Boolean);
          if (epLines.length > 500) {
            fs.writeFileSync(epPath, epLines.slice(-500).join('\n') + '\n', 'utf-8');
          }
        }
      } catch (e) {}
    } catch (e) { /* non-fatal */ }

    // ── Memory ops summary ──────────────────────────────────────
    try {
      var memOpsSessionId = String(hookInput.sessionId || hookInput.session_id || process.env.CLAUDE_SESSION_ID || '');
      var memOpsPath = path.join(CWD, '.monomind', 'memory-ops-' + memOpsSessionId.slice(0, 16) + '.json');
      if (fs.existsSync(memOpsPath)) {
        var memOps = JSON.parse(fs.readFileSync(memOpsPath, 'utf-8'));
        if (memOps.writes > 0 || memOps.searches > 0) {
          var parts = [];
          if (memOps.writes > 0) parts.push(memOps.writes + ' writes' + (memOps.redundantWrites > 0 ? ' (' + memOps.redundantWrites + ' redundant)' : ''));
          if (memOps.searches > 0) parts.push(memOps.searches + ' searches' + (memOps.emptySearches > 0 ? ' (' + memOps.emptySearches + ' empty)' : ''));
          console.log('[MEMORY_OPS] Session: ' + parts.join(', '));
        }
        // Clean up session stats file
        try { fs.unlinkSync(memOpsPath); } catch (e) {}
      }
    } catch (e) { /* non-fatal */ }

  }
};
