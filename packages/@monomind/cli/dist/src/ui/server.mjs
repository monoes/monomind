import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { collectAll, getWatchPaths, collectProject, collectSessions, collectSwarm, collectSwarmHistory, appendSwarmHistory, collectSwarmEvents, getSwarmDataSize, cleanSwarmData, collectAgents, collectTokens, collectHooks, collectKnowledge, collectMetrics, collectMemory, collectMemoryFiles, collectSystem } from './collector.mjs';

const JSONL_SIZE_CAP = 10 * 1024 * 1024; // 10 MB — skip files larger than this in /api/graph

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Session JSONL parser ────────────────────────────────────────────────────
function categorizeTool(name) {
  if (['Read','Write','Edit','MultiEdit','Glob','Grep','LS'].includes(name)) return 'file';
  if (name === 'Bash') return 'bash';
  if (['Agent','Task'].includes(name)) return 'agent';
  if (name.startsWith('mcp__monobrain__memory') || name.startsWith('mcp__monobrain__agentdb')) return 'memory';
  if (['WebFetch','WebSearch'].includes(name)) return 'web';
  if (name === 'TodoWrite' || name === 'TodoRead') return 'task';
  if (name === 'Skill') return 'skill';
  if (name === 'ToolSearch') return 'search';
  if (name.startsWith('mcp__')) return 'mcp';
  return 'other';
}

function parseSessionLines(lines) {
  const events = [];
  let agentDepth = 0;
  const toolMap = new Map(); // id → tool event index

  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const type = entry.type;
    const ts = entry.timestamp || null;
    const uuid = entry.uuid || null;

    if (type === 'user') {
      const content = entry.message?.content;
      let text = '';
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content)) {
        text = content.filter(b => b && b.type === 'text').map(b => b.text).join('');
      }
      if (text && text.length > 0) {
        events.push({ kind: 'user', text: text.slice(0, 500), uuid, ts });
      }
    } else if (type === 'assistant') {
      const content = entry.message?.content || [];
      for (const block of (Array.isArray(content) ? content : [])) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'thinking') {
          events.push({ kind: 'thinking', text: (block.thinking || '').slice(0, 200), uuid, ts });
        } else if (block.type === 'text') {
          const t = (block.text || '').trim();
          if (t) events.push({ kind: 'text', text: t.slice(0, 600), uuid, ts });
        } else if (block.type === 'tool_use') {
          const cat = categorizeTool(block.name);
          const label = buildToolLabel(block.name, block.input || {});
          const idx = events.length;
          const ev = { kind: 'tool', name: block.name, cat, label, id: block.id, uuid, ts };
          if (cat === 'agent') {
            ev.subagent = block.input?.subagent_type || block.input?.description || '?';
            ev.background = !!block.input?.run_in_background;
          }
          events.push(ev);
          if (block.id) toolMap.set(block.id, idx);
        }
      }
    } else if (type === 'tool') {
      const content = entry.message?.content || [];
      for (const block of (Array.isArray(content) ? content : [])) {
        if (!block || block.type !== 'tool_result') continue;
        const resultText = Array.isArray(block.content)
          ? block.content.filter(b => b && b.type === 'text').map(b => b.text).join('').slice(0, 400)
          : String(block.content || '').slice(0, 400);
        const isError = !!block.is_error;
        const toolIdx = toolMap.get(block.tool_use_id);
        events.push({ kind: 'tool_result', tool_use_id: block.tool_use_id, text: resultText, isError, toolIdx, uuid, ts });
      }
    }
  }
  return events;
}

function buildToolLabel(name, input) {
  if (name === 'Read') return input.file_path ? `Read ${path.basename(input.file_path)}` : 'Read';
  if (name === 'Write') return input.file_path ? `Write ${path.basename(input.file_path)}` : 'Write';
  if (name === 'Edit') return input.file_path ? `Edit ${path.basename(input.file_path)}` : 'Edit';
  if (name === 'Bash') return (input.description || input.command || 'Bash').slice(0, 60);
  if (name === 'Grep') return `Grep ${(input.pattern || '').slice(0, 30)}`;
  if (name === 'Glob') return `Glob ${(input.pattern || '').slice(0, 30)}`;
  if (name === 'Agent' || name === 'Task') return `→ ${input.subagent_type || input.description || 'agent'}`;
  if (name === 'WebFetch') return `Fetch ${(input.url || '').slice(0, 50)}`;
  if (name === 'WebSearch') return `Search ${(input.query || '').slice(0, 40)}`;
  if (name === 'Skill') return `Skill: ${input.skill || '?'}`;
  if (name.startsWith('mcp__monobrain__memory')) return name.replace('mcp__monobrain__memory_', 'mem:');
  if (name.startsWith('mcp__')) return name.replace('mcp__monobrain__', '⬡ ').replace('mcp__', '⬡ ').slice(0, 40);
  return name.slice(0, 40);
}

// ─── Section collectors (for /api/section lazy load) ────────────────────────
function buildSectionData(name, dir) {
  const d = path.resolve(dir);
  switch (name) {
    case 'sessions': return { sessions: collectSessions(d) };
    case 'swarm':    return { swarm: collectSwarm(d), swarmHistory: collectSwarmHistory(d), agents: collectAgents(d) };
    case 'agents':   return { agents: collectAgents(d) };
    case 'tokens':   return { tokens: collectTokens(d) };
    case 'hooks':    return { hooks: collectHooks(d) };
    case 'knowledge':return { knowledge: collectKnowledge(d) };
    case 'metrics':  return { metrics: collectMetrics(d) };
    case 'system':   return { system: collectSystem() };
    case 'memory': {
      const s = collectSessions(d);
      return { sessions: { palace: s.palace }, memory: collectMemory(d) };
    }
    case 'overview': return { project: collectProject(d), system: collectSystem() };
    default: return {};
  }
}

// Map file path fragment → affected section names
function pathToSections(filename) {
  if (!filename) return null;
  const f = filename.toLowerCase();
  if (f.includes('swarm'))                          return ['swarm'];
  if (f.includes('token'))                          return ['tokens'];
  if (f.includes('registry') || f.includes('registrations')) return ['agents'];
  if (f.includes('route') || f.includes('worker-dispatch'))  return ['hooks'];
  if (f.includes('chunk') || f.includes('skills')) return ['knowledge'];
  if (f.includes('memory.db') || f.includes('memory.graph') || f.includes('hnsw.index') ||
      f.includes('ruvector.db') || f.includes('ranked-context') ||
      (f.includes('/memory/') && f.endsWith('.md'))) return ['memory', 'sessions'];
  if (f.includes('palace') || f.includes('drawers') || f.includes('identity')) return ['memory', 'sessions'];
  if (f.includes('ddd') || f.includes('learning') || f.includes('audit')) return ['metrics'];
  if (f.endsWith('.jsonl') || f.includes('sessions')) return ['sessions'];
  return ['sessions', 'swarm', 'agents', 'tokens', 'hooks'];
}

// SSE client registry
const sseClients = new Set();

// Server state
let running = false;
let currentPort = null;
let currentUrl = null;
let activeServer = null;
const activeWatchers = [];

/**
 * Broadcasts a data payload to all connected SSE clients.
 * Silently removes clients that have disconnected.
 */
function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch {
      sseClients.delete(client);
    }
  }
}

/**
 * Opens a URL in the default browser, cross-platform.
 */
async function openUrl(url) {
  const { exec } = await import('child_process');
  const cmd =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
      ? `start "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd);
}

/**
 * Attempts to bind the HTTP server to a port, trying up to 10 increments
 * if the initial port is already in use.
 */
function bindServer(server, port) {
  return new Promise((resolve, reject) => {
    const maxTries = 10;
    let attempt = 0;

    function tryPort(p) {
      server.listen(p, () => resolve(p));
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && attempt < maxTries) {
          attempt += 1;
          server.removeAllListeners('error');
          tryPort(p + 1);
        } else {
          reject(err);
        }
      });
    }

    tryPort(port);
  });
}

/**
 * Starts the monomind live dashboard HTTP server.
 *
 * @param {object} [options]
 * @param {number}  [options.port=4242]        - Preferred port. Tries up to port+10 on collision.
 * @param {string}  [options.projectDir]       - Root of the project to collect data from.
 * @param {boolean} [options.openBrowser=true] - Whether to open the dashboard in the default browser.
 * @returns {Promise<{port: number, url: string, server: http.Server}>}
 */
export async function startServer({ port = 4242, projectDir, openBrowser = true } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];

    // ------------------------------------------------------------------ GET /
    if (req.method === 'GET' && url === '/') {
      const htmlPath = path.join(__dirname, 'dashboard.html');
      try {
        const html = fs.readFileSync(htmlPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Failed to load dashboard.html: ${err.message}`);
      }
      return;
    }

    // --------------------------------------------------------- GET /api/data
    if (req.method === 'GET' && url === '/api/data') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const snapshot = await collectAll(dir);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify(snapshot));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------ GET /api/session
    if (req.method === 'GET' && url === '/api/session') {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const file = qs.get('file');
      const limit = Math.min(parseInt(qs.get('limit') || '600', 10), 3000);
      if (!file) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing file param' }));
        return;
      }
      try {
        const raw = fs.readFileSync(file, 'utf8');
        const allLines = raw.split('\n').filter(Boolean);
        const lines = allLines.slice(-limit);
        const events = parseSessionLines(lines);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ events, total: allLines.length, shown: lines.length }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/session-journal
    if (req.method === 'GET' && url === '/api/session-journal') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const slug = d.replace(/\//g, '-');
        const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);

        let sessionFiles = [];
        try {
          sessionFiles = fs.readdirSync(projectClaudeDir)
            .filter(f => f.endsWith('.jsonl'))
            .map(f => { try { return { f, mtime: fs.statSync(path.join(projectClaudeDir, f)).mtimeMs }; } catch { return null; } })
            .filter(Boolean)
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 15);
        } catch {}

        const sessions = [];
        for (const { f, mtime } of sessionFiles) {
          const fp = path.join(projectClaudeDir, f);
          const id = f.replace('.jsonl', '');
          let lastPrompt = '', summaries = [], totalDurationMs = 0, totalMessages = 0, firstTs = null, lastTs = null;
          try {
            const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
            let pendingCompact = false;
            for (const line of lines) {
              let e; try { e = JSON.parse(line); } catch { continue; }
              if (e.timestamp) { if (!firstTs) firstTs = e.timestamp; lastTs = e.timestamp; }
              if (e.type === 'last-prompt' && e.lastPrompt) lastPrompt = e.lastPrompt;
              if (e.type === 'system' && e.subtype === 'compact_boundary') pendingCompact = true;
              if (pendingCompact && e.type === 'user') {
                const msg = e.message || {};
                const ct = msg.content || [];
                let text = '';
                if (Array.isArray(ct)) { for (const b of ct) { if (b && b.type === 'text') { text = b.text; break; } } }
                else if (typeof ct === 'string') text = ct;
                const m = text.match(/Summary:\s*([\s\S]+)/);
                if (m) summaries.push({ ts: e.timestamp, text: m[1].trim() });
                pendingCompact = false;
              }
              if (e.type === 'system' && e.subtype === 'turn_duration') {
                totalDurationMs += e.durationMs || 0;
                if ((e.messageCount || 0) > totalMessages) totalMessages = e.messageCount;
              }
            }
          } catch {}
          sessions.push({ id, mtime, firstTs, lastTs, lastPrompt, summaries, totalDurationMs, totalMessages });
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ sessions }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/palace
    if (req.method === 'GET' && url === '/api/palace') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const palaceDir = path.join(d, '.monomind', 'palace');

        let drawers = [];
        try {
          const raw = fs.readFileSync(path.join(palaceDir, 'drawers.jsonl'), 'utf8');
          drawers = raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        } catch {}

        let identity = null;
        try { identity = fs.readFileSync(path.join(palaceDir, 'identity.md'), 'utf8'); } catch {}

        let kg = [];
        try { const raw = fs.readFileSync(path.join(palaceDir, 'kg.json'), 'utf8'); kg = JSON.parse(raw); } catch {}

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ drawers, identity, kg }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/memory-files
    if (req.method === 'GET' && url === '/api/memory-files') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const homeDir = os.homedir();
        const slug = d.replace(/\//g, '-');
        const memDir = path.join(homeDir, '.claude', 'projects', slug, 'memory');

        let files = [];
        try { files = fs.readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md'); } catch {}

        const memories = files.map(fname => {
          const fp = path.join(memDir, fname);
          let stat = null; try { stat = fs.statSync(fp); } catch {}
          let raw = ''; try { raw = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n'); } catch {}
          // Parse frontmatter — escHtml ordering: bold replace runs on already-escaped content (safe)
          let name = fname.replace('.md', ''), description = '', type = 'project', body = raw;
          const fm = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
          if (fm) {
            body = fm[2].trim();
            for (const line of fm[1].split('\n')) {
              const m = line.match(/^(\w+):\s*(.+)$/);
              if (m) {
                if (m[1] === 'name') name = m[2].trim();
                if (m[1] === 'description') description = m[2].trim();
                if (m[1] === 'type') type = m[2].trim();
              }
            }
          }
          return { filename: fname, name, description, type, body, mtime: stat ? stat.mtimeMs : null };
        }).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ memories, memDir }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- PUT /api/memory-file
    if (req.method === 'PUT' && url === '/api/memory-file') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const qs = new URL(req.url, 'http://localhost').searchParams;
          const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
          const slug = d.replace(/\//g, '-');
          const memDir = path.join(os.homedir(), '.claude', 'projects', slug, 'memory');
          const { filename, content } = JSON.parse(body);
          if (!filename || filename.includes('..') || !filename.endsWith('.md') || filename.includes('/')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid filename' }));
            return;
          }
          const fp = path.join(memDir, filename);
          if (!fp.startsWith(memDir + path.sep) && fp !== memDir) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Access denied' }));
            return;
          }
          fs.mkdirSync(memDir, { recursive: true });
          fs.writeFileSync(fp, content || '', 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ------------------------------------------------------- DELETE /api/memory-file
    if (req.method === 'DELETE' && url === '/api/memory-file') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const qs = new URL(req.url, 'http://localhost').searchParams;
          const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
          const slug = d.replace(/\//g, '-');
          const memDir = path.join(os.homedir(), '.claude', 'projects', slug, 'memory');
          const { filename } = JSON.parse(body);
          if (!filename || filename.includes('..') || !filename.endsWith('.md') || filename.includes('/')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid filename' }));
            return;
          }
          const fp = path.join(memDir, filename);
          if (!fp.startsWith(memDir + path.sep) && fp !== memDir) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Access denied' }));
            return;
          }
          fs.unlinkSync(fp);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ---------------------------------------------------------- GET /api/loops
    if (req.method === 'GET' && url === '/api/loops') {
      try {
        const cwd = projectDir || process.cwd();
        const loopsDir = path.join(cwd, '.monomind', 'loops');
        let loops = [];
        let stopFiles = new Set();
        try {
          const files = fs.readdirSync(loopsDir).filter(f => f.endsWith('.json'));
          stopFiles = new Set(fs.readdirSync(loopsDir).filter(f => f.endsWith('.stop')).map(f => f.replace('.stop', '')));
          for (const file of files) {
            try {
              const data = JSON.parse(fs.readFileSync(path.join(loopsDir, file), 'utf-8'));
              data.stopRequested = stopFiles.has(data.id);
              loops.push(data);
            } catch {}
          }
        } catch (e) { if (e.code !== 'ENOENT') throw e; }

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
            try { process.kill(pid, 0); alive = true; } catch {}
            const alreadyTracked = loops.some(l => l.id === sessionId || l.sessionId === sessionId);
            if (alive && sessionId && !alreadyTracked && !stopFiles.has(sessionId)) {
              // Try to extract ScheduleWakeup context from session JSONL
              let loopEntry = null;
              try {
                const escaped = cwd.replace(/\//g, '-');
                const sessionFile = path.join(os.homedir(), '.claude', 'projects', escaped, `${sessionId}.jsonl`);
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
                    const currentRep = repM ? parseInt(repM[1]) : 1;
                    const maxReps = repM ? parseInt(repM[2]) : 0;
                    const repFlag = (prompt).match(/--rep\s+(\d+)/);
                    const timesFlag = (prompt).match(/--times\s+(\d+)/);
                    const finalRep = repFlag ? parseInt(repFlag[1]) : currentRep;
                    const finalMax = timesFlag ? parseInt(timesFlag[1]) : maxReps;
                    const type = (finalMax > 0 || /repeat|loop/i.test(prompt)) ? 'repeat' : 'do';
                    loopEntry = {
                      id: sessionId,
                      sessionId,
                      type,
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

        loops.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ loops }));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    // ---------------------------------------------------------- POST /api/loops/stop
    if (req.method === 'POST' && url === '/api/loops/stop') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { id } = JSON.parse(body);
          if (!id) { res.writeHead(400); res.end(JSON.stringify({ error: 'id required' })); return; }
          const loopsDir = path.join(projectDir || process.cwd(), '.monomind', 'loops');
          fs.mkdirSync(loopsDir, { recursive: true });
          fs.writeFileSync(path.join(loopsDir, `${id}.stop`), `stop-requested-${Date.now()}`);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      });
      return;
    }

    // ------------------------------------------------------- DELETE /api/knowledge-chunk
    if (req.method === 'DELETE' && url === '/api/knowledge-chunk') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const qs = new URL(req.url, 'http://localhost').searchParams;
          const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
          const chunksFile = path.join(d, '.monomind', 'knowledge', 'chunks.jsonl');
          const { chunkId } = JSON.parse(body);
          if (!chunkId || typeof chunkId !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid chunkId' }));
            return;
          }
          if (!fs.existsSync(chunksFile)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'chunks.jsonl not found' }));
            return;
          }
          const entries = fs.readFileSync(chunksFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
          const before = entries.length;
          const filtered = entries.filter(e => e.chunkId !== chunkId);
          if (filtered.length === before) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Chunk not found' }));
            return;
          }
          fs.writeFileSync(chunksFile, filtered.map(e => JSON.stringify(e)).join('\n') + (filtered.length ? '\n' : ''), 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true, removed: before - filtered.length }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ------------------------------------------------------- PUT /api/knowledge-chunk
    if (req.method === 'PUT' && url === '/api/knowledge-chunk') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const qs = new URL(req.url, 'http://localhost').searchParams;
          const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
          const chunksFile = path.join(d, '.monomind', 'knowledge', 'chunks.jsonl');
          const { chunkId, text } = JSON.parse(body);
          if (!chunkId || typeof chunkId !== 'string' || typeof text !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid chunkId or text' }));
            return;
          }
          if (!fs.existsSync(chunksFile)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'chunks.jsonl not found' }));
            return;
          }
          const entries = fs.readFileSync(chunksFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
          const idx = entries.findIndex(e => e.chunkId === chunkId);
          if (idx === -1) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Chunk not found' }));
            return;
          }
          entries[idx] = { ...entries[idx], text };
          fs.writeFileSync(chunksFile, entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ------------------------------------------------------- GET /api/monograph-html
    if (req.method === 'GET' && url === '/api/monograph-html') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');

        // Generate HTML on-the-fly from SQLite DB using the improved toHtml export
        if (fs.existsSync(dbPath)) {
          const { openDb, closeDb, toHtml } = await import('@monoes/monograph');
          const db = openDb(dbPath);
          let html;
          try {
            const rawNodes = db.prepare('SELECT * FROM nodes LIMIT 5000').all();
            const rawEdges = db.prepare('SELECT * FROM edges').all();
            // Remap snake_case DB columns to camelCase MonographNode/MonographEdge interfaces
            const parsedNodes = rawNodes.map(n => ({
              id: n.id,
              label: n.label,
              name: n.name,
              normLabel: n.norm_label,
              filePath: n.file_path,
              startLine: n.start_line,
              endLine: n.end_line,
              communityId: n.community_id,
              isExported: !!n.is_exported,
              language: n.language,
              properties: n.properties ? JSON.parse(n.properties) : {},
            }));
            const parsedEdges = rawEdges.map(e => ({
              id: e.id,
              sourceId: e.source_id,
              targetId: e.target_id,
              relation: e.relation,
              confidence: e.confidence,
              confidenceScore: e.confidence_score,
              weight: e.weight,
            }));
            html = toHtml(parsedNodes, parsedEdges);
          } finally {
            closeDb(db);
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
          res.end(html);
          return;
        }

        // Fallback: try legacy graph.html on disk
        const htmlPath = path.join(d, '.monomind', 'graph', 'graph.html');
        const html = fs.readFileSync(htmlPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(html);
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<html><body style="background:#0f0f1a;color:#888;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center;"><h3 style="color:#4E79A7;">No Graph Built Yet</h3><p>Run <code style="color:#00E5C8;">mcp__monomind__monograph_build</code> or click BUILD in the sidebar.</p></div></body></html>');
      }
      return;
    }

    // ------------------------------------------------------- GET /api/monograph-report
    if (req.method === 'GET' && url === '/api/monograph-report') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        let report = null, exists = false, stats = null;
        if (fs.existsSync(dbPath)) {
          exists = true;
          const { openDb, closeDb } = await import('@monoes/monograph');
          const db = openDb(dbPath);
          try {
            const nodeCount = db.prepare('SELECT COUNT(*) AS c FROM nodes').get().c;
            const edgeCount = db.prepare('SELECT COUNT(*) AS c FROM edges').get().c;
            const topNodes = db.prepare(`SELECT n.id, n.name, n.label, (SELECT COUNT(*) FROM edges e WHERE e.source_id=n.id OR e.target_id=n.id) AS deg FROM nodes n ORDER BY deg DESC LIMIT 20`).all();
            const labelDist = db.prepare('SELECT label, COUNT(*) AS cnt FROM nodes GROUP BY label ORDER BY cnt DESC LIMIT 10').all();
            const dbStat = fs.statSync(dbPath);
            stats = { nodes: nodeCount, edges: edgeCount, size: dbStat.size, mtime: dbStat.mtimeMs };
            report = [
              '# Monograph Knowledge Graph',
              '',
              `## Overview`,
              `- **Nodes**: ${nodeCount.toLocaleString()}`,
              `- **Edges**: ${edgeCount.toLocaleString()}`,
              `- **Last built**: ${new Date(dbStat.mtimeMs).toLocaleString()}`,
              '',
              '## Top 20 Nodes by Degree',
              ...topNodes.map((n, i) => `${String(i+1).padStart(3,' ')}. **${n.name || n.id}** \`${n.label}\` — ${n.deg} connections`),
              '',
              '## Node Type Distribution',
              ...labelDist.map(r => `- **${r.label}**: ${r.cnt}`),
            ].join('\n');
          } finally { closeDb(db); }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ exists, report, stats }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/monograph-graph
    if (req.method === 'GET' && url === '/api/monograph-graph') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        let nodes = [], edges = [];
        if (fs.existsSync(dbPath)) {
          const { openDb, closeDb } = await import('@monoes/monograph');
          const db = openDb(dbPath);
          try {
            const nodeLimit = Math.min(parseInt(qs.get('limit') || '500', 10), 5000);
            // ?labels=Section,Concept  →  fetch only those label types (no degree cutoff)
            const labelFilter = qs.get('labels') ? new Set(qs.get('labels').split(',').map(s => s.trim())) : null;
            const rawNodes = labelFilter
              ? db.prepare(`SELECT id, name, label, file_path, community_id FROM nodes WHERE label IN (${[...labelFilter].map(() => '?').join(',')}) LIMIT 5000`).all(...labelFilter)
              : db.prepare('SELECT id, name, label, file_path, community_id FROM nodes LIMIT 5000').all();
            const rawEdges = db.prepare('SELECT source_id, target_id, relation FROM edges').all();
            // Compute degree
            const degree = new Map();
            for (const n of rawNodes) degree.set(n.id, 0);
            for (const e of rawEdges) {
              if (degree.has(e.source_id)) degree.set(e.source_id, (degree.get(e.source_id) || 0) + 1);
              if (degree.has(e.target_id)) degree.set(e.target_id, (degree.get(e.target_id) || 0) + 1);
            }
            // When filtering by labels, return all matching nodes (skip degree sort+slice)
            const topNodes = labelFilter
              ? rawNodes
              : [...rawNodes].sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0)).slice(0, nodeLimit);
            const topIds = new Set(topNodes.map(n => n.id));
            nodes = topNodes.map(n => ({ id: n.id, label: n.name || n.id, type: n.label || 'unknown', degree: degree.get(n.id) || 0 }));
            edges = rawEdges.filter(e => topIds.has(e.source_id) && topIds.has(e.target_id)).slice(0, 2000).map(e => ({ source: e.source_id, target: e.target_id, relation: e.relation || 'REF' }));
          } finally { closeDb(db); }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ nodes, edges }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- POST /api/ua-enrich
    // Trigger semantic enrichment on an existing monograph DB.
    // Imports understand graph.json if present; falls back to structural-only pass.
    if (req.method === 'POST' && url === '/api/ua-enrich') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const dbFilePath = path.join(d, '.monomind', 'monograph.db');

        // Check for UA graph.json first
        const uaGraphCandidates = [
          path.join(d, '.understand-anything', 'knowledge-graph.json'),
          path.join(d, '.understand-anything', 'graph.json'),
          path.join(d, '.ua', 'knowledge-graph.json'),
          path.join(d, '.ua', 'graph.json'),
        ];
        const uaGraph = uaGraphCandidates.find(p => fs.existsSync(p));
        const importScript = path.join(process.cwd(), 'scripts', 'ua-import.mjs');
        const enrichScript = path.join(process.cwd(), 'scripts', 'ua-enrich.mjs');

        res.writeHead(202, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });

        if (uaGraph && fs.existsSync(importScript)) {
          res.end(JSON.stringify({ status: 'importing', source: uaGraph }));
          const { spawn: sp } = await import('child_process');
          const child = sp(process.execPath, [importScript, uaGraph, dbFilePath], { stdio: 'ignore', detached: true, cwd: d });
          child.unref();
        } else if (fs.existsSync(enrichScript)) {
          res.end(JSON.stringify({ status: 'enriching', mode: 'structural-only' }));
          const { spawn: sp } = await import('child_process');
          const child = sp(process.execPath, [enrichScript, '--dir', d, '--db', dbFilePath, '--full'], { stdio: 'ignore', detached: true, cwd: d });
          child.unref();
        } else {
          res.end(JSON.stringify({ status: 'skipped', reason: 'No understand graph.json found. Run /monomind:understand in Claude Code first.' }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- POST /api/monograph-build
    if (req.method === 'POST' && url === '/api/monograph-build') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());

        res.writeHead(202, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ status: 'building', dir: d }));

        // Build via monograph in background
        const { spawn: sp } = await import('child_process');
        const script = `import { buildAsync } from '@monoes/monograph'; await buildAsync(${JSON.stringify(d)});`;
        const child = sp(process.execPath, ['--input-type=module', '--eval', script], { stdio: 'ignore', detached: true, cwd: d });
        child.unref();
        console.log(`[graph] build started for ${d} via monograph`);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/monograph-query
    if (req.method === 'GET' && url === '/api/monograph-query') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const q = qs.get('q') || '';
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        if (!q) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing ?q= parameter' })); return; }
        if (!fs.existsSync(dbPath)) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ success: false, result: 'Graph not built yet. Run: monomind monograph build' })); return; }
        const { openDb, closeDb, ftsSearch } = await import('@monoes/monograph');
        const db = openDb(dbPath);
        let result = '';
        try {
          const hits = ftsSearch(db, q, 20);
          if (!hits.length) {
            result = `No matches found for: "${q}"`;
          } else {
            result = hits.map((h, i) => `${String(i+1).padStart(3,' ')}. ${h.name} [${h.normLabel}]${h.filePath ? '\n     ' + h.filePath : ''}`).join('\n');
            // Show outgoing edges for top hit
            const topHit = hits[0];
            const neighbors = db.prepare('SELECT target_id, relation FROM edges WHERE source_id=? LIMIT 10').all(topHit.id);
            if (neighbors.length) {
              result += `\n\n── ${topHit.name} references:\n` + neighbors.map(n => `   ${n.relation} → ${n.target_id.split('/').pop() || n.target_id}`).join('\n');
            }
          }
        } finally { closeDb(db); }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, query: q, result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/monograph-explain
    if (req.method === 'GET' && url === '/api/monograph-explain') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const nodeQ = qs.get('node') || '';
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        if (!nodeQ) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing ?node= parameter' })); return; }
        if (!fs.existsSync(dbPath)) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ success: false, explanation: 'Graph not built yet. Run: monomind monograph build' })); return; }
        const { openDb, closeDb, ftsSearch } = await import('@monoes/monograph');
        const db = openDb(dbPath);
        let explanation = '';
        try {
          let nd = db.prepare('SELECT * FROM nodes WHERE id=?').get(nodeQ) || db.prepare('SELECT * FROM nodes WHERE name=?').get(nodeQ);
          if (!nd) { const hits = ftsSearch(db, nodeQ, 1); if (hits[0]) nd = db.prepare('SELECT * FROM nodes WHERE id=?').get(hits[0].id); }
          if (!nd) {
            explanation = `No node found matching: "${nodeQ}"`;
          } else {
            const outEdges = db.prepare('SELECT target_id, relation FROM edges WHERE source_id=? LIMIT 20').all(nd.id);
            const inEdges = db.prepare('SELECT source_id, relation FROM edges WHERE target_id=? LIMIT 20').all(nd.id);
            explanation = [
              `## ${nd.name} [${nd.label}]`,
              nd.file_path ? `File: ${nd.file_path}${nd.start_line ? ':' + nd.start_line : ''}` : '',
              nd.language ? `Language: ${nd.language}` : '',
              nd.is_exported ? 'Exported: yes' : 'Exported: no',
              '',
              outEdges.length ? `References (${outEdges.length}):\n` + outEdges.map(e => `  ${e.relation} → ${e.target_id.split('/').pop() || e.target_id}`).join('\n') : 'No outgoing references.',
              inEdges.length ? `\nReferenced by (${inEdges.length}):\n` + inEdges.map(e => `  ${e.source_id.split('/').pop() || e.source_id} [${e.relation}]`).join('\n') : '',
            ].filter(Boolean).join('\n');
          }
        } finally { closeDb(db); }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, node: nodeQ, explanation }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/monograph-path
    if (req.method === 'GET' && url === '/api/monograph-path') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const from = qs.get('from') || '';
        const to = qs.get('to') || '';
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        if (!from || !to) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing ?from= and ?to= parameters' })); return; }
        if (!fs.existsSync(dbPath)) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ success: false, path: 'Graph not built yet.' })); return; }
        const { openDb, closeDb, getShortestPath, ftsSearch } = await import('@monoes/monograph');
        const db = openDb(dbPath);
        let pathResult = '';
        try {
          const resolveId = (q) => {
            const direct = db.prepare('SELECT id FROM nodes WHERE id=? OR name=?').get(q, q);
            if (direct) return direct.id;
            const hits = ftsSearch(db, q, 1);
            return hits[0]?.id || q;
          };
          const fromId = resolveId(from);
          const toId = resolveId(to);
          const p = getShortestPath(db, fromId, toId);
          if (!p || !p.length) {
            pathResult = `No path found between "${from}" and "${to}"`;
          } else {
            const names = p.map(id => { const n = db.prepare('SELECT name FROM nodes WHERE id=?').get(id); return n ? n.name : id.split('/').pop() || id; });
            pathResult = names.join(' → ') + `  (${p.length - 1} hop${p.length !== 2 ? 's' : ''})`;
          }
        } finally { closeDb(db); }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, from, to, path: pathResult }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/monograph-watch-status
    if (req.method === 'GET' && url === '/api/monograph-watch-status') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const pidPath = path.join(d, '.monomind', 'monograph.watch.pid');
        let running = false, pid = null;
        try {
          pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
          process.kill(pid, 0);
          running = true;
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ running, pid }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- POST /api/monograph-watch-toggle
    if (req.method === 'POST' && url === '/api/monograph-watch-toggle') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const pidPath = path.join(d, '.monomind', 'monograph.watch.pid');
        let wasRunning = false;
        try {
          const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
          process.kill(pid, 0);
          wasRunning = true;
          process.kill(pid, 'SIGTERM');
          try { fs.unlinkSync(pidPath); } catch {}
        } catch {}

        if (wasRunning) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ running: false, action: 'stopped' }));
        } else {
          const { spawn: sp } = await import('child_process');
          const child = sp(process.execPath, [process.argv[1], 'monograph', 'watch'], { stdio: 'ignore', detached: true, cwd: d, env: process.env });
          child.unref();
          try { fs.mkdirSync(path.join(d, '.monomind'), { recursive: true }); } catch {}
          try { fs.writeFileSync(pidPath, String(child.pid)); } catch {}
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ running: true, pid: child.pid, action: 'started' }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- POST /api/mcp/call
    if (req.method === 'POST' && url === '/api/mcp/call') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        const json = res => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); };
        const ok = (data) => { json(res); res.end(JSON.stringify({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] })); };
        const err = (msg) => { json(res); res.end(JSON.stringify({ error: msg })); };
        try {
          const { tool, input = {} } = JSON.parse(body);
          const qs2 = new URL(req.url, 'http://localhost').searchParams;
          const dir2 = qs2.get('dir') || projectDir;
          const d2 = path.resolve(dir2 || process.cwd());
          const dbPath2 = path.join(d2, '.monomind', 'monograph.db');
          if (!fs.existsSync(dbPath2)) { err('monograph.db not found — run monograph build first'); return; }
          const { openDb, closeDb, ftsSearch, getShortestPath, countNodes, countEdges } = await import('@monoes/monograph');
          const db2 = openDb(dbPath2);
          try {
            if (tool === 'monograph_stats') {
              const n = countNodes(db2), e = countEdges(db2);
              ok(`nodes: ${n}\nedges: ${e}`);
            } else if (tool === 'monograph_cypher') {
              // Translate basic MATCH (n:Label) queries to SQL
              const q = (input.query || '').trim();
              const labelMatch = q.match(/MATCH\s+\(n:(\w+)\)/i);
              if (labelMatch) {
                const label = labelMatch[1];
                const rows = db2.prepare('SELECT name FROM nodes WHERE label = ? LIMIT 5000').all(label);
                ok(rows.map(r => r.name).join('\n'));
              } else {
                ok('Cypher: unsupported query pattern');
              }
            } else if (tool === 'monograph_cohesion') {
              const limit = input.limit || 30;
              // Check if community_id is populated
              const hasCommunities = db2.prepare('SELECT COUNT(*) as c FROM nodes WHERE community_id IS NOT NULL').get().c > 0;
              if (hasCommunities) {
                const rows = db2.prepare('SELECT community_id, COUNT(*) as size FROM nodes GROUP BY community_id ORDER BY size DESC LIMIT ?').all(limit);
                ok(rows.map(r => `community ${r.community_id}: ${r.size} nodes`).join('\n'));
              } else {
                // Fallback: group by type (label)
                const rows = db2.prepare('SELECT label, COUNT(*) as cnt FROM nodes GROUP BY label ORDER BY cnt DESC LIMIT ?').all(limit);
                const total = db2.prepare('SELECT COUNT(*) as c FROM nodes').get().c;
                const lines = rows.map(r => {
                  const pct = ((r.cnt / total) * 100).toFixed(1);
                  const bar = '█'.repeat(Math.round(pct / 3));
                  return `${(r.label || 'unknown').padEnd(12)} ${r.cnt.toString().padStart(6)} nodes  (${pct}%)  ${bar}`;
                });
                ok(`Type Distribution (community clustering not yet run)\n${'─'.repeat(50)}\n${lines.join('\n')}`);
              }
            } else if (tool === 'monograph_bridge') {
              const limit = input.limit || 20;
              // Find hub nodes that connect many different directories (cross-module connectors)
              const rows = db2.prepare(`
                SELECT n.name, n.label, n.file_path,
                  COUNT(DISTINCT CASE WHEN e.source_id = n.id THEN n2.file_path ELSE NULL END) +
                  COUNT(DISTINCT CASE WHEN e.target_id = n.id THEN n2.file_path ELSE NULL END) as cross_file_count,
                  (SELECT COUNT(*) FROM edges WHERE source_id = n.id OR target_id = n.id) as total_degree
                FROM nodes n
                JOIN edges e ON e.source_id = n.id OR e.target_id = n.id
                JOIN nodes n2 ON (e.source_id = n2.id OR e.target_id = n2.id) AND n2.id != n.id
                GROUP BY n.id
                HAVING cross_file_count > 2
                ORDER BY cross_file_count DESC, total_degree DESC
                LIMIT ?`).all(limit);
              if (!rows.length) {
                ok('No cross-module bridge nodes found in top results. Try running monograph build to index more files.');
              } else {
                const lines = rows.map(r =>
                  `${r.name} (${r.label})\n  → connects ${r.cross_file_count} files, degree ${r.total_degree}\n  ${r.file_path || '?'}`
                );
                ok(`Cross-Module Bridge Nodes (${rows.length})\n${'─'.repeat(50)}\n${lines.join('\n\n')}`);
              }
            } else if (tool === 'monograph_detect_changes') {
              const { execSync } = await import('child_process');
              let changed = '';
              try { changed = execSync('git diff --name-only HEAD', { cwd: d2, encoding: 'utf-8' }); } catch { changed = '(git not available)'; }
              ok(changed.trim() || 'No changed files detected');
            } else if (tool === 'monograph_diff') {
              ok('Graph diff: compare two snapshots using monograph snapshot + monograph diff commands');
            } else if (tool === 'monograph_rename') {
              const sym = input.symbolName || '';
              if (!sym) { ok('Provide symbolName to rename'); return; }
              const hits = ftsSearch(db2, sym, 20);
              ok(`Found ${hits.length} occurrences of "${sym}":\n` + hits.map(h => `  ${h.filePath || '?'}:${h.startLine || '?'} — ${h.name}`).join('\n'));
            } else if (tool === 'monograph_impact') {
              const target = input.target || '';
              const dir3 = input.direction || 'both';
              const depth = input.maxDepth || 4;
              const hits = ftsSearch(db2, target, 5);
              if (!hits.length) { ok(`Node not found: ${target}`); return; }
              const nodeId = hits[0].id;
              const visited = new Set([nodeId]);
              const frontier = [nodeId];
              const results = [];
              for (let d3 = 0; d3 < depth && frontier.length; d3++) {
                const next = [];
                for (const id of frontier) {
                  const outgoing = dir3 !== 'upstream' ? db2.prepare('SELECT target_id, relation FROM edges WHERE source_id = ?').all(id) : [];
                  const incoming = dir3 !== 'downstream' ? db2.prepare('SELECT source_id as target_id, relation FROM edges WHERE target_id = ?').all(id) : [];
                  for (const e of [...outgoing, ...incoming]) {
                    if (!visited.has(e.target_id)) {
                      visited.add(e.target_id);
                      next.push(e.target_id);
                      const n3 = db2.prepare('SELECT name, label FROM nodes WHERE id = ?').get(e.target_id);
                      if (n3) results.push(`  [hop ${d3+1}] ${n3.name} (${n3.label}) via ${e.relation}`);
                    }
                  }
                }
                frontier.length = 0; frontier.push(...next);
              }
              ok(`Impact of "${hits[0].name}" (${dir3}, depth=${depth}):\n` + (results.join('\n') || '  (no dependencies found)'));
            } else if (tool === 'monograph_context') {
              const id = input.id || '';
              const hits = ftsSearch(db2, id, 5);
              if (!hits.length) { ok(`Node not found: ${id}`); return; }
              const node = hits[0];
              const outEdges = db2.prepare('SELECT e.relation, n.name FROM edges e JOIN nodes n ON n.id = e.target_id WHERE e.source_id = ? LIMIT 20').all(node.id);
              const inEdges = db2.prepare('SELECT e.relation, n.name FROM edges e JOIN nodes n ON n.id = e.source_id WHERE e.target_id = ? LIMIT 20').all(node.id);
              ok(`# ${node.name} (${node.label})\nFile: ${node.filePath || '?'}\n\n**Imports / depends on (${outEdges.length}):**\n${outEdges.map(e => `  → ${e.name} [${e.relation}]`).join('\n') || '  (none)'}\n\n**Used by / depended on by (${inEdges.length}):**\n${inEdges.map(e => `  ← ${e.name} [${e.relation}]`).join('\n') || '  (none)'}`);
            } else if (tool === 'monograph_query' || tool === 'monograph_suggest') {
              const q2 = input.query || input.task || '';
              const hits2 = ftsSearch(db2, q2, 20);
              ok(hits2.map(h => `${h.name} (${h.label}) — ${h.filePath || '?'}:${h.startLine || '?'}`).join('\n') || 'No results');
            } else {
              ok(`Tool "${tool}" not implemented in control panel`);
            }
          } finally { closeDb(db2); }
        } catch(e2) { err(String(e2)); }
      });
      return;
    }

    // -------------------------------------------------- GET /api/monograph-benchmark
    if (req.method === 'GET' && url === '/api/monograph-benchmark') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const graphPath = path.join(d, '.monomind', 'graph', 'graph.json');
        const legacyPath = path.join(d, 'graphify-out', 'graph.json');
        const gp = fs.existsSync(graphPath) ? graphPath : (fs.existsSync(legacyPath) ? legacyPath : null);

        if (!gp) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ available: false }));
          return;
        }

        const { execSync: ex } = await import('child_process');
        const out = ex(`graphify benchmark ${gp}`, { encoding: 'utf8', cwd: d, timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ available: true, result: out }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }


    // ------------------------------------------------------- GET /api/graph
    if (req.method === 'GET' && url === '/api/graph') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());

        // Find session files — sort by mtime descending before processing
        const homeDir = os.homedir();
        const slug = d.replace(/\//g, '-');
        const sessionsDir = fs.existsSync(path.join(homeDir, '.claude', 'projects', slug))
          ? path.join(homeDir, '.claude', 'projects', slug)
          : path.join(d, '.claude', 'sessions');

        let sessionFiles = [];
        try {
          sessionFiles = fs.readdirSync(sessionsDir)
            .filter(f => f.endsWith('.jsonl'))
            .map(f => ({ f, mtime: (() => { try { return fs.statSync(path.join(sessionsDir, f)).mtimeMs; } catch { return 0; } })() }))
            .sort((a, b) => b.mtime - a.mtime)
            .map(({ f }) => f);
        } catch {}

        // Parse each session: count tool categories + agent type spawns
        const TOOL_CAT = name => {
          if (['Read','Write','Edit','MultiEdit','Glob','Grep','LS'].includes(name)) return 'file';
          if (name === 'Bash') return 'bash';
          if (['Agent','Task'].includes(name)) return 'agent';
          if (name.startsWith('mcp__monobrain__memory') || name.startsWith('mcp__monobrain__agentdb')) return 'memory';
          if (['WebFetch','WebSearch'].includes(name)) return 'web';
          if (name === 'Skill') return 'skill';
          return 'other';
        };

        const nodes = [];
        const edges = [];
        const agentTypeNodes = {}; // subagent_type → node id

        for (const fname of sessionFiles) {
          const sid = fname.replace('.jsonl','');
          const fp = path.join(sessionsDir, fname);
          let stat = null;
          try { stat = fs.statSync(fp); } catch { continue; }

          // Skip files over size cap to avoid memory spikes on large sessions
          if (stat.size > JSONL_SIZE_CAP) {
            nodes.push({ id: sid, type: 'session', label: sid.slice(0,8), turns: 0, totalTools: 0,
              toolCounts: {}, cost: 0, mtime: stat.mtimeMs, size: stat.size, agentSpawns: {}, truncated: true });
            continue;
          }

          const toolCounts = {};
          const agentSpawns = {}; // subagent_type → count
          let turns = 0, totalCost = 0;

          try {
            const raw = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n');
            const lines = raw.split('\n').filter(Boolean);
            for (const line of lines) {
              let e; try { e = JSON.parse(line); } catch { continue; }
              if (e.type === 'user') turns++;
              if (e.type === 'assistant') {
                for (const block of (e.message?.content || [])) {
                  if (!block || block.type !== 'tool_use') continue;
                  const cat = TOOL_CAT(block.name);
                  toolCounts[cat] = (toolCounts[cat] || 0) + 1;
                  if (cat === 'agent') {
                    const sub = block.input?.subagent_type || block.input?.description || '?';
                    agentSpawns[sub] = (agentSpawns[sub] || 0) + 1;
                  }
                }
              }
              if (e.costUSD) totalCost += e.costUSD;
            }
          } catch {}

          const totalTools = Object.values(toolCounts).reduce((a,b)=>a+b,0);
          nodes.push({
            id: sid, type: 'session', label: sid.slice(0,8),
            turns, totalTools, toolCounts,
            cost: totalCost, mtime: stat.mtimeMs, size: stat.size,
            agentSpawns
          });

          // Create/link agent type nodes
          for (const [subType, count] of Object.entries(agentSpawns)) {
            const nodeId = 'agent::' + subType;
            if (!agentTypeNodes[subType]) {
              agentTypeNodes[subType] = true;
              nodes.push({ id: nodeId, type: 'agenttype', label: subType, totalSpawns: 0 });
            }
            const aNode = nodes.find(n => n.id === nodeId);
            if (aNode) aNode.totalSpawns = (aNode.totalSpawns || 0) + count;
            edges.push({ source: sid, target: nodeId, weight: count, label: String(count) });
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ nodes, edges }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------- GET /api/swarm-history
    if (req.method === 'GET' && url === '/api/swarm-history') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const entries = collectSwarmHistory(path.resolve(dir));
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ entries }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------- GET /api/swarm-events
    if (req.method === 'GET' && url === '/api/swarm-events') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const swarmId = qs.get('swarmId') || undefined;
        const agentId = qs.get('agentId') || undefined;
        const last = qs.get('last') ? parseInt(qs.get('last')) : undefined;
        const events = collectSwarmEvents(path.resolve(dir), { swarmId, agentId, last });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ events, count: events.length }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------- GET /api/swarm-data-size
    if (req.method === 'GET' && url === '/api/swarm-data-size') {
      try {
        const dir = new URL(req.url, 'http://localhost').searchParams.get('dir') || projectDir || process.cwd();
        const size = getSwarmDataSize(path.resolve(dir));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(size));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------- DELETE /api/swarm-clean
    if (req.method === 'DELETE' && url === '/api/swarm-clean') {
      try {
        const dir = new URL(req.url, 'http://localhost').searchParams.get('dir') || projectDir || process.cwd();
        const result = cleanSwarmData(path.resolve(dir));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/token-usage
    if (req.method === 'GET' && url.startsWith('/api/token-usage')) {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const period = ['today','week','30days','month'].includes(qs.get('period')) ? qs.get('period') : 'today';
        const dir = path.resolve(qs.get('dir') || projectDir || process.cwd());
        const trackerPath = path.join(dir, '.claude', 'helpers', 'token-tracker.cjs');
        const fallback = () => {
          const summary = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, '.monomind', 'metrics', 'token-summary.json'), 'utf8')); } catch { return {}; } })();
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
          res.end(JSON.stringify({ totalCost: summary.todayCost || 0, totalCalls: summary.todayCalls || 0, totalIn: 0, totalOut: 0, totalCR: 0, totalCW: 0, projects: [], modelBreakdown: {}, categoryBreakdown: {}, toolBreakdown: {}, mcpBreakdown: {}, periodLabel: period }));
        };
        if (!fs.existsSync(trackerPath)) { fallback(); return; }
        try {
          const _req = createRequire(import.meta.url);
          const tracker = _req(trackerPath);
          const range = tracker.getDateRange(period);
          const projects = tracker.parseAllSessions(range.start, range.end);
          let totalCost = 0, totalIn = 0, totalOut = 0, totalCR = 0, totalCW = 0, totalCalls = 0;
          const modelBreakdown = {}, categoryBreakdown = {}, toolBreakdown = {}, mcpBreakdown = {};
          for (const p of projects) {
            totalCost += p.totalCost || 0;
            for (const s of (p.sessions || [])) {
              totalIn += s.totalInputTokens || 0;
              totalOut += s.totalOutputTokens || 0;
              totalCR += s.totalCacheRead || 0;
              totalCW += s.totalCacheWrite || 0;
              totalCalls += s.apiCalls || 0;
              for (const [mn, m] of Object.entries(s.modelBreakdown || {})) {
                if (!modelBreakdown[mn]) modelBreakdown[mn] = { calls: 0, cost: 0, tokens: 0 };
                modelBreakdown[mn].calls += m.calls || 0;
                modelBreakdown[mn].cost += m.cost || 0;
                modelBreakdown[mn].tokens += m.tokens || 0;
              }
              for (const [cat, c] of Object.entries(s.categoryBreakdown || {})) {
                if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { turns: 0, cost: 0 };
                categoryBreakdown[cat].turns += c.turns || 0;
                categoryBreakdown[cat].cost += c.cost || 0;
              }
              for (const [tool, t] of Object.entries(s.toolBreakdown || {})) {
                if (!toolBreakdown[tool]) toolBreakdown[tool] = { calls: 0 };
                toolBreakdown[tool].calls += t.calls || 0;
              }
              for (const [srv, m] of Object.entries(s.mcpBreakdown || {})) {
                if (!mcpBreakdown[srv]) mcpBreakdown[srv] = { calls: 0 };
                mcpBreakdown[srv].calls += m.calls || 0;
              }
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
          res.end(JSON.stringify({ totalCost, totalCalls, totalIn, totalOut, totalCR, totalCW, projects, modelBreakdown, categoryBreakdown, toolBreakdown, mcpBreakdown, periodLabel: period }));
        } catch (e) { fallback(); }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/section
    if (req.method === 'GET' && url === '/api/section') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const name = qs.get('name') || '';
        const dir = qs.get('dir') || projectDir || process.cwd();
        const full = qs.get('full') === '1';
        let partial = buildSectionData(name, dir || process.cwd());
        // For full knowledge request, include all chunks
        if (name === 'knowledge' && full) {
          const chunksPath = path.join(path.resolve(dir || process.cwd()), '.monomind', 'knowledge', 'chunks.jsonl');
          let allChunks = [];
          try {
            const raw = fs.readFileSync(chunksPath, 'utf8');
            allChunks = raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
          } catch {}
          partial = { knowledge: { ...partial.knowledge, allChunks } };
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify(partial));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/stream
    if (req.method === 'GET' && url === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });

      // Keep the connection alive with periodic comments
      const keepAlive = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          clearInterval(keepAlive);
        }
      }, 20_000);

      sseClients.add(res);

      req.on('close', () => {
        clearInterval(keepAlive);
        sseClients.delete(res);
      });

      // Send the initial snapshot immediately
      try {
        const snapshot = await collectAll(projectDir);
        res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      }
      return;
    }

    // ---------------------------------------------------- GET /favicon.ico
    if (req.method === 'GET' && url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    // -------------------------------------------------------- GET /mastermind
    if (req.method === 'GET' && url === '/mastermind') {
      const htmlPath = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'docs', 'mastermind-diagram.html');
      try {
        const html = fs.readFileSync(htmlPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`mastermind-diagram.html not found at: ${htmlPath}`);
      }
      return;
    }

    // ------------------------------------------------------------------ 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  // Bind to available port
  const boundPort = await bindServer(server, port);
  const url = `http://localhost:${boundPort}`;

  // ---------------------------------------------------------------- Watchers
  let debounceTimer = null;
  let pendingSections = new Set();

  function scheduleRefresh(event, filename) {
    const sections = pathToSections(filename);
    if (sections) sections.forEach(s => pendingSections.add(s));
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const changed = pendingSections.size > 0
        ? Array.from(pendingSections)
        : ['sessions', 'swarm', 'agents', 'tokens', 'hooks', 'memory', 'knowledge', 'metrics'];
      pendingSections.clear();
      broadcast({ kind: 'changed', sections: changed });
    }, 500);
  }

  // Watch .monomind directory
  const monomindDir = path.join(projectDir || process.cwd(), '.monomind');
  if (fs.existsSync(monomindDir)) {
    try {
      const w = fs.watch(monomindDir, { recursive: true }, scheduleRefresh);
      activeWatchers.push(w);
    } catch {
      // Directory may not support recursive watch on all platforms — ignore
    }
  }

  // Watch .claude/sessions/ if present
  const claudeSessionsDir = path.join(projectDir || process.cwd(), '.claude', 'sessions');
  if (fs.existsSync(claudeSessionsDir)) {
    try {
      const w = fs.watch(claudeSessionsDir, { recursive: true }, scheduleRefresh);
      activeWatchers.push(w);
    } catch {
      // Ignore unsupported watch
    }
  }

  // Update module-level state
  running = true;
  currentPort = boundPort;
  currentUrl = url;
  activeServer = server;

  // --------------------------------------------------------- Graceful shutdown
  function shutdown() {
    for (const w of activeWatchers) {
      try {
        w.close();
      } catch {
        // Already closed
      }
    }
    activeWatchers.length = 0;

    // Close all SSE connections
    for (const client of sseClients) {
      try {
        client.end();
      } catch {
        // Already ended
      }
    }
    sseClients.clear();

    server.close(() => {
      running = false;
      currentPort = null;
      currentUrl = null;
      activeServer = null;
    });
  }

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  // ---------------------------------------------------------- Auto-open
  if (openBrowser) {
    openUrl(url).catch(() => {
      // Non-fatal: browser open failure should not crash the server
    });
  }

  return { port: boundPort, url, server };
}

/**
 * Returns the current server status.
 */
export function getServerStatus() {
  return {
    running,
    port: currentPort,
    url: currentUrl,
    clientCount: sseClients.size,
  };
}

// Auto-start when invoked directly: node server.mjs [port]
const _isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (_isMain) {
  const _port = parseInt(process.argv[2] || process.env.CONTROL_PORT || '4242', 10);
  const _dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  startServer({ port: _port, openBrowser: false, projectDir: _dir }).catch(err => {
    process.stderr.write(`[server] failed to start: ${err.message}\n`);
    process.exit(1);
  });
}
