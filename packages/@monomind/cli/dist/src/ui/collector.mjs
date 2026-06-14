import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readJSONL(filePath, last) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const slice = last != null ? lines.slice(-last) : lines;
    return slice.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function countJSONLLines(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function fileStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function listDir(dirPath) {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Section collectors
// ---------------------------------------------------------------------------

function collectProject(projectDir) {
  let name = path.basename(projectDir);
  const pkgPath = path.join(projectDir, 'package.json');
  const pkg = readJSON(pkgPath);
  if (pkg && pkg.name) {
    name = pkg.name;
  }
  return { dir: projectDir, name };
}

function getClaudeProjectSessionsDir(projectDir) {
  // Claude Code stores sessions in ~/.claude/projects/<slug>/ not in the project itself
  const homeDir = os.homedir();
  const slug = projectDir.replace(/\//g, '-');
  const globalSessions = path.join(homeDir, '.claude', 'projects', slug);
  if (fs.existsSync(globalSessions)) return globalSessions;
  // Fallback to local .claude/sessions
  return path.join(projectDir, '.claude', 'sessions');
}

function collectSessions(projectDir) {
  const sessionsDir = getClaudeProjectSessionsDir(projectDir);
  const entries = listDir(sessionsDir);
  const list = entries
    .filter(f => f.endsWith('.json') || f.endsWith('.jsonl'))
    .map(f => {
      const filePath = path.join(sessionsDir, f);
      const stat = fileStat(filePath);
      const id = path.basename(f, path.extname(f));
      return {
        id,
        file: filePath,
        mtime: stat ? stat.mtimeMs : null,
        size: stat ? stat.size : null
      };
    })
    .sort((a, b) => (b.mtime || 0) - (a.mtime || 0));

  const memFiles = collectMemoryFiles(projectDir);

  return {
    list,
    count: list.length,
    palace: {
      count: memFiles.length
    }
  };
}

const _appendedSwarmIds = new Set();

function collectSwarm(projectDir) {
  const base = path.join(projectDir, '.monomind');
  const state = readJSON(path.join(base, 'swarm', 'swarm-state.json')) || {};
  const dotSwarmState = readJSON(path.join(projectDir, '.swarm', 'state.json')) || {};
  const merged = { ...dotSwarmState, ...state };

  const terminalStatuses = ['stopped', 'terminated', 'completed', 'error'];
  const swarmId = merged.swarmId || merged.id;
  if (swarmId && terminalStatuses.includes(merged.status) && !_appendedSwarmIds.has(swarmId)) {
    _appendedSwarmIds.add(swarmId);
    const agents = (merged.agents || merged.agentPlan || []).map(a => ({
      id: a.id || a.type || a.role,
      type: a.type || a.role || '?',
      role: a.role || 'worker',
      tasksCompleted: a.tasksCompleted || a.count || 0,
      tasksFailed: a.tasksFailed || 0,
      messageCount: a.messageCount || 0,
      utilization: a.utilization || 0,
    }));
    const entry = {
      swarmId,
      topology: merged.topology || '—',
      consensus: merged.consensus || '—',
      strategy: merged.strategy || '—',
      status: merged.status,
      agents,
      messages: merged.messages || [],
      errors: merged.errors || [],
      findings: merged.findings || [],
      taskCount: merged.taskCount || 0,
      completedTasks: merged.completedTasks || 0,
      failedTasks: merged.failedTasks || 0,
      startedAt: merged.startedAt || merged.createdAt || new Date().toISOString(),
      endedAt: merged.stoppedAt || merged.endedAt || new Date().toISOString(),
      durationMs: 0,
    };
    if (entry.startedAt && entry.endedAt) {
      entry.durationMs = new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime();
    }
    try { appendSwarmHistory(projectDir, entry); } catch {}
  }

  return {
    state: merged,
    activity: readJSON(path.join(base, 'metrics', 'swarm-activity.json')) || {},
    suggestion: {},
    config: readJSON(path.join(base, 'swarm-config.json')) || {},
  };
}

function collectSwarmHistory(projectDir) {
  const historyPath = path.join(projectDir, '.monomind', 'swarm', 'history.jsonl');
  const byId = new Map();

  // 1. Persisted history (if any swarm ever appended on terminal status)
  for (const e of readJSONL(historyPath)) {
    const id = e && (e.swarmId || e.id);
    if (id) byId.set(id, e);
  }

  // 2. Derive from the live swarm-state.json. The writer stores a NESTED
  //    { swarms: { <id>: {...} } } map, but collectSwarm() only appends to
  //    history.jsonl when a FLAT top-level swarmId/status is present — which
  //    this format never has. So without this fallback the tab is empty even
  //    though swarms exist. Derive entries directly from the map here.
  try {
    const state = readJSON(path.join(projectDir, '.monomind', 'swarm', 'swarm-state.json')) || {};
    const swarmsMap = state.swarms || (state.swarmId ? { [state.swarmId]: state } : {});
    for (const [key, s] of Object.entries(swarmsMap)) {
      if (!s || typeof s !== 'object') continue;
      const sid = s.swarmId || s.id || key;
      if (byId.has(sid)) continue; // a real history entry wins over derived
      const cfg = s.config || {};
      const agents = Array.isArray(s.agents) ? s.agents : [];
      byId.set(sid, {
        swarmId: sid,
        topology: s.topology || cfg.topology || '—',
        consensus: s.consensus || cfg.consensusMechanism || '—',
        strategy: s.strategy || cfg.strategy || '—',
        status: s.status || 'unknown',
        agentCount: agents.length || s.maxAgents || cfg.maxAgents || 0,
        agents,
        taskCount: Array.isArray(s.tasks) ? s.tasks.length : (s.taskCount || 0),
        startedAt: s.createdAt || s.startedAt || null,
        endedAt: s.updatedAt || s.endedAt || null,
        derived: true,
      });
    }
  } catch {}

  // newest-first
  return Array.from(byId.values()).sort((a, b) =>
    new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime());
}

function appendSwarmHistory(projectDir, entry) {
  const dir = path.join(projectDir, '.monomind', 'swarm');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const historyPath = path.join(dir, 'history.jsonl');
  fs.appendFileSync(historyPath, JSON.stringify(entry) + '\n');
}

function collectSwarmEvents(projectDir, opts = {}) {
  const eventsPath = path.join(projectDir, '.monomind', 'swarm', 'events.jsonl');
  const events = readJSONL(eventsPath, opts.last || null);
  if (opts.swarmId) return events.filter(e => e.swarmId === opts.swarmId);
  if (opts.agentId) return events.filter(e => e.agentId === opts.agentId);
  return events;
}

function getSwarmDataSize(projectDir) {
  const dir = path.join(projectDir, '.monomind', 'swarm');
  let totalBytes = 0;
  let fileCount = 0;
  const files = ['history.jsonl', 'events.jsonl'];
  for (const f of files) {
    const stat = fileStat(path.join(dir, f));
    if (stat) { totalBytes += stat.size; fileCount++; }
  }
  return { totalBytes, fileCount, humanSize: totalBytes < 1024 ? totalBytes + ' B' : totalBytes < 1048576 ? (totalBytes / 1024).toFixed(1) + ' KB' : (totalBytes / 1048576).toFixed(1) + ' MB' };
}

function cleanSwarmData(projectDir) {
  const dir = path.join(projectDir, '.monomind', 'swarm');
  const files = ['history.jsonl', 'events.jsonl'];
  let removed = 0;
  for (const f of files) {
    const fp = path.join(dir, f);
    try { fs.unlinkSync(fp); removed++; } catch {}
  }
  _appendedSwarmIds.clear();
  return { removed, files };
}

function collectAgents(projectDir) {
  const base = path.join(projectDir, '.monomind');
  const regsDir = path.join(base, 'agents', 'registrations');
  const regFiles = listDir(regsDir).filter(f => f.endsWith('.json'));
  const registrations = regFiles.map(f => {
    return readJSON(path.join(regsDir, f));
  }).filter(Boolean);

  const registry = readJSON(path.join(base, 'registry.json')) || {};

  return {
    registrations,
    registry,
    count: registrations.length
  };
}

const _TOK_PRICES = {
  'claude-opus-4-6':   { in: 5e-6,    out: 25e-6,  cw: 6.25e-6, cr: 0.5e-6  },
  'claude-opus-4-5':   { in: 5e-6,    out: 25e-6,  cw: 6.25e-6, cr: 0.5e-6  },
  'claude-opus-4':     { in: 15e-6,   out: 75e-6,  cw: 18.75e-6,cr: 1.5e-6  },
  'claude-sonnet-4-6': { in: 3e-6,    out: 15e-6,  cw: 3.75e-6, cr: 0.3e-6  },
  'claude-sonnet-4-5': { in: 3e-6,    out: 15e-6,  cw: 3.75e-6, cr: 0.3e-6  },
  'claude-sonnet-4':   { in: 3e-6,    out: 15e-6,  cw: 3.75e-6, cr: 0.3e-6  },
  'claude-3-7-sonnet': { in: 3e-6,    out: 15e-6,  cw: 3.75e-6, cr: 0.3e-6  },
  'claude-3-5-sonnet': { in: 3e-6,    out: 15e-6,  cw: 3.75e-6, cr: 0.3e-6  },
  'claude-haiku-4-5':  { in: 1e-6,    out: 5e-6,   cw: 1.25e-6, cr: 0.1e-6  },
  'claude-3-5-haiku':  { in: 0.8e-6,  out: 4e-6,   cw: 1e-6,    cr: 0.08e-6 },
};
function _tokPrice(model) {
  const _ALIAS = { 'haiku': 'claude-haiku-4-5', 'opus': 'claude-opus-4-6', 'sonnet': 'claude-sonnet-4-6' };
  let k = (model || '').replace(/@.*$/, '').replace(/-\d{8}$/, '');
  k = _ALIAS[k] || k;
  if (_TOK_PRICES[k]) return _TOK_PRICES[k];
  for (const p of Object.keys(_TOK_PRICES)) { if (k.startsWith(p) || k.includes(p)) return _TOK_PRICES[p]; }
  return { in: 3e-6, out: 15e-6, cw: 3.75e-6, cr: 0.3e-6 }; // sonnet default
}
function _tokCost(model, usage) {
  const p = _tokPrice(model);
  return (usage.input_tokens || 0) * p.in
       + (usage.output_tokens || 0) * p.out
       + (usage.cache_creation_input_tokens || 0) * p.cw
       + (usage.cache_read_input_tokens || 0) * p.cr;
}

function collectTokens(projectDir, days = 14) {
  const base = path.join(projectDir, '.monomind', 'metrics');
  const summary = readJSON(path.join(base, 'token-summary.json')) || {};

  // Scan session JSONLs to build daily chart data and per-session rows
  const sessionsDir = getClaudeProjectSessionsDir(projectDir);
  const jsonlFiles = listDir(sessionsDir).filter(f => f.endsWith('.jsonl'));

  const dailyMap = {};   // date-string → { cost, calls, tokensIn, tokensOut }
  const rows = [];       // per-session summary
  let totalTokensIn = 0, totalTokensOut = 0;

  // Cutoff: look back `days` days
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  for (const fname of jsonlFiles) {
    const fpath = path.join(sessionsDir, fname);
    let stat;
    try { stat = fs.statSync(fpath); } catch { continue; }
    // Skip very old sessions for performance (mtime heuristic)
    if (stat.mtimeMs < cutoff - 7 * 24 * 60 * 60 * 1000) continue;

    let content;
    try { content = fs.readFileSync(fpath, 'utf8'); } catch { continue; }

    const lines = content.split('\n');
    let sessTokensIn = 0, sessTokensOut = 0, sessCost = 0, sessCalls = 0;
    let sessLastPrompt = '';

    for (const line of lines) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }

      // Capture last user prompt for session label
      if (entry.type === 'user') {
        const txt = Array.isArray(entry.message?.content)
          ? (entry.message.content.find(b => b.type === 'text')?.text || '').slice(0, 60)
          : String(entry.message?.content || '').slice(0, 60);
        if (txt.trim()) sessLastPrompt = txt.trim();
      }

      if (entry.type === 'assistant' && entry.message?.usage) {
        const usage = entry.message.usage;
        const model = entry.message.model || '';
        const cost = _tokCost(model, usage);
        const tokIn = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
        const tokOut = usage.output_tokens || 0;
        const ts = entry.timestamp || '';
        const day = ts.slice(0, 10); // "YYYY-MM-DD"

        if (day && day >= new Date(cutoff).toISOString().slice(0, 10)) {
          if (!dailyMap[day]) dailyMap[day] = { cost: 0, calls: 0, tokensIn: 0, tokensOut: 0 };
          dailyMap[day].cost += cost;
          dailyMap[day].calls++;
          dailyMap[day].tokensIn += tokIn;
          dailyMap[day].tokensOut += tokOut;
        }

        sessTokensIn += tokIn;
        sessTokensOut += tokOut;
        sessCost += cost;
        sessCalls++;
        totalTokensIn += tokIn;
        totalTokensOut += tokOut;
      }
    }

    if (sessCalls > 0) {
      rows.push({
        id: fname.replace('.jsonl', ''),
        session: sessLastPrompt || fname.replace('.jsonl', '').slice(0, 20),
        calls: sessCalls,
        tokens: sessTokensIn + sessTokensOut,
        cost: sessCost,
      });
    }
  }

  // Build sorted daily array
  const daily = Object.keys(dailyMap).sort().slice(-days).map(d => ({
    date: d,
    label: d.slice(5), // "MM-DD"
    cost: dailyMap[d].cost,
    calls: dailyMap[d].calls,
    tokensIn: dailyMap[d].tokensIn,
    tokensOut: dailyMap[d].tokensOut,
  }));

  // Sort rows by cost descending
  rows.sort((a, b) => b.cost - a.cost);

  const totalTokens = totalTokensIn + totalTokensOut;
  if (totalTokens > 0) summary.totalTokens = totalTokens;

  // Overwrite stale cached todayCost/todayCalls with fresh JSONL-derived values.
  // daily uses UTC date keys (entry.timestamp.slice(0,10)), so match that here.
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayEntry = dailyMap[todayKey];
  summary.todayCost  = todayEntry ? todayEntry.cost  : 0;
  summary.todayCalls = todayEntry ? todayEntry.calls : 0;

  return { summary, daily, rows };
}

function collectHooks(projectDir) {
  const base = path.join(projectDir, '.monomind');
  const lastRoute = readJSON(path.join(base, 'last-route.json')) || {};
  const feedback = readJSONL(path.join(base, 'routing-feedback.jsonl'), 10);

  const workerDispatchDir = path.join(base, 'worker-dispatch');
  const workerDispatch = listDir(workerDispatchDir).filter(f => f.startsWith('pending-') && f.endsWith('.json'));

  return { lastRoute, feedback, workerDispatch };
}

function collectKnowledge(projectDir) {
  const base = path.join(projectDir, '.monomind');
  const chunksPath = path.join(base, 'knowledge', 'chunks.jsonl');
  const skillsPath = path.join(base, 'skills.jsonl');

  // Read chunks.jsonl once; derive count and recent slice together
  let chunks = 0;
  let recent = [];
  try {
    const raw = fs.readFileSync(chunksPath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    chunks = lines.length;
    recent = lines.slice(-5).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  } catch {}
  const skills = countJSONLLines(skillsPath);

  return { chunks, skills, recent };
}

function collectMetrics(projectDir) {
  const base = path.join(projectDir, '.monomind');
  const swarmActivity = readJSON(path.join(base, 'metrics', 'swarm-activity.json')) || {};
  const tokenSummary = readJSON(path.join(base, 'metrics', 'token-summary.json')) || {};

  // Derive routing stats from feedback log (cap at 1000 to avoid reading unbounded file)
  const feedbackAll = readJSONL(path.join(base, 'routing-feedback.jsonl'), 1000);
  const routingTotal = feedbackAll.length;
  let routingConfSum = 0, routingConfCount = 0;
  const agentCounts = {};
  for (const fb of feedbackAll) {
    if (fb.confidence != null) { routingConfSum += fb.confidence; routingConfCount++; }
    const a = fb.suggestedAgent || fb.agent;
    if (a) agentCounts[a] = (agentCounts[a] || 0) + 1;
  }
  const avgConf = routingConfCount > 0 ? Math.round((routingConfSum / routingConfCount) * 100) : null;
  const topAgent = Object.entries(agentCounts).sort((a, b) => b[1] - a[1])[0];

  return {
    routing: {
      total: routingTotal,
      avgConfidence: avgConf,
      topAgent: topAgent ? topAgent[0] : null,
      topAgentCount: topAgent ? topAgent[1] : null,
    },
    swarm: {
      active: swarmActivity.swarm && swarmActivity.swarm.active,
      agentCount: swarmActivity.swarm && swarmActivity.swarm.agent_count,
      lastActive: swarmActivity.timestamp || null,
    },
    tokens: {
      todayCost: tokenSummary.todayCost,
      todayCalls: tokenSummary.todayCalls,
      monthCost: tokenSummary.monthCost,
      monthCalls: tokenSummary.monthCalls,
    },
    security: readJSON(path.join(base, 'security', 'audit-status.json')) || {}
  };
}

function collectTriggers(projectDir) {
  return readJSON(path.join(projectDir, '.monomind', 'trigger-index.json')) || {};
}

function collectMemoryFiles(projectDir) {
  const homeDir = os.homedir();
  const slug = path.resolve(projectDir).replace(/\//g, '-');
  const memDir = path.join(homeDir, '.claude', 'projects', slug, 'memory');
  let files = [];
  try { files = fs.readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md'); } catch {}
  return files.map(fname => {
    const fp = path.join(memDir, fname);
    let raw = ''; try { raw = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n'); } catch {}
    let name = fname.replace('.md', ''), description = '', type = 'project';
    const fm = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (fm) {
      for (const line of fm[1].split('\n')) {
        const m2 = line.match(/^(\w+):\s*(.+)$/);
        if (m2) {
          if (m2[1] === 'name') name = m2[2].trim();
          if (m2[1] === 'description') description = m2[2].trim();
          if (m2[1] === 'type') type = m2[2].trim();
        }
      }
    }
    let stat = null; try { stat = fs.statSync(fp); } catch {}
    return { filename: fname, name, description, type, mtime: stat ? stat.mtimeMs : null };
  }).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
}

// Probe candidate paths in priority order, return first existing file's stat
function probeFile(...candidates) {
  for (const p of candidates) {
    const s = fileStat(p);
    if (s && s.size > 0) return { path: p, size: s.size };
  }
  return null;
}

function collectMemory(projectDir) {
  const d = path.resolve(projectDir);
  const monomindDir = path.join(d, '.monomind');

  // AgentDB — check all known locations across different init styles
  const dbCandidates = [
    path.join(d, 'data', 'memory.db'),         // custom --path ./data/memory.db
    path.join(d, '.swarm', 'memory.db'),        // default init path
    path.join(monomindDir, 'memory.db'),        // legacy .monomind path
    path.join(d, '.claude', 'memory.db'),       // .claude dir (some setups)
  ];
  const dbHit = probeFile(...dbCandidates);
  const dbSize = dbHit ? dbHit.size : 0;
  const dbPath = dbHit ? dbHit.path : null;

  // HNSW — lives alongside the DB or at the .swarm default
  const hnswCandidates = dbPath ? [
    path.join(path.dirname(dbPath), 'memory.graph'),  // alongside DB (hybrid backend)
    path.join(path.dirname(dbPath), 'hnsw.index'),    // default init name
  ] : [
    path.join(d, 'data', 'memory.graph'),
    path.join(d, '.swarm', 'hnsw.index'),
  ];
  const hnswHit = probeFile(...hnswCandidates);
  const hnsw = !!hnswHit;

  // MonoVector DB
  const monovectorHit = probeFile(
    path.join(monomindDir, 'data', 'monovector.db'),
    path.join(d, 'data', 'monovector.db'),
  );
  const monovectorSize = monovectorHit ? monovectorHit.size : 0;
  const monovectorExists = !!monovectorHit;

  let monovectorPatterns = 0;
  const ranked = readJSON(path.join(monomindDir, 'data', 'ranked-context.json'));
  if (ranked && ranked.entries) monovectorPatterns = ranked.entries.length;

  const files = collectMemoryFiles(projectDir);

  return { dbSize, dbPath, hnsw, monovectorSize, monovectorExists, monovectorPatterns, files, count: files.length };
}

function collectSystem() {
  return {
    nodeVersion: process.version,
    uptime: process.uptime(),
    platform: process.platform,
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
  };
}

// ---------------------------------------------------------------------------
// Global: all projects on this machine (~/.claude/projects/)
// ---------------------------------------------------------------------------

function slugToPath(slug) {
  return resolveSlugPath(slug);
}

// Reconstruct the real filesystem path from a Claude project slug.
// Slugs encode the path with every '/' replaced by '-', which is lossy when
// directory names contain literal hyphens (e.g. /Desktop/agent-f/accounting).
// Strategy: naive replace first; if not found, greedy DFS through the filesystem
// trying longest-possible segment (with embedded hyphens) at each level.
function resolveSlugPath(slug) {
  const naive = '/' + slug.replace(/^-/, '').replace(/-/g, '/');
  try { if (fs.existsSync(naive)) return naive; } catch {}

  const tokens = slug.replace(/^-/, '').split('-').filter(Boolean);

  function walk(idx, dir) {
    if (idx === tokens.length) return dir;
    // Try longest span first (greedy) so "agent-f" is preferred over "agent"+"f"
    for (let end = tokens.length; end > idx; end--) {
      const segment = tokens.slice(idx, end).join('-');
      const candidate = path.join(dir, segment);
      try {
        if (fs.statSync(candidate).isDirectory()) {
          const result = walk(end, candidate);
          if (result !== null) return result;
        }
      } catch {}
    }
    return null;
  }

  return walk(0, '/') || naive;
}

let _apCache = null;
let _apCacheTs = 0;
const AP_TTL = 5_000;

export function collectAllProjects() {
  const now = Date.now();
  if (_apCache !== null && now - _apCacheTs < AP_TTL) return _apCache;
  const homeDir = os.homedir();
  const projectsRoot = path.join(homeDir, '.claude', 'projects');
  const result = [];

  let slugs = [];
  try { slugs = fs.readdirSync(projectsRoot); } catch { return result; }

  for (const slug of slugs) {
    const projectClaudeDir = path.join(projectsRoot, slug);
    let stat;
    try { stat = fs.statSync(projectClaudeDir); } catch { continue; }
    if (!stat.isDirectory()) continue;

    // Find session files (.jsonl) and subdirs (session folders)
    let entries = [];
    try { entries = fs.readdirSync(projectClaudeDir); } catch { continue; }

    const sessionFiles = entries.filter(e => e.endsWith('.jsonl'));
    const sessions = sessionFiles.map(f => {
      const fp = path.join(projectClaudeDir, f);
      let fstat = null;
      try { fstat = fs.statSync(fp); } catch {}
      // Peek at first line for model/type info
      let firstTurn = null;
      try {
        const buf = Buffer.alloc(512);
        const fd = fs.openSync(fp, 'r');
        try {
          fs.readSync(fd, buf, 0, 512, 0);
        } finally {
          fs.closeSync(fd);
        }
        const line = buf.toString('utf8').split('\n')[0];
        firstTurn = JSON.parse(line);
      } catch {}
      return {
        id: path.basename(f, '.jsonl'),
        file: fp,
        mtime: fstat ? fstat.mtimeMs : null,
        size: fstat ? fstat.size : null,
        lines: null, // skip line count for perf
        model: firstTurn && firstTurn.model ? firstTurn.model : null,
      };
    }).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));

    // Resolve the actual filesystem path (handles hyphens in directory names)
    const diskPath = resolveSlugPath(slug);
    const parts = diskPath.split('/').filter(Boolean);
    const name = parts[parts.length - 1] || slug;
    const exists = fs.existsSync(diskPath);

    // Last activity = most recent session mtime
    const lastActivity = sessions.length ? sessions[0].mtime : null;

    // Count auto-memory files from ~/.claude/projects/<slug>/memory/
    let memoryCount = 0;
    try {
      const memDir = path.join(os.homedir(), '.claude', 'projects', slug, 'memory');
      if (fs.existsSync(memDir)) {
        memoryCount = fs.readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md').length;
      }
    } catch {}

    result.push({
      slug,
      name,
      path: diskPath,
      exists,
      sessionCount: sessions.length,
      sessions: sessions.slice(0, 5), // top 5 most recent
      lastActivity,
      memoryCount,
      totalSize: sessions.reduce((sum, s) => sum + (s.size || 0), 0),
    });
  }

  // Sort by most recently active
  result.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
  _apCache = result;
  _apCacheTs = Date.now();
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function collectAll(projectDir) {
  const resolvedDir = path.resolve(projectDir);

  return {
    timestamp: Date.now(),
    project: collectProject(resolvedDir),
    sessions: collectSessions(resolvedDir),
    swarm: collectSwarm(resolvedDir),
    agents: collectAgents(resolvedDir),
    tokens: collectTokens(resolvedDir),
    hooks: collectHooks(resolvedDir),
    knowledge: collectKnowledge(resolvedDir),
    metrics: collectMetrics(resolvedDir),
    triggers: collectTriggers(resolvedDir),
    memory: collectMemory(resolvedDir),
    system: collectSystem(),
    allProjects: collectAllProjects(),
  };
}

export { collectProject, collectSessions, collectSwarm, collectSwarmHistory, appendSwarmHistory, collectSwarmEvents, getSwarmDataSize, cleanSwarmData, collectAgents, collectTokens, collectHooks, collectKnowledge, collectMetrics, collectMemory, collectMemoryFiles, collectSystem };

export function getWatchPaths(projectDir) {
  const resolvedDir = path.resolve(projectDir);
  const m = path.join(resolvedDir, '.monomind');
  const c = path.join(resolvedDir, '.claude');

  return [
    // Swarm
    path.join(m, 'swarm', 'swarm-state.json'),
    path.join(m, 'swarm', 'history.jsonl'),
    path.join(m, 'swarm-config.json'),
    // Metrics
    path.join(m, 'metrics', 'swarm-activity.json'),
    path.join(m, 'metrics', 'token-summary.json'),
    path.join(m, 'metrics', 'token-sessions.json'),
    path.join(m, 'metrics', 'ddd-progress.json'),
    path.join(m, 'metrics', 'learning.json'),
    // Agents
    path.join(m, 'registry.json'),
    path.join(m, 'agents', 'registrations'),
    // Hooks / routing
    path.join(m, 'last-route.json'),
    path.join(m, 'routing-feedback.jsonl'),
    path.join(m, 'worker-dispatch'),
    // Knowledge
    path.join(m, 'knowledge', 'chunks.jsonl'),
    path.join(m, 'skills.jsonl'),
    // Security
    path.join(m, 'security', 'audit-status.json'),
    // Triggers & memory — watch all candidate locations
    path.join(m, 'trigger-index.json'),
    path.join(resolvedDir, 'data', 'memory.db'),
    path.join(resolvedDir, 'data', 'memory.graph'),
    path.join(resolvedDir, '.swarm', 'memory.db'),
    path.join(resolvedDir, '.swarm', 'hnsw.index'),
    path.join(m, 'memory.db'),
    path.join(m, 'data', 'monovector.db'),
    path.join(m, 'data', 'ranked-context.json'),
    // Sessions
    path.join(c, 'sessions')
  ];
}
