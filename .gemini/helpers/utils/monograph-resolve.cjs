'use strict';
// Where the hooks find @monoes/monograph, and how they rebuild the graph with
// it (#328). monograph-freshen.cjs, the post-edit rebuild in
// handlers/edit-handler.cjs and utils/monograph.cjs all resolve through here
// so they agree on one copy. A bare `import '@monoes/monograph'` only walks
// the project's node_modules, which misses the default npx setup entirely:
// there the only copy is the one bundled with the monomind CLI in npm's npx
// cache, or a global install.
//
// Resolution happens at hook time rather than being recorded by `init`: the
// npx cache directory changes with every CLI version and npm prunes it, so a
// recorded path goes stale, while scanning costs one readdir.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, execSync, spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { claimLock } = require('./fs-helpers.cjs');

const GLOBAL_FIX = 'npm i -g --allow-scripts=better-sqlite3 @monoes/monograph';
const STALE_LIMIT = 50;
const BUILD_LOG_MAX_BYTES = 1024 * 1024;
// Matched against an error's message and code only: a stack through
// better-sqlite3's JS (SQLITE_BUSY, say) is not a native-load failure.
const NATIVE_ERROR_RE = /NODE_MODULE_VERSION|bindings file|better_sqlite3\.node|compiled against a different Node|ERR_DLOPEN_FAILED/i;

function _readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (_) { return null; }
}

// The package's ESM entry file, read from its own package.json (its exports
// map has no "require" condition, so require.resolve can't find it).
function entryFromPkgDir(pkgDir) {
  var pkg = _readJson(path.join(pkgDir, 'package.json'));
  if (!pkg || pkg.name !== '@monoes/monograph') return null;
  var dot = pkg.exports && pkg.exports['.'];
  var rel = (typeof dot === 'string' ? dot : dot && (dot.import || dot.default)) || pkg.main;
  if (!rel) return null;
  var full = path.join(pkgDir, rel);
  return fs.existsSync(full) ? { entry: full, pkgDir: pkgDir, version: String(pkg.version || '0') } : null;
}

function compareVersions(a, b) {
  var pa = String(a).split(/[.-]/).map(function (x) { return parseInt(x, 10) || 0; });
  var pb = String(b).split(/[.-]/).map(function (x) { return parseInt(x, 10) || 0; });
  for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function _newest(found) {
  found = found.filter(Boolean);
  if (found.length === 0) return null;
  found.sort(function (x, y) { return compareVersions(y.version, x.version); });
  return found[0];
}

function _localCandidates(dir) {
  return [
    // Monorepo workspace build first: it carries unpublished fixes.
    path.join(dir, 'packages', '@monomind', 'monograph'),
    // The project IS the monograph package.
    dir,
    path.join(dir, 'node_modules', '@monoes', 'monograph'),
    path.join(dir, 'node_modules', '@monomind', 'monograph'),
    path.join(dir, 'node_modules', '.pnpm', 'node_modules', '@monoes', 'monograph'),
    path.join(dir, 'packages', 'node_modules', '.pnpm', 'node_modules', '@monoes', 'monograph'),
    // The copy nested under a local, unhoisted monomind CLI install.
    path.join(dir, 'node_modules', '@monoes', 'monomindcli', 'node_modules', '@monoes', 'monograph'),
    path.join(dir, 'node_modules', 'monomind', 'node_modules', '@monoes', 'monograph'),
  ];
}

function _pnpmStore(dir) {
  var base = path.join(dir, 'node_modules', '.pnpm');
  var names;
  try { names = fs.readdirSync(base).filter(function (e) { return e.indexOf('@monoes+monograph@') === 0; }); }
  catch (_) { return null; }
  return _newest(names.map(function (e) {
    return entryFromPkgDir(path.join(base, e, 'node_modules', '@monoes', 'monograph'));
  }));
}

function _resolveLocal(projectDir) {
  var cands = _localCandidates(projectDir);
  for (var i = 0; i < cands.length; i++) {
    var hit = entryFromPkgDir(cands[i]);
    if (hit) return hit;
  }
  var store = _pnpmStore(projectDir);
  if (store) return store;
  // Ancestor walk: what a bare specifier's node_modules lookup would find.
  var dir = path.dirname(projectDir);
  for (;;) {
    var up = entryFromPkgDir(path.join(dir, 'node_modules', '@monoes', 'monograph'));
    if (up) return up;
    var parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

var _globalRootCache;
function npmGlobalRoot() {
  if (_globalRootCache !== undefined) return _globalRootCache;
  try {
    _globalRootCache = execSync('npm root -g', {
      encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch (_) { _globalRootCache = null; }
  return _globalRootCache;
}

function _resolveGlobal(globalRoot) {
  if (!globalRoot) return null;
  var nested = path.join('node_modules', '@monoes', 'monograph');
  var cands = [
    path.join(globalRoot, '@monoes', 'monograph'),
    path.join(globalRoot, 'monomind', nested),
    path.join(globalRoot, 'monomind', 'node_modules', '@monoes', 'monomindcli', nested),
    path.join(globalRoot, '@monoes', 'monomindcli', nested),
  ];
  for (var i = 0; i < cands.length; i++) {
    var hit = entryFromPkgDir(cands[i]);
    if (hit) return hit;
  }
  return null;
}

function npxCacheDir() {
  if (process.env.npm_config_cache) return process.env.npm_config_cache;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'npm-cache');
  }
  return path.join(os.homedir(), '.npm');
}

// The copy the MCP server's `npx monomind` / `npx @monoes/monomindcli` run
// installed. Newest version wins when several CLI versions are cached.
function _resolveNpxCache(cacheDir) {
  var base = path.join(cacheDir, '_npx');
  var dirs;
  try { dirs = fs.readdirSync(base); } catch (_) { return null; }
  return _newest(dirs.map(function (d) {
    return entryFromPkgDir(path.join(base, d, 'node_modules', '@monoes', 'monograph'));
  }));
}

/**
 * Find @monoes/monograph for `projectDir`: the project's own install, then a
 * global npm install (standalone or bundled with the monomind CLI), then the
 * copy bundled with the CLI in the npx cache. Returns
 * { entry, pkgDir, version, source: 'local'|'global'|'npx' } or null.
 * Only absolute paths come back, never a bare specifier.
 */
function resolveMonographEntry(projectDir, opts) {
  opts = opts || {};
  var hit = _resolveLocal(projectDir);
  if (hit) { hit.source = 'local'; return hit; }
  hit = _resolveGlobal(opts.globalRoot !== undefined ? opts.globalRoot : npmGlobalRoot());
  if (hit) { hit.source = 'global'; return hit; }
  hit = _resolveNpxCache(opts.npxCacheDir || npxCacheDir());
  if (hit) { hit.source = 'npx'; return hit; }
  return null;
}

// The monomind CLI, for `monomind monograph build` when no package resolves:
// the project's own bin, then PATH (a global install). Never `npx -y`.
function findMonomindBin(projectDir, pathEnv) {
  var names = process.platform === 'win32' ? ['monomind.cmd', 'monomind.exe'] : ['monomind'];
  var dirs = [path.join(projectDir, 'node_modules', '.bin')]
    .concat(String(pathEnv !== undefined ? pathEnv : process.env.PATH || '').split(path.delimiter));
  for (var i = 0; i < dirs.length; i++) {
    if (!dirs[i]) continue;
    for (var j = 0; j < names.length; j++) {
      var p = path.join(dirs[i], names[j]);
      try { if (fs.statSync(p).isFile()) return p; } catch (_) {}
    }
  }
  return null;
}

function nativeFix(resolved, projectDir) {
  if (!resolved || resolved.source !== 'local') return GLOBAL_FIX;
  var pnpm = fs.existsSync(path.join(projectDir || '', 'pnpm-lock.yaml'));
  return (pnpm ? 'pnpm' : 'npm') + ' rebuild better-sqlite3';
}

function _firstLine(msg) {
  return String(msg || '').split('\n').filter(function (l) { return l.trim(); })[0] || 'unknown error';
}

// Load the better-sqlite3 that `resolved`'s copy would load. A global npm
// install on current npm skips its install script (allowScripts), leaving no
// binary; a Node upgrade leaves one built for the wrong ABI.
function checkNative(resolved, projectDir) {
  try {
    var bs = require.resolve('better-sqlite3', { paths: [path.dirname(resolved.entry)] });
    var Database = require(bs);
    new Database(':memory:').close();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: _firstLine(e && e.message), fix: nativeFix(resolved, projectDir) };
  }
}

function _graphDir(projectDir) { return path.join(projectDir, '.monomind', 'graph'); }
function _statusPath(projectDir) { return path.join(_graphDir(projectDir), 'rebuild-status.json'); }

function readRebuildStatus(projectDir) { return _readJson(_statusPath(projectDir)); }

function _writeStatus(projectDir, status) {
  try {
    fs.mkdirSync(_graphDir(projectDir), { recursive: true });
    fs.writeFileSync(_statusPath(projectDir), JSON.stringify(status));
  } catch (_) {}
}

// Keep build.log bounded: past 1 MB it moves to build.log.1 (replacing the
// previous one), so a failing rebuild can't grow it forever.
function capBuildLog(projectDir) {
  var logPath = path.join(_graphDir(projectDir), 'build.log');
  try {
    if (fs.statSync(logPath).size > BUILD_LOG_MAX_BYTES) fs.renameSync(logPath, logPath + '.1');
  } catch (_) {}
}

/**
 * Record a failed rebuild in rebuild-status.json and build.log. The same
 * failure repeated only bumps `repeats` in the status file; build.log gets a
 * line when the failure first appears or changes.
 */
function recordRebuildFailure(projectDir, reason, message, fix) {
  var prev = readRebuildStatus(projectDir) || {};
  var line = '[monograph] rebuild failed (' + reason + '): ' + message + (fix ? ' — fix: ' + fix : '');
  var same = prev.ok === false && prev.line === line;
  _writeStatus(projectDir, {
    ok: false, reason: reason, message: message, fix: fix || null, line: line,
    at: Date.now(), since: same ? prev.since : Date.now(), repeats: same ? (prev.repeats || 1) + 1 : 1,
  });
  if (same) return;
  try {
    capBuildLog(projectDir);
    fs.appendFileSync(path.join(_graphDir(projectDir), 'build.log'), new Date().toISOString() + ' ' + line + '\n');
  } catch (_) {}
}

// Called by the rebuild child (see _childScript) when buildAsync throws.
function recordBuildError(projectDir, err, source) {
  var msg = _firstLine(err && (err.message || err));
  if (NATIVE_ERROR_RE.test(String(err && err.message || err) + ' ' + String(err && err.code || ''))) {
    recordRebuildFailure(projectDir, 'native', 'better-sqlite3 failed to load: ' + msg, nativeFix({ source: source }, projectDir));
  } else {
    recordRebuildFailure(projectDir, 'build', msg, null);
  }
}

function recordRebuildSuccess(projectDir) { _writeStatus(projectDir, { ok: true, at: Date.now() }); }

function _pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/**
 * claimLock, but a lock whose PID has exited is stale once it is `minAgeMs`
 * old (a crashed or finished rebuild), not only after `maxAgeMs`.
 */
function claimRebuildLock(lockPath, minAgeMs, maxAgeMs) {
  try {
    var st = fs.statSync(lockPath);
    var pid = parseInt(fs.readFileSync(lockPath, 'utf-8'), 10);
    if (Date.now() - st.mtimeMs >= minAgeMs && !(pid > 0 && _pidAlive(pid))) {
      var claimed = lockPath + '.' + process.pid + '.' + Date.now() + '.dead';
      fs.renameSync(lockPath, claimed);
      // Another process replaced the lock between the stat and the rename:
      // that lock is live, so put it back.
      var st2 = fs.statSync(claimed);
      if (st2.ino !== st.ino || st2.mtimeMs !== st.mtimeMs) { try { fs.linkSync(claimed, lockPath); } catch (_) {} }
      fs.unlinkSync(claimed);
    }
  } catch (_) { /* no lock, or lost a race — claimLock decides */ }
  return claimLock(lockPath, maxAgeMs);
}

function _childScript(projectDir, resolved, cleanup, vacuum) {
  var j = JSON.stringify;
  var vacuumJs = !vacuum ? '' : `
  try {
    const dbPath = ${j(path.join(projectDir, '.monomind', 'monograph.db'))};
    const fileMB = statSync(dbPath).size / 1024 / 1024;
    // Array argv, no shell: a project path can't inject a command (P3-8).
    const liveMB = parseInt(execFileSync('sqlite3', [dbPath, 'SELECT SUM(pgsize)/1024/1024 FROM dbstat;'],
      { encoding: 'utf-8', timeout: 30000 }).trim(), 10);
    if (fileMB > 100 && liveMB / fileMB < 0.5) execFileSync('sqlite3', [dbPath, 'VACUUM;'], { timeout: 120000 });
  } catch (_) {}`;
  return `
import { unlinkSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
const status = createRequire(${j(pathToFileURL(__filename).href)})(${j(__filename)});
try {
  const { buildAsync } = await import(${j(pathToFileURL(resolved.entry).href)});
  await buildAsync(${j(projectDir)});
  status.recordRebuildSuccess(${j(projectDir)});${vacuumJs}
} catch (err) {
  status.recordBuildError(${j(projectDir)}, err, ${j(resolved.source)});
  process.exitCode = 1;
} finally {
  for (const p of ${j(cleanup)}) { try { unlinkSync(p); } catch {} }
}`;
}

/**
 * Start a detached background rebuild of `projectDir`'s graph; never waits
 * for it. Imports the resolved package by absolute file URL; with nothing
 * resolvable, runs `monomind monograph build` from the project or PATH; with
 * neither, records an 'unresolvable' failure. The child's PID replaces the
 * caller's in `opts.lockPath`, and the module child removes the lock and
 * `opts.cleanup` files when done.
 * Returns { mode: 'module'|'cli'|'none', pid?, resolved? }.
 */
function startRebuild(projectDir, opts) {
  opts = opts || {};
  var resolved = opts.resolved !== undefined ? opts.resolved : resolveMonographEntry(projectDir);
  var bin = resolved ? null : findMonomindBin(projectDir);
  if (!resolved && !bin) {
    recordRebuildFailure(projectDir, 'unresolvable',
      '@monoes/monograph not found in the project, the global npm root or the npx cache', GLOBAL_FIX);
    return { mode: 'none' };
  }
  var graphDir = _graphDir(projectDir);
  try { fs.mkdirSync(graphDir, { recursive: true }); } catch (_) {}
  capBuildLog(projectDir);
  var logFd;
  try { logFd = fs.openSync(path.join(graphDir, 'build.log'), 'a'); } catch (_) { logFd = 'ignore'; }
  var cleanup = (opts.lockPath ? [opts.lockPath] : []).concat(opts.cleanup || []);
  var child;
  if (resolved) {
    child = spawn(process.execPath,
      ['--input-type=module', '--eval', _childScript(projectDir, resolved, cleanup, opts.vacuum)],
      { detached: true, stdio: ['ignore', logFd, logFd], cwd: projectDir });
  } else {
    child = spawn(bin, ['monograph', 'build', '--path', projectDir], {
      detached: true, stdio: ['ignore', logFd, logFd], cwd: projectDir,
      shell: process.platform === 'win32',
    });
  }
  child.on('error', function () {});
  child.unref();
  if (typeof logFd === 'number') { try { fs.closeSync(logFd); } catch (_) {} }
  if (opts.lockPath && child.pid) { try { fs.writeFileSync(opts.lockPath, String(child.pid)); } catch (_) {} }
  return { mode: resolved ? 'module' : 'cli', pid: child.pid, resolved: resolved };
}

function _suppressSqliteWarning(fn) {
  var orig = process.emitWarning;
  process.emitWarning = function (w) {
    if (/SQLite is an experimental feature/.test(String(w && w.message || w))) return;
    return orig.apply(process, arguments);
  };
  try { return fn(); } finally { process.emitWarning = orig; }
}

var COMMIT_SQL = "SELECT value FROM index_meta WHERE key IN ('last_commit_hash','lastCommit') ORDER BY key = 'last_commit_hash' DESC LIMIT 1";

// The commit the graph was built at, read with node:sqlite so it works even
// when @monoes/monograph or its native addon is what's missing. `immutable`
// (doctor --read-only) opens without SQLite's -shm/-wal files, which even a
// read-only connection to a WAL database creates or updates; it does not see
// changes still in the WAL, which a finished build has checkpointed.
function readIndexedCommit(dbPath, immutable) {
  try {
    return _suppressSqliteWarning(function () {
      var DatabaseSync = require('node:sqlite').DatabaseSync;
      var target = dbPath;
      if (immutable) {
        target = require('node:url').pathToFileURL(dbPath);
        target.search = '?immutable=1';
      }
      var db = new DatabaseSync(target, { readOnly: true });
      try { var row = db.prepare(COMMIT_SQL).get(); return row && row.value ? String(row.value) : null; }
      finally { db.close(); }
    });
  } catch (_) { return null; }
}

function commitsBehind(projectDir, commit) {
  if (!commit || !/^[0-9a-f]{7,40}$/i.test(commit)) return null;
  try {
    var n = parseInt(execFileSync('git', ['rev-list', '--count', commit + '..HEAD'], {
      cwd: projectDir, encoding: 'utf-8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim(), 10);
    return isNaN(n) ? null : n;
  } catch (_) { return null; }
}

/**
 * Everything `doctor` and the SessionStart warning need, from the hooks' point
 * of view: { resolved, cliBin, native, dbExists, commit, behind, canRebuild,
 * problem, fix, lastStatus }. `problem` says why the hooks can't rebuild.
 */
function diagnose(projectDir, opts) {
  opts = opts || {};
  var resolved = resolveMonographEntry(projectDir, opts);
  var cliBin = resolved ? null : findMonomindBin(projectDir, opts.pathEnv);
  var native = resolved ? checkNative(resolved, projectDir) : null;
  var dbPath = path.join(projectDir, '.monomind', 'monograph.db');
  var dbExists = fs.existsSync(dbPath);
  var commit = dbExists ? readIndexedCommit(dbPath, opts.readOnly) : null;
  var problem = null;
  var fix = null;
  if (!resolved && !cliBin) {
    problem = '@monoes/monograph not found by the hooks (project, global npm root, npx cache)';
    fix = GLOBAL_FIX;
  } else if (native && !native.ok) {
    problem = 'better-sqlite3 for ' + resolved.pkgDir + ' failed to load: ' + native.error;
    fix = native.fix;
  }
  return {
    resolved: resolved, cliBin: cliBin, native: native, dbExists: dbExists, commit: commit,
    behind: commitsBehind(projectDir, commit), canRebuild: !problem, problem: problem, fix: fix,
    lastStatus: readRebuildStatus(projectDir),
  };
}

// The one-line SessionStart warning, or null when there is nothing to say:
// shown when the hooks can't build a missing graph, or the graph is behind
// HEAD (or its commit can't be read) and the hooks can't rebuild it or the
// last rebuild failed.
function sessionWarning(diag) {
  if (!diag.dbExists) {
    return diag.problem ? '[MONOGRAPH_WARN] The hooks cannot build the monograph graph: ' + diag.problem + ' — run: ' + diag.fix : null;
  }
  if (diag.behind === 0) return null;
  var last = diag.lastStatus && diag.lastStatus.ok === false ? diag.lastStatus : null;
  var problem = diag.problem || (last && ('last rebuild failed: ' + last.message));
  if (!problem) return null;
  var fix = diag.fix || (last && last.fix) || 'see .monomind/graph/build.log';
  var age = diag.behind == null ? 'may be stale' : 'is ' + diag.behind + ' commit(s) behind HEAD';
  return '[MONOGRAPH_WARN] The monograph graph ' + age + ' and the hooks cannot rebuild it: ' +
    problem + ' — run: ' + fix;
}

/**
 * Once per cause, say that the grep gate and graph hints are off: the graph
 * DB exists but the hooks can't open it (`db` null), or it is more than 50
 * commits behind. Later prompts with the same cause return null.
 */
function graphOffNoticeOnce(projectDir, db) {
  var dbPath = path.join(projectDir, '.monomind', 'monograph.db');
  var key;
  var behind = null;
  var commit = null;
  if (!db) {
    if (!fs.existsSync(dbPath)) return null;
    key = 'unloadable';
  } else {
    try { var row = db.prepare(COMMIT_SQL).get(); commit = row && row.value; } catch (_) { return null; }
    if (!commit) return null;
    key = 'stale:' + commit;
  }
  var marker = path.join(_graphDir(projectDir), 'gate-off-notice.json');
  var prev = _readJson(marker);
  if (prev && prev.key === key) return null;
  var msg;
  if (!db) {
    msg = '[MONOGRAPH_OFF] The hooks cannot load @monoes/monograph, so the grep gate and [MONOGRAPH] hints are off. Fix: ' + GLOBAL_FIX;
  } else {
    behind = commitsBehind(projectDir, commit);
    if (behind == null || behind <= STALE_LIMIT) return null;
    msg = '[MONOGRAPH_OFF] The monograph graph is ' + behind + ' commits behind HEAD (limit ' + STALE_LIMIT +
      '), so the grep gate and [MONOGRAPH] hints are off until it is rebuilt. Rebuild: npx monomind monograph build (or mcp__monomind__monograph_build)';
  }
  try {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({ key: key, at: Date.now() }));
  } catch (_) {}
  return msg;
}

module.exports = {
  GLOBAL_FIX,
  STALE_LIMIT,
  BUILD_LOG_MAX_BYTES,
  entryFromPkgDir,
  resolveMonographEntry,
  findMonomindBin,
  npmGlobalRoot,
  npxCacheDir,
  checkNative,
  claimRebuildLock,
  startRebuild,
  capBuildLog,
  recordRebuildFailure,
  recordBuildError,
  recordRebuildSuccess,
  readRebuildStatus,
  readIndexedCommit,
  commitsBehind,
  diagnose,
  sessionWarning,
  graphOffNoticeOnce,
};
