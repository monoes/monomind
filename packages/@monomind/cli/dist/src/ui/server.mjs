import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
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
        const dir = qs.get('dir') || projectDir;
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
        const dir = qs.get('dir') || projectDir;
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
        const dir = qs.get('dir') || projectDir;
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
        const dir = qs.get('dir') || projectDir;
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
        const loopsDir = path.join(projectDir || process.cwd(), '.monomind', 'loops');
        let loops = [];
        try {
          const files = fs.readdirSync(loopsDir).filter(f => f.endsWith('.json'));
          const stopFiles = new Set(fs.readdirSync(loopsDir).filter(f => f.endsWith('.stop')).map(f => f.replace('.stop', '')));
          for (const file of files) {
            try {
              const data = JSON.parse(fs.readFileSync(path.join(loopsDir, file), 'utf-8'));
              data.stopRequested = stopFiles.has(data.id);
              loops.push(data);
            } catch {}
          }
        } catch (e) { if (e.code !== 'ENOENT') throw e; }
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

    // ------------------------------------------------------- GET /api/graphify-html
    if (req.method === 'GET' && url === '/api/graphify-html') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir;
        const d = path.resolve(dir || process.cwd());
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

    // ------------------------------------------------------- GET /api/graphify-report
    if (req.method === 'GET' && url === '/api/graphify-report') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir;
        const d = path.resolve(dir || process.cwd());
        const reportPath = path.join(d, '.monomind', 'graph', 'GRAPH_REPORT.md');
        const graphPath = path.join(d, '.monomind', 'graph', 'graph.json');

        let content = null, exists = false, stats = null, enriched = null;
        try { content = fs.readFileSync(reportPath, 'utf-8'); exists = true; } catch {}
        try {
          const s = fs.statSync(graphPath);
          if (s.size < 5 * 1024 * 1024) {
            const g = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
            const nodes = Array.isArray(g.nodes) ? g.nodes.length : 0;
            const edgeArr = Array.isArray(g.edges) ? g.edges : (Array.isArray(g.links) ? g.links : []);
            const edges = edgeArr.length;
            stats = { nodes, edges, size: s.size, mtime: s.mtimeMs };
          } else {
            stats = { size: s.size, mtime: s.mtimeMs, tooLarge: true };
          }
        } catch {}
        // Include enriched metadata if available (same 5MB size cap as graph.json)
        const enrichedPath = path.join(d, '.monomind', 'graph', 'graph.enriched.json');
        try {
          const es = fs.statSync(enrichedPath);
          if (es.size < 5 * 1024 * 1024) {
            const em = JSON.parse(fs.readFileSync(enrichedPath, 'utf-8'));
            enriched = { enrichedAt: em.enrichedAt, enrichedNodes: em.metrics?.enrichedNodes,
              resolvedCallEdges: em.metrics?.resolvedCallEdges, pageRankComputed: em.metrics?.pageRankComputed, size: es.size };
          } else {
            enriched = { size: es.size, tooLarge: true };
          }
          if (stats) stats.enriched = enriched;
        } catch {}

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ exists, content, stats, reportPath, enriched }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/graphify-graph
    if (req.method === 'GET' && url === '/api/graphify-graph') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir;
        const d = path.resolve(dir || process.cwd());
        const graphPath = path.join(d, '.monomind', 'graph', 'graph.json');
        let nodes = [], edges = [], tooLarge = false;
        try {
          const s = fs.statSync(graphPath);
          if (s.size < 50 * 1024 * 1024) {
            const g = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
            const rawNodes = Array.isArray(g.nodes) ? g.nodes : [];
            const rawEdges = Array.isArray(g.edges) ? g.edges : (Array.isArray(g.links) ? g.links : []);
            // Filter to internal nodes (project symbols with a known source file)
            const internalNodes = rawNodes.filter(n => n.sourceFile && n.sourceFile !== '');
            const internalIds = new Set(internalNodes.map(n => n.id));
            // Compute degree: count edges that touch any internal node (measures real-world connectivity)
            const degree = new Map();
            for (const n of internalNodes) degree.set(n.id, 0);
            for (const e of rawEdges) {
              if (internalIds.has(e.source)) degree.set(e.source, (degree.get(e.source) || 0) + 1);
              if (internalIds.has(e.target)) degree.set(e.target, (degree.get(e.target) || 0) + 1);
            }
            // Top 120 internal nodes by degree
            const topNodes = [...internalNodes]
              .sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0))
              .slice(0, 120);
            const topIds = new Set(topNodes.map(n => n.id));
            nodes = topNodes.map(n => ({ id: n.id, label: n.label || n.id, type: n.type, degree: degree.get(n.id) || 0 }));
            edges = rawEdges
              .filter(e => topIds.has(e.source) && topIds.has(e.target))
              .sort((a, b) => ((degree.get(b.source) || 0) + (degree.get(b.target) || 0)) - ((degree.get(a.source) || 0) + (degree.get(a.target) || 0)))
              .slice(0, 500)
              .map(e => ({ source: e.source, target: e.target, relation: e.relation || e.type }));
          } else {
            tooLarge = true;
          }
        } catch (e) { if (e.code !== 'ENOENT') throw e; }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ nodes, edges, tooLarge }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- POST /api/graphify-build
    if (req.method === 'POST' && url === '/api/graphify-build') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir;
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

    // -------------------------------------------------- GET /api/graphify-query
    if (req.method === 'GET' && url === '/api/graphify-query') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir;
        const q = qs.get('q') || '';
        const mode = qs.get('mode') === 'dfs' ? '--dfs' : '';
        const budget = qs.get('budget') || '2000';
        const d = path.resolve(dir || process.cwd());
        const graphPath = path.join(d, '.monomind', 'graph', 'graph.json');
        const legacyPath = path.join(d, 'graphify-out', 'graph.json');
        const gp = fs.existsSync(graphPath) ? graphPath : (fs.existsSync(legacyPath) ? legacyPath : null);

        if (!q) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing ?q= parameter' }));
          return;
        }

        const { execSync: ex } = await import('child_process');
        const args = ['query', JSON.stringify(q), '--budget', budget];
        if (mode) args.push(mode);
        if (gp) args.push('--graph', gp);
        const out = ex(`graphify ${args.join(' ')}`, { encoding: 'utf8', cwd: d, timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, query: q, result: out }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/graphify-explain
    if (req.method === 'GET' && url === '/api/graphify-explain') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir;
        const node = qs.get('node') || '';
        const d = path.resolve(dir || process.cwd());
        const graphPath = path.join(d, '.monomind', 'graph', 'graph.json');
        const legacyPath = path.join(d, 'graphify-out', 'graph.json');
        const gp = fs.existsSync(graphPath) ? graphPath : (fs.existsSync(legacyPath) ? legacyPath : null);

        if (!node) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing ?node= parameter' }));
          return;
        }

        const { execSync: ex } = await import('child_process');
        const args = ['explain', JSON.stringify(node)];
        if (gp) args.push('--graph', gp);
        const out = ex(`graphify ${args.join(' ')}`, { encoding: 'utf8', cwd: d, timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, node, explanation: out }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/graphify-path
    if (req.method === 'GET' && url === '/api/graphify-path') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir;
        const from = qs.get('from') || '';
        const to = qs.get('to') || '';
        const d = path.resolve(dir || process.cwd());
        const graphPath = path.join(d, '.monomind', 'graph', 'graph.json');
        const legacyPath = path.join(d, 'graphify-out', 'graph.json');
        const gp = fs.existsSync(graphPath) ? graphPath : (fs.existsSync(legacyPath) ? legacyPath : null);

        if (!from || !to) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing ?from= and ?to= parameters' }));
          return;
        }

        const { execSync: ex } = await import('child_process');
        const args = ['path', JSON.stringify(from), JSON.stringify(to)];
        if (gp) args.push('--graph', gp);
        const out = ex(`graphify ${args.join(' ')}`, { encoding: 'utf8', cwd: d, timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, from, to, path: out }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/graphify-watch-status
    if (req.method === 'GET' && url === '/api/graphify-watch-status') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir;
        const d = path.resolve(dir || process.cwd());
        const pidPath = path.join(d, '.monomind', 'graph', 'watch.pid');
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

    // -------------------------------------------------- POST /api/graphify-watch-toggle
    if (req.method === 'POST' && url === '/api/graphify-watch-toggle') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir;
        const d = path.resolve(dir || process.cwd());
        const pidPath = path.join(d, '.monomind', 'graph', 'watch.pid');
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
          const child = sp('graphify', ['watch', d], { stdio: 'ignore', detached: true, cwd: d });
          child.unref();
          try { fs.mkdirSync(path.join(d, '.monomind', 'graph'), { recursive: true }); } catch {}
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

    // -------------------------------------------------- GET /api/graphify-benchmark
    if (req.method === 'GET' && url === '/api/graphify-benchmark') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir;
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
        const dir = qs.get('dir') || projectDir;
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

    // ------------------------------------------------------- GET /api/section
    if (req.method === 'GET' && url === '/api/section') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const name = qs.get('name') || '';
        const dir = qs.get('dir') || projectDir;
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
