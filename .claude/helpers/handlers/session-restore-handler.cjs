'use strict';
// Extracted from hook-handler.cjs — handles 'session-restore' hook event.
// Receives hCtx from dispatcher. See route-handler.cjs for hCtx field docs.

const path = require('path');
const fs = require('fs');
const { injectGodNodesContext } = require('../utils/monograph.cjs');

module.exports = {
  handleRestore: async function(hCtx) {
    var hookInput = hCtx.hookInput;
    var session = hCtx.session;
    var intelligence = hCtx.intelligence;
    var CWD = hCtx.CWD;
    var helpersDir = hCtx.helpersDir;
    var runWithTimeout = hCtx.runWithTimeout;
    var _autoIndexKnowledge = hCtx._autoIndexKnowledge;
    var _buildKnowledgeSearchFn = hCtx._buildKnowledgeSearchFn;
    var getMonographSuggestions = hCtx.getMonographSuggestions;

    // Session restore / start
    try {
      if (session) {
        var existing = session.restore && session.restore();
        if (!existing) {
          session.start && session.start();
        }
      } else {
        console.log('[OK] Session restored: session-' + Date.now());
      }
    } catch (e) { console.log('[WARN] Session restore failed: ' + e.message); }

    // ── Non-blocking security scan via @monomind/hooks worker ─────────────
    // The hooks package ships a security worker (worker-security.ts) that scans
    // for hardcoded secrets and vulnerability patterns. We run it at session
    // start as a fire-and-forget check — failures are silently ignored since
    // the package may not be installed or built.
    try {
      var hooksWorkersMod = require('@monomind/hooks/dist/workers/worker-security.js');
      var _createSecurityWorker = hooksWorkersMod.createSecurityWorker;
      if (typeof _createSecurityWorker === 'function') {
        var _securityScan = _createSecurityWorker(CWD);
        // Fire-and-forget: do not await — must not delay session restore
        Promise.resolve(_securityScan()).catch(function() {});
      }
    } catch (e) { /* @monomind/hooks not available or not built — skip */ }

    // Stale helper self-heal — silently refresh project helpers that drift from
    // the bundled npm copy, so a `npm i -g monomind@latest` (or npx picking up a
    // new version) takes effect on the very next session instead of requiring a
    // manual `doctor --fix` / `init upgrade`. Skip when running inside the
    // monomind dev repo itself: local helpers ARE the source of truth there, so
    // any diff vs. the npm global install is expected (and would self-clobber
    // in-progress edits).
    try {
      // Walk up from CWD, not just check CWD directly — Claude Code can be opened
      // with CWD set to any subdirectory of the monorepo (e.g. packages/@monomind/cli
      // itself, or a nested package), where a bare CWD-only check would miss the
      // monorepo root and wrongly treat the dev repo as a regular consumer project,
      // letting the heal logic below silently overwrite the actual dev-repo SOURCE
      // helpers (packages/@monomind/cli/.claude/helpers/*) with a stale published
      // version pulled from node_modules/global npm.
      var _isDevRepo = (function() {
        var dir = CWD;
        for (var _d = 0; _d < 6; _d++) {
          if (fs.existsSync(path.join(dir, 'packages', '@monomind', 'cli', 'package.json')) &&
              fs.existsSync(path.join(dir, 'packages', '@monomind', 'cli', '.claude', 'helpers'))) {
            return true;
          }
          var _parent = path.dirname(dir);
          if (_parent === dir) break;
          dir = _parent;
        }
        return false;
      })();
      if (!_isDevRepo) {
        var crypto = require('crypto');
        function _findBundledHelpers() {
          var helperPaths = [
            path.join(helpersDir),
            path.join(CWD, 'node_modules', 'monomind', '.claude', 'helpers'),
            path.join(CWD, 'node_modules', '@monoes', 'monomindcli', '.claude', 'helpers'),
          ];
          try {
            var globalRoot = require('child_process')
              .execSync('npm root -g 2>/dev/null', { encoding: 'utf-8', timeout: 2000 })
              .trim();
            if (globalRoot) {
              helperPaths.push(path.join(globalRoot, 'monomind', '.claude', 'helpers'));
              helperPaths.push(path.join(globalRoot, '@monoes', 'monomindcli', '.claude', 'helpers'));
            }
          } catch (_) {}
          for (var i = 0; i < helperPaths.length; i++) {
            if (fs.existsSync(path.join(helperPaths[i], 'hook-handler.cjs')) &&
                helperPaths[i] !== path.join(CWD, '.claude', 'helpers')) {
              return helperPaths[i];
            }
          }
          return null;
        }

        function _hashFile(p) {
          try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
          catch (_) { return null; }
        }

        // Copy `bundledF` -> `localF` iff their contents differ (or local is missing).
        // Atomic copy-via-rename so a partial write can never leave a broken hook.
        function _healIfStale(localF, bundledF) {
          if (!fs.existsSync(bundledF)) return null;
          var hashB = _hashFile(bundledF);
          var hashL = fs.existsSync(localF) ? _hashFile(localF) : null;
          if (hashL === hashB) return null;
          try {
            var tmp = localF + '.' + process.pid + '.tmp';
            fs.mkdirSync(path.dirname(localF), { recursive: true });
            fs.copyFileSync(bundledF, tmp);
            try { fs.chmodSync(tmp, 0o755); } catch (_) {}
            fs.renameSync(tmp, localF);
            return path.relative(path.join(CWD, '.claude', 'helpers'), localF);
          } catch (_) { return null; }
        }

        var bundledDir = _findBundledHelpers();
        if (bundledDir) {
          var healed = [];
          // Top-level critical files — mirrors executor.ts's `criticalHelpers` list.
          var helpersToCheck = ['hook-handler.cjs', 'statusline.cjs', 'router.cjs', 'graphify-freshen.cjs', 'intelligence.cjs', 'auto-memory-hook.mjs'];
          for (var hi = 0; hi < helpersToCheck.length; hi++) {
            var hName = helpersToCheck[hi];
            var healedName = _healIfStale(
              path.join(CWD, '.claude', 'helpers', hName),
              path.join(bundledDir, hName)
            );
            if (healedName) healed.push(healedName);
          }
          // handlers/ and utils/ subdirectories — where most real hook-behavior
          // fixes actually live (capture-handler.cjs, gates-handler.cjs, etc.).
          var subdirs = ['handlers', 'utils'];
          for (var si = 0; si < subdirs.length; si++) {
            var bundledSub = path.join(bundledDir, subdirs[si]);
            if (!fs.existsSync(bundledSub)) continue;
            var files;
            try { files = fs.readdirSync(bundledSub).filter(function(f) { return !f.startsWith('._') && !fs.statSync(path.join(bundledSub, f)).isDirectory(); }); }
            catch (_) { files = []; }
            for (var fi = 0; fi < files.length; fi++) {
              var healedName2 = _healIfStale(
                path.join(CWD, '.claude', 'helpers', subdirs[si], files[fi]),
                path.join(bundledSub, files[fi])
              );
              if (healedName2) healed.push(healedName2);
            }
          }
          if (healed.length > 0) {
            console.log('[STALE_HELPERS] Refreshed ' + healed.length + ' helper(s) from bundled version: ' + healed.join(', '));
          }
        }

        // Fallback for pure `npx monomind@latest ...` usage — the local scan above
        // only finds a bundled copy via node_modules or a global npm install, but a
        // per-invocation `npx` run leaves no reliably-discoverable copy there (each
        // invocation caches under a hashed, non-predictable ~/.npm/_npx/<hash>/ dir
        // that this process has no correct way to pick the newest of without risking
        // healing "backward" to some older cached version). `npx monomind@latest`
        // itself already resolves this correctly (it always fetches/uses latest),
        // and `doctor --fix` reuses the exact same bundled-package resolution that
        // `init upgrade` uses — so shell out to it instead of re-solving the same
        // problem here. Rate-limited to once per 6h (mirrors the metrics-worker
        // staleness gate below) and fully non-blocking: spawned detached+unref with
        // stdio ignored, session start never waits on it, and a fresh session or
        // hook a few seconds later just picks up whatever it left behind.
        try {
          var _healCheckPath = path.join(CWD, '.monomind', 'helpers-heal-check.json');
          var _lastHealCheck = 0;
          try { _lastHealCheck = JSON.parse(fs.readFileSync(_healCheckPath, 'utf-8')).ts || 0; } catch (_) {}
          var HEAL_CHECK_STALE_MS = 6 * 60 * 60 * 1000; // 6 hours
          if (Date.now() - _lastHealCheck > HEAL_CHECK_STALE_MS) {
            // Write the rate-limit marker BEFORE spawning, and only spawn if the
            // write actually succeeded (fail closed) — otherwise a persistently
            // unwritable marker (disk quota, permissions) would make this branch
            // re-fire on every single session-restore instead of once per 6h,
            // since `Date.now() - 0 > HEAL_CHECK_STALE_MS` stays true forever.
            var _markerWritten = false;
            try {
              fs.mkdirSync(path.dirname(_healCheckPath), { recursive: true });
              fs.writeFileSync(_healCheckPath, JSON.stringify({ ts: Date.now() }), 'utf-8');
              _markerWritten = true;
            } catch (_) {}
            if (_markerWritten) {
              var _spawn = require('child_process').spawn;
              // shell:true is required on Windows to invoke npx.cmd via spawn()
              // without an explicit .cmd extension; harmless on macOS/Linux.
              var _child = _spawn('npx', ['-y', 'monomind@latest', 'doctor', '--fix', '--component', 'helpers'], {
                cwd: CWD,
                detached: true,
                stdio: 'ignore',
                env: process.env,
                shell: process.platform === 'win32',
                windowsHide: true,
              });
              _child.on('error', function() {}); // offline / npx unavailable — silently skip
              _child.unref();
            }
          }
        } catch (e) { /* non-fatal — background self-heal is best-effort */ }
      }
    } catch (e) { /* non-fatal */ }

    // Initialize intelligence — respects monomind.neural.enabled kill switch.
    var neuralEnabled = true;
    try {
      var settingsPath = path.join(CWD, '.claude', 'settings.json');
      var MAX_SETTINGS = 256 * 1024; // 256 KiB
      if (fs.existsSync(settingsPath) && (function() { try { return fs.statSync(settingsPath).size <= MAX_SETTINGS; } catch(_) { return false; } }())) {
        var settingsData = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (settingsData.monomind && settingsData.monomind.neural && settingsData.monomind.neural.enabled === false) {
          neuralEnabled = false;
          console.log('[NEURAL] Disabled via monomind.neural.enabled=false');
        }
      }
    } catch (e) { /* non-fatal */ }
    if (neuralEnabled && intelligence && intelligence.init) {
      var initResult = await runWithTimeout(function() { return intelligence.init(); }, 'intelligence.init()');
      if (initResult && initResult.nodes > 0) {
        console.log('[INTELLIGENCE] Loaded ' + initResult.nodes + ' patterns, ' + initResult.edges + ' edges');
      }
    }

    // Bridge to @monomind/hooks compiled workers (GAP-001).
    // Uses the shared hCtx._ensureHooksModule() (defined in hook-handler.cjs) so worker
    // registration happens exactly once per process instead of being duplicated here —
    // every other bridging handler (agent-start, pre-task, post-task, post-edit,
    // session-end) calls the same lazy loader since each hook event is its own process.
    try {
      var hooksModule = hCtx._ensureHooksModule ? await hCtx._ensureHooksModule() : await import('@monomind/hooks');
      if (hooksModule) {
        hCtx._hooksModule = hooksModule;
        console.log('[INFO] @monomind/hooks workers initialized');

        // Gate enforcement lives entirely in gates-handler.cjs (its own regex
        // table, run on every PreToolUse). The @monomind/guidance package that
        // used to compile gate configs here was removed.

        // Fire SessionStart event so observability bus and other SessionStart hooks activate
        if (hooksModule.executeHooks && hooksModule.HookEvent) {
          try {
            await runWithTimeout(function() {
              return hooksModule.executeHooks(hooksModule.HookEvent.SessionStart, {
                session: {
                  id: String(hookInput.sessionId || hookInput.session_id || ''),
                  startedAt: new Date(),
                },
              }, { continueOnError: true, timeout: 1500 });
            }, '@monomind/hooks.SessionStart');
          } catch (e2) { /* non-fatal */ }
        }
      }
    } catch (e) { /* @monomind/hooks not compiled yet — skip */ }

    // Refresh worker metrics once per session start — the statusline
    // (.claude/helpers/statusline.cjs) reads .monomind/metrics/ddd-progress.json,
    // route-handler.cjs and doctor read codebase-map/security-audit/performance/
    // consolidation.json; the @monomind/hooks workers are never otherwise
    // scheduled on the live hook path (the worker daemon that used to produce
    // these files was deleted).
    //
    // Staleness gating keeps session start fast: the metrics-producing workers
    // only run when their output file is missing or older than 6 hours (ddd is
    // refreshed every session, as before). Each run is capped by runWithTimeout
    // (1.5s) — on timeout the awaiting stops but the worker keeps running and
    // flushes atomically via tmp+rename, so a slow worker never blocks session
    // start and never leaves a partial file.
    try {
      var _metricsDir = path.join(CWD, '.monomind', 'metrics');
      fs.mkdirSync(_metricsDir, { recursive: true });
      var STALE_MS = 6 * 60 * 60 * 1000; // 6 hours
      var _isStale = function(outFile) {
        try {
          var st = fs.statSync(path.join(_metricsDir, outFile));
          return (Date.now() - st.mtimeMs) > STALE_MS;
        } catch (e) { return true; } // missing → run
      };
      var _hooksWorkers = [
        { factory: 'createDDDWorker',         file: 'worker-ddd.js',         out: 'ddd-progress.json',    always: true },
        { factory: 'createMapWorker',         file: 'worker-map.js',         out: 'codebase-map.json' },
        { factory: 'createAuditWorker',       file: 'worker-audit.js',       out: 'security-audit.json' },
        { factory: 'createOptimizeWorker',    file: 'worker-optimize.js',    out: 'performance.json' },
        { factory: 'createConsolidateWorker', file: 'worker-consolidate.js', out: 'consolidation.json' },
      ];
      var _hooksDistDir = path.join(CWD, 'packages', '@monomind', 'hooks', 'dist', 'workers');
      for (var wi = 0; wi < _hooksWorkers.length; wi++) {
        var _w = _hooksWorkers[wi];
        if (!_w.always && !_isStale(_w.out)) continue;
        try {
          var _create = (hooksModule && typeof hooksModule[_w.factory] === 'function')
            ? hooksModule[_w.factory] : null;
          if (!_create) {
            // Dev-repo fallback: bare '@monomind/hooks' does not resolve from .claude/helpers
            // in the monorepo (pnpm workspace link lives under packages/@monomind/cli), so
            // import the compiled worker directly by path.
            var _wDist = path.join(_hooksDistDir, _w.file);
            if (fs.existsSync(_wDist)) {
              var _wMod = await import('file://' + _wDist);
              if (_wMod && typeof _wMod[_w.factory] === 'function') _create = _wMod[_w.factory];
            }
          }
          if (_create) {
            var _wRun = _create(CWD);
            // runWithTimeout caps each at 1.5s so a slow worker can never block session start.
            await runWithTimeout(function() { return _wRun(); }, '@monomind/hooks.' + _w.factory);
          }
        } catch (e) { /* non-fatal — worker unavailable */ }
      }
    } catch (e) { /* non-fatal — hooks workers unavailable */ }

    // AgentKnowledgeBase — preload shared knowledge context on session restore.
    try {
      var knowledgeDir = path.join(CWD, '.monomind', 'knowledge');
      var indexed = _autoIndexKnowledge(knowledgeDir);
      if (indexed > 0) {
        console.log('[KNOWLEDGE_INDEXED] ' + indexed + ' chunks written from project sources');
      }

      var kSearchFn = _buildKnowledgeSearchFn(knowledgeDir);
      var sessionCtx = (hookInput && (hookInput.sessionId || hookInput.session_id))
        ? 'session context: ' + (hookInput.sessionId || hookInput.session_id)
        : 'project context general';

      var memoryMod = null;
      try { memoryMod = await import('@monomind/memory'); } catch (e) {}

      if (memoryMod && memoryMod.KnowledgeStore && memoryMod.KnowledgeRetriever) {
        var kStore = new memoryMod.KnowledgeStore(knowledgeDir);
        var kRetriever = new memoryMod.KnowledgeRetriever(kSearchFn, kStore);
        var kResult = await kRetriever.retrieveForTask('shared', sessionCtx, 5);
        if (kResult.excerpts.length > 0) {
          console.log('[KNOWLEDGE_PRELOADED] ' + kResult.excerpts.length + ' excerpts (KnowledgeRetriever)');
        }
      } else {
        var directResults = await kSearchFn(sessionCtx, { namespace: 'knowledge:shared', limit: 5, minScore: 0.3 });
        if (directResults.length > 0) {
          console.log('[KNOWLEDGE_PRELOADED] ' + directResults.length + ' excerpts (direct keyword search)');
        }
      }
    } catch (e) { /* non-fatal */ }

    // Monograph Context Injection — delegates to shared helper in utils/monograph.cjs.
    injectGodNodesContext(CWD);

    // SharedInstructions — auto-load .agents/shared_instructions.md (hard limit: 1500 chars).
    var SI_CHAR_LIMIT = 1500;
    var applySharedInstrLimit = function(content, source) {
      if (content.length > SI_CHAR_LIMIT) {
        console.warn('[SHARED_INSTRUCTIONS_OVERLIMIT] ' + content.length + ' chars exceeds limit of ' + SI_CHAR_LIMIT +
          ' — truncating. Edit ' + source + ' to stay under limit.');
        return content.slice(0, SI_CHAR_LIMIT) + '\n… [truncated — file exceeds ' + SI_CHAR_LIMIT + ' char limit]';
      }
      return content;
    };
    try {
      var siMod = await import('file://' + path.join(CWD, 'packages/@monomind/cli/dist/src/agents/shared-instructions-loader.js'));
      var loader = siMod.sharedInstructionsLoader || (siMod.SharedInstructionsLoader ? new siMod.SharedInstructionsLoader() : null);
      if (loader) {
        var sharedInstr = loader.getSharedInstructions(CWD);
        if (sharedInstr) {
          var sharedInstrSafe = applySharedInstrLimit(sharedInstr, '.agents/shared_instructions.md');
          console.log('[SHARED_INSTRUCTIONS] Loaded ' + sharedInstrSafe.length + ' chars from .agents/shared_instructions.md');
          console.log(sharedInstrSafe);
        }
      }
    } catch (e) {
      try {
        var siPath = path.join(CWD, '.agents', 'shared_instructions.md');
        if (fs.existsSync(siPath)) {
          var siContent = fs.readFileSync(siPath, 'utf-8');
          var siContentSafe = applySharedInstrLimit(siContent, siPath);
          console.log('[SHARED_INSTRUCTIONS] Loaded ' + siContentSafe.length + ' chars from .agents/shared_instructions.md');
          console.log(siContentSafe);
        }
      } catch (e2) { /* non-fatal */ }
    }

    // Memory Palace — inject L0 (identity) + L1 (essential story) into session context.
    try {
      var palace = require(path.join(helpersDir, 'memory-palace.cjs'));
      var palaceContext = palace.wakeUp(CWD);
      if (palaceContext) {
        console.log(palaceContext);
      }
    } catch (e) { /* non-fatal — palace not available */ }

    // Periodic Update Check (once per day).
    try {
      var updateCheckFile = path.join(CWD, '.monomind', 'last-update-check.json');
      var shouldCheck = true;
      if (fs.existsSync(updateCheckFile)) {
        var lastCheck = JSON.parse(fs.readFileSync(updateCheckFile, 'utf-8'));
        var hoursSince = (Date.now() - new Date(lastCheck.timestamp).getTime()) / (1000 * 60 * 60);
        if (hoursSince < 24) shouldCheck = false;
      }
      if (shouldCheck) {
        fs.mkdirSync(path.join(CWD, '.monomind'), { recursive: true });
        fs.writeFileSync(updateCheckFile, JSON.stringify({ timestamp: new Date().toISOString() }), 'utf-8');
        try {
          var localPkg = path.join(CWD, 'packages/@monomind/cli/package.json');
          var MAX_PKG = 64 * 1024; // 64 KiB
          if (fs.existsSync(localPkg) && (function() { try { return fs.statSync(localPkg).size <= MAX_PKG; } catch(_) { return false; } }())) {
            var localVer = JSON.parse(fs.readFileSync(localPkg, 'utf-8')).version;
            if (localVer) {
              var spawnFn = require('child_process').spawn;
              var child = spawnFn('npm', ['view', '@monomind/cli', 'version'], {
                stdio: ['ignore', 'pipe', 'ignore'],
                shell: false,
              });
              child.on('error', function() {});
              var out = '';
              child.stdout.on('data', function(d) { if (out.length < 256) out += d; });
              child.on('close', function() {
                var current = out.trim().slice(0, 64);
                var pendingUpdatePath = path.join(CWD, '.monomind', 'pending-update.json');
                if (current && current !== localVer) {
                  try {
                    fs.writeFileSync(
                      pendingUpdatePath,
                      JSON.stringify({ from: localVer, to: current, checkedAt: new Date().toISOString() }),
                      'utf-8'
                    );
                  } catch (e2) {}
                } else if (current) {
                  try { fs.unlinkSync(pendingUpdatePath); } catch (e2) {}
                }
              });
              child.unref();
            }
          }
        } catch (e) { /* npm not available */ }
      }
      try {
        var pendingUpdate = path.join(CWD, '.monomind', 'pending-update.json');
        var MAX_UPD = 4096; // 4 KiB
        if (fs.existsSync(pendingUpdate) && (function() { try { return fs.statSync(pendingUpdate).size <= MAX_UPD; } catch(_) { return false; } }())) {
          var upd = JSON.parse(fs.readFileSync(pendingUpdate, 'utf-8'));
          if (upd && upd.from && upd.to && upd.from !== upd.to) {
            console.log('[UPDATE_AVAILABLE] @monomind/cli ' + upd.from + ' → ' + upd.to + ' (run: npx monomind update)');
          }
        }
      } catch (e) {}
    } catch (e) { /* non-fatal */ }

    // Token Usage — inject daily/monthly cost summary.
    try {
      var tokenTracker = require(path.join(helpersDir, 'token-tracker.cjs'));
      var tokenSummary = tokenTracker.quickSummary();
      if (tokenSummary) {
        console.log(tokenSummary);
      }
      try {
        var tokenData = tokenTracker.quickSummaryData();
        if (tokenData) {
          var metricsDir = path.join(CWD, '.monomind', 'metrics');
          if (!fs.existsSync(metricsDir)) fs.mkdirSync(metricsDir, { recursive: true });
          tokenData.cachedAt = new Date().toISOString();
          fs.writeFileSync(path.join(metricsDir, 'token-summary.json'), JSON.stringify(tokenData), 'utf-8');
        }
      } catch (_) { /* ignore cache write failure */ }
    } catch (e) { /* non-fatal — token tracker not available */ }

    // Registry Surfacing (SR-001) — show agent count.
    try {
      var regPath = path.join(CWD, '.monomind', 'registry.json');
      var MAX_REG = 512 * 1024; // 512 KiB
      if (fs.existsSync(regPath) && (function() { try { return fs.statSync(regPath).size <= MAX_REG; } catch(_) { return false; } }())) {
        var reg = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
        var agentCount = (reg.agents || []).length;
        if (agentCount > 0) {
          console.log('[REGISTRY] ' + agentCount + ' agents available in registry');
        }
      }
    } catch (e) { /* non-fatal */ }

    // Monomind Control UI Status — only probe when a daemon.pid file exists,
    // meaning the daemon was intentionally started in this project. This avoids
    // printing "[CONTROL_UI] offline" noise on every session in projects that
    // never run the daemon.  The broader "monomind.config.json" check is dropped
    // because that file is present in the dev repo itself and in any initialized
    // project, making the old condition nearly always true.
    var _controlUiShouldProbe = fs.existsSync(path.join(CWD, '.monomind', 'daemon.pid'));
    if (_controlUiShouldProbe) {
      try {
        var http = require('http');
        var controlPort = 4242;
        var req = http.get('http://localhost:' + controlPort + '/', function(res) {
          if (res.statusCode === 200) {
            console.log('[CONTROL_UI] UP — http://localhost:' + controlPort);
          }
          res.resume();
        });
        req.on('error', function() {
          // Only warn when daemon was previously running (pid file exists but server is gone)
          console.log('[CONTROL_UI] offline — restart with: npx monomind mcp start');
        });
        req.setTimeout(800, function() { req.destroy(); });
      } catch (e) { /* non-fatal */ }
    }

  },
};
