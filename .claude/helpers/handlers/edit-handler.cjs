'use strict';
// Extracted from hook-handler.cjs — receives hCtx from dispatcher.
// Handles the 'post-edit' hook event.
// See route-handler.cjs for full hCtx field documentation.

const path = require('path');
const fs = require('fs');

module.exports = {
  handle: async function(hCtx) {
    var hookInput = hCtx.hookInput;
    var toolInput = hCtx.toolInput;
    var args = hCtx.args;
    var session = hCtx.session;
    var intelligence = hCtx.intelligence;
    var CWD = hCtx.CWD;

    if (session && session.metric) {
      try { session.metric('edits'); } catch (e) { /* no active session */ }
    }
    if (intelligence && intelligence.recordEdit) {
      try {
        var file = hookInput.file_path || toolInput.file_path
          || process.env.TOOL_INPUT_file_path || args[0] || '';
        intelligence.recordEdit(file);
      } catch (e) { /* non-fatal */ }
    }
    // Track recently-edited files for compact injection and pre-resolve boosting.
    try {
      var editedForRecent = hookInput.file_path || toolInput.file_path
        || process.env.TOOL_INPUT_file_path || args[0] || '';
      if (editedForRecent) hCtx._recordRecentEdit(editedForRecent);
    } catch (e) { /* non-fatal */ }
    // Increment write counter and rebuild monograph when threshold hit.
    hCtx._maybeRebuildMonograph();

    // Test feedback (detection-only): when editing a source file, list tests
    // that import it so the LLM/user knows what to verify next.
    try {
      var editedFile = hookInput.file_path || toolInput.file_path
        || process.env.TOOL_INPUT_file_path || args[0] || '';
      if (editedFile && !editedFile.match(/\.(test|spec)\./) && !editedFile.includes('__tests__')) {
        var affectedTests = hCtx._findAffectedTests(editedFile);
        if (affectedTests.length > 0) {
          console.log('[AFFECTED_TESTS] ' + affectedTests.length + ' test(s) cover this file:');
          for (var ti = 0; ti < Math.min(5, affectedTests.length); ti++) {
            console.log('  · ' + affectedTests[ti]);
          }
        }
      }
    } catch (e) {}
    // ── Security-Sensitive File Auto-Alert ────────────────────────────────────
    // When editing auth, security, crypto, or env-related files, flag it
    try {
      var editFile = (hookInput.file_path || toolInput.file_path
        || process.env.TOOL_INPUT_file_path || args[0] || '').toLowerCase();
      var securityPatterns = /\b(auth|security|crypto|secret|credential|token|password|\.env|permission|acl|rbac|jwt|oauth|session|cookie)\b/;
      if (securityPatterns.test(editFile) || editFile.includes('/security/') || editFile.includes('/auth/')) {
        console.log('[SECURITY_EDIT] Security-sensitive file modified: ' + path.basename(editFile));
        console.log('[SECURITY_EDIT] INSTRUCTION: Consider running a security review. Invoke Skill("code-review:code-review") with security focus, or run: npx monomind security scan --path "' + editFile + '"');
      }
    } catch (e) { /* non-fatal */ }

    // ── Smart Test/Build Suggestions (PE-001) ───────────────────────────
    try {
      var editFile2 = (hookInput.file_path || toolInput.file_path
        || process.env.TOOL_INPUT_file_path || args[0] || '');
      var editBase = path.basename(editFile2).toLowerCase();
      if (/\.(test|spec)\.(ts|js|tsx|jsx)$/.test(editBase)) {
        console.log('[AUTO_SUGGEST] Test file modified — run: npm test -- --testPathPattern="' + path.basename(editFile2) + '"');
      } else if (editBase === 'package.json') {
        console.log('[AUTO_SUGGEST] package.json changed — consider running: npm install');
      } else if (editBase === 'tsconfig.json' || editBase === 'tsconfig.base.json') {
        console.log('[AUTO_SUGGEST] TypeScript config changed — consider running: npm run build');
      }
    } catch (e) { /* non-fatal */ }

    // ── Monograph Incremental Rebuild ─────────────────────────────────────
    // After every code file edit, trigger a background monograph rebuild so
    // the knowledge graph stays current. Debounced via a lock file (5s cooldown).
    try {
      var editedFile2 = (hookInput.file_path || toolInput.file_path
        || process.env.TOOL_INPUT_file_path || args[0] || '');
      var codeExts = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|cpp|c|rb|swift|php)$/i;
      if (editedFile2 && codeExts.test(editedFile2)) {
        var lockFile = path.join(CWD, '.monomind', 'graph', '.rebuild-lock');
        var now = Date.now();
        var lastBuild = 0;
        try { lastBuild = parseInt(fs.readFileSync(lockFile, 'utf-8').trim(), 10) || 0; } catch (e) {}
        var COOLDOWN_MS = 5000; // 5-second debounce
        if (now - lastBuild > COOLDOWN_MS) {
          fs.writeFileSync(lockFile, String(now), 'utf-8');
          var { spawn: spawnRebuild } = require('child_process');
          var rebuildScript = "import { buildAsync } from '@monoes/monograph'; await buildAsync(" + JSON.stringify(CWD) + ");";
          var graphDir = path.join(CWD, '.monomind', 'graph');
          var logPath = path.join(graphDir, 'build.log');
          var logFd;
          try { logFd = fs.openSync(logPath, 'a'); } catch(e) { logFd = 'ignore'; }
          var child = spawnRebuild(process.execPath, ['--input-type=module', '--eval', rebuildScript], {
            detached: true, stdio: ['ignore', logFd, logFd], cwd: CWD,
          });
          child.unref();
          console.log('[MONOGRAPH] Incremental rebuild triggered for ' + path.basename(editedFile2));

          // Option C: fire ua-enrich.mjs in background after monograph rebuild
          var uaEnrichScript = path.join(CWD, 'scripts', 'ua-enrich.mjs');
          if (fs.existsSync(uaEnrichScript)) {
            var uaChild = spawnRebuild(process.execPath, [uaEnrichScript, '--dir', CWD, '--file', editedFile2, '--db', path.join(CWD, '.monomind', 'monograph.db')], {
              detached: true, stdio: 'ignore', cwd: CWD,
            });
            uaChild.unref();
          }
        }
        // Show importers of the edited file so Claude sees blast radius
        try {
          var mgDbPath4 = path.join(CWD, '.monomind', 'monograph.db');
          if (fs.existsSync(mgDbPath4)) {
            var mgMod4 = null;
            var _requireMonograph4 = hCtx._requireMonograph;
            mgMod4 = _requireMonograph4 ? _requireMonograph4() : null;
            if (mgMod4 && mgMod4.openDb) {
              var db4 = mgMod4.openDb(mgDbPath4);
              try {
                var editedBase4 = path.basename(editedFile2).replace(/\.[^.]+$/, '');
                var editNode4 = db4.prepare("SELECT id, name, label FROM nodes WHERE file_path LIKE ? OR name = ? LIMIT 1")
                  .get('%' + path.sep + path.basename(editedFile2), editedBase4);
                if (editNode4) {
                  var editImporters4 = db4.prepare(
                    'SELECT n2.name FROM edges e JOIN nodes n2 ON n2.id = e.source_id WHERE e.target_id = ? LIMIT 8'
                  ).all(editNode4.id);
                  if (editImporters4.length > 0) {
                    console.log('[MONOGRAPH_IMPACT] ' + editNode4.name + ' (' + editNode4.label + ') is depended on by: ' +
                      editImporters4.map(function(i) { return i.name; }).join(', '));
                  }
                }
              } finally { if (mgMod4.closeDb) mgMod4.closeDb(db4); }
            }
          }
        } catch(e) { /* non-fatal */ }
      }
    } catch (e) { /* non-fatal */ }

    console.log('[OK] Edit recorded');
  }
};
