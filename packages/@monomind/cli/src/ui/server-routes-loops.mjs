import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAllowedProjectDir } from './server-fileutils.mjs';
import { pathToSlug } from './server-slug.mjs';

// ScheduleWakeup / loop-runner routes.
// Registered, in order, by startServer's request dispatcher in server.mjs.
export async function handleRoutesLoops(req, res, url, corsOrigin, ctx) {
  const { projectDir } = ctx;
  // ---------------------------------------------------------- GET /api/loops
  if (req.method === 'GET' && url === '/api/loops') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const cwd = qs.get('dir') || projectDir || process.cwd();
      const loopsDir = path.join(cwd, '.monomind', 'loops');
      let loops = [];
      let stopFiles = new Set();
      try {
        const files = fs.readdirSync(loopsDir).filter((f) => f.endsWith('.json'));
        stopFiles = new Set(
          fs
            .readdirSync(loopsDir)
            .filter((f) => f.endsWith('.stop'))
            .map((f) => f.replace('.stop', '')),
        );
        for (const file of files) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(loopsDir, file), 'utf-8'));
            data.stopRequested = stopFiles.has(data.id);
            loops.push(data);
          } catch {}
        }
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }

      // Also read .claude/scheduled_tasks.lock — active Claude Code /loop sessions
      // that haven't had their ScheduleWakeup hook fire yet (or running on older version)
      try {
        const lockPath = path.join(cwd, '.claude', 'scheduled_tasks.lock');
        if (fs.existsSync(lockPath)) {
          const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
          const sessionId = lock.sessionId;
          const pid = lock.pid;
          // Verify PID is alive
          let alive = false;
          try {
            process.kill(pid, 0);
            alive = true;
          } catch {}
          const alreadyTracked = loops.some((l) => l.id === sessionId || l.sessionId === sessionId);
          if (alive && sessionId && !alreadyTracked && !stopFiles.has(sessionId)) {
            // Try to extract ScheduleWakeup context from session JSONL
            let loopEntry = null;
            try {
              const escaped = pathToSlug(cwd);
              const sessionFile = path.join(
                os.homedir(),
                '.claude',
                'projects',
                escaped,
                `${sessionId}.jsonl`,
              );
              if (fs.existsSync(sessionFile)) {
                const stat = fs.statSync(sessionFile);
                const readStart = Math.max(0, stat.size - 100000);
                const buf = Buffer.alloc(stat.size - readStart);
                const fd = fs.openSync(sessionFile, 'r');
                fs.readSync(fd, buf, 0, buf.length, readStart);
                fs.closeSync(fd);
                const lines = buf.toString('utf-8').split('\n').filter(Boolean);
                let lastWakeup = null;
                for (const line of lines) {
                  try {
                    const entry = JSON.parse(line);
                    const content = entry?.message?.content;
                    if (Array.isArray(content)) {
                      for (const block of content) {
                        if (block?.type === 'tool_use' && block?.name === 'ScheduleWakeup') {
                          lastWakeup = block.input;
                        }
                      }
                    }
                  } catch {}
                }
                if (lastWakeup) {
                  const prompt = lastWakeup.prompt || '';
                  const reason = lastWakeup.reason || '';
                  const delaySeconds = lastWakeup.delaySeconds || 60;
                  // Parse rep info from reason e.g. "repeat run 2/10"
                  const repM = (reason || prompt).match(/(\d+)\s*\/\s*(\d+)/);
                  const currentRep = repM ? parseInt(repM[1], 10) : 1;
                  const maxReps = repM ? parseInt(repM[2], 10) : 0;
                  const repFlag = prompt.match(/--rep\s+(\d+)/);
                  const timesFlag = prompt.match(/--times\s+(\d+)/);
                  const finalRep = repFlag ? parseInt(repFlag[1], 10) : currentRep;
                  const finalMax = timesFlag ? parseInt(timesFlag[1], 10) : maxReps;
                  const isTillendPrompt = /--tillend/i.test(prompt);
                  const type = isTillendPrompt
                    ? 'tillend'
                    : finalMax > 0 || /repeat|loop/i.test(prompt)
                      ? 'repeat'
                      : 'do';
                  const cmdMatch = prompt.match(/^\s*(\/[\w:_-]+)/);
                  const command = cmdMatch ? cmdMatch[1] : '';
                  loopEntry = {
                    id: sessionId,
                    sessionId,
                    type,
                    command,
                    status: 'waiting',
                    prompt: prompt.slice(0, 300),
                    reason,
                    startedAt: lock.acquiredAt || Date.now(),
                    lastRunAt: Date.now(),
                    nextRunAt: Date.now() + delaySeconds * 1000,
                    currentRep: finalRep,
                    maxReps: finalMax,
                    interval: Math.round(delaySeconds / 60),
                    source: 'scheduled_tasks_lock',
                  };
                }
              }
            } catch {}
            // Fallback: minimal entry from lock file alone
            if (!loopEntry) {
              loopEntry = {
                id: sessionId,
                sessionId,
                type: 'do',
                status: 'running',
                prompt: '(active session)',
                reason: '',
                startedAt: lock.acquiredAt || Date.now(),
                lastRunAt: lock.acquiredAt || Date.now(),
                nextRunAt: null,
                source: 'scheduled_tasks_lock',
              };
            }
            loops.push(loopEntry);
          }
        }
      } catch {}

      // Dedup: suppress scheduled_tasks_lock noise when real repeat loops exist
      const hasRepeatLoops = loops.some(
        (l) => l.source !== 'scheduled_tasks_lock' && l.source !== 'schedule_wakeup_hook',
      );
      if (hasRepeatLoops)
        loops = loops.filter(
          (l) => l.source !== 'scheduled_tasks_lock' && l.source !== 'schedule_wakeup_hook',
        );

      loops.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ loops }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ---------------------------------------------------------- POST /api/loops/stop
  if (req.method === 'POST' && url === '/api/loops/stop') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2097152) {
        req.destroy();
        return true;
      }
    });
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body);
        if (typeof id !== 'string' || !/^loop-[\w-]+$/.test(id)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'valid loop id required' }));
          return true;
        }
        const _stopQs = new URL(req.url, 'http://localhost').searchParams;
        const _stopDir = path.resolve(_stopQs.get('dir') || projectDir || process.cwd());
        const loopsDir = path.join(_stopDir, '.monomind', 'loops');
        const stopFile = path.resolve(loopsDir, `${id}.stop`);
        if (path.dirname(stopFile) !== path.resolve(loopsDir)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'invalid loop id' }));
          return true;
        }
        fs.mkdirSync(loopsDir, { recursive: true });
        fs.writeFileSync(stopFile, `stop-requested-${Date.now()}`);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  // ---------------------------------------------------------- POST /api/loops/create
  if (req.method === 'POST' && url === '/api/loops/create') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2097152) {
        req.destroy();
        return true;
      }
    });
    req.on('end', () => {
      try {
        const _qs = new URL(req.url, 'http://localhost').searchParams;
        const {
          name: _rawName,
          prompt: _rawPrompt,
          interval: _rawInterval,
          maxReps: _rawMaxReps,
        } = JSON.parse(body);
        // Cap field sizes to prevent individual large-field disk inflation.
        // The 2MB body cap already limits total payload, but a single field
        // near 2MB would produce a multi-MB loop config file per request.
        const MAX_LOOP_PROMPT_LEN = 64 * 1024; // 64 KB
        const MAX_LOOP_NAME_LEN = 512;
        const MAX_LOOP_INTERVAL_LEN = 64;
        const prompt =
          typeof _rawPrompt === 'string' ? _rawPrompt.slice(0, MAX_LOOP_PROMPT_LEN) : null;
        const name = typeof _rawName === 'string' ? _rawName.slice(0, MAX_LOOP_NAME_LEN) : null;
        const interval =
          typeof _rawInterval === 'string' ? _rawInterval.slice(0, MAX_LOOP_INTERVAL_LEN) : null;
        const maxReps =
          typeof _rawMaxReps === 'number' && Number.isFinite(_rawMaxReps)
            ? Math.max(1, Math.min(Math.floor(_rawMaxReps), 10000))
            : null;
        if (!prompt) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'prompt required' }));
          return true;
        }
        const _createDir = resolveAllowedProjectDir(_qs.get('dir'), projectDir);
        if (!_createDir) {
          res.writeHead(403);
          res.end(JSON.stringify({ error: 'dir is not the server project or a known project' }));
          return true;
        }
        const loopsDir = path.join(_createDir, '.monomind', 'loops');
        fs.mkdirSync(loopsDir, { recursive: true });
        const id = `loop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const nowMs = Date.now();
        const loop = {
          id,
          type: 'repeat',
          name: name || prompt.slice(0, 40),
          prompt,
          interval: interval || '1h',
          maxReps,
          status: 'active',
          currentRep: 0,
          startedAt: nowMs,
          lastRunAt: null,
        };
        fs.writeFileSync(path.join(loopsDir, `${id}.json`), JSON.stringify(loop, null, 2));
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ ok: true, id }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  return false;
}
