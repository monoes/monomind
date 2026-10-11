import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { SESSION_ID_RE } from './server-constants.mjs';
import { _getGitMonomindDir, appendToFile } from './server-fileutils.mjs';
import { _accumulateAgentUsage } from './server-mastermind-usage.mjs';
import { _getActiveRunId, _resolveOrgProjectDir, _updateRunState } from './server-orgutils.mjs';
import {
  _insertRunEvent,
  activeOrgRuns,
  activeSessionsByOrg,
  runStreamClients,
} from './server-rundb.mjs';
import { broadcastMm, writeSse } from './sse-manager.mjs';

function createHandleMastermindEvent({ projectDir, MONOMIND_HOME }) {
  return async function handleMastermindEvent(req, res, corsOrigin) {
    let body = '';
    try {
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2097152) {
          req.destroy();
          break;
        }
      }
    } catch (_) {
      // Client aborted mid-body — nothing to answer.
      return;
    }
    let event = {};
    try {
      event = JSON.parse(body);
    } catch (_) {}
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'event must be a JSON object' }));
      return;
    }
    event.ts = event.ts || Date.now();
    // Event type validation: accept any {scope}:{action} pattern — future event types
    // auto-work without whitelist maintenance. Malformed types are logged and rejected.
    if (event.type != null) {
      if (
        typeof event.type !== 'string' ||
        !/^[a-z][a-z0-9-]*:[a-z][a-z0-9:-]*$/.test(event.type)
      ) {
        try {
          const _badLog = path.join(projectDir || process.cwd(), 'data', 'unknown-events.jsonl');
          fs.mkdirSync(path.dirname(_badLog), { recursive: true });
          fs.appendFileSync(
            _badLog,
            `${JSON.stringify({ ts: Date.now(), type: event.type, body: body.slice(0, 256) })}\n`,
          );
        } catch (_) {}
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid event type' }));
        return;
      }
    }
    // Use project path from event if provided (multi-project support).
    // Security: path.isAbsolute() alone is insufficient — an attacker can
    // supply event.project="/etc" and cause writes to system directories.
    // Only accept paths that resolve to an existing directory AND are not
    // the filesystem root (/), AND are not obviously system paths.
    // Cap to 4096 chars to prevent OOM from huge path strings.
    const _rawProject = event.project ?? event.projectDir;
    let eventProject = null;
    if (
      typeof _rawProject === 'string' &&
      _rawProject.length > 0 &&
      _rawProject.length <= 4096 &&
      path.isAbsolute(_rawProject)
    ) {
      // Reject filesystem root and common system directories
      const _norm = path.resolve(_rawProject);
      const _systemPaths = [
        '/',
        '/etc',
        '/usr',
        '/bin',
        '/sbin',
        '/lib',
        '/lib64',
        '/boot',
        '/dev',
        '/sys',
        '/proc',
        '/tmp',
        os.tmpdir(),
        (() => {
          try {
            return fs.realpathSync(os.tmpdir());
          } catch (_) {
            return '';
          }
        })(),
      ].filter(Boolean);
      if (!_systemPaths.includes(_norm) && !_systemPaths.some((p) => _norm.startsWith(`${p}/`))) {
        eventProject = _norm;
      }
    }
    // Forwarder events omit `project` on everything but org:start — resolve the
    // org's home from known-projects so run-file writes land in the ORG's git
    // dir, not the server's (the dashboard reads the org project's run files).
    let _orgHome = null;
    if (!eventProject && event.org) {
      try {
        _orgHome = _resolveOrgProjectDir(String(event.org).trim(), projectDir || process.cwd());
      } catch (_) {}
    }
    const root = eventProject || _orgHome || projectDir || process.cwd();
    const dataDir = path.join(root, 'data');
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch (_) {}
    // Track known project dirs for aggregated session listing
    if (eventProject) {
      const knownFile = path.join(projectDir || process.cwd(), 'data', 'known-projects.json');
      try {
        let known = [];
        try {
          known = JSON.parse(fs.readFileSync(knownFile, 'utf8'));
        } catch (_) {}
        if (!known.includes(eventProject)) {
          known.push(eventProject);
          fs.writeFileSync(knownFile, JSON.stringify(known));
        }
      } catch (_) {}
    }
    // Track active runs and enrich event with runId BEFORE persisting so the JSONL replay
    // on SSE reconnect contains the same enriched event that live clients received.
    // Previously this was done AFTER the appendFileSync, causing org:comms events stored in
    // mastermind-events.jsonl to lack runId — _odtHandleLiveEvent dropped them on reconnect.
    if (event.org) {
      const _orgKey = String(event.org).trim();
      // Any event with both org+runId updates the active run map (run:start written directly to file so org:start is first via curl)
      if (event.runId) activeOrgRuns.set(_orgKey, String(event.runId).trim());
      else if (activeOrgRuns.has(_orgKey)) event.runId = activeOrgRuns.get(_orgKey);
      else {
        const _rsId = _getActiveRunId(_orgKey, root);
        if (_rsId) event.runId = _rsId;
      }
      if (
        event.type === 'run:complete' ||
        event.type === 'org:complete' ||
        event.type === 'org:stop'
      )
        activeOrgRuns.delete(_orgKey);
      // Persist active-run.json so capture-handler.cjs can find the current org/runId without HTTP calls.
      // Use process.cwd() (server's own dir, same as CLAUDE_PROJECT_DIR in the session) — not root (org project dir),
      // because capture-handler.cjs reads from CLAUDE_PROJECT_DIR which is the server's working directory.
      try {
        const _captureDir = path.join(MONOMIND_HOME, '.monomind', 'capture');
        const _activeRunFile = path.join(_captureDir, 'active-run.json');
        if (
          (event.type === 'run:start' || event.type === 'org:start') &&
          event.org &&
          event.runId
        ) {
          fs.mkdirSync(_captureDir, { recursive: true });
          fs.writeFileSync(
            _activeRunFile,
            JSON.stringify({
              org: String(event.org).trim(),
              runId: String(event.runId).trim(),
              ts: Date.now(),
            }),
          );
        } else if (
          (event.type === 'run:complete' ||
            event.type === 'org:complete' ||
            event.type === 'org:stop') &&
          fs.existsSync(_activeRunFile)
        ) {
          fs.unlinkSync(_activeRunFile);
          // Phase 1: Clean up ppid-keyed files for this org (Issue 3)
          try {
            const _ppidDir = path.join(_captureDir, 'active-runs');
            const _completedOrg = String(event.org || '').trim();
            if (_completedOrg && fs.existsSync(_ppidDir)) {
              fs.readdirSync(_ppidDir)
                .filter((f) => f.endsWith('.json'))
                .forEach((_pf) => {
                  try {
                    const _pData = JSON.parse(fs.readFileSync(path.join(_ppidDir, _pf), 'utf8'));
                    if (_pData.org === _completedOrg) fs.unlinkSync(path.join(_ppidDir, _pf));
                  } catch (_) {}
                });
            }
          } catch (_e) {}
        }
      } catch (_e) {}
    }
    // Update durable runstate.json — survives server restarts
    if (event.org) _updateRunState(event, root);
    appendToFile(path.join(dataDir, 'mastermind-events.jsonl'), `${JSON.stringify(event)}\n`).catch(
      () => {},
    );
    // Persist to git-safe run file (survives branch switches + shared across worktrees)
    if (event.org && event.runId) {
      try {
        const _orn = String(event.org).trim();
        const _rid = String(event.runId).trim();
        if (
          _orn.length > 0 &&
          _orn.length <= 64 &&
          /^[a-z0-9][a-z0-9_-]*$/i.test(_orn) &&
          _rid.length > 0 &&
          _rid.length <= 80 &&
          /^[a-z0-9][a-z0-9_-]*$/i.test(_rid)
        ) {
          const _monoDir = _getGitMonomindDir(root) || path.join(root, '.monomind');
          const _runDir = path.join(_monoDir, 'orgs', _orn, 'runs');
          fs.mkdirSync(_runDir, { recursive: true });
          await appendToFile(path.join(_runDir, `${_rid}.jsonl`), `${JSON.stringify(event)}\n`);
          _insertRunEvent(event, 'http');
          _accumulateAgentUsage(event, root, _orn);
          // Solution 3: dedicated conversation log — org:comms only, for easy replay
          if (event.type === 'org:comms') {
            const _conv = {
              ts: event.ts,
              run_id: _rid,
              from: event.from,
              to: event.to,
              msg: event.msg,
            };
            await appendToFile(
              path.join(_runDir, `${_rid}.convs.jsonl`),
              `${JSON.stringify(_conv)}\n`,
            );
            // Also write to org-level threads.jsonl so the dashboard Threads tab shows agent conversations
            const _orgThreadsFile = path.join(root, '.monomind', 'orgs', `${_orn}-threads.jsonl`);
            const _thread = {
              type: 'message',
              id: `${_rid}-${event.ts}`,
              run_id: _rid,
              ts: event.ts,
              from: event.from,
              to: event.to,
              msg: event.msg,
              subject: `Run ${_rid}`,
            };
            appendToFile(_orgThreadsFile, `${JSON.stringify(_thread)}\n`).catch(() => {});
          }
          // Phase 4: Compact completed run to three-tier retention (Issue 7)
          // hot (SQLite JSONL in .monomind) → warm (flat JSONL in archive/) → cold (gzip)
          // We use a lightweight approach: rename completed JSONL to .warm.jsonl, then gzip runs
          // older than 24 hours to .cold.jsonl.gz — no external deps.
          if (event.type === 'run:complete' || event.type === 'org:complete') {
            setImmediate(() => {
              try {
                const _hotFile = path.join(_runDir, `${_rid}.jsonl`);
                const _warmFile = path.join(_runDir, `${_rid}.warm.jsonl`);
                // Promote: hot → warm (just rename — same dir, marks run as done)
                if (fs.existsSync(_hotFile) && !fs.existsSync(_warmFile)) {
                  fs.renameSync(_hotFile, _warmFile);
                }
                // Compact warm files older than 24h to cold gzip
                const _24h = 24 * 60 * 60 * 1000;
                fs.readdirSync(_runDir)
                  .filter((f) => f.endsWith('.warm.jsonl') && !f.startsWith('._'))
                  .forEach((_wf) => {
                    const _wp = path.join(_runDir, _wf);
                    try {
                      if (Date.now() - fs.statSync(_wp).mtimeMs < _24h) return;
                      const _coldPath = _wp.replace('.warm.jsonl', '.cold.jsonl.gz');
                      if (fs.existsSync(_coldPath)) return; // already compacted
                      const _warmData = fs.readFileSync(_wp);
                      // `zlib` is a static ESM import at the top of this file. It used to be
                      // `require('zlib')`, which is undefined in an ESM module — the
                      // ReferenceError was swallowed by the surrounding catch, so cold-tier
                      // compaction silently never ran. See tests/repo/no-cjs-require-in-esm.
                      zlib.gzip(_warmData, (_err, _gz) => {
                        if (_err) return;
                        try {
                          fs.writeFileSync(_coldPath, _gz);
                          fs.unlinkSync(_wp); // remove warm after cold written
                        } catch (_) {}
                      });
                    } catch (_) {}
                  });
              } catch (_) {}
            });
          }
        }
      } catch (_) {}
    }
    // ── Active session tracking: link org:comms / agent:usage events to current session ──
    // This must run BEFORE session persistence so events without session get enriched.
    try {
      const _evOrg = event.org ? String(event.org).trim() : null;
      if (event.type === 'session:start' && event.session && _evOrg) {
        activeSessionsByOrg.set(_evOrg, {
          sessionId: String(event.session),
          ts: event.ts || Date.now(),
        });
        // Write active-session.json so capture-handler.cjs can read it without HTTP
        try {
          const _captureDir = path.join(root, '.monomind', 'capture');
          fs.mkdirSync(_captureDir, { recursive: true });
          fs.writeFileSync(
            path.join(_captureDir, 'active-session.json'),
            JSON.stringify({ org: _evOrg, sessionId: String(event.session), ts: Date.now() }),
          );
        } catch (_) {}
      } else if (event.type === 'session:complete' && _evOrg) {
        activeSessionsByOrg.delete(_evOrg);
        try {
          fs.unlinkSync(path.join(root, '.monomind', 'capture', 'active-session.json'));
        } catch (_) {}
      }
      // Enrich events that have org but no session (agent:usage, org:comms, agent:spawn, intercom)
      if (_evOrg && !event.session && activeSessionsByOrg.has(_evOrg)) {
        event.session = activeSessionsByOrg.get(_evOrg).sessionId;
      }
    } catch (_) {}
    // ── Per-session JSONL persistence (append-only, O(1) per event) ──────────
    // Replaces the old monolithic mastermind-sessions.json (O(N) read+write per event).
    // Format: data/sessions/<sessionId>.jsonl  +  data/sessions/_index.json
    try {
      const _sid = String(event.session || '').trim();
      if (_sid.length > 0 && _sid.length <= 128 && SESSION_ID_RE.test(_sid)) {
        const sessDir = path.join(dataDir, 'sessions');
        fs.mkdirSync(sessDir, { recursive: true });
        // Append event to per-session JSONL (O(1), no read)
        appendToFile(path.join(sessDir, `${_sid}.jsonl`), `${JSON.stringify(event)}\n`).catch(
          () => {},
        );
        // Update lightweight index (id, ts, prompt, status, org, startedAt, endedAt, domains only)
        const indexFile = path.join(sessDir, '_index.json');
        let _idx = [];
        try {
          _idx = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
        } catch (_) {}
        const _entry = _idx.find((e) => e.id === _sid);
        if (event.type === 'session:start') {
          if (!_entry) {
            _idx.unshift({
              id: _sid,
              ts: event.ts,
              prompt: event.prompt || '',
              status: 'running',
              org: event.org || '',
              startedAt: event.ts,
              domains: [],
            });
            if (_idx.length > 2000) _idx = _idx.slice(0, 2000);
          }
        } else if (_entry) {
          if (event.type === 'session:complete') {
            _entry.status = event.status || 'complete';
            _entry.endedAt = event.ts;
          }
          if (event.type === 'domain:dispatch' && event.domain) {
            _entry.domains = _entry.domains || [];
            if (!_entry.domains.includes(event.domain)) _entry.domains.push(event.domain);
          }
          if (
            event.type === 'agent:usage' ||
            event.type === 'agent:spawn' ||
            event.type === 'agent:complete'
          ) {
            _entry.hasAgents = true;
          }
        }
        fs.writeFileSync(indexFile, JSON.stringify(_idx));
      }
    } catch (_) {}
    // ── Legacy mastermind-sessions.json (kept for backwards compat, read by old clients) ──
    try {
      const sessFile = path.join(dataDir, 'mastermind-sessions.json');
      let sessions = [];
      try {
        sessions = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
      } catch (_) {}
      if (event.type === 'session:start' && event.session) {
        if (!sessions.find((s) => s.id === event.session)) {
          sessions.unshift({
            id: event.session,
            ts: event.ts,
            prompt: event.prompt || '',
            status: 'running',
            org: event.org || '',
            domains: [],
            startedAt: event.ts,
          });
        }
      } else if (event.session) {
        const s = sessions.find((s) => s.id === event.session);
        if (s) {
          if (event.type === 'session:complete') {
            s.status = event.status || 'complete';
            s.endedAt = event.ts;
          }
          if (
            event.type === 'domain:dispatch' &&
            event.domain &&
            !s.domains?.includes(event.domain)
          )
            (s.domains = s.domains || []).push(event.domain);
        }
      }
      fs.writeFileSync(sessFile, JSON.stringify(sessions.slice(0, 500)));
    } catch (_) {}
    // For org:stop events, write a stop marker the boss agent can detect
    // For org:start events, remove any existing stop marker so the org shows as running again
    if ((event.type === 'org:stop' || event.type === 'org:start') && event.org) {
      try {
        const orgName = String(event.org).trim();
        // Validate before any filesystem use — reject rather than strip
        if (orgName.length > 0 && orgName.length <= 64 && /^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
          const stopDir = path.join(root, '.monomind', 'orgs', '.stops');
          if (event.type === 'org:stop') {
            fs.mkdirSync(stopDir, { recursive: true });
            fs.writeFileSync(path.join(stopDir, `${orgName}.stop`), String(Date.now()));
          } else {
            // org:start — remove stop file so the org can appear running
            try {
              fs.unlinkSync(path.join(stopDir, `${orgName}.stop`));
            } catch (_) {}
          }
        }
      } catch (_) {}
    }
    // Broadcast to all mastermind SSE clients
    broadcastMm(event);
    // Phase 3: Forward to per-org streaming tail clients
    if (event.org) {
      const _fwdOrg = String(event.org).trim();
      const _fwdClients = runStreamClients.get(_fwdOrg);
      if (_fwdClients && _fwdClients.size > 0) {
        const _fwdLine = `data: ${JSON.stringify(event)}\n\n`;
        for (const _fwdClient of _fwdClients) writeSse(_fwdClient, _fwdLine, _fwdClients);
      }
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
    });
    res.end('{"ok":true}');
  };
}

export { createHandleMastermindEvent };
