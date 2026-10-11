import fs from 'node:fs';
import path from 'node:path';
// forwarder.js is compiled from orgrt/forwarder.ts (dist/src/orgrt/forwarder.js
// sits alongside this file's own compiled copy in dist/src/ui/ after
// build; under vitest the .js specifier resolves straight to the .ts source,
// same as every other cross-reference in this codebase). translate()/
// companionEvents() are pure — no filesystem or process side effects — so
// importing them here doesn't pull in attachForwarder's spawn/heal logic.
import { companionEvents, translate } from '../orgrt/forwarder.js';
import {
  EVENTS_DEFAULT_LIMIT,
  EVENTS_MAX_LIMIT,
  v2RunStatus,
  v2Summary,
  v2Window,
} from './org-run-summary.mjs';

// Org dashboard routes: run list and run events.
// Registered, in order, by handleOrgRoutes in routes-org.mjs.
export async function handleOrgRunRoutes(req, res, url, corsOrigin, ctx) {
  // GET /api/org/:name/runs — list structured run files for an org
  if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/runs(\?.*)?$/i.test(url)) {
    try {
      const _rQs = new URL(req.url, 'http://localhost').searchParams;
      const _rOrgName = decodeURIComponent(url.split('/')[3] || '');
      if (_rOrgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(_rOrgName)) {
        res.writeHead(400);
        res.end('{"error":"Invalid org name"}');
        return true;
      }
      const _rExplicitDir = _rQs.get('dir');
      const _rServerRoot = path.resolve(_rExplicitDir || ctx.projectDir || process.cwd());
      // Search across known projects (same logic as /api/orgs) unless explicit dir given
      const _rProjDirs = new Set([_rServerRoot]);
      if (!_rExplicitDir) {
        try {
          const _rKnown = JSON.parse(
            fs.readFileSync(path.join(_rServerRoot, 'data', 'known-projects.json'), 'utf8'),
          );
          _rKnown.forEach((p) => _rProjDirs.add(p));
        } catch (_) {}
      }
      const _rSeenFiles = new Set();
      const runs = [];
      const _parseRun = (filePath, f) => {
        try {
          const raw = fs.readFileSync(filePath, 'utf8');
          const allLines = raw.split('\n').filter(Boolean);
          const parse = (l) => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          };
          // Merge .warm.jsonl (promoted pre-complete events) for accurate event count + metadata
          const warmFile = filePath.replace(/\.jsonl$/, '.warm.jsonl');
          let warmLines = [];
          let warmEvents = [];
          try {
            if (fs.existsSync(warmFile)) {
              warmLines = fs.readFileSync(warmFile, 'utf8').split('\n').filter(Boolean);
              warmEvents = warmLines.map(parse).filter(Boolean);
            }
          } catch (_) {}
          const combinedLines = [...warmLines, ...allLines];
          const eventCount = combinedLines.length;
          const headEvents = (
            warmEvents.length ? warmEvents : allLines.map(parse).filter(Boolean)
          ).slice(0, 10);
          const _tailEvents = allLines.map(parse).filter(Boolean).slice(-5).length
            ? allLines.map(parse).filter(Boolean).slice(-5)
            : warmEvents.slice(-5);
          const first = headEvents.find((e) => e.type === 'run:start') || headEvents[0];
          const last = [...warmEvents.slice(-5), ...allLines.map(parse).filter(Boolean).slice(-3)]
            .slice()
            .reverse()
            .find((e) => e.type === 'run:complete' || e.type === 'org:complete');
          const cycles = combinedLines.filter((l) => l.includes('"org:checkpoint"')).length;
          const lastEvent =
            allLines.map(parse).filter(Boolean).slice(-1)[0] || warmEvents.slice(-1)[0];
          const ageMs = lastEvent?.ts ? Date.now() - lastEvent.ts : Infinity;
          const isStale = !last && ageMs > 30 * 60 * 1000;
          const firstBossComms = headEvents.find(
            (e) => e.type === 'org:comms' && (e.from === 'boss' || e.role === 'boss') && e.msg,
          );
          const derivedGoal = first?.goal || firstBossComms?.msg?.slice(0, 80) || '';
          return {
            runId: f.replace(/\.warm\.jsonl$|\.jsonl$/, ''),
            startedAt: first?.ts || 0,
            endedAt: last?.ts || 0,
            status: last ? 'complete' : isStale ? 'stale' : 'running',
            eventCount,
            cycleCount: cycles,
            goal: derivedGoal,
            bossRole: first?.bossRole || '',
          };
        } catch (_) {
          return null;
        }
      };
      // Org Runtime v2 (#238): each run's raw BusEvents live under a
      // per-run directory named for the run itself — orgs/<org>/<runId>/bus.jsonl
      // — never the flat orgs/<org>/runs/<runId>.jsonl layout _parseRun above
      // expects. Translate through the same translate()/companionEvents()
      // forwarder.ts uses for the live view, so historical and live event
      // shapes always match.
      const _parseV2RunDir = (orgDir, runId) => {
        try {
          const busFile = path.join(orgDir, runId, 'bus.jsonl');
          if (!fs.existsSync(busFile)) return null;
          const sum = v2Summary(busFile);
          if (!sum) return null;
          const { status, closedBy } = v2RunStatus(orgDir, runId, sum);
          return {
            runId,
            startedAt: sum.startedAt,
            endedAt: sum.endedAt,
            status,
            ...(closedBy ? { closedBy } : {}),
            eventCount: sum.eventCount,
            cycleCount: sum.cycleCount,
            goal: sum.goal,
            bossRole: '',
          };
        } catch (_) {
          return null;
        }
      };
      for (const _rpd of _rProjDirs) {
        // Check both .monomind and .git/monomind locations
        const _rMonoDir = ctx._getGitMonomindDir(_rpd) || path.join(_rpd, '.monomind');
        const _rOrgDirs = [path.join(_rMonoDir, 'orgs', _rOrgName)];
        if (_rMonoDir !== path.join(_rpd, '.monomind'))
          _rOrgDirs.push(path.join(_rpd, '.monomind', 'orgs', _rOrgName));
        for (const _rOrgDir of _rOrgDirs) {
          if (!fs.existsSync(_rOrgDir)) continue;
          const runDirs = fs
            .readdirSync(_rOrgDir)
            .filter(
              (d) => d.startsWith('run-') && fs.statSync(path.join(_rOrgDir, d)).isDirectory(),
            )
            .sort()
            .reverse();
          for (const runId of runDirs.slice(0, 50)) {
            if (_rSeenFiles.has(runId)) continue;
            const r = _parseV2RunDir(_rOrgDir, runId);
            if (!r) continue;
            _rSeenFiles.add(runId);
            runs.push(r);
          }
        }
        const _rSearchDirs = [path.join(_rMonoDir, 'orgs', _rOrgName, 'runs')];
        if (_rMonoDir !== path.join(_rpd, '.monomind'))
          _rSearchDirs.push(path.join(_rpd, '.monomind', 'orgs', _rOrgName, 'runs'));
        for (const _rDir of _rSearchDirs) {
          if (!fs.existsSync(_rDir)) continue;
          // Include .warm.jsonl — completed runs are renamed hot→warm on org:complete and
          // must stay visible in the chat history dropdown.
          const files = fs
            .readdirSync(_rDir)
            .filter(
              (f) =>
                f.endsWith('.jsonl') &&
                !f.startsWith('._') &&
                !f.endsWith('.convs.jsonl') &&
                !f.endsWith('.cold.jsonl'),
            )
            .sort()
            .reverse();
          for (const f of files.slice(0, 50)) {
            const _rFileId = f.replace(/\.warm\.jsonl$|\.jsonl$/, '');
            if (_rSeenFiles.has(_rFileId)) continue;
            _rSeenFiles.add(_rFileId);
            const r = _parseRun(path.join(_rDir, f), f);
            if (r) runs.push(r);
          }
        }
      }
      runs.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
      // Threads fallback: if no run files found, synthesize a run from the org threads file
      // so orgs whose boss never emitted runId-tagged events still show in the chat dropdown.
      if (runs.length === 0) {
        for (const _rpd of _rProjDirs) {
          const _tf = path.join(_rpd, '.monomind', 'orgs', `${_rOrgName}-threads.jsonl`);
          if (!fs.existsSync(_tf)) continue;
          const _tLines = fs.readFileSync(_tf, 'utf8').split('\n').filter(Boolean);
          if (!_tLines.length) continue;
          const _tEvs = _tLines
            .map((l) => {
              try {
                return JSON.parse(l);
              } catch {
                return null;
              }
            })
            .filter(Boolean);
          if (!_tEvs.length) continue;
          const _firstTs = _tEvs[0].ts
            ? typeof _tEvs[0].ts === 'number'
              ? _tEvs[0].ts
              : new Date(_tEvs[0].ts).getTime()
            : Date.now();
          const _lastTs = _tEvs[_tEvs.length - 1].ts
            ? typeof _tEvs[_tEvs.length - 1].ts === 'number'
              ? _tEvs[_tEvs.length - 1].ts
              : new Date(_tEvs[_tEvs.length - 1].ts).getTime()
            : _firstTs;
          runs.push({
            id: `threads-${_rOrgName}`,
            orgName: _rOrgName,
            goal: `${_rOrgName} threads`,
            status: 'complete',
            startedAt: _firstTs,
            endedAt: _lastTs,
            eventCount: _tEvs.length,
            _threadsFile: _tf,
          });
          break;
        }
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(runs));
    } catch (_) {
      res.writeHead(500);
      res.end('[]');
    }
    return true;
  }

  // GET /api/org/:name/runs/:runId — get all events for a specific run
  if (
    req.method === 'GET' &&
    /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/runs\/[a-z0-9][a-z0-9_-]{0,79}(\?.*)?$/i.test(url)
  ) {
    try {
      const _rvQs = new URL(req.url, 'http://localhost').searchParams;
      const _rvParts = url.replace(/\?.*$/, '').split('/');
      const _rvOrgName = decodeURIComponent(_rvParts[3] || '');
      const _rvRunId = decodeURIComponent(_rvParts[5] || '');
      if (
        _rvOrgName.length > 64 ||
        !/^[a-z0-9][a-z0-9_-]*$/i.test(_rvOrgName) ||
        _rvRunId.length > 80 ||
        !/^[a-z0-9][a-z0-9_-]*$/i.test(_rvRunId)
      ) {
        res.writeHead(400);
        res.end('{"error":"Invalid org or run id"}');
        return true;
      }
      const _rvExplicitDir = _rvQs.get('dir');
      const _rvServerRoot = path.resolve(_rvExplicitDir || ctx.projectDir || process.cwd());
      // Threads fallback: threads-${orgName} is a synthetic runId served from threads file
      if (_rvRunId === `threads-${_rvOrgName}`) {
        const _rvProjDirsT = new Set([_rvServerRoot]);
        if (!_rvExplicitDir) {
          try {
            JSON.parse(
              fs.readFileSync(path.join(_rvServerRoot, 'data', 'known-projects.json'), 'utf8'),
            ).forEach((p) => _rvProjDirsT.add(p));
          } catch (_) {}
        }
        for (const _rvpd of _rvProjDirsT) {
          const _tf = path.join(_rvpd, '.monomind', 'orgs', `${_rvOrgName}-threads.jsonl`);
          if (!fs.existsSync(_tf)) continue;
          const _tLines = fs.readFileSync(_tf, 'utf8').split('\n').filter(Boolean);
          const _tEvs = _tLines
            .map((l) => {
              try {
                const e = JSON.parse(l);
                return {
                  type: 'org:comms',
                  from: e.role || e.from || 'agent',
                  to: e.to || 'all',
                  msg: e.message || e.msg || '',
                  ts: e.ts
                    ? typeof e.ts === 'number'
                      ? e.ts
                      : new Date(e.ts).getTime()
                    : Date.now(),
                  org: _rvOrgName,
                  runId: _rvRunId,
                };
              } catch {
                return null;
              }
            })
            .filter(Boolean);
          res.writeHead(200, {
            'Content-Type': 'application/json',
            ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          });
          res.end(JSON.stringify(_tEvs));
          return true;
        }
        res.writeHead(404);
        res.end('{"error":"threads file not found"}');
        return true;
      }
      // Search across known projects
      const _rvProjDirs = new Set([_rvServerRoot]);
      if (!_rvExplicitDir) {
        try {
          JSON.parse(
            fs.readFileSync(path.join(_rvServerRoot, 'data', 'known-projects.json'), 'utf8'),
          ).forEach((p) => _rvProjDirs.add(p));
        } catch (_) {}
      }
      // Org Runtime v2 (#238): try the per-run-directory bus.jsonl layout
      // first — orgs/<org>/<runId>/bus.jsonl — translated to the same
      // dashboard vocabulary the live view gets from forwarder.ts, before
      // falling back to the v1 flat orgs/<org>/runs/<runId>.jsonl lookup
      // below (v1 files are already stored pre-translated).
      for (const _rvpd of _rvProjDirs) {
        const _rvMonoDir = ctx._getGitMonomindDir(_rvpd) || path.join(_rvpd, '.monomind');
        const _v2Candidates = [path.join(_rvMonoDir, 'orgs', _rvOrgName, _rvRunId, 'bus.jsonl')];
        if (_rvMonoDir !== path.join(_rvpd, '.monomind'))
          _v2Candidates.push(
            path.join(_rvpd, '.monomind', 'orgs', _rvOrgName, _rvRunId, 'bus.jsonl'),
          );
        for (const _v2File of _v2Candidates) {
          if (!fs.existsSync(_v2File)) continue;
          const { raw, total, offset } = v2Window(_v2File, _rvQs);
          const events = raw.flatMap((e) => [...companionEvents(e), translate(e)]);
          events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
          res.writeHead(200, {
            'Content-Type': 'application/json',
            ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
            'Cache-Control': 'no-cache',
            'X-Total-Events': String(total),
            'X-Events-Offset': String(offset),
          });
          res.end(JSON.stringify(events));
          return true;
        }
      }
      let _rvFile = null;
      for (const _rvpd of _rvProjDirs) {
        const _rvMonoDir = ctx._getGitMonomindDir(_rvpd) || path.join(_rvpd, '.monomind');
        const _candidates = [
          path.join(_rvMonoDir, 'orgs', _rvOrgName, 'runs', `${_rvRunId}.jsonl`),
          path.join(_rvMonoDir, 'orgs', _rvOrgName, 'runs', `${_rvRunId}.warm.jsonl`),
        ];
        if (_rvMonoDir !== path.join(_rvpd, '.monomind')) {
          _candidates.push(
            path.join(_rvpd, '.monomind', 'orgs', _rvOrgName, 'runs', `${_rvRunId}.jsonl`),
          );
          _candidates.push(
            path.join(_rvpd, '.monomind', 'orgs', _rvOrgName, 'runs', `${_rvRunId}.warm.jsonl`),
          );
        }
        for (const c of _candidates) {
          if (fs.existsSync(c)) {
            _rvFile = c;
            break;
          }
        }
        if (_rvFile) break;
      }
      if (!_rvFile) {
        res.writeHead(404);
        res.end('{"error":"run not found"}');
        return true;
      }
      const _parseLines = (p) => {
        try {
          return fs
            .readFileSync(p, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((l) => {
              try {
                return JSON.parse(l);
              } catch {
                return null;
              }
            })
            .filter(Boolean);
        } catch {
          return [];
        }
      };
      const events = _parseLines(_rvFile);
      // Merge .warm.jsonl (pre-run:complete events, including org:comms) if it exists.
      // When run:complete fires, the hot .jsonl is renamed to .warm.jsonl so all pre-complete
      // events live there. The current .jsonl then only holds post-complete events (e.g. org:stop).
      const _rvWarmFile = _rvFile.endsWith('.warm.jsonl')
        ? _rvFile
        : _rvFile.replace(/\.jsonl$/, '.warm.jsonl');
      if (_rvWarmFile !== _rvFile && fs.existsSync(_rvWarmFile)) {
        events.push(..._parseLines(_rvWarmFile));
      }
      // For in-progress runs (no .warm.jsonl), org:comms also go to .convs.jsonl (stripped form).
      // They're already in .jsonl as full events, so .convs.jsonl would duplicate — skip it.
      events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      const _rvLimit = Math.min(
        Math.max(Number.parseInt(_rvQs.get('limit') ?? '', 10) || EVENTS_DEFAULT_LIMIT, 1),
        EVENTS_MAX_LIMIT,
      );
      const _rvOffset =
        _rvQs.get('offset') === null
          ? Math.max(0, events.length - _rvLimit)
          : Math.max(Number.parseInt(_rvQs.get('offset'), 10) || 0, 0);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
        'X-Total-Events': String(events.length),
        'X-Events-Offset': String(_rvOffset),
      });
      res.end(JSON.stringify(events.slice(_rvOffset, _rvOffset + _rvLimit)));
    } catch (_) {
      res.writeHead(500);
      res.end('[]');
    }
    return true;
  }
  return false;
}
