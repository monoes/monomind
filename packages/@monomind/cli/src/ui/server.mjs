import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectDashboardTokenLeak,
  formatDashboardTokenLeakWarning,
} from '../mcp/monoes-mcp-entry.mjs';
import { recordedPidLiveness } from '../orgrt/run-liveness.js';
import { issueLoginNonce } from './human-auth.mjs';
import { _isOpenRoute, createAuthGate } from './server-auth.mjs';
import { buildDocsState, SESSION_ID_RE } from './server-constants.mjs';
import { createDashboardTokenManager } from './server-dashboard-token.mjs';
import { dispatchRequest } from './server-dispatch.mjs';
import { _getGitMonomindDir, appendToFile, getMonomindHome } from './server-fileutils.mjs';
import { _getKnowledgeBridge } from './server-knowledge-bridge.mjs';
import {
  _readNewOrgLines,
  reportBoundPort,
  seedOrgsFileSizes,
  setupServerLifecycle,
  startOrgsFsWatchFallback,
  watchOrgsParentDir,
} from './server-lifecycle.mjs';
import { createHandleMastermindEvent } from './server-mastermind-event.mjs';
import {
  activeWatchers,
  bindServer,
  dashboardServingProject,
  findRunningDashboard,
  isAllowedHost,
  openUrl,
  parseHostHeader,
  resolveAllowedHosts,
  watchSafely,
} from './server-net.mjs';
import {
  _detectMimeType,
  _getActiveRunId,
  _getAllowedArtifactDirs,
  _readRunState,
  _resolveOrgProjectDir,
  _updateRunState,
  parseAgentDef,
} from './server-orgutils.mjs';
import { checkRequestGate } from './server-request-gate.mjs';
import {
  _closeRunDb,
  _initRunDb,
  _require,
  _runDb,
  activeOrgRuns,
  looksLikeOurProcess,
  runStreamClients,
} from './server-rundb.mjs';
import { createShutdown } from './server-shutdown.mjs';
import { setupKnowledgeBridgeWarmup } from './server-startup-tasks.mjs';
import { addMmClient, broadcastMm, getSseClientCount, removeMmClient } from './sse-manager.mjs';

// Re-exported: these used to be defined directly here; other modules/tests still
// import them by name from 'ui/server.mjs'.
export {
  getMonomindHome,
  isAllowedHost,
  openUrl,
  parseHostHeader,
  resolveAllowedHosts,
  watchSafely,
};

// Pricing per token (mirrors token-tracker.cjs FALLBACK_PRICING)
const _SJ_PRICING = {
  'claude-fable-5-1': { in: 10e-6, out: 50e-6, cw: 12.5e-6, cr: 0.25e-6 },
  'claude-opus-5': { in: 5e-6, out: 25e-6, cw: 6.25e-6, cr: 0.5e-6 },
  'claude-opus-4-7': { in: 5e-6, out: 25e-6, cw: 6.25e-6, cr: 0.5e-6 },
  'claude-opus-4-6': { in: 5e-6, out: 25e-6, cw: 6.25e-6, cr: 0.5e-6 },
  'claude-opus-4-5': { in: 5e-6, out: 25e-6, cw: 6.25e-6, cr: 0.5e-6 },
  'claude-opus-4-1': { in: 15e-6, out: 75e-6, cw: 18.75e-6, cr: 1.5e-6 },
  'claude-opus-4': { in: 15e-6, out: 75e-6, cw: 18.75e-6, cr: 1.5e-6 },
  'claude-sonnet-5': { in: 2e-6, out: 10e-6, cw: 2.5e-6, cr: 0.2e-6 },
  'claude-sonnet-4-6': { in: 3e-6, out: 15e-6, cw: 3.75e-6, cr: 0.3e-6 },
  'claude-sonnet-4-5': { in: 3e-6, out: 15e-6, cw: 3.75e-6, cr: 0.3e-6 },
  'claude-sonnet-4': { in: 3e-6, out: 15e-6, cw: 3.75e-6, cr: 0.3e-6 },
  'claude-3-7-sonnet': { in: 3e-6, out: 15e-6, cw: 3.75e-6, cr: 0.3e-6 },
  'claude-3-5-sonnet': { in: 3e-6, out: 15e-6, cw: 3.75e-6, cr: 0.3e-6 },
  'claude-haiku-4-5': { in: 1e-6, out: 5e-6, cw: 1.25e-6, cr: 0.1e-6 },
  'claude-haiku-4': { in: 0.8e-6, out: 4e-6, cw: 1e-6, cr: 0.08e-6 },
  'claude-3-5-haiku': { in: 0.8e-6, out: 4e-6, cw: 1e-6, cr: 0.08e-6 },
  'gpt-5': { in: 2.5e-6, out: 10e-6, cw: 2.5e-6, cr: 1.25e-6 },
  'gpt-4o': { in: 2.5e-6, out: 10e-6, cw: 2.5e-6, cr: 1.25e-6 },
  'gpt-4o-mini': { in: 0.15e-6, out: 0.6e-6, cw: 0.15e-6, cr: 0.075e-6 },
  'gemini-2.5-pro': { in: 1.25e-6, out: 10e-6, cw: 1.25e-6, cr: 0.315e-6 },
};
function _sjGetPricing(model) {
  const _ALIAS = {
    haiku: 'claude-haiku-4-5-20251001',
    opus: 'claude-opus-5',
    // claude-sonnet-5 = DEFAULT_CLAUDE_MODEL (src/orgrt/vercel-providers.ts); .mjs can't import TS.
    sonnet: 'claude-sonnet-5',
    fable: 'claude-fable-5-1',
  };
  let canonical = (model || '').replace(/@.*$/, '').replace(/-\d{8}$/, '');
  canonical = _ALIAS[canonical] || canonical;
  if (_SJ_PRICING[canonical]) return _SJ_PRICING[canonical];
  // Longest key wins so 'gpt-4o-mini' never resolves to the cheaper-to-match 'gpt-4o'.
  const keys = Object.keys(_SJ_PRICING).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (canonical.startsWith(k)) return _SJ_PRICING[k];
  }
  for (const k of keys) {
    if (canonical.includes(k)) return _SJ_PRICING[k];
  }
  return null;
}
/**
 * True when this model has a pricing row (directly, by alias, or by prefix match).
 * A model with no row cannot be costed — every caller that sums _sjCalcCost() must
 * use this to mark the total as INCOMPLETE rather than presenting the missing
 * contribution as a genuine $0.00. The table above is a hand-maintained snapshot,
 * so newly released models land here routinely.
 */
export function _sjHasPricing(model) {
  return _sjGetPricing(model) !== null;
}
export function _sjCalcCost(model, usage) {
  const p = _sjGetPricing(model);
  if (!p) return null; // unpriced model — callers must not count it as a genuine $0
  if (!usage) return 0;
  const webSearch = (usage.server_tool_use?.web_search_requests || 0) * 0.01;
  return (
    (usage.input_tokens || 0) * p.in +
    (usage.output_tokens || 0) * p.out +
    (usage.cache_creation_input_tokens || 0) * p.cw +
    (usage.cache_read_input_tokens || 0) * p.cr +
    webSearch
  );
} // key: resolved dir → { status, sections, files, error, startedAt, completedAt }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Fallback dashboard HTML used by GET /mastermind when the project has no
// docs/mastermind-diagram.html of its own. Extracted from an inline string
// literal (was ~48KB embedded in this file) to a real static asset. Read
// defensively at module load: a missing sibling asset (e.g. a packaging step
// that copies server.mjs without it) degrades the /mastermind fallback route
// to a plain-text error instead of throwing ENOENT and failing the entire
// dashboard server to start.
let MASTERMIND_DIAGRAM_HTML;
try {
  MASTERMIND_DIAGRAM_HTML = fs.readFileSync(
    path.join(__dirname, 'mastermind-diagram-fallback.html'),
    'utf8',
  );
} catch (_) {
  MASTERMIND_DIAGRAM_HTML =
    '<!DOCTYPE html><html><body>mastermind-diagram-fallback.html is missing from this install.</body></html>';
}

// Re-resolved from the options at startServer() time (the projectDir only exists then); the
// call sites below all read it from inside startServer, after that assignment.
let MONOMIND_HOME = getMonomindHome();

// Server state
let running = false;
let currentPort = null;
let currentUrl = null;
let _activeServer = null;

// startServer's result when this project's dashboard is already being served
// by another process: nothing was started, and `url` is that server's.
function alreadyRunningResult(existing) {
  reportBoundPort(existing.port, existing.pid);
  return {
    port: existing.port,
    url: existing.url,
    pid: existing.pid,
    server: null,
    alreadyRunning: true,
  };
}

// Log (never exit) on stray async errors so one bad request cannot take the dashboard down.
let _processErrorHandlersRegistered = false;
function registerProcessErrorHandlers() {
  if (_processErrorHandlersRegistered) return;
  _processErrorHandlersRegistered = true;
  process.on('unhandledRejection', (reason) => {
    console.error('[server] unhandledRejection:', reason);
  });
}

export async function startServer({
  port = 4242,
  projectDir,
  projectDirExplicit = false,
  openBrowser = true,
  allowedHosts,
} = {}) {
  // #308: resolve the home now that the caller's project dir is in hand.
  MONOMIND_HOME = getMonomindHome(projectDir, projectDirExplicit);
  // #477: a second start for a project whose dashboard is already up (on the
  // port control.json records, or on the requested one) reuses it instead of
  // starting another beside it. This runs before anything that could keep the
  // process alive. Port 0 asks for a fresh ephemeral server, so it never reuses.
  const _projectRoot = projectDir || process.cwd();
  if (port !== 0) {
    const existing = await findRunningDashboard(_projectRoot, port);
    if (existing) return alreadyRunningResult(existing);
  }
  // i-052 commit 3: warn on every start, not only at `init` (executor.ts).
  // The dashboard is what WRITES dashboard-token — a user who never
  // re-runs `init` after the file got committed (e.g. before commits 1-2
  // shipped `.gitignore` coverage) would otherwise never see this warning
  // at all. Same "name the file, never the value" contract as the
  // monoes.me leak warning; best-effort (never blocks startup on a git
  // failure — detectDashboardTokenLeak already treats git-unavailable as
  // "not a leak signal", not an error).
  const dashboardTokenStartupWarning = formatDashboardTokenLeakWarning(
    await detectDashboardTokenLeak(projectDir || process.cwd()),
  );
  if (dashboardTokenStartupWarning) console.error(dashboardTokenStartupWarning);
  // Extra Host names accepted beyond loopback (see isAllowedHost above).
  const _allowedHosts = resolveAllowedHosts(allowedHosts);
  // ── Security: per-process auth credential for mutating (non-GET) requests ─
  // Generated once per server start and written to a well-known location so
  // trusted local callers (CLI, control-start.cjs) can read it and pass it
  // back via an auth header or query param on non-GET requests.
  const authBytes = crypto.randomBytes(24);
  const dashboardAuthValue = authBytes.toString('hex');

  // tokenState.path is the live "which token file did THIS process write" value,
  // read by the /api/identity route and by shutdown() below.
  const { writeDashboardToken, propagateDashboardToken, tokenState } = createDashboardTokenManager({
    projectDir,
    dashboardAuthValue,
  });

  // Handed to routes-org-mastermind.mjs via ctx below; never called directly here.
  const handleMastermindEvent = createHandleMastermindEvent({ projectDir, MONOMIND_HOME });

  registerProcessErrorHandlers();

  // Set once the server is bound (server-shutdown.mjs); the request handler and
  // the signal handlers call through this.
  let _shutdown = null;
  const shutdown = () => _shutdown?.();

  const { checkAuth: _checkAuth, sendUnauthorized: _sendUnauthorized } = createAuthGate({
    dashboardAuthValue,
  });

  const _handleRequest = async (req, res) => {
    const gate = checkRequestGate({
      req,
      res,
      _allowedHosts,
      currentPort,
      boundPort,
      port,
      _isOpenRoute,
      _checkAuth,
      _sendUnauthorized,
    });
    if (gate.blocked) return;
    const { url, corsOrigin, _boundPortForCors } = gate;

    const handled = await dispatchRequest(req, res, url, corsOrigin, {
      projectDir,
      __dirname,
      dashboardAuthValue,
      tokenState,
      shutdown,
      MONOMIND_HOME,
      _boundPortForCors,
      activeOrgRuns,
      _resolveOrgProjectDir,
      runStreamClients,
      broadcastMm,
      appendToFile,
      _getActiveRunId,
      removeMmClient,
      _runDb,
      parseAgentDef,
      handleMastermindEvent,
      addMmClient,
      _getGitMonomindDir,
      _detectMimeType,
      _readRunState,
      _getAllowedArtifactDirs,
      _updateRunState,
      _getKnowledgeBridge,
      SESSION_ID_RE,
      MASTERMIND_DIAGRAM_HTML,
      buildDocsState,
      looksLikeOurProcess,
    });
    if (handled) return;

    // ------------------------------------------------------------------ 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  };
  const server = http.createServer(async (req, res) => {
    try {
      await _handleRequest(req, res);
    } catch (err) {
      console.error(`[server] request handler failed (${req.method} ${req.url}):`, err);
      try {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        } else {
          res.destroy();
        }
      } catch (_) {}
    }
  });

  // ── Gap-fill ordering (ADR Issue 7): rebuild activeOrgRuns BEFORE the server
  // starts accepting connections so the first incoming event already has runId context.
  await _initRunDb(MONOMIND_HOME);
  // #155 follow-up: the original gap-fill scanned run_events (SQLite) / a
  // run's bus.jsonl for a terminal event — but run_events is populated by
  // LIVE forwarding while a dashboard is connected, not backfilled from a
  // run's actual history. A dashboard that starts after a run has already
  // stopped never saw most (or any) of that run's events, including its
  // terminal one, so there was nothing for the corrected #155 query to
  // match against even once the query itself was fixed. runtime.json's own
  // top-level `status` field is authoritative regardless of dashboard
  // uptime — it's the exact thing `monomind org status` reads — so check
  // that directly instead of reconstructing "done" from an event log that
  // may simply never have recorded it.
  try {
    const _gfOrgsDir = path.join(MONOMIND_HOME, '.monomind', 'orgs');
    if (fs.existsSync(_gfOrgsDir)) {
      for (const _gfOrg of fs.readdirSync(_gfOrgsDir)) {
        if (!_gfOrg || _gfOrg.startsWith('.') || !/^[a-z0-9][a-z0-9_-]*$/i.test(_gfOrg)) continue;
        try {
          const _gfRuntimePath = path.join(_gfOrgsDir, _gfOrg, 'runtime.json');
          if (!fs.existsSync(_gfRuntimePath)) continue;
          const _gfRt = JSON.parse(fs.readFileSync(_gfRuntimePath, 'utf8'));
          const _gfId = typeof _gfRt?.run === 'string' ? _gfRt.run : null;
          if (!_gfId) continue;
          // Mirrors org.ts's statusAction: a "running" record whose pid is
          // gone means the daemon died without its stopOrg cleanup — treat
          // that as not-active too, not just a literal status !== 'running'.
          // #573: a pid now held by another process counts as gone too.
          let _gfActive = _gfRt.status === 'running';
          if (_gfActive && typeof _gfRt.pid === 'number') {
            _gfActive = recordedPidLiveness(_gfRt.pid, _gfRt.pidStart) === 'alive';
          } else if (_gfActive) {
            _gfActive = false; // running record without a numeric pid cannot be verified alive
          }
          if (_gfActive) activeOrgRuns.set(_gfOrg, _gfId);
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Bind to available port (after activeOrgRuns is populated — no race window).
  // A busy port that turns out to be this project's own dashboard (a start that
  // raced another) ends the walk: reuse it rather than bind port+1 (#477).
  let boundPort;
  try {
    boundPort = await bindServer(server, port, {
      onBusy: port === 0 ? undefined : (p) => dashboardServingProject(p, _projectRoot),
    });
  } catch (err) {
    // Nothing started so far may outlive a failed start (#477): the run DB's
    // persist timer is the only background work begun before listen.
    _closeRunDb();
    server.close();
    if (err.code === 'EALREADYRUNNING') return alreadyRunningResult(err.existing);
    throw err;
  }
  const url = `http://localhost:${boundPort}`;

  // Registered right after bind so a stop request during the startup window works;
  // stopBackgroundTasks is late-bound (assigned once setupServerLifecycle has run).
  let _stopBackgroundTasks = () => {};
  _shutdown = createShutdown({
    server,
    stopBackgroundTasks: () => _stopBackgroundTasks(),
    tokenState,
    onClosed: () => {
      running = false;
      currentPort = null;
      currentUrl = null;
      _activeServer = null;
    },
  });
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGHUP', shutdown);

  reportBoundPort(boundPort);
  await writeDashboardToken(boundPort);
  propagateDashboardToken(boundPort);

  const { stopBackgroundTasks } = setupServerLifecycle({
    projectDir,
    MONOMIND_HOME,
    boundPort,
    dashboardAuthValue,
  });
  _stopBackgroundTasks = stopBackgroundTasks;
  // Watchers and the ingest sweep start only once the port is ours (#477).
  setupKnowledgeBridgeWarmup({ projectDir, _getKnowledgeBridge, watchSafely, activeWatchers });

  function watchOrgsDir() {
    const _orgsDir = path.join(MONOMIND_HOME, '.monomind', 'orgs');
    if (!fs.existsSync(_orgsDir)) {
      watchOrgsParentDir(_orgsDir, watchOrgsDir);
      return;
    }
    seedOrgsFileSizes(_orgsDir);
    // Use chokidar when available (Linux requires it — fs.watch { recursive } is macOS/Windows only).
    // Falls back to fs.watch for environments where chokidar is absent.
    let _watcherStarted = false;
    try {
      const chokidar = _require('chokidar');
      const _chokidarWatcher = chokidar.watch(_orgsDir, {
        ignoreInitial: true,
        depth: 3,
        ignored: (p) => {
          const b = path.basename(p);
          return b.endsWith('.warm.jsonl') || b.endsWith('.convs.jsonl') || b.startsWith('.');
        },
        awaitWriteFinish: false,
      });
      const _handleChokidarPath = (absPath) => {
        if (!absPath.endsWith('.jsonl')) return;
        const rel = path.relative(_orgsDir, absPath).replace(/\\/g, '/');
        const parts = rel.split('/');
        if (parts.length >= 3 && parts[1] === 'runs') {
          const _wOrgName = parts[0];
          const _wRunId = parts[2].replace('.jsonl', '');
          if (
            _wOrgName &&
            _wRunId &&
            /^[a-z0-9][a-z0-9_-]*$/i.test(_wOrgName) &&
            /^[a-z0-9][a-z0-9_-]*$/i.test(_wRunId)
          ) {
            _readNewOrgLines(absPath, _wOrgName, _wRunId);
          }
        }
      };
      watchSafely(_chokidarWatcher, 'orgs-chokidar');
      _chokidarWatcher.on('add', _handleChokidarPath);
      _chokidarWatcher.on('change', _handleChokidarPath);
      activeWatchers.push(_chokidarWatcher);
      _watcherStarted = true;
    } catch (_chokidarErr) {
      /* chokidar unavailable — fall through to fs.watch */
    }
    if (!_watcherStarted) startOrgsFsWatchFallback(_orgsDir);
  }
  watchOrgsDir();

  // Update module-level state
  running = true;
  currentPort = boundPort;
  currentUrl = url;
  _activeServer = server;

  // ---------------------------------------------------------- Auto-open
  if (openBrowser) {
    // A one-time login link, so the browser this opens gets the human session.
    let _openAt = url;
    try {
      _openAt = `${url}/?login=${issueLoginNonce()}`;
    } catch (_) {
      /* no session possible — the page explains how to get one */
    }
    openUrl(_openAt).catch(() => {
      // Non-fatal: browser open failure should not crash the server
    });
  }

  return { port: boundPort, url, server };
}

export function getServerStatus() {
  return {
    running,
    port: currentPort,
    url: currentUrl,
    clientCount: getSseClientCount(),
  };
}

// Auto-start when invoked directly: node server.mjs [port]
const _isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (_isMain) {
  const _port = parseInt(process.argv[2] || process.env.CONTROL_PORT || '4242', 10);
  // CLAUDE_PROJECT_DIR names a project; the bare cwd fallback does not (#308).
  const _dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  startServer({
    port: _port,
    openBrowser: false,
    projectDir: _dir,
    projectDirExplicit: Boolean(process.env.CLAUDE_PROJECT_DIR),
  })
    .then((res) => {
      // #477: a duplicate start exits cleanly instead of lingering.
      if (!res.alreadyRunning) return;
      process.stdout.write(
        `[server] dashboard already running for this project at ${res.url} (pid ${res.pid})\n`,
      );
      process.exit(0);
    })
    .catch((err) => {
      process.stderr.write(`[server] failed to start: ${err.message}\n`);
      process.exit(1);
    });
}
