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

    // Stale helper detection — warn when project helpers drift from the bundled npm copy.
    try {
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

      var bundledDir = _findBundledHelpers();
      if (bundledDir) {
        var helpersToCheck = ['hook-handler.cjs', 'statusline.cjs'];
        var stale = [];
        for (var hi = 0; hi < helpersToCheck.length; hi++) {
          var hName = helpersToCheck[hi];
          var localF   = path.join(CWD, '.claude', 'helpers', hName);
          var bundledF = path.join(bundledDir, hName);
          if (!fs.existsSync(localF) || !fs.existsSync(bundledF)) continue;
          try {
            var hashL = crypto.createHash('sha256').update(fs.readFileSync(localF)).digest('hex');
            var hashB = crypto.createHash('sha256').update(fs.readFileSync(bundledF)).digest('hex');
            if (hashL !== hashB) stale.push(hName);
          } catch (_) {}
        }
        if (stale.length > 0) {
          console.log('[STALE_HELPERS] Project helpers differ from bundled version: ' + stale.join(', '));
          console.log('  Run `npx monomind@latest init upgrade` to refresh and pick up the latest features.');
        }
      }
    } catch (e) { /* non-fatal */ }

    // Initialize intelligence — respects monomind.neural.enabled kill switch.
    var neuralEnabled = true;
    try {
      var settingsPath = path.join(CWD, '.claude', 'settings.json');
      if (fs.existsSync(settingsPath)) {
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
    try {
      var hooksModule = await import('@monomind/hooks');
      if (hooksModule && hooksModule.initDefaultWorkers) {
        await runWithTimeout(function() { return hooksModule.initDefaultWorkers(); }, '@monomind/hooks.initDefaultWorkers()');
        hCtx._hooksModule = hooksModule;
        console.log('[INFO] @monomind/hooks workers initialized');
      }
    } catch (e) { /* @monomind/hooks not compiled yet — skip */ }

    // Context Persistence Auto-Restore
    try {
      var cpHook = await import('file://' + path.join(helpersDir, 'context-persistence-hook.mjs'));
      var restoreFn = (cpHook && cpHook.restore) || (cpHook && cpHook.default && cpHook.default.restore);
      if (restoreFn) {
        var restored = await runWithTimeout(function() { return restoreFn(); }, 'context-persistence.restore()');
        if (restored && restored.turns > 0) {
          console.log('[CONTEXT_RESTORED] ' + restored.turns + ' turns from previous session');
        }
      }
    } catch (e) { /* non-fatal */ }

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
          if (fs.existsSync(localPkg)) {
            var localVer = JSON.parse(fs.readFileSync(localPkg, 'utf-8')).version;
            if (localVer) {
              var spawnFn = require('child_process').spawn;
              var child = spawnFn('npm', ['view', '@monomind/cli', 'version'], {
                stdio: ['ignore', 'pipe', 'ignore'],
                shell: false,
              });
              child.on('error', function() {});
              var out = '';
              child.stdout.on('data', function(d) { out += d; });
              child.on('close', function() {
                var current = out.trim();
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
        if (fs.existsSync(pendingUpdate)) {
          var upd = JSON.parse(fs.readFileSync(pendingUpdate, 'utf-8'));
          if (upd && upd.from && upd.to && upd.from !== upd.to) {
            console.log('[UPDATE_AVAILABLE] @monomind/cli ' + upd.from + ' → ' + upd.to + ' (run: npx monomind update)');
          }
        }
      } catch (e) {}
    } catch (e) { /* non-fatal */ }

    // Daemon Auto-Start Check.
    try {
      var daemonPid = path.join(CWD, '.monomind', 'daemon.pid');
      var daemonRunning = false;
      if (fs.existsSync(daemonPid)) {
        try {
          var pid = parseInt(fs.readFileSync(daemonPid, 'utf-8').trim(), 10);
          process.kill(pid, 0);
          daemonRunning = true;
        } catch (e) { /* pid stale */ }
      }
      if (!daemonRunning) {
        var daemonCfg = {};
        try {
          var cfgPath = path.join(CWD, 'monomind.config.json');
          if (fs.existsSync(cfgPath)) daemonCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')).daemon || {};
        } catch (e) {}
        if (daemonCfg.autoStart) {
          var spawn = require('child_process').spawn;
          var daemonChild = spawn('npx', ['monomind', 'daemon', 'start'], {
            cwd: CWD, detached: true, stdio: 'ignore'
          });
          daemonChild.on('error', function() {});
          daemonChild.unref();
          console.log('[DAEMON_AUTOSTART] Background daemon started (pid ' + daemonChild.pid + ')');
        } else {
          console.log('[DAEMON_STOPPED] Background daemon is not running. To auto-start, set daemon.autoStart=true in monomind.config.json or run: npx monomind daemon start');
        }
      }
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
      if (fs.existsSync(regPath)) {
        var reg = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
        var agentCount = (reg.agents || []).length;
        if (agentCount > 0) {
          console.log('[REGISTRY] ' + agentCount + ' agents available in registry');
        }
      }
    } catch (e) { /* non-fatal */ }

    // Monomind Control UI Status.
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
        console.log('[CONTROL_UI] offline — run: npx monomind mcp start');
      });
      req.setTimeout(800, function() { req.destroy(); });
    } catch (e) { /* non-fatal */ }

    // Worker Queue Resume (SR-003).
    try {
      var dispatchDir = path.join(CWD, '.monomind', 'worker-dispatch');
      if (fs.existsSync(dispatchDir)) {
        var pendingFiles = fs.readdirSync(dispatchDir).filter(function(f) { return f.startsWith('pending-'); });
        if (pendingFiles.length > 0) {
          console.log('[WORKER_RESUME] ' + pendingFiles.length + ' worker dispatch(es) pending from prior session');
        }
      }
    } catch (e) { /* non-fatal */ }
  },
};
