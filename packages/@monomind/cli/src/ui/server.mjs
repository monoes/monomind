import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import {
  collectAgents,
  collectAll,
  collectHooks,
  collectKnowledge,
  collectMemory,
  collectMetrics,
  collectProject,
  collectSessions,
  collectSystem,
  collectTokens,
} from './collector.mjs';
import { handleMonographRoutes } from './routes-monograph.mjs';
import { handleMonoesRoutes } from './routes-monoes.mjs';
import { handleOrgRoutes } from './routes-org.mjs';
import {
  addMmClient,
  addSseClient,
  broadcast,
  broadcastMm,
  closeSseClients,
  getSseClientCount,
  removeMmClient,
  removeSseClient,
} from './sse-manager.mjs';

const _JSONL_SIZE_CAP = 10 * 1024 * 1024; // 10 MB — skip files larger than this in /api/graph
// Session id format for data/sessions/<id>.jsonl persistence — no path traversal (".."), starts
// with a word char, rest is word chars/dot/dash. Shared by every session-id-accepting endpoint.
const SESSION_ID_RE = /^(?!.*\.\.)[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/;
const buildDocsState = new Map();

// Pricing per token (mirrors token-tracker.cjs FALLBACK_PRICING)
const _SJ_PRICING = {
  'claude-opus-5': { in: 5e-6, out: 25e-6, cw: 6.25e-6, cr: 0.5e-6 },
  'claude-opus-4-7': { in: 5e-6, out: 25e-6, cw: 6.25e-6, cr: 0.5e-6 },
  'claude-opus-4-6': { in: 5e-6, out: 25e-6, cw: 6.25e-6, cr: 0.5e-6 },
  'claude-opus-4-5': { in: 5e-6, out: 25e-6, cw: 6.25e-6, cr: 0.5e-6 },
  'claude-opus-4-1': { in: 15e-6, out: 75e-6, cw: 18.75e-6, cr: 1.5e-6 },
  'claude-opus-4': { in: 15e-6, out: 75e-6, cw: 18.75e-6, cr: 1.5e-6 },
  'claude-sonnet-5': { in: 3e-6, out: 15e-6, cw: 3.75e-6, cr: 0.3e-6 },
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
    haiku: 'claude-haiku-4-5',
    opus: 'claude-opus-4-6',
    sonnet: 'claude-sonnet-4-6',
  };
  let canonical = (model || '').replace(/@.*$/, '').replace(/-\d{8}$/, '');
  canonical = _ALIAS[canonical] || canonical;
  if (_SJ_PRICING[canonical]) return _SJ_PRICING[canonical];
  for (const k of Object.keys(_SJ_PRICING)) {
    if (canonical.startsWith(k) || canonical.includes(k)) return _SJ_PRICING[k];
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
function _sjCalcCost(model, usage) {
  const p = _sjGetPricing(model);
  if (!p || !usage) return 0;
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

// ─── Session JSONL parser ────────────────────────────────────────────────────
function categorizeTool(name) {
  if (['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS'].includes(name)) return 'file';
  if (name === 'Bash') return 'bash';
  if (['Agent', 'Task'].includes(name)) return 'agent';
  if (name.startsWith('mcp__monomind__memory') || name.startsWith('mcp__monomind__agentdb'))
    return 'memory';
  if (['WebFetch', 'WebSearch'].includes(name)) return 'web';
  if (name === 'TodoWrite' || name === 'TodoRead') return 'task';
  if (name === 'Skill') return 'skill';
  if (name === 'ToolSearch') return 'search';
  if (name.startsWith('mcp__')) return 'mcp';
  return 'other';
}

function parseSessionLines(lines) {
  const events = [];
  const _agentDepth = 0;
  const toolMap = new Map(); // id → tool event index

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const type = entry.type;
    const ts = entry.timestamp || null;
    const uuid = entry.uuid || null;

    if (type === 'user') {
      const content = entry.message?.content;
      let text = '';
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content)) {
        text = content
          .filter((b) => b && b.type === 'text')
          .map((b) => b.text)
          .join('');
      }
      if (text && text.length > 0) {
        events.push({ kind: 'user', text: text.slice(0, 500), uuid, ts });
      }
    } else if (type === 'assistant') {
      const content = entry.message?.content || [];
      for (const block of Array.isArray(content) ? content : []) {
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
      for (const block of Array.isArray(content) ? content : []) {
        if (block?.type !== 'tool_result') continue;
        const resultText = Array.isArray(block.content)
          ? block.content
              .filter((b) => b && b.type === 'text')
              .map((b) => b.text)
              .join('')
              .slice(0, 400)
          : String(block.content || '').slice(0, 400);
        const isError = !!block.is_error;
        const toolIdx = toolMap.get(block.tool_use_id);
        events.push({
          kind: 'tool_result',
          tool_use_id: block.tool_use_id,
          text: resultText,
          isError,
          toolIdx,
          uuid,
          ts,
        });
      }
    }
  }
  return events;
}

function buildToolLabel(name, input) {
  if (name === 'Read') return input.file_path ? `Read ${path.basename(input.file_path)}` : 'Read';
  if (name === 'Write')
    return input.file_path ? `Write ${path.basename(input.file_path)}` : 'Write';
  if (name === 'Edit') return input.file_path ? `Edit ${path.basename(input.file_path)}` : 'Edit';
  if (name === 'Bash') return (input.description || input.command || 'Bash').slice(0, 60);
  if (name === 'Grep') return `Grep ${(input.pattern || '').slice(0, 30)}`;
  if (name === 'Glob') return `Glob ${(input.pattern || '').slice(0, 30)}`;
  if (name === 'Agent' || name === 'Task')
    return `→ ${input.subagent_type || input.description || 'agent'}`;
  if (name === 'WebFetch') return `Fetch ${(input.url || '').slice(0, 50)}`;
  if (name === 'WebSearch') return `Search ${(input.query || '').slice(0, 40)}`;
  if (name === 'Skill') return `Skill: ${input.skill || '?'}`;
  if (name.startsWith('mcp__monomind__memory'))
    return name.replace('mcp__monomind__memory_', 'mem:');
  if (name.startsWith('mcp__'))
    return name.replace('mcp__monomind__', '⬡ ').replace('mcp__', '⬡ ').slice(0, 40);
  return name.slice(0, 40);
}

// ─── Section collectors (for /api/section lazy load) ────────────────────────
function buildSectionData(name, dir) {
  const d = path.resolve(dir);
  switch (name) {
    case 'sessions':
      return { sessions: collectSessions(d) };
    case 'agents':
      return { agents: collectAgents(d) };
    case 'tokens':
      return { tokens: collectTokens(d) };
    case 'hooks':
      return { hooks: collectHooks(d) };
    case 'knowledge':
      return { knowledge: collectKnowledge(d) };
    case 'metrics':
      return { metrics: collectMetrics(d) };
    case 'system':
      return { system: collectSystem() };
    case 'memory': {
      const s = collectSessions(d);
      return { sessions: { palace: s.palace }, memory: collectMemory(d) };
    }
    case 'overview':
      return { project: collectProject(d), system: collectSystem() };
    default:
      return {};
  }
}

// Map file path fragment → affected section names
function pathToSections(filename) {
  if (!filename) return null;
  const f = filename.toLowerCase();
  if (f.includes('swarm')) return ['swarm'];
  if (f.includes('token')) return ['tokens'];
  if (f.includes('registry') || f.includes('registrations')) return ['agents'];
  if (f.includes('route') || f.includes('worker-dispatch')) return ['hooks'];
  if (f.includes('chunk') || f.includes('skills')) return ['knowledge'];
  if (
    f.includes('auto-memory-store') ||
    f.includes('episodes.jsonl') ||
    (f.includes('/memory/') && f.endsWith('.md'))
  )
    return ['memory', 'sessions'];
  if (f.includes('palace') || f.includes('drawers') || f.includes('identity'))
    return ['memory', 'sessions'];
  if (f.includes('consolidation')) return ['metrics', 'memory'];
  if (
    f.includes('ddd') ||
    f.includes('audit') ||
    f.includes('codebase-map') ||
    f.includes('security-audit') ||
    f.includes('performance')
  )
    return ['metrics'];
  if (f.endsWith('.jsonl') || f.includes('sessions')) return ['sessions'];
  return ['sessions', 'swarm', 'agents', 'tokens', 'hooks'];
}

// SSE client registry and mastermind SSE clients are managed by sse-manager.mjs
// Active org run tracking: org -> runId (enables event routing for orgs without runId in payload)
const activeOrgRuns = new Map();
// Active session tracking: org -> {sessionId, ts} (enables linking agent events to sessions)
const activeSessionsByOrg = new Map();
// Phase 3: Per-org SSE clients for run streaming tail endpoint
const runStreamClients = new Map(); // orgName → Set<res>

// Design doc Issue 2: concurrent write safety. Since server.mjs is the sole writer
// (all hook processes POST via HTTP), in-process serialization is sufficient.
// SQLite WAL (Issue 2 Phase 1.5): run events are indexed in an in-memory sql.js database
// with WAL mode and persisted to .monomind/run-events.db every 1000ms. JSONL files are
// still written (bash lifecycle scripts write them directly), but SQLite is the query layer
// for streaming tail replay and startup gap-fill.
//
// Serializing write queue — prevents concurrent JSONL corruption (Issue 2 from design doc)
const _writeQueue = new Map(); // filePath → Promise (in-flight write)

// ── sql.js WAL run-event index (Phase 1.5) ──────────────────────────────────
let _runDb = null; // sql.js in-memory Database
let _runDbPath = null; // disk path for persistence
let _runDbPersistTimer = null;
let _runDbInsertStmt = null; // prepared INSERT statement

const _require = createRequire(import.meta.url);

/**
 * Guard against a stale PID file outliving its process and the OS recycling
 * that PID for an unrelated process — verify the live process actually looks
 * like ours (node/npx running something under this project or monomind)
 * before signaling it or reporting it as "running".
 */
function looksLikeOurProcess(pid, dir) {
  try {
    const { execSync } = _require('child_process');
    const cmd = execSync(`ps -p ${pid} -o command=`, { timeout: 2000, encoding: 'utf-8' }).trim();
    const looksLikeNode = cmd.includes('node') || cmd.includes('npx') || cmd.includes('npm exec');
    return (
      looksLikeNode && (cmd.includes('monomind') || cmd.includes('monograph') || cmd.includes(dir))
    );
  } catch {
    return false;
  }
}

async function _initRunDb(monoHome) {
  try {
    const initSqlJs = _require('sql.js');
    const SQL = await initSqlJs();
    _runDbPath = path.join(monoHome, '.monomind', 'run-events.db');
    fs.mkdirSync(path.dirname(_runDbPath), { recursive: true });
    let fileData;
    try {
      fileData = fs.readFileSync(_runDbPath);
    } catch (_) {}
    _runDb = fileData ? new SQL.Database(fileData) : new SQL.Database();
    _runDb.run('PRAGMA journal_mode=WAL');
    _runDb.run('PRAGMA synchronous=NORMAL');
    _runDb.run(`CREATE TABLE IF NOT EXISTS run_events (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      org   TEXT    NOT NULL,
      run_id TEXT   NOT NULL,
      type  TEXT    NOT NULL,
      raw   TEXT    NOT NULL,
      ts    INTEGER NOT NULL,
      source TEXT   DEFAULT 'http',
      UNIQUE(org, run_id, ts, type, raw)
    )`);
    _runDb.run('CREATE INDEX IF NOT EXISTS idx_re_org_id ON run_events(org, id)');
    _runDb.run('CREATE INDEX IF NOT EXISTS idx_re_ts    ON run_events(ts)');
    _runDbInsertStmt = _runDb.prepare(
      'INSERT OR IGNORE INTO run_events (org, run_id, type, raw, ts, source) VALUES (?,?,?,?,?,?)',
    );
    // Compact old events at startup: keep last 30 days
    const _cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    _runDb.run('DELETE FROM run_events WHERE ts < ?', [_cutoff]);
    _persistRunDb();
  } catch (_) {
    _runDb = null; // graceful fallback — JSONL path continues to work
  }
}

// Single-writer guard for the run-events.db snapshot persist: bindServer() can start a
// SECOND dashboard instance on port+1 when 4242 is already taken (two projects' dashboards
// running simultaneously, or a stale-but-still-bound old instance). Each instance holds an
// independent in-memory sql.js copy; without a lock, each instance's periodic full-snapshot
// overwrite silently clobbers the other's accumulated events (last writer wins, no error).
// Claiming this lock before every snapshot write ensures only ONE live instance actually
// persists at a time — the other still runs, just skips its write until it can claim the
// lock (e.g. after the current holder exits and its lock goes stale). This doesn't merge
// both instances' events into one file, but it stops them from destructively overwriting
// each other. Pattern mirrors .claude/helpers/utils/fs-helpers.cjs's claimLock/releaseLock
// (wx-create, rename-to-reclaim-stale) — replicated inline here since this file ships
// standalone in the published package and can't depend on repo-local dev tooling.
function _runDbLockPath() {
  return _runDbPath ? `${_runDbPath}.lock` : null;
}

function _claimRunDbLock(staleMs) {
  const lockPath = _runDbLockPath();
  if (!lockPath) return false;
  staleMs = staleMs || 5000;
  const tryCreate = () => {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return true;
    } catch (_) {
      return false;
    }
  };
  if (tryCreate()) return true;
  try {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs < staleMs) return false; // held by a live/fresh owner
    // Stale lock — reclaim via atomic rename so only one racing process wins it.
    const claimed = `${lockPath}.${process.pid}.${Date.now()}.stale`;
    try {
      fs.renameSync(lockPath, claimed);
    } catch (_) {
      return false; // another process already reclaimed it
    }
    try {
      fs.unlinkSync(claimed);
    } catch (_) {}
    return tryCreate();
  } catch (_) {
    // Lock vanished between our failed create and this stat — retry once.
    return tryCreate();
  }
}

function _releaseRunDbLock() {
  const lockPath = _runDbLockPath();
  if (!lockPath) return;
  try {
    if (Number(fs.readFileSync(lockPath, 'utf8')) === process.pid) fs.unlinkSync(lockPath);
  } catch (_) {}
}

function _writeRunDbSnapshot() {
  if (!_runDb || !_runDbPath) return;
  if (!_claimRunDbLock()) return; // another live instance owns the write right now
  try {
    fs.writeFileSync(_runDbPath, Buffer.from(_runDb.export()));
  } catch (_) {
    // best-effort — matches prior swallow-on-error behavior
  } finally {
    _releaseRunDbLock();
  }
}

function _persistRunDb() {
  if (!_runDb || !_runDbPath) return;
  clearTimeout(_runDbPersistTimer);
  _runDbPersistTimer = setTimeout(_writeRunDbSnapshot, 1000);
}

function _insertRunEvent(ev, source) {
  if (!_runDb || !_runDbInsertStmt) return;
  try {
    const org = String(ev.org || '').trim();
    const runId = String(ev.runId || '').trim();
    if (!org || !runId) return;
    _runDbInsertStmt.run([
      org,
      runId,
      String(ev.type || ''),
      JSON.stringify(ev),
      Number(ev.ts || Date.now()),
      source || 'http',
    ]);
    _persistRunDb();
  } catch (_) {
    // sql.js leaves the prepared statement in a dirty state after any error (step() throws but
    // reset() is never called). Reset it so subsequent inserts aren't permanently broken.
    try {
      _runDbInsertStmt.reset();
    } catch (_2) {}
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Bounded file reads for session JSONL (P3-6b) ────────────────────────────
// /api/session already caps memory correctly by tailing; /api/session-journal and
// /api/session-errors used to fs.readFileSync() whole session files regardless of
// size, so one request against a multi-hundred-MB session log (a real scenario for
// long-running org sessions) buffers the entire file. These helpers cap the read to
// a fixed byte window via openSync/readSync (mirrors the byte-offset tail-read the
// /api/loops handler already uses for ScheduleWakeup lookups) instead of loading the
// whole file.
function _readTailLines(filePath, maxBytes) {
  maxBytes = maxBytes || 4 * 1024 * 1024; // 4MB — generous for the most recent activity
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const len = stat.size - start;
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, len, start);
  } finally {
    fs.closeSync(fd);
  }
  let text = buf.toString('utf8');
  if (start > 0) {
    // We started mid-file — the first line is very likely a partial line, drop it.
    const nl = text.indexOf('\n');
    text = nl === -1 ? '' : text.slice(nl + 1);
  }
  return text.split('\n').filter(Boolean);
}

function _readHeadText(filePath, maxBytes) {
  maxBytes = maxBytes || 8192; // enough for the JSONL header line(s) we need to inspect
  const stat = fs.statSync(filePath);
  const len = Math.min(maxBytes, stat.size);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, len, 0);
  } finally {
    fs.closeSync(fd);
  }
  return buf.toString('utf8');
}
// ─────────────────────────────────────────────────────────────────────────────

function appendToFile(filePath, line) {
  const prev = _writeQueue.get(filePath) || Promise.resolve();
  const next = prev.then(() => {
    try {
      fs.appendFileSync(filePath, line);
    } catch (_) {}
  });
  _writeQueue.set(filePath, next);
  next.then(() => {
    if (_writeQueue.get(filePath) === next) _writeQueue.delete(filePath);
  });
  return next;
}

// Returns the shared git directory parent so run files survive branch switches and
// are shared across all worktrees. In a worktree, .git is a FILE pointing to the
// shared .git dir (e.g. /main/.git/worktrees/feat); we navigate up two levels to
// reach /main/.git, then up one more to /main/ for the monomind data root.
// Falls back to the working directory if git isn't available.
const _gitMonomindCache = new Map();
const _MAX_GIT_CACHE = 100;
function _getGitMonomindDir(workDir) {
  if (!workDir) return null;
  if (_gitMonomindCache.has(workDir)) return _gitMonomindCache.get(workDir);
  let result = null;
  try {
    const gitEntry = path.join(workDir, '.git');
    const st = fs.statSync(gitEntry);
    if (st.isDirectory()) {
      // Regular repo: .git is a directory
      result = path.join(gitEntry, 'monomind');
    } else if (st.isFile()) {
      // Worktree: .git is a text file "gitdir: /main/.git/worktrees/name"
      const m = fs
        .readFileSync(gitEntry, 'utf8')
        .trim()
        .match(/^gitdir:\s*(.+)/);
      if (m) {
        // Resolve relative paths (gitdir can be relative to the worktree root)
        const worktreeDir = path.resolve(workDir, m[1].trim());
        // /main/.git/worktrees/name -> /main/.git -> /main/.git/monomind
        const commonGitDir = path.dirname(path.dirname(worktreeDir));
        result = path.join(commonGitDir, 'monomind');
      }
    }
  } catch {}
  if (!result) result = path.join(workDir, '.monomind'); // fallback
  if (_gitMonomindCache.size >= _MAX_GIT_CACHE) {
    const oldest = _gitMonomindCache.keys().next().value;
    _gitMonomindCache.delete(oldest);
  }
  _gitMonomindCache.set(workDir, result);
  return result;
}

// Returns the monomind home directory for server-level data (capture, control.json, loops).
// Priority: MONOMIND_HOME env var > walk up from cwd finding .monomind/control.json > cwd fallback
function getMonomindHome() {
  if (process.env.MONOMIND_HOME) return path.resolve(process.env.MONOMIND_HOME);
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.monomind', 'control.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}
const MONOMIND_HOME = getMonomindHome();

// Resolve an org's project directory by searching across known projects.
// Returns the first project dir where {dir}/.monomind/orgs/{orgName}.json exists, or null.
function _resolveOrgProjectDir(orgName, serverRoot) {
  const dirs = new Set([serverRoot]);
  try {
    const kf = path.join(serverRoot, 'data', 'known-projects.json');
    if (fs.existsSync(kf)) JSON.parse(fs.readFileSync(kf, 'utf8')).forEach((p) => dirs.add(p));
  } catch (_) {}
  for (const d of dirs) {
    if (fs.existsSync(path.join(d, '.monomind', 'orgs', `${orgName}.json`))) return d;
  }
  return null;
}

// ── Org run state helpers ────────────────────────────────────────────────
// Reads {name}-runstate.json from disk. Returns null if missing/corrupt.
function _readRunState(orgName, rootDir) {
  const projDir = _resolveOrgProjectDir(orgName, rootDir) || rootDir;
  const base = _getGitMonomindDir(projDir) || path.join(projDir, '.monomind');
  const file = path.join(base, 'orgs', `${orgName}-runstate.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

// Returns the current runId from runstate (for events that omit it after restart).
function _getActiveRunId(orgName, rootDir) {
  return _readRunState(orgName, rootDir)?.runId || null;
}

// Returns all project dirs allowed for artifact reads (serverRoot + known-projects.json).
function _getAllowedArtifactDirs(serverRoot) {
  const dirs = [path.resolve(serverRoot)];
  try {
    const kf = path.join(serverRoot, 'data', 'known-projects.json');
    if (fs.existsSync(kf))
      JSON.parse(fs.readFileSync(kf, 'utf8')).forEach((p) => dirs.push(path.resolve(p)));
  } catch (_) {}
  return dirs;
}

// Detects a basic mime type from file extension for artifact responses.
function _detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.ts': 'text/typescript',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.css': 'text/css',
    '.py': 'text/x-python',
    '.sh': 'text/x-shellscript',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.toml': 'text/plain',
    '.env': 'text/plain',
    '.xml': 'text/xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  };
  return map[ext] || 'application/octet-stream';
}

// Writes runstate.json for state-changing events. Debounces lastEventAt for frequent events.
const _runstateDebouncers = new Map();
function _updateRunState(event, rootDir) {
  const orgName = String(event.org || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!orgName) return;
  const projDir = _resolveOrgProjectDir(orgName, rootDir) || rootDir;
  const base = _getGitMonomindDir(projDir) || path.join(projDir, '.monomind');
  const orgsDir = path.join(base, 'orgs');
  const file = path.join(orgsDir, `${orgName}-runstate.json`);
  const stateChanging = [
    'org:start',
    'org:stop',
    'org:complete',
    'run:complete',
    'org:agent:online',
    'org:agent:offline',
  ];
  const ts = event.ts || Date.now();

  if (stateChanging.includes(event.type)) {
    // State-changing: clear any pending debounced write, then write immediately
    const pending = _runstateDebouncers.get(orgName);
    if (pending?.timer) clearTimeout(pending.timer);
    _runstateDebouncers.delete(orgName);
    let cur = null;
    try {
      cur = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    } catch (_) {
      cur = {};
    }
    if (event.type === 'org:start') {
      cur.runId = event.runId || cur.runId;
      cur.status = 'running';
      cur.startedAt = ts;
      cur.checkpointInterval = event.checkpointInterval || 600000;
      cur.agentStates = {};
    } else if (event.type === 'org:stop') {
      cur.status = 'idle';
    } else if (event.type === 'org:complete' || event.type === 'run:complete') {
      // Only close runstate if the completing run matches (or no runId given)
      if (!event.runId || !cur.runId || String(event.runId).trim() === String(cur.runId)) {
        cur.status = 'complete';
        cur.endedAt = ts;
      }
    } else if (event.type === 'org:agent:online') {
      cur.agentStates = cur.agentStates || {};
      cur.agentStates[String(event.from || '').trim()] = { status: 'active', lastSeen: ts };
    } else if (event.type === 'org:agent:offline') {
      if (cur.agentStates?.[String(event.from || '').trim()]) {
        cur.agentStates[String(event.from).trim()].status = 'idle';
      }
    }
    cur.lastEventAt = ts;
    try {
      fs.mkdirSync(orgsDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(cur, null, 2));
    } catch (_) {}
  } else {
    // Frequent event: debounce lastEventAt write by 5s
    const existing = _runstateDebouncers.get(orgName);
    if (existing?.timer) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      _runstateDebouncers.delete(orgName);
      try {
        if (!fs.existsSync(file)) return;
        const rs = JSON.parse(fs.readFileSync(file, 'utf8'));
        rs.lastEventAt = Date.now();
        fs.writeFileSync(file, JSON.stringify(rs, null, 2));
      } catch (_) {}
    }, 5000);
    _runstateDebouncers.set(orgName, { timer });
  }
}
// ── End runstate helpers ─────────────────────────────────────────────────

// ── Security: DNS-rebinding defence ───────────────────────────────────────────
// The dashboard binds 127.0.0.1 and embeds a live auth token in the HTML served
// by GET / (an open route — the page needs the token before it can attach it to
// any fetch). Loopback binding is NOT a boundary against a browser: a page on
// attacker.example can point its own DNS at 127.0.0.1, and the browser will
// happily connect and treat the response as same-origin with attacker.example,
// letting the attacker's script read the token straight out of the <meta> tag
// and then drive every authenticated /api/* route.
//
// The distinguishing signal is the Host header: the browser sends the name from
// the URL bar, so a rebound request carries `Host: attacker.example` while the
// real dashboard carries a loopback name. Rejecting non-loopback Host values
// closes the hole without affecting any legitimate client. (CORS does not help
// here — the rebound page IS same-origin as far as the browser is concerned.)
const _LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Extract the hostname from a Host header, dropping the port.
 * Returns '' for a missing/blank header. IPv6 literals keep their brackets
 * (`[::1]:4242` → `[::1]`), which is how they appear in a Host header.
 */
export function parseHostHeader(hostHeader) {
  const h = String(hostHeader ?? '')
    .trim()
    .toLowerCase();
  if (!h) return '';
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? h : h.slice(0, end + 1);
  }
  const colon = h.lastIndexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

/**
 * True when a request's Host header names this machine's loopback interface or
 * an explicitly configured extra host.
 *
 * A request with NO Host header is allowed: HTTP/1.0 and raw local scripts omit
 * it, and it is not an attack vector — browsers ALWAYS send Host, so a rebinding
 * page cannot suppress it.
 *
 * `extraHosts` comes from startServer({ allowedHosts }) or the
 * MONOMIND_DASHBOARD_ALLOWED_HOSTS env var (comma-separated), for the case where
 * someone deliberately fronts the dashboard with another name.
 */
export function isAllowedHost(hostHeader, extraHosts = []) {
  const name = parseHostHeader(hostHeader);
  if (!name) return true; // absent Host — non-browser client, see above
  if (_LOOPBACK_HOSTNAMES.has(name)) return true;
  // 127.0.0.0/8 is entirely loopback, not just 127.0.0.1.
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name)) return true;
  for (const extra of extraHosts) {
    if (parseHostHeader(extra) === name) return true;
  }
  return false;
}

/** Parse the configured extra-host allow-list from an option + env var. */
export function resolveAllowedHosts(optionValue) {
  const raw = []
    .concat(Array.isArray(optionValue) ? optionValue : optionValue ? [optionValue] : [])
    .concat(String(process.env.MONOMIND_DASHBOARD_ALLOWED_HOSTS || '').split(','));
  return raw.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
}

// Server state
let running = false;
let currentPort = null;
let currentUrl = null;
let _activeServer = null;
const activeWatchers = [];

// broadcast() is imported from sse-manager.mjs

/**
 * Opens a URL in the default browser, cross-platform.
 */
async function openUrl(url) {
  const { exec } = await import('node:child_process');
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
      server.listen(p, '127.0.0.1', () => resolve(p));
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
/**
 * Resolve a Claude project slug back to the real filesystem path.
 * Slugs are created by replacing all '/' with '-', so paths containing
 * hyphens (like agent-f/agf-accounting) are ambiguous. This function
 * uses a greedy BFS over the real filesystem to find the correct path.
 * Falls back to cwd in session files, then to direct slug replacement.
 */
const _slugPathCache = new Map();
const _MAX_SLUG_CACHE = 200;

// Inverse of resolveSlugToPath: absolute path -> ~/.claude/projects/<slug>
// dir name. Claude Code's slug replaces every path separator AND the
// Windows drive-letter colon with '-' (e.g. "C:\Users\x" -> "C--Users-x")
// — replacing only '/' leaves Windows paths (all-backslash) completely
// untouched, so every dir= lookup 404s and every project shows 0 sessions.
function pathToSlug(d) {
  return String(d).replace(/[\\/:]/g, '-');
}

function resolveSlugToPath(slug, projDir) {
  if (_slugPathCache.has(slug)) return _slugPathCache.get(slug);
  const resolved = _resolveSlugToPathUncached(slug, projDir);
  if (_slugPathCache.size >= _MAX_SLUG_CACHE) {
    const oldest = _slugPathCache.keys().next().value;
    _slugPathCache.delete(oldest);
  }
  _slugPathCache.set(slug, resolved);
  return resolved;
}

function _resolveSlugToPathUncached(slug, projDir) {
  // 1. Try filesystem BFS (most reliable). Branching is O(2^hyphens) in the
  // worst case (a slug with N hyphens can require exploring both "new path
  // segment" and "hyphen is part of this segment's name" at each of the N
  // positions) — bound total exploration so a slug with many hyphens (e.g.
  // a UUID-embedded temp/scratchpad dir) can't hang the event loop.
  const parts = slug.replace(/^-/, '').split('-');
  const MAX_CALLS = 20000;
  let calls = 0;
  function tryPaths(idx, current) {
    if (++calls > MAX_CALLS) return null;
    if (idx === parts.length) return fs.existsSync(current) ? current : null;
    // Option A: next part is a new path component
    const asDir = path.join(current, parts[idx]);
    const r1 = tryPaths(idx + 1, asDir);
    if (r1) return r1;
    // Option B: combine with hyphen into current basename
    if (current !== '/') {
      const combined = path.join(path.dirname(current), `${path.basename(current)}-${parts[idx]}`);
      const r2 = tryPaths(idx + 1, combined);
      if (r2) return r2;
    }
    return null;
  }
  const fsResolved = parts.length ? tryPaths(1, `/${parts[0]}`) : null;
  if (fsResolved) return fsResolved;

  // 2. Try reading cwd from a session file
  try {
    const sfiles = fs
      .readdirSync(projDir)
      .filter((f) => f.endsWith('.jsonl') && !f.startsWith('._'));
    for (const sf of sfiles) {
      try {
        const line = fs
          .readFileSync(path.join(projDir, sf), 'utf-8')
          .split('\n')
          .find((l) => l.includes('"cwd"'));
        if (line) {
          const m = line.match(/"cwd"\s*:\s*"([^"]+)"/);
          // m[1] is the raw JSON-escaped text between the quotes (e.g. a
          // Windows path's backslashes still escaped as \\) — unescape it
          // properly instead of returning the escaped literal.
          if (m?.[1]) {
            try {
              return JSON.parse(`"${m[1]}"`);
            } catch {
              return m[1];
            }
          }
        }
      } catch {}
    }
  } catch {}

  // 3. Dumb fallback (known-broken for hyphenated dirs, but last resort)
  return slug.replace(/-/g, '/');
}

export async function startServer({
  port = 4242,
  projectDir,
  openBrowser = true,
  allowedHosts,
} = {}) {
  // Extra Host names accepted beyond loopback (see isAllowedHost above).
  const _allowedHosts = resolveAllowedHosts(allowedHosts);
  // ── Security: per-process auth credential for mutating (non-GET) requests ─
  // Generated once per server start and written to a well-known location so
  // trusted local callers (CLI, control-start.cjs) can read it and pass it
  // back via an auth header or query param on non-GET requests.
  const authBytes = crypto.randomBytes(24);
  const dashboardAuthValue = authBytes.toString('hex');
  // A project has ONE primary token file (read by hooks, the CLI, and cross-
  // project callers). Writing it eagerly here would let a SECONDARY instance
  // (scratch port, tests, a second `serve`) clobber the live control server's
  // token — after which every hook call to the primary 401s until it restarts,
  // silently degrading per-prompt Second Brain injection to keyword fallback.
  // So the write is deferred to bind time and gated: primary instances write
  // `dashboard-token`; secondaries write `dashboard-token-<port>` instead.
  async function writeDashboardToken(actualPort) {
    try {
      actualPort = Number(actualPort);
      const authFileDir = path.join(projectDir || process.cwd(), '.monomind');
      fs.mkdirSync(authFileDir, { recursive: true });
      // Primary = control.json absent/invalid, or it names this port, or
      // nothing answers on the port it names (stale record from a previous
      // run). Liveness is an HTTP probe, not a pid check — control-start may
      // record pid 0 for adopted servers, and dead pids get recycled; a probe
      // is authoritative either way. Anything answering on the claimed port
      // means "don't clobber" (conservative on ambiguity).
      let primary = true;
      try {
        const ctl = JSON.parse(fs.readFileSync(path.join(authFileDir, 'control.json'), 'utf8'));
        const ctlPort = Number(ctl.port || (String(ctl.url || '').match(/:(\d+)/) || [])[1]);
        if (
          ctlPort &&
          ctlPort !== actualPort &&
          !(Number.isInteger(ctl.pid) && ctl.pid === process.pid)
        ) {
          // A single 800ms probe is not enough evidence to declare the record
          // stale: on a loaded host the primary's event loop can be blocked for
          // seconds (heavy search/KG work, parallel test suites), the probe
          // times out, and a secondary would wrongly claim primary and CLOBBER
          // the live server's token — the exact failure this gate exists to
          // prevent. Retry before concluding "nothing answering" so the gate
          // stays conservative on ambiguity.
          for (let attempt = 0; attempt < 3 && primary; attempt++) {
            try {
              await fetch(`http://127.0.0.1:${ctlPort}/api/status`, {
                signal: AbortSignal.timeout(1500),
              });
              primary = false; // something answered — a live server owns the primary token
            } catch (_) {
              if (attempt < 2) await new Promise((r) => setTimeout(r, 250));
            }
          }
        }
      } catch (_) {
        /* no readable control.json — treat as primary */
      }
      fs.writeFileSync(
        path.join(authFileDir, primary ? 'dashboard-token' : `dashboard-token-${actualPort}`),
        dashboardAuthValue,
        { mode: 0o600 },
      );
      // Sweep stale secondary tokens (dead scratch/test instances) so they
      // don't accumulate as orphaned credential files.
      // monolean: age-based sweep only — no on-exit unlink plumbing.
      try {
        const weekMs = 7 * 24 * 3600 * 1000;
        for (const f of fs.readdirSync(authFileDir)) {
          if (!/^dashboard-token-\d+$/.test(f) || f === `dashboard-token-${actualPort}`) continue;
          const fp = path.join(authFileDir, f);
          if (Date.now() - fs.statSync(fp).mtimeMs > weekMs) fs.unlinkSync(fp);
        }
      } catch (_) {}
    } catch (_) {}
  }
  // Propagate the fresh token to every known project whose control.json points
  // at this server — otherwise each restart silently orphans cross-project
  // callers (their curls/CLI reads a stale token and 401s forever).
  // Called after bind so the match uses the ACTUAL bound port.
  function propagateDashboardToken(actualPort) {
    try {
      const _kpFile = path.join(projectDir || process.cwd(), 'data', 'known-projects.json');
      if (!fs.existsSync(_kpFile)) return;
      for (const _kp of JSON.parse(fs.readFileSync(_kpFile, 'utf8'))) {
        try {
          const _kpMono = path.join(_kp, '.monomind');
          const _kpCtl = JSON.parse(fs.readFileSync(path.join(_kpMono, 'control.json'), 'utf8'));
          // Only pair projects that direct their traffic to this server's port.
          if (_kpCtl && String(_kpCtl.url || '').includes(`:${actualPort}`)) {
            fs.writeFileSync(path.join(_kpMono, 'dashboard-token'), dashboardAuthValue, {
              mode: 0o600,
            });
          }
        } catch (_) {
          /* project missing/unreadable — skip */
        }
      }
    } catch (_) {}
  }

  // Parse a .claude/agents/*.md definition into { name, description, capability{}, document }.
  // Tolerant line-based parse of the YAML frontmatter (expertise / task_types as lists).
  function parseAgentDef(raw) {
    const out = { name: '', description: '', capability: {}, document: '' };
    const fm = String(raw).match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    let front = '',
      body = String(raw);
    if (fm) {
      front = fm[1];
      body = fm[2];
    }
    out.document = body.trim();
    const strip = (s) => s.trim().replace(/^["']|["']$/g, '');
    let inCap = false,
      listKey = null;
    for (const line of front.split('\n')) {
      const top = line.match(/^([a-z_]+):\s*(.*)$/i);
      if (top && !/^\s/.test(line)) {
        inCap = top[1] === 'capability';
        listKey = null;
        if (top[1] === 'name') out.name = strip(top[2]);
        else if (top[1] === 'description') out.description = strip(top[2]);
        continue;
      }
      if (!inCap) continue;
      const li = line.match(/^\s+-\s+(.+)$/);
      if (li && listKey) {
        (out.capability[listKey] = out.capability[listKey] || []).push(strip(li[1]));
        continue;
      }
      const kv = line.match(/^\s+([a-z_]+):\s*(.*)$/i);
      if (kv) {
        if (kv[2].trim() === '') {
          listKey = kv[1];
          out.capability[kv[1]] = out.capability[kv[1]] || [];
        } else {
          listKey = null;
          out.capability[kv[1]] = strip(kv[2]);
        }
      }
    }
    return out;
  }

  // ── handleMastermindEvent ─────────────────────────────────────────────────
  // Extracted from the request dispatcher to reduce cyclomatic complexity.
  // Handles POST /api/mastermind/event: parses body, enriches with runId/session,
  // persists to JSONL files, broadcasts to SSE clients, returns {ok:true}.
  async function handleMastermindEvent(req, res, corsOrigin) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 2097152) {
        req.destroy();
        break;
      }
    }
    let event = {};
    try {
      event = JSON.parse(body);
    } catch (_) {}
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
          // Usage accumulation — persist per-role token/cost data to state.json (accumulated
          // across runs). Real producers emit two distinct shapes and both must be handled:
          //  - 'agent:usage': flattened { role, tokens_in, tokens_out, cost_usd } (legacy/direct).
          //  - 'org:usage': orgrt's actual forwarded shape (attachForwarder's translate(), the
          //    default case for a raw OrgBus 'usage' event) — { from, data: { tokens, cost_usd } }.
          //    orgrt never emits 'agent:usage' itself, so without this branch real v2 cost data
          //    never reaches state.json even though the UI displays it as if it did.
          const _usageRole =
            event.type === 'agent:usage'
              ? event.role
              : event.type === 'org:usage'
                ? event.from
                : null;
          if (_usageRole) {
            try {
              const _arole = String(_usageRole).trim();
              if (
                _arole.length > 0 &&
                _arole.length <= 64 &&
                /^[a-z0-9][a-z0-9_-]*$/i.test(_arole)
              ) {
                const _stateFile = path.join(root, '.monomind', 'orgs', `${_orn}-state.json`);
                let _st = {};
                try {
                  _st = JSON.parse(fs.readFileSync(_stateFile, 'utf8'));
                } catch (_e) {}
                if (!_st.agents) _st.agents = {};
                const _ex = _st.agents[_arole] || {};
                const _tokensIn = event.type === 'agent:usage' ? Number(event.tokens_in) || 0 : 0;
                const _tokensOut = event.type === 'agent:usage' ? Number(event.tokens_out) || 0 : 0;
                // 'org:usage' carries a single total (data.tokens), not an in/out split —
                // counted toward tokens_used so the budget total still reflects it honestly.
                const _tokensTotal =
                  event.type === 'org:usage' ? Number(event.data?.tokens) || 0 : 0;
                const _costUsd =
                  event.type === 'agent:usage'
                    ? Number(event.cost_usd) || 0
                    : Number(event.data?.cost_usd) || 0;
                _st.agents[_arole] = {
                  ..._ex,
                  tokens_in: (_ex.tokens_in || 0) + _tokensIn,
                  tokens_out: (_ex.tokens_out || 0) + _tokensOut,
                  tokens_used: (_ex.tokens_used || 0) + _tokensIn + _tokensOut + _tokensTotal,
                  total_cost_usd: (_ex.total_cost_usd || 0) + _costUsd,
                  lastUpdated: event.ts,
                };
                fs.writeFileSync(_stateFile, JSON.stringify(_st, null, 2));
              }
            } catch (_e) {}
          }
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
        for (const _fwdClient of _fwdClients) {
          try {
            _fwdClient.write(_fwdLine);
          } catch (_) {
            _fwdClients.delete(_fwdClient);
          }
        }
      }
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
    });
    res.end('{"ok":true}');
  }

  // ── Security: shared auth check, reused below for non-GET routes and for
  // the handful of GET routes that return sensitive data (full session
  // transcripts, cost/usage data) rather than UI chrome. Defined once here
  // (not per-request inside the request handler below) since both only
  // close over per-server-start state (dashboardAuthValue) plus their
  // explicit req/res/corsOrigin params. ──────────────────────────────────
  // ── Second Brain warm bridge: lazy singleton import of the compiled memory
  // bridge (loads the local embedding model once for the server's lifetime).
  // Boot-warmed below only when this project actually has a knowledge base.
  let _knowledgeBridgePromise = null;
  const _getKnowledgeBridge = () => {
    if (!_knowledgeBridgePromise) {
      _knowledgeBridgePromise = import('../memory/memory-bridge.js').catch((err) => {
        _knowledgeBridgePromise = null; // allow retry on next request
        if (process.env.MONOMIND_DEBUG)
          console.error('[knowledge] bridge import failed:', err.message);
        return null;
      });
    }
    return _knowledgeBridgePromise;
  };
  try {
    if (
      fs.existsSync(
        path.join(projectDir || process.cwd(), '.monomind', 'knowledge', 'chunks.jsonl'),
      )
    ) {
      // Warm off the startup path: first hook request should hit a hot model.
      const _warmTimer = setTimeout(() => {
        _getKnowledgeBridge()
          .then((b) =>
            b?.bridgeSearchEntries?.({ query: 'warmup', namespace: 'knowledge:shared', limit: 1 }),
          )
          .catch(() => {
            /* warm-up is best-effort */
          });
      }, 3000);
      if (_warmTimer.unref) _warmTimer.unref();

      // ── Second Brain live ingestion ──────────────────────────────────
      // This server is the one long-lived local process AND holds the warm
      // embedding model — so it watches for document changes and ingests
      // in-process within seconds, instead of waiting for the next session
      // start. Best-effort: recursive fs.watch is unsupported on some
      // platforms/volumes; the session-start reindex remains the backstop.
      try {
        const _sbDocExts = new Set(['.md', '.txt', '.pdf', '.docx']);
        const _sbSkip =
          /(^|\/)(node_modules|\.git|dist|\.monomind|\.claude|\.next|__pycache__|\.venv|vendor)(\/|$)/;
        const _sbPending = new Map(); // file -> debounce timer
        const _sbRoot = path.resolve(projectDir || process.cwd());
        const _sbWatcher = fs.watch(_sbRoot, { recursive: true }, (_evt, rel) => {
          try {
            if (!rel) return;
            const relStr = String(rel);
            // Skip macOS AppleDouble resource forks (`._name`) at any depth.
            // The old `relStr.startsWith('.')` only caught dotfiles at the ROOT;
            // `._` forks in subdirectories sailed through. We match `._` per path
            // segment rather than all dotfiles — `.monodesign/` critique snapshots
            // are legitimate indexable documents.
            if (_sbSkip.test(relStr) || /(^|\/)\._./.test(relStr)) return;
            if (!_sbDocExts.has(path.extname(relStr).toLowerCase())) return;
            const full = path.join(_sbRoot, relStr);
            clearTimeout(_sbPending.get(full));
            _sbPending.set(
              full,
              setTimeout(async () => {
                _sbPending.delete(full);
                try {
                  if (!fs.existsSync(full)) return; // deleted — session-start reindex handles removal
                  const pipeline = await import('../knowledge/document-pipeline.js');
                  const r = await pipeline.ingestDocument(full, 'shared', _sbRoot);
                  if (r.chunksIndexed > 0 && !r.skipped) {
                    console.log(
                      `[knowledge] live-ingested ${path.basename(full)} (${r.chunksIndexed} chunks)`,
                    );
                  }
                } catch (_) {
                  /* single-file ingest failure never matters here */
                }
              }, 5000),
            );
          } catch (_) {
            /* watcher callback must never throw */
          }
        });
        activeWatchers.push(_sbWatcher);
      } catch (_) {
        /* recursive watch unavailable — the sweep below still covers it */
      }

      // Polling sweep backstop: fs.watch/fsevents silently stops delivering on
      // some volumes (exFAT/SMB — exactly where many projects live). Every 60s,
      // a bounded mtime walk ingests anything the watcher missed. Stat-only
      // when nothing changed; skips while a sweep is already running.
      try {
        const _sbDocExts2 = new Set(['.md', '.txt', '.pdf', '.docx']);
        const _sbSkipDirs = new Set([
          'node_modules',
          '.git',
          'dist',
          '.monomind',
          '.claude',
          '.next',
          '__pycache__',
          '.venv',
          'vendor',
        ]);
        const _sbSweepRoot = path.resolve(projectDir || process.cwd());
        let _sbLastSweep = Date.now();
        let _sbSweeping = false;
        const _sbSweepTimer = setInterval(async () => {
          if (_sbSweeping) return;
          _sbSweeping = true;
          const since = _sbLastSweep - 5000; // small overlap so boundary writes aren't missed
          _sbLastSweep = Date.now();
          try {
            const changed = [];
            let scanned = 0;
            const walk = (dir, depth) => {
              if (depth > 4 || scanned > 3000 || changed.length >= 20) return;
              let names;
              try {
                names = fs.readdirSync(dir, { withFileTypes: true });
              } catch (_) {
                return;
              }
              for (const ent of names) {
                if (scanned++ > 3000 || changed.length >= 20) return;
                if (ent.name.startsWith('.') || _sbSkipDirs.has(ent.name)) continue;
                const full = path.join(dir, ent.name);
                if (ent.isDirectory()) {
                  walk(full, depth + 1);
                  continue;
                }
                if (!_sbDocExts2.has(path.extname(ent.name).toLowerCase())) continue;
                try {
                  if (fs.statSync(full).mtimeMs > since) changed.push(full);
                } catch (_) {}
              }
            };
            walk(_sbSweepRoot, 0);
            if (changed.length) {
              const pipeline = await import('../knowledge/document-pipeline.js');
              for (const f of changed) {
                try {
                  const r = await pipeline.ingestDocument(f, 'shared', _sbSweepRoot);
                  if (r.chunksIndexed > 0 && !r.skipped)
                    console.log(
                      `[knowledge] sweep-ingested ${path.basename(f)} (${r.chunksIndexed} chunks)`,
                    );
                } catch (_) {
                  /* per-file failures never matter here */
                }
              }
            }
          } catch (_) {
            /* sweep is best-effort */
          } finally {
            _sbSweeping = false;
          }
        }, 60_000);
        if (_sbSweepTimer.unref) _sbSweepTimer.unref();
        activeWatchers.push({ close: () => clearInterval(_sbSweepTimer) });
      } catch (_) {
        /* non-fatal */
      }
    }
  } catch (_) {
    /* non-fatal */
  }

  const _checkAuth = (req) => {
    let _suppliedAuth = req.headers['x-monomind-token'] || '';
    if (!_suppliedAuth) {
      try {
        _suppliedAuth = new URL(req.url, 'http://localhost').searchParams.get('token') || '';
      } catch (_) {}
    }
    const _suppliedAuthBuf = Buffer.from(String(_suppliedAuth));
    const _expectedAuthBuf = Buffer.from(dashboardAuthValue);
    return (
      _suppliedAuthBuf.length === _expectedAuthBuf.length &&
      crypto.timingSafeEqual(_suppliedAuthBuf, _expectedAuthBuf)
    );
  };
  const _sendUnauthorized = (res, corsOrigin) => {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
    });
    res.end(JSON.stringify({ error: 'Unauthorized: missing or invalid auth token' }));
  };
  // Page-bootstrap and static-asset routes that stay open — everything else
  // (all of /api/*, GET or not) requires _checkAuth. These serve the HTML/JS
  // that embeds the token in a <meta name="mm-token"> tag on page load, so
  // they must be reachable before any fetch() call could attach the token.
  const _OPEN_ROUTES = new Set([
    '/',
    '/v2',
    '/mastermind',
    '/orgs',
    '/orgs-files.js',
    '/markdown.js',
    '/favicon.ico',
  ]);
  const _isOpenRoute = (url, method) =>
    (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') &&
    (_OPEN_ROUTES.has(url) ||
      /^\/data\/avatars\/[A-Za-z0-9._-]+\.svg$/.test(url) ||
      // The browser hits this directly via monoes.me's OAuth redirect — it
      // never has this dashboard's own auth token to attach. Protected
      // instead by the OAuth `state` parameter (routes-monoes.mjs rejects
      // any code/state pair it didn't itself generate).
      url.startsWith('/api/monoes/callback'));

  const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];

    // ── Security: DNS-rebinding defence (see isAllowedHost) ─────────────────
    // Must run before ANY route — including the open ones, since GET / is what
    // hands out the auth token. Fails closed with a bare 403 and no CORS header.
    if (!isAllowedHost(req.headers.host, _allowedHosts)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(
        'Forbidden: Host header is not a loopback address. ' +
          'Set MONOMIND_DASHBOARD_ALLOWED_HOSTS to permit another host name.\n',
      );
      return;
    }

    // ── Security: strict CORS allow-list ────────────────────────────────────
    // Only reflect Origin when it is this dashboard's own loopback origin.
    // Otherwise the header is omitted entirely, so cross-origin reads fail
    // closed rather than defaulting to '*'.
    const _reqOrigin = req.headers.origin || '';
    const _boundPortForCors = currentPort || boundPort || port;
    const _allowedOrigins = new Set([
      `http://localhost:${_boundPortForCors}`,
      `http://127.0.0.1:${_boundPortForCors}`,
    ]);
    const corsOrigin = _allowedOrigins.has(_reqOrigin) ? _reqOrigin : undefined;

    // ── Security: default-closed for /api/* — every API route requires the
    // auth token, GET or not. Only the page-bootstrap and static-asset
    // routes below stay open (they serve the HTML/JS that embeds the token
    // in the first place, before any fetch() call could attach it).
    // Gating individual GET routes by name (tried first) left real gaps
    // across two independent review passes — session-journal,
    // search-sessions, project-costs, org threads/budgets/runs, several SSE
    // streams, and more all returned session/cost/secret-adjacent data
    // unauthenticated. Default-deny is the only version of this fix that
    // doesn't silently miss a route.
    if (!_isOpenRoute(url, req.method)) {
      if (!_checkAuth(req)) {
        _sendUnauthorized(res, corsOrigin);
        return;
      }
    }

    // ------------------------------------------------------------------ GET /
    if (req.method === 'GET' && url === '/') {
      const htmlPath = path.join(__dirname, 'dashboard.html');
      try {
        let html = fs.readFileSync(htmlPath, 'utf8');
        // Inject this process's auth credential so the page's own fetch() calls can
        // attach it (see the fetch-wrapper near the top of dashboard.html's <script>
        // block) — every non-GET route above requires it, but the served HTML was
        // previously never given a way to know it, so every write action 401'd from
        // the actual browser UI.
        html = html.replace(
          '<head>',
          `<head>\n<meta name="mm-token" content="${dashboardAuthValue}">`,
        );
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        });
        res.end(html);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Failed to load dashboard.html: ${err.message}`);
      }
      return;
    }

    // ------------------------------------------------ GET /markdown.js
    // Markdown renderer, split out of dashboard.html (#124) — same pattern
    // as GET /orgs-files.js in routes-org.mjs (a sibling asset served via
    // its own hardcoded route, not a generic static-file handler). Must be
    // in _OPEN_ROUTES above: dashboard.html's own <script src="markdown.js">
    // request happens before the page has the auth token to attach.
    if (req.method === 'GET' && url === '/markdown.js') {
      try {
        const jsPath = path.join(__dirname, 'markdown.js');
        const js = fs.readFileSync(jsPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(js);
      } catch (err) {
        res.writeHead(404);
        res.end(`markdown.js not found: ${err.message}`);
      }
      return;
    }

    // ------------------------------------------------- GET /data/avatars/*.svg (agent avatars)
    if (req.method === 'GET' && /^\/data\/avatars\/[A-Za-z0-9._-]+\.svg$/.test(url)) {
      try {
        const name = path.basename(decodeURIComponent(url));
        if (!/^[A-Za-z0-9._-]+\.svg$/.test(name) || name.includes('..')) {
          res.writeHead(400);
          res.end();
          return;
        }
        const avatarsDir = path.join(__dirname, 'data', 'avatars');
        const filePath = path.join(avatarsDir, name);
        if (!filePath.startsWith(avatarsDir + path.sep) || !fs.existsSync(filePath)) {
          res.writeHead(404);
          res.end();
          return;
        }
        const svg = fs.readFileSync(filePath);
        res.writeHead(200, {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
        });
        res.end(svg);
      } catch (_) {
        res.writeHead(404);
        res.end();
      }
      return;
    }

    // ----------------------------------------------------------------- GET /v2 (alias → /)
    if (req.method === 'GET' && url === '/v2') {
      res.writeHead(301, { Location: '/' });
      res.end();
      return;
    }

    // --------------------------------------------------------- GET /api/git-user
    if (req.method === 'GET' && url === '/api/git-user') {
      try {
        const { execSync: gitExec } = await import('node:child_process');
        const cwd = projectDir || process.cwd();
        const name = gitExec('git config user.name', { cwd, encoding: 'utf8' }).trim();
        const email = gitExec('git config user.email', { cwd, encoding: 'utf8' }).trim();
        let remoteUrl = '';
        try {
          remoteUrl = gitExec('git remote get-url origin', { cwd, encoding: 'utf8' }).trim();
        } catch {}
        // Normalise SSH remote to HTTPS URL for browser linking
        if (remoteUrl.startsWith('git@')) {
          remoteUrl = remoteUrl.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '');
        } else if (remoteUrl.endsWith('.git')) {
          remoteUrl = remoteUrl.slice(0, -4);
        }
        let branch = '';
        try {
          branch = gitExec('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim();
        } catch {}
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ name, email, cwd, remoteUrl, branch }));
      } catch (_) {
        const cwd2 = projectDir || process.cwd();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ name: '', email: '', cwd: cwd2, remoteUrl: '', branch: '' }));
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
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
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
        // Security: validate that the requested file stays within this Claude
        // Code install's session-transcript store. The dashboard legitimately
        // browses sessions across multiple projects (see the projectsBase glob
        // above), so this is scoped to ~/.claude/projects rather than the full
        // home directory — narrow enough that ?file=/etc/passwd or a sibling
        // dir under $HOME can't be read, wide enough for real usage.
        const _resolvedFile = path.resolve(file);
        const _sessionsRoot = path.join(os.homedir(), '.claude', 'projects');
        // Bare-prefix check (no path.sep) is bypassable: a sibling dir name that
        // happens to start with the same string would pass a naive startsWith.
        // Require the separator (or exact equality to the root itself) so only
        // true descendants pass.
        if (
          _resolvedFile !== _sessionsRoot &&
          !_resolvedFile.startsWith(_sessionsRoot + path.sep)
        ) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ error: 'Access denied: file must be within ~/.claude/projects' }),
          );
          return;
        }
        // Only allow JSONL files (session logs).
        if (!_resolvedFile.endsWith('.jsonl')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access denied: only .jsonl files are permitted' }));
          return;
        }
        const raw = fs.readFileSync(_resolvedFile, 'utf8');
        const allLines = raw.split('\n').filter(Boolean);
        const lines = allLines.slice(-limit);
        const events = parseSessionLines(lines);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
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
        const slug = pathToSlug(d);
        const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);

        let sessionFiles = [];
        try {
          sessionFiles = fs
            .readdirSync(projectClaudeDir)
            .filter((f) => f.endsWith('.jsonl') && !f.startsWith('._'))
            .map((f) => {
              try {
                return { f, mtime: fs.statSync(path.join(projectClaudeDir, f)).mtimeMs };
              } catch {
                return null;
              }
            })
            .filter(Boolean)
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 50);
        } catch {}

        const sessions = [];
        for (const { f, mtime } of sessionFiles) {
          const fp = path.join(projectClaudeDir, f);
          const id = f.replace('.jsonl', '');
          let lastPrompt = '',
            summaries = [],
            totalDurationMs = 0,
            totalMessages = 0,
            firstTs = null,
            lastTs = null,
            totalCost = 0,
            toolCalls = 0,
            userMessages = 0,
            cacheReadTokens = 0,
            totalInputTokens = 0,
            errorCount = 0;
          const modelBreakdown = {};
          const unknownPricingModels = new Set();
          const filesTouchedSet = new Set();
          try {
            const lines = _readTailLines(fp);
            let pendingCompact = false;
            for (const line of lines) {
              let e;
              try {
                e = JSON.parse(line);
              } catch {
                continue;
              }
              if (e.timestamp) {
                if (!firstTs) firstTs = e.timestamp;
                lastTs = e.timestamp;
              }
              if (e.type === 'last-prompt' && e.lastPrompt) lastPrompt = e.lastPrompt;
              if (e.type === 'user') {
                userMessages++;
                for (const b of e.message?.content || []) {
                  if (b && b.type === 'tool_result' && b.is_error) errorCount++;
                }
              }
              if (e.type === 'system' && e.subtype === 'compact_boundary') pendingCompact = true;
              if (pendingCompact && e.type === 'user') {
                const msg = e.message || {};
                const ct = msg.content || [];
                let text = '';
                if (Array.isArray(ct)) {
                  for (const b of ct) {
                    if (b && b.type === 'text') {
                      text = b.text;
                      break;
                    }
                  }
                } else if (typeof ct === 'string') text = ct;
                const m = text.match(/Summary:\s*([\s\S]+)/);
                if (m) summaries.push({ ts: e.timestamp, text: m[1].trim() });
                pendingCompact = false;
              }
              if (e.type === 'assistant') {
                const msg = e.message || {};
                for (const block of msg.content || []) {
                  if (block && block.type === 'tool_use') {
                    toolCalls++;
                    if (
                      ['Write', 'Edit', 'Read', 'MultiEdit'].includes(block.name) &&
                      block.input?.file_path
                    ) {
                      filesTouchedSet.add(path.basename(block.input.file_path));
                    }
                  }
                }
                if (msg.usage && msg.model) {
                  const c = _sjCalcCost(msg.model, msg.usage);
                  totalCost += c;
                  const mk = msg.model.replace(/@.*$/, '').replace(/-\d{8}$/, '');
                  if (!modelBreakdown[mk]) modelBreakdown[mk] = { calls: 0, cost: 0 };
                  modelBreakdown[mk].calls++;
                  modelBreakdown[mk].cost += c;
                  // A model absent from the pricing table contributes 0 to the sum. Flag it
                  // instead of letting the UI render an authoritative-looking $0.00.
                  if (!_sjHasPricing(msg.model)) {
                    modelBreakdown[mk].unknownPricing = true;
                    unknownPricingModels.add(mk);
                  }
                  cacheReadTokens += msg.usage.cache_read_input_tokens || 0;
                  totalInputTokens +=
                    (msg.usage.input_tokens || 0) +
                    (msg.usage.cache_creation_input_tokens || 0) +
                    (msg.usage.cache_read_input_tokens || 0);
                }
              }
              if (e.type === 'system' && e.subtype === 'turn_duration') {
                totalDurationMs += e.durationMs || 0;
                if ((e.messageCount || 0) > totalMessages) totalMessages = e.messageCount;
              }
            }
          } catch {}
          const filesTouched = [...filesTouchedSet].slice(0, 20);
          const compactCount = summaries.length;
          const summary = summaries.length ? summaries[summaries.length - 1].text : null;
          // costIncomplete => totalCost is a LOWER BOUND: at least one model had no
          // pricing row, so its spend is missing from the sum entirely.
          sessions.push({
            id,
            mtime,
            firstTs,
            lastTs,
            lastPrompt,
            summaries,
            summary,
            compactCount,
            errorCount,
            totalDurationMs,
            totalMessages,
            totalCost,
            costIncomplete: unknownPricingModels.size > 0,
            unknownPricingModels: [...unknownPricingModels],
            toolCalls,
            userMessages,
            cacheReadTokens,
            totalInputTokens,
            modelBreakdown,
            filesTouched,
            file: fp,
          });
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ sessions }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/search-sessions
    if (req.method === 'GET' && url === '/api/search-sessions') {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || '';
      const q = (qs.get('q') || '').toLowerCase().trim();
      if (!q || q.length < 2) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ results: [] }));
        return;
      }
      try {
        const d = path.resolve(dir || process.cwd());
        const slug = pathToSlug(d);
        const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
        let sessionFiles = [];
        try {
          sessionFiles = fs
            .readdirSync(projectClaudeDir)
            .filter((f) => f.endsWith('.jsonl') && !f.startsWith('._'))
            .map((f) => {
              try {
                return { f, mtime: fs.statSync(path.join(projectClaudeDir, f)).mtimeMs };
              } catch {
                return null;
              }
            })
            .filter(Boolean)
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 20);
        } catch {}
        const results = [];
        for (const { f, mtime } of sessionFiles) {
          const fp = path.join(projectClaudeDir, f);
          const id = f.replace('.jsonl', '');
          let lastPrompt = '';
          const matches = [];
          try {
            const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
            for (const line of lines) {
              let e;
              try {
                e = JSON.parse(line);
              } catch {
                continue;
              }
              if (e.type === 'last-prompt' && e.lastPrompt) lastPrompt = e.lastPrompt;
              if (e.type === 'user') {
                const msg = e.message || {};
                const ct = msg.content || [];
                let text = '';
                if (Array.isArray(ct)) {
                  for (const b of ct) {
                    if (b && b.type === 'text') {
                      text = b.text;
                      break;
                    }
                  }
                } else if (typeof ct === 'string') text = ct;
                if (text.toLowerCase().includes(q))
                  matches.push({ text: text.slice(0, 150), ts: e.timestamp });
              }
              if (matches.length >= 3) break;
            }
          } catch {}
          if (matches.length) results.push({ id, file: fp, lastPrompt, mtime, matches });
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ results, q }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/recent-events
    if (req.method === 'GET' && url === '/api/recent-events') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const limit = Math.min(parseInt(qs.get('limit') || '50', 10), 200);
        const d = path.resolve(dir || process.cwd());
        const slug = pathToSlug(d);
        const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
        let sessionFiles = [];
        try {
          sessionFiles = fs
            .readdirSync(projectClaudeDir)
            .filter((f) => f.endsWith('.jsonl') && !f.startsWith('._'))
            .map((f) => {
              try {
                return { f, mtime: fs.statSync(path.join(projectClaudeDir, f)).mtimeMs };
              } catch {
                return null;
              }
            })
            .filter(Boolean)
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 5); // check last 5 sessions
        } catch {}

        const events = [];
        const HOOK_RE = /^<(local-command-|command-name>|command-message>)/;
        for (const { f } of sessionFiles) {
          const fp = path.join(projectClaudeDir, f);
          const sessId = f.replace('.jsonl', '');
          try {
            const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean).slice(-200);
            for (const line of lines) {
              let e;
              try {
                e = JSON.parse(line);
              } catch {
                continue;
              }
              if (e.type === 'assistant') {
                const content = e.message?.content || [];
                for (const block of content) {
                  if (block?.type === 'tool_use') {
                    events.push({
                      kind: 'tool',
                      ts: e.timestamp,
                      tool: block.name,
                      session: sessId,
                    });
                  }
                }
              } else if (e.type === 'user') {
                const content = e.message?.content || [];
                for (const block of content) {
                  if (
                    block?.type === 'text' &&
                    block.text?.trim() &&
                    !HOOK_RE.test(block.text.trim())
                  ) {
                    events.push({
                      kind: 'user',
                      ts: e.timestamp,
                      text: block.text.slice(0, 120),
                      session: sessId,
                    });
                  }
                }
              }
            }
          } catch {}
        }

        // sort by ts desc, take limit
        events.sort((a, b) => {
          const ta = a.ts ? new Date(a.ts).getTime() : 0;
          const tb = b.ts ? new Date(b.ts).getTime() : 0;
          return tb - ta;
        });

        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ events: events.slice(0, limit) }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/tool-errors
    if (req.method === 'GET' && url === '/api/tool-errors') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const slug = pathToSlug(d);
        const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
        let sessionFiles = [];
        try {
          sessionFiles = fs
            .readdirSync(projectClaudeDir)
            .filter((f) => f.endsWith('.jsonl') && !f.startsWith('._'))
            .map((f) => {
              try {
                return { f, mtime: fs.statSync(path.join(projectClaudeDir, f)).mtimeMs };
              } catch {
                return null;
              }
            })
            .filter(Boolean)
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 10);
        } catch {}
        // tool_use id → name map, then count is_error:true tool_result per tool name
        const errorCounts = {},
          totalCounts = {};
        for (const { f } of sessionFiles) {
          const fp = path.join(projectClaudeDir, f);
          try {
            const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
            const toolIdMap = {};
            for (const line of lines) {
              let e;
              try {
                e = JSON.parse(line);
              } catch {
                continue;
              }
              if (e.type === 'assistant') {
                for (const b of e.message?.content || []) {
                  if (b && b.type === 'tool_use') {
                    toolIdMap[b.id] = b.name;
                    totalCounts[b.name] = (totalCounts[b.name] || 0) + 1;
                  }
                }
              }
              if (e.type === 'user') {
                for (const b of e.message?.content || []) {
                  if (b && b.type === 'tool_result' && b.is_error) {
                    const name = toolIdMap[b.tool_use_id] || '?';
                    errorCounts[name] = (errorCounts[name] || 0) + 1;
                  }
                }
              }
            }
          } catch {}
        }
        const errors = Object.entries(errorCounts)
          .map(([tool, count]) => ({ tool, count, total: totalCounts[tool] || count }))
          .sort((a, b) => b.count - a.count);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ errors }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/tool-ranking
    if (req.method === 'GET' && url === '/api/tool-ranking') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const slug = pathToSlug(d);
        const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
        let sessionFiles = [];
        try {
          sessionFiles = fs
            .readdirSync(projectClaudeDir)
            .filter((f) => f.endsWith('.jsonl') && !f.startsWith('._'))
            .map((f) => {
              try {
                return { f, mtime: fs.statSync(path.join(projectClaudeDir, f)).mtimeMs };
              } catch {
                return null;
              }
            })
            .filter(Boolean)
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 30);
        } catch {}
        const toolCounts = {},
          errorCounts = {};
        for (const { f } of sessionFiles) {
          const fp = path.join(projectClaudeDir, f);
          try {
            const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
            const toolIdMap = {};
            for (const line of lines) {
              let e;
              try {
                e = JSON.parse(line);
              } catch {
                continue;
              }
              if (e.type === 'assistant') {
                for (const b of e.message?.content || []) {
                  if (b && b.type === 'tool_use') {
                    toolIdMap[b.id] = b.name;
                    toolCounts[b.name] = (toolCounts[b.name] || 0) + 1;
                  }
                }
              }
              if (e.type === 'user') {
                for (const b of e.message?.content || []) {
                  if (b && b.type === 'tool_result' && b.is_error) {
                    const name = toolIdMap[b.tool_use_id] || '?';
                    errorCounts[name] = (errorCounts[name] || 0) + 1;
                  }
                }
              }
            }
          } catch {}
        }
        const tools = Object.entries(toolCounts)
          .map(([tool, count]) => ({ tool, count, errors: errorCounts[tool] || 0 }))
          .sort((a, b) => b.count - a.count);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ tools }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/project-costs
    if (req.method === 'GET' && url === '/api/project-costs') {
      try {
        const projectsBase = path.join(os.homedir(), '.claude', 'projects');
        let slugDirs = [];
        try {
          slugDirs = fs
            .readdirSync(projectsBase, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
        } catch {}
        const projectCosts = [];
        for (const slug of slugDirs) {
          const projDir = path.join(projectsBase, slug);
          const projPath = resolveSlugToPath(slug, projDir);
          let sessionFiles = [];
          try {
            sessionFiles = fs
              .readdirSync(projDir)
              .filter((f) => f.endsWith('.jsonl') && !f.startsWith('._'))
              .map((f) => path.join(projDir, f));
          } catch {}
          if (!sessionFiles.length) continue;
          let totalCost = 0;
          const unknownPricingModels = new Set();
          for (const fp of sessionFiles) {
            try {
              const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
              for (const line of lines) {
                let e;
                try {
                  e = JSON.parse(line);
                } catch {
                  continue;
                }
                if (e.type === 'assistant' && e.message?.usage) {
                  const _m = e.message.model || '';
                  totalCost += _sjCalcCost(_m, e.message.usage);
                  if (!_sjHasPricing(_m))
                    unknownPricingModels.add(_m.replace(/@.*$/, '').replace(/-\d{8}$/, ''));
                }
              }
            } catch {}
          }
          // Include projects whose entire spend is on unpriced models — previously they
          // were dropped by `totalCost > 0` and simply vanished from the cost list.
          if (totalCost > 0 || unknownPricingModels.size > 0) {
            projectCosts.push({
              path: projPath,
              cost: totalCost,
              sessions: sessionFiles.length,
              costIncomplete: unknownPricingModels.size > 0,
              unknownPricingModels: [...unknownPricingModels],
            });
          }
        }
        projectCosts.sort((a, b) => b.cost - a.cost);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ projects: projectCosts }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/projects
    if (req.method === 'GET' && url === '/api/projects') {
      try {
        const projectsBase = path.join(os.homedir(), '.claude', 'projects');
        let slugDirs = [];
        try {
          slugDirs = fs
            .readdirSync(projectsBase, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
        } catch {}
        const projects = slugDirs
          .map((slug) => {
            const projDir = path.join(projectsBase, slug);
            const projPath = resolveSlugToPath(slug, projDir);
            const name = path.basename(projPath) || slug.split('-').filter(Boolean).pop() || slug;
            let sessionCount = 0;
            let lastActivity = 0;
            let memoryCount = 0;
            try {
              const files = fs
                .readdirSync(projDir)
                .filter((f) => f.endsWith('.jsonl') && !f.startsWith('._'));
              sessionCount = files.length;
              for (const f of files) {
                try {
                  const st = fs.statSync(path.join(projDir, f));
                  if (st.mtimeMs > lastActivity) lastActivity = st.mtimeMs;
                } catch {}
              }
            } catch {}
            try {
              const memDir = path.join(projDir, 'memory');
              memoryCount = fs
                .readdirSync(memDir)
                .filter((f) => f.endsWith('.md') && f !== 'MEMORY.md').length;
            } catch {}
            return {
              slug,
              path: projPath,
              name,
              sessionCount,
              memoryCount,
              lastActivity: lastActivity || null,
            };
          })
          .filter((p) => p.sessionCount > 0 || fs.existsSync(path.join(p.path, '.monomind')))
          .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ projects }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/global-docs
    // Lists mastermind-generated markdown documents across ALL known projects,
    // plus the global brain. Returns metadata only — content is fetched
    // on demand via /api/global-doc/read. Ordered by mtime (newest first)
    // by the caller; the server returns enough fields for the client to sort
    // and group either way.
    if (req.method === 'GET' && url.startsWith('/api/global-docs')) {
      try {
        // 1. Gather candidate project roots: every project the dashboard
        //    knows about (from ~/.claude/projects) + the global brain dir.
        const projectsBase = path.join(os.homedir(), '.claude', 'projects');
        const roots = [];
        try {
          for (const slug of fs.readdirSync(projectsBase)) {
            const projDir = path.join(projectsBase, slug);
            if (!fs.statSync(projDir).isDirectory()) continue;
            const resolved = resolveSlugToPath(slug, projDir);
            if (resolved && fs.existsSync(resolved)) roots.push(resolved);
          }
        } catch {
          /* projects tree absent — fine */
        }
        const globalBrain =
          process.env.MONOMIND_GLOBAL_BRAIN_DIR ||
          path.join(os.homedir(), '.monomind', 'global-brain');
        if (fs.existsSync(globalBrain)) roots.push(globalBrain);

        // 2. Per-root, scan the known mastermind output directories.
        //    Order in this array is the category-priority order used when
        //    no doc-specific category is inferable from the filename.
        const DOC_DIRS = [
          { sub: ['docs', 'mastermind', 'plans'], category: 'plan' },
          { sub: ['docs', 'mastermind', 'specs'], category: 'spec' },
          { sub: ['docs', 'mastermind', 'reviews'], category: 'review' },
          { sub: ['docs', 'mastermind', 'reports'], category: 'report' },
          { sub: ['docs', 'mastermind', 'wiki'], category: 'wiki' },
          { sub: ['docs', 'mastermind', 'decisions'], category: 'decision' },
          { sub: ['docs', 'mastermind', 'ideas'], category: 'idea' },
          { sub: ['docs', 'mastermind', 'improvements'], category: 'improvement' },
          { sub: ['docs', 'mastermind', 'tasks'], category: 'task' },
          { sub: ['docs', 'mastermind'], category: 'mastermind' },
          { sub: ['docs', 'improvements'], category: 'improvement' },
          { sub: ['docs', 'ideas'], category: 'idea' },
          { sub: ['docs', 'tasks'], category: 'task' },
          { sub: ['docs', 'adrs'], category: 'decision' },
          { sub: ['docs', 'specs'], category: 'spec' },
          { sub: ['docs', 'reviews'], category: 'review' },
          { sub: ['docs', 'plans'], category: 'plan' },
          { sub: ['docs', 'reports'], category: 'report' },
          { sub: ['docs', 'decisions'], category: 'decision' },
          { sub: ['docs', 'wiki'], category: 'wiki' },
        ];

        const seen = new Set(); // dedupe by absolute path
        const docs = [];
        for (const root of roots) {
          for (const { sub, category } of DOC_DIRS) {
            const dir = path.join(root, ...sub);
            if (!fs.existsSync(dir)) continue;
            let files = [];
            try {
              files = fs.readdirSync(dir);
            } catch {
              continue;
            }
            for (const fname of files) {
              if (!fname.endsWith('.md') || fname.startsWith('._')) continue;
              const fullPath = path.join(dir, fname);
              let st;
              try {
                st = fs.statSync(fullPath);
              } catch {
                continue;
              }
              if (!st.isFile()) continue;
              if (seen.has(fullPath)) continue;
              seen.add(fullPath);
              // Pull the first H1 (or first non-empty line) as the title.
              let title = fname.replace(/\.md$/i, '');
              let preview = '';
              try {
                const raw = fs.readFileSync(fullPath, 'utf8').slice(0, 4000);
                const h1 = raw.match(/^#\s+(.+)$/m);
                if (h1) title = h1[1].trim();
                // First non-heading, non-frontmatter paragraph as a preview.
                preview = raw
                  .replace(/^---[\s\S]*?---/, '')
                  .split('\n')
                  .map((l) => l.trim())
                  .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^[<|!]/.test(l))
                  .slice(0, 1)
                  .join(' ')
                  .slice(0, 180);
              } catch {
                /* unreadable — keep defaults */
              }
              docs.push({
                path: fullPath,
                project:
                  root === globalBrain
                    ? 'Global Brain'
                    : root.split('/').filter(Boolean).pop() || root,
                projectPath: root,
                category,
                filename: fname,
                title,
                preview,
                sizeBytes: st.size,
                mtime: st.mtimeMs,
                date: new Date(st.mtimeMs).toISOString(),
              });
            }
          }
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ docs }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/global-doc/read
    // Returns the raw markdown body of a single doc. The `path` query param
    // must resolve to a file under one of the project roots or the global
    // brain — anything else is rejected with 403 to avoid an arbitrary-file-read.
    if (req.method === 'GET' && url.startsWith('/api/global-doc/read')) {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const target = qs.get('path');
        if (!target || typeof target !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'path query param required' }));
          return;
        }
        let resolved = path.resolve(target);
        // Resolve symlinks so the containment check can't be bypassed by a
        // symlink that lexically sits inside an allowed root but physically
        // points outside it. Fall back to the lexical path if the target
        // doesn't exist yet — the existsSync check below will 403 it anyway.
        try {
          resolved = fs.realpathSync(resolved);
        } catch {}
        // Reconstruct the allowed roots set and verify containment.
        const projectsBase = path.join(os.homedir(), '.claude', 'projects');
        const allowedRoots = [];
        try {
          for (const slug of fs.readdirSync(projectsBase)) {
            const resolvedProj = resolveSlugToPath(slug, path.join(projectsBase, slug));
            if (resolvedProj) allowedRoots.push(resolvedProj);
          }
        } catch {}
        const globalBrain =
          process.env.MONOMIND_GLOBAL_BRAIN_DIR ||
          path.join(os.homedir(), '.monomind', 'global-brain');
        if (fs.existsSync(globalBrain)) allowedRoots.push(globalBrain);
        const isAllowed = allowedRoots.some((root) => {
          const rel = path.relative(root, resolved);
          return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
        });
        if (!isAllowed || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'path is outside the allowed project roots' }));
          return;
        }
        if (!resolved.toLowerCase().endsWith('.md')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'only markdown (.md) files are readable' }));
          return;
        }
        const body = fs.readFileSync(resolved, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ path: resolved, body }));
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
          drawers = raw
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
        } catch {}

        let identity = null;
        try {
          identity = fs.readFileSync(path.join(palaceDir, 'identity.md'), 'utf8');
        } catch {}

        let kg = [];
        try {
          const raw = fs.readFileSync(path.join(palaceDir, 'kg.json'), 'utf8');
          kg = JSON.parse(raw);
        } catch {}

        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ drawers, identity, kg }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/adrs
    if (req.method === 'GET' && url.startsWith('/api/adrs')) {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());

        const adrDirs = [{ path: path.join(d, 'docs', 'adrs'), group: 'all' }];

        const adrs = [];
        for (const { path: adrDir, group: _group } of adrDirs) {
          if (!fs.existsSync(adrDir)) continue;
          // Skip AppleDouble junk ('._*') — exFAT volumes litter these and they aren't real ADRs
          const files = fs
            .readdirSync(adrDir)
            .filter(
              (f) =>
                f.endsWith('.md') &&
                !f.startsWith('._') &&
                f !== 'README.md' &&
                f !== 'v3-adrs.md' &&
                f !== 'SECURITY-REVIEW-SUMMARY.md',
            );
          for (const fname of files.sort()) {
            const resolvedGroup = /^ADR-G/i.test(fname) ? 'guidance' : 'implementation';
            try {
              const raw = fs.readFileSync(path.join(adrDir, fname), 'utf8');
              const titleMatch = raw.match(/^#\s+(.+)$/m);
              const header = raw.split('\n').slice(0, 20).join('\n');
              const statusTableMatch = header.match(
                /^\|\s*\*{0,2}Status\*{0,2}\s*\|\s*\*{0,2}([^|*\n]{2,40}?)\*{0,2}\s*\|/im,
              );
              const statusInlineMatch = header.match(
                /\*\*Status[:\s]+\*?\*?\s*(Accepted|Implemented|Proposed|Superseded|Deprecated|Draft|Rejected|Complete|Active|Retired)[^*]*/i,
              );
              const statusMatch = statusTableMatch || statusInlineMatch;
              const dateInlineMatch = header.match(
                /\*\*Date[:\s]+\*?\*?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i,
              );
              const dateMatch =
                raw.match(/\|\s*\*{0,2}Date\*{0,2}\s*\|\s*\*{0,2}([^|*\n]+?)\*{0,2}\s*\|/i) ||
                dateInlineMatch ||
                raw.match(/Date[:\s]+([0-9]{4}-[0-9]{2}-[0-9]{2})/);
              const numMatch = fname.match(/ADR-([A-Z]*[0-9]+)/i);
              const summaryMatch = raw.match(
                /##\s+(?:Context|Summary|Problem Statement)[^\n]*\n+([\s\S]{20,300})/i,
              );
              adrs.push({
                number: numMatch ? `ADR-${numMatch[1]}` : fname.replace('.md', ''),
                title: titleMatch
                  ? titleMatch[1].replace(/^ADR-[A-Z0-9-]+[:\s]+/i, '').trim()
                  : fname.replace('.md', ''),
                status: statusMatch ? statusMatch[1].trim() : 'Unknown',
                date: dateMatch ? dateMatch[1].trim() : null,
                summary: summaryMatch
                  ? summaryMatch[1].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
                  : null,
                group: resolvedGroup,
                file: fname,
              });
            } catch {
              /* skip unreadable */
            }
          }
        }

        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ adrs }));
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
        const slug = pathToSlug(d);
        const memDir = path.join(homeDir, '.claude', 'projects', slug, 'memory');

        let files = [];
        try {
          files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
        } catch {}

        const memories = files
          .map((fname) => {
            const fp = path.join(memDir, fname);
            let stat = null;
            try {
              stat = fs.statSync(fp);
            } catch {}
            let raw = '';
            try {
              raw = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n');
            } catch {}
            // Parse frontmatter — escHtml ordering: bold replace runs on already-escaped content (safe)
            let name = fname.replace('.md', ''),
              description = '',
              type = 'project',
              body = raw;
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
            return {
              filename: fname,
              name,
              description,
              type,
              body,
              source: 'file',
              readonly: false,
              mtime: stat ? stat.mtimeMs : null,
            };
          })
          .sort((a, b) => (b.mtime || 0) - (a.mtime || 0));

        // Merge backend store (AgentDB / auto-memory bridge). These live in the
        // SQLite-backed store, not as .md files, so the file-only listing above
        // misses them. Surface them read-only with a source badge so the dashboard
        // reflects ALL memory, not just whatever has been flushed to disk.
        let backend = [];
        try {
          const storePath = path.join(d, '.monomind', 'data', 'auto-memory-store.json');
          if (fs.existsSync(storePath)) {
            const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
            const rows = Array.isArray(raw) ? raw : raw.entries || [];
            backend = rows
              .filter((e) => e && e.content != null && e.status !== 'deleted')
              .map((e) => ({
                filename: `backend:${e.key || e.id}`,
                name: e.key || e.id || 'entry',
                description: e.namespace ? `namespace: ${e.namespace}` : '',
                type: e.type || 'semantic',
                body: String(e.content),
                source: 'backend',
                readonly: true,
                mtime: e.updatedAt || e.createdAt || null,
              }))
              .sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
          }
        } catch {}

        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ memories: memories.concat(backend), memDir }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- PUT /api/memory-file
    if (req.method === 'PUT' && url === '/api/memory-file') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2097152) {
          req.destroy();
          return;
        }
      });
      req.on('end', () => {
        try {
          const qs = new URL(req.url, 'http://localhost').searchParams;
          const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
          const slug = pathToSlug(d);
          const memDir = path.join(os.homedir(), '.claude', 'projects', slug, 'memory');
          const { filename, content } = JSON.parse(body);
          if (
            !filename ||
            filename.includes('..') ||
            !filename.endsWith('.md') ||
            filename.includes('/')
          ) {
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
          res.writeHead(200, {
            'Content-Type': 'application/json',
            ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          });
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
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2097152) {
          req.destroy();
          return;
        }
      });
      req.on('end', () => {
        try {
          const qs = new URL(req.url, 'http://localhost').searchParams;
          const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
          const slug = pathToSlug(d);
          const memDir = path.join(os.homedir(), '.claude', 'projects', slug, 'memory');
          const { filename } = JSON.parse(body);
          if (
            !filename ||
            filename.includes('..') ||
            !filename.endsWith('.md') ||
            filename.includes('/')
          ) {
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
          res.writeHead(200, {
            'Content-Type': 'application/json',
            ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ------------------------------------------------- GET /api/routing-feedback
    if (req.method === 'GET' && url === '/api/routing-feedback') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
        const feedbackPath = path.join(d, '.monomind', 'routing-feedback.jsonl');
        let rows = [];
        if (fs.existsSync(feedbackPath)) {
          const raw = fs.readFileSync(feedbackPath, 'utf-8');
          rows = raw
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
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify(rows));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ---------------------------------------------------- GET /api/memory/stats
    if (req.method === 'GET' && url === '/api/memory/stats') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
        const slug = pathToSlug(d);
        const memDir = path.join(os.homedir(), '.claude', 'projects', slug, 'memory');

        let total = 0,
          namespaces = 0,
          size = 0,
          lastWrite = null;
        const byType = {};
        if (fs.existsSync(memDir)) {
          const files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md'));
          total = files.length;
          namespaces = files.length; // each .md file is a memory namespace
          files.forEach((f) => {
            const fp = path.join(memDir, f);
            try {
              const st = fs.statSync(fp);
              size += st.size;
              if (!lastWrite || st.mtimeMs > lastWrite) lastWrite = st.mtimeMs;
            } catch {}
            const type = f.replace('.md', '');
            byType[type] = (byType[type] || 0) + 1;
          });
        }

        // Real v2 memory sources: auto-memory pattern store + episodic log
        let patterns = 0,
          patternsUpdated = null;
        try {
          const store = JSON.parse(
            fs.readFileSync(path.join(d, '.monomind', 'data', 'auto-memory-store.json'), 'utf8'),
          );
          if (Array.isArray(store)) {
            patterns = store.length;
            for (const e of store) {
              if (e && typeof e.ts === 'number' && (!patternsUpdated || e.ts > patternsUpdated))
                patternsUpdated = e.ts;
            }
          }
        } catch {}

        let episodes = 0,
          lastEpisode = null;
        try {
          const lines = fs
            .readFileSync(path.join(d, '.monomind', 'episodic', 'episodes.jsonl'), 'utf8')
            .split('\n')
            .filter(Boolean);
          episodes = lines.length;
          if (lines.length) {
            try {
              const last = JSON.parse(lines[lines.length - 1]);
              lastEpisode = last.ts || last.timestamp || null;
            } catch {}
          }
        } catch {}

        const stats = {
          total,
          count: total,
          namespaces,
          ns: Object.keys(byType).length,
          size,
          byType,
          patterns,
          patternsUpdated,
          episodes,
          lastEpisode,
          memoryFiles: total,
          // Legacy keys (v1 backends removed in v2) — kept false for frontend backward-safety
          hnsw: false,
          agentdb: false,
          rvf: false,
          lastWrite,
          memDir,
        };
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ stats }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------ GET /api/memory/entries (SQLite)
    if (req.method === 'GET' && url === '/api/memory/entries') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const ns = qs.get('namespace') || undefined;
        const limit = Math.min(parseInt(qs.get('limit') || '50', 10) || 50, 200);
        const offset = parseInt(qs.get('offset') || '0', 10) || 0;
        const bridge = await _getKnowledgeBridge();
        if (!bridge) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Memory bridge unavailable' }));
          return;
        }
        const result = await bridge.bridgeListEntries({ namespace: ns, limit, offset });
        if (!result?.success) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: result?.error || 'Failed to list entries' }));
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ entries: result.entries, total: result.total }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // --------------------------------------- GET /api/memory/search (SQLite)
    if (req.method === 'GET' && url === '/api/memory/search') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const query = qs.get('q') || '';
        const ns = qs.get('namespace') || undefined;
        const limit = Math.min(parseInt(qs.get('limit') || '20', 10) || 20, 100);
        if (!query) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing query parameter q' }));
          return;
        }
        const bridge = await _getKnowledgeBridge();
        if (!bridge) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Memory bridge unavailable' }));
          return;
        }
        const result = await bridge.bridgeSearchEntries({ query, namespace: ns, limit });
        if (!result?.success) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: result?.error || 'Search failed' }));
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Cache-Control': 'no-cache',
        });
        res.end(
          JSON.stringify({
            results: result.results,
            searchTime: result.searchTime,
            searchMethod: result.searchMethod,
          }),
        );
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------- POST /api/memory/entry (SQLite)
    if (req.method === 'POST' && url === '/api/memory/entry') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2097152) {
          req.destroy();
          return;
        }
      });
      req.on('end', async () => {
        try {
          const { key, value, namespace, tags } = JSON.parse(body);
          if (!key || !value) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing key or value' }));
            return;
          }
          const bridge = await _getKnowledgeBridge();
          if (!bridge) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Memory bridge unavailable' }));
            return;
          }
          const result = await bridge.bridgeStoreEntry({
            key: String(key),
            value: String(value),
            namespace: namespace || 'default',
            tags: Array.isArray(tags) ? tags : [],
            upsert: true,
          });
          if (!result?.success) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: result?.error || 'Store failed' }));
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'application/json',
            ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          });
          res.end(JSON.stringify({ ok: true, id: result.id, duplicate: result.duplicate }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ------------------------------------ DELETE /api/memory/entry (SQLite)
    if (req.method === 'DELETE' && url === '/api/memory/entry') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2097152) {
          req.destroy();
          return;
        }
      });
      req.on('end', async () => {
        try {
          const { key, id, namespace } = JSON.parse(body);
          if (!key && !id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing key or id' }));
            return;
          }
          const bridge = await _getKnowledgeBridge();
          if (!bridge) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Memory bridge unavailable' }));
            return;
          }
          const result = await bridge.bridgeDeleteEntry({
            key,
            id,
            namespace: namespace || 'default',
          });
          if (!result?.success) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: result?.error || 'Delete failed' }));
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'application/json',
            ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          });
          res.end(JSON.stringify({ ok: true, deleted: result.deleted }));
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
            const alreadyTracked = loops.some(
              (l) => l.id === sessionId || l.sessionId === sessionId,
            );
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
      return;
    }

    // ---------------------------------------------------------- POST /api/loops/stop
    if (req.method === 'POST' && url === '/api/loops/stop') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2097152) {
          req.destroy();
          return;
        }
      });
      req.on('end', () => {
        try {
          const { id } = JSON.parse(body);
          if (!id) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'id required' }));
            return;
          }
          const _stopQs = new URL(req.url, 'http://localhost').searchParams;
          const _stopDir = path.resolve(_stopQs.get('dir') || projectDir || process.cwd());
          const loopsDir = path.join(_stopDir, '.monomind', 'loops');
          fs.mkdirSync(loopsDir, { recursive: true });
          fs.writeFileSync(path.join(loopsDir, `${id}.stop`), `stop-requested-${Date.now()}`);
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
      return;
    }

    // ---------------------------------------------------------- POST /api/loops/create
    if (req.method === 'POST' && url === '/api/loops/create') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2097152) {
          req.destroy();
          return;
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
            return;
          }
          const loopsDir = path.join(
            path.resolve(_qs.get('dir') || projectDir || process.cwd()),
            '.monomind',
            'loops',
          );
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
      return;
    }

    // ---------------------------------------------------------- GET /api/session-errors
    if (req.method === 'GET' && url === '/api/session-errors') {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
      // Cap sessionId to prevent O(n×m) DoS via f.includes(sessionId) substring
      // match against every filename when sessionId is a very long string.
      const _rawSessId = qs.get('id') || '';
      const sessionId = _rawSessId.slice(0, 256);
      const slug = pathToSlug(d);
      const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
      try {
        const files = fs
          .readdirSync(projectClaudeDir)
          .filter((f) => f.endsWith('.jsonl') && !f.startsWith('._'));
        let fp = null;
        // Find the file matching sessionId
        for (const f of files) {
          if (f.includes(sessionId) || sessionId === f.replace('.jsonl', '')) {
            fp = path.join(projectClaudeDir, f);
            break;
          }
        }
        if (!fp) {
          // fallback: find by scanning — the sessionId lives in the first JSONL line, so a
          // small head-read is enough; no need to load the whole (potentially huge) file.
          for (const f of files) {
            const head = _readHeadText(path.join(projectClaudeDir, f));
            const firstLine = head.split('\n', 1)[0];
            if (firstLine) {
              try {
                const first = JSON.parse(firstLine);
                if (first.sessionId === sessionId) {
                  fp = path.join(projectClaudeDir, f);
                  break;
                }
              } catch {}
            }
          }
        }
        if (!fp) {
          res.writeHead(404);
          res.end(JSON.stringify({ errors: [] }));
          return;
        }
        // Only the most recent portion of the file matters for a dashboard error feed —
        // tail-cap the read so a multi-hundred-MB session log doesn't get buffered whole.
        const lines = _readTailLines(fp);
        const errors = [];
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            const content = obj.message?.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (block.type === 'tool_result' && block.is_error) {
                const errText = Array.isArray(block.content)
                  ? block.content.map((c) => c.text || '').join('')
                  : String(block.content || '');
                if (errText)
                  errors.push({ toolUseId: block.tool_use_id || '', text: errText.slice(0, 500) });
              }
            }
          } catch {}
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        res.end(JSON.stringify({ errors: errors.slice(0, 50) }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ errors: [], error: err.message }));
      }
      return;
    }

    // ---------------------------------------------------------- GET /api/events-stream (SSE)
    if (req.method === 'GET' && url.startsWith('/api/events-stream')) {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
      const slug = pathToSlug(d);
      const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      const send = (ev, data) => {
        try {
          res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
        } catch {}
      };
      send('connected', { ts: Date.now() });
      let watcher = null;
      try {
        watcher = fs.watch(projectClaudeDir, { persistent: false }, (evtype) => {
          if (evtype === 'change' || evtype === 'rename') send('update', { ts: Date.now() });
        });
      } catch {}
      const pingInterval = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {}
      }, 20000);
      req.on('close', () => {
        clearInterval(pingInterval);
        try {
          watcher?.close();
        } catch {}
      });
      return;
    }

    // ------------------------------------------------------- DELETE /api/knowledge-chunk
    if (req.method === 'DELETE' && url === '/api/knowledge-chunk') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2097152) {
          req.destroy();
          return;
        }
      });
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
          const entries = fs
            .readFileSync(chunksFile, 'utf8')
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
          const before = entries.length;
          const filtered = entries.filter((e) => e.chunkId !== chunkId);
          if (filtered.length === before) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Chunk not found' }));
            return;
          }
          fs.writeFileSync(
            chunksFile,
            filtered.map((e) => JSON.stringify(e)).join('\n') + (filtered.length ? '\n' : ''),
            'utf8',
          );
          res.writeHead(200, {
            'Content-Type': 'application/json',
            ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          });
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
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2097152) {
          req.destroy();
          return;
        }
      });
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
          const entries = fs
            .readFileSync(chunksFile, 'utf8')
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
          const idx = entries.findIndex((e) => e.chunkId === chunkId);
          if (idx === -1) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Chunk not found' }));
            return;
          }
          entries[idx] = { ...entries[idx], text };
          fs.writeFileSync(
            chunksFile,
            `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`,
            'utf8',
          );
          res.writeHead(200, {
            'Content-Type': 'application/json',
            ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ── Monograph routes (extracted to routes-monograph.mjs) ──────────────
    if (
      await handleMonographRoutes(req, res, url, corsOrigin, {
        projectDir,
        buildDocsState,
        looksLikeOurProcess,
      })
    )
      return;

    // -------------------------------------------------- POST /api/shutdown
    if (req.method === 'POST' && url === '/api/shutdown') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ ok: true }));
      // Kill monograph watcher if running
      const d = projectDir || process.cwd();
      for (const pidName of ['monograph.watch.pid', 'monograph-watch.pid']) {
        try {
          const wp = path.join(d, '.monomind', pidName);
          if (fs.statSync(wp).size > 32) continue;
          const wpid = parseInt(fs.readFileSync(wp, 'utf-8').trim(), 10);
          if (!Number.isInteger(wpid) || wpid <= 0) {
            try {
              fs.unlinkSync(wp);
            } catch {}
            continue;
          }
          if (looksLikeOurProcess(wpid, d)) process.kill(wpid, 'SIGTERM');
          try {
            fs.unlinkSync(wp);
          } catch {}
        } catch {}
      }
      // Remove control.json so startup knows we're gone
      try {
        fs.unlinkSync(path.join(d, '.monomind', 'control.json'));
      } catch {}
      setTimeout(shutdown, 100);
      return;
    }

    // -------------------------------------------------- POST /api/mcp/call
    if (req.method === 'POST' && url === '/api/mcp/call') {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 2097152) {
          req.destroy();
          return;
        }
      });
      req.on('end', async () => {
        const json = (res) => {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          });
        };
        const ok = (data) => {
          json(res);
          res.end(
            JSON.stringify({
              content: [
                {
                  type: 'text',
                  text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
                },
              ],
            }),
          );
        };
        const err = (msg) => {
          json(res);
          res.end(JSON.stringify({ error: msg }));
        };
        try {
          const { tool, input = {}, args = {} } = JSON.parse(body);
          const qs2 = new URL(req.url, 'http://localhost').searchParams;
          // dir can come from: URL query string, body.args.dir, body.input.dir, or server default
          const dir2 = qs2.get('dir') || args.dir || input.dir || projectDir;
          const d2 = path.resolve(dir2 || process.cwd());
          const dbPath2 = path.join(d2, '.monomind', 'monograph.db');
          if (!fs.existsSync(dbPath2)) {
            err('monograph.db not found — run monograph build first');
            return;
          }
          // Import only graphology-free storage modules to avoid broken graphology dep
          const { openDb, closeDb } = await import(
            new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href
          );
          const { ftsSearch } = await import(
            new URL('../../../../monograph/dist/src/storage/fts-store.js', import.meta.url).href
          );
          const { countNodes } = await import(
            new URL('../../../../monograph/dist/src/storage/node-store.js', import.meta.url).href
          );
          const { countEdges } = await import(
            new URL('../../../../monograph/dist/src/storage/edge-store.js', import.meta.url).href
          );
          const _getShortestPath = (db, fromId, toId, maxDepth = 6) => {
            if (fromId === toId) return [fromId];
            const visited = new Set([fromId]);
            let frontier = [[fromId]];
            for (let depth = 0; depth < maxDepth; depth++) {
              const next = [];
              for (const chain of frontier) {
                const cur = chain[chain.length - 1];
                const neighbors = db
                  .prepare(
                    'SELECT target_id AS id FROM edges WHERE source_id=? UNION SELECT source_id AS id FROM edges WHERE target_id=?',
                  )
                  .all(cur, cur);
                for (const { id } of neighbors) {
                  if (!visited.has(id)) {
                    const newChain = [...chain, id];
                    if (id === toId) return newChain;
                    visited.add(id);
                    next.push(newChain);
                  }
                }
              }
              if (!next.length) break;
              frontier = next;
            }
            return null;
          };
          const db2 = openDb(dbPath2);
          try {
            if (tool === 'monograph_stats') {
              const n = countNodes(db2),
                e = countEdges(db2);
              ok(`nodes: ${n}\nedges: ${e}`);
            } else if (tool === 'monograph_cypher') {
              // Translate basic MATCH (n:Label) queries to SQL
              const q = String(input.query || '')
                .trim()
                .slice(0, 4096);
              const labelMatch = q.match(/MATCH\s+\(n:(\w+)\)/i);
              if (labelMatch) {
                const label = labelMatch[1];
                const rows = db2
                  .prepare('SELECT name FROM nodes WHERE label = ? LIMIT 5000')
                  .all(label);
                ok(rows.map((r) => r.name).join('\n'));
              } else {
                ok('Cypher: unsupported query pattern');
              }
            } else if (tool === 'monograph_cohesion') {
              const limit = input.limit || 30;
              // Check if community_id is populated
              const hasCommunities =
                db2.prepare('SELECT COUNT(*) as c FROM nodes WHERE community_id IS NOT NULL').get()
                  .c > 0;
              if (hasCommunities) {
                const rows = db2
                  .prepare(
                    'SELECT community_id, COUNT(*) as size FROM nodes GROUP BY community_id ORDER BY size DESC LIMIT ?',
                  )
                  .all(limit);
                ok(rows.map((r) => `community ${r.community_id}: ${r.size} nodes`).join('\n'));
              } else {
                // Fallback: group by type (label)
                const rows = db2
                  .prepare(
                    'SELECT label, COUNT(*) as cnt FROM nodes GROUP BY label ORDER BY cnt DESC LIMIT ?',
                  )
                  .all(limit);
                const total = db2.prepare('SELECT COUNT(*) as c FROM nodes').get().c;
                const lines = rows.map((r) => {
                  const pct = ((r.cnt / total) * 100).toFixed(1);
                  const bar = '█'.repeat(Math.round(pct / 3));
                  return `${(r.label || 'unknown').padEnd(12)} ${r.cnt.toString().padStart(6)} nodes  (${pct}%)  ${bar}`;
                });
                ok(
                  `Type Distribution (community clustering not yet run)\n${'─'.repeat(50)}\n${lines.join('\n')}`,
                );
              }
            } else if (tool === 'monograph_bridge') {
              const limit = input.limit || 20;
              // Find hub nodes that connect many different directories (cross-module connectors)
              const rows = db2
                .prepare(`
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
                LIMIT ?`)
                .all(limit);
              if (!rows.length) {
                ok(
                  'No cross-module bridge nodes found in top results. Try running monograph build to index more files.',
                );
              } else {
                const lines = rows.map(
                  (r) =>
                    `${r.name} (${r.label})\n  → connects ${r.cross_file_count} files, degree ${r.total_degree}\n  ${r.file_path || '?'}`,
                );
                ok(
                  `Cross-Module Bridge Nodes (${rows.length})\n${'─'.repeat(50)}\n${lines.join('\n\n')}`,
                );
              }
            } else if (tool === 'monograph_detect_changes') {
              const { execSync } = await import('node:child_process');
              let changed = '';
              try {
                changed = execSync('git diff --name-only HEAD', { cwd: d2, encoding: 'utf-8' });
              } catch {
                changed = '(git not available)';
              }
              ok(changed.trim() || 'No changed files detected');
            } else if (tool === 'monograph_diff') {
              ok(
                'Graph diff: compare two snapshots using monograph snapshot + monograph diff commands',
              );
            } else if (tool === 'monograph_rename') {
              // Cap sym to prevent O(n) FTS scan DoS via oversized query string.
              const sym = String(input.symbolName || '').slice(0, 4096);
              if (!sym) {
                ok('Provide symbolName to rename');
                return;
              }
              const hits = ftsSearch(db2, sym, 20);
              ok(
                `Found ${hits.length} occurrences of "${sym}":\n` +
                  hits
                    .map((h) => `  ${h.filePath || '?'}:${h.startLine || '?'} — ${h.name}`)
                    .join('\n'),
              );
            } else if (tool === 'monograph_impact') {
              const target = String(input.target || '').slice(0, 4096);
              const dir3 = input.direction || 'both';
              const depth = input.maxDepth || 4;
              const hits = ftsSearch(db2, target, 5);
              if (!hits.length) {
                ok(`Node not found: ${target}`);
                return;
              }
              const nodeId = hits[0].id;
              const visited = new Set([nodeId]);
              const frontier = [nodeId];
              const results = [];
              for (let d3 = 0; d3 < depth && frontier.length; d3++) {
                const next = [];
                for (const id of frontier) {
                  const outgoing =
                    dir3 !== 'upstream'
                      ? db2
                          .prepare('SELECT target_id, relation FROM edges WHERE source_id = ?')
                          .all(id)
                      : [];
                  const incoming =
                    dir3 !== 'downstream'
                      ? db2
                          .prepare(
                            'SELECT source_id as target_id, relation FROM edges WHERE target_id = ?',
                          )
                          .all(id)
                      : [];
                  for (const e of [...outgoing, ...incoming]) {
                    if (!visited.has(e.target_id)) {
                      visited.add(e.target_id);
                      next.push(e.target_id);
                      const n3 = db2
                        .prepare('SELECT name, label FROM nodes WHERE id = ?')
                        .get(e.target_id);
                      if (n3)
                        results.push(
                          `  [hop ${d3 + 1}] ${n3.name} (${n3.label}) via ${e.relation}`,
                        );
                    }
                  }
                }
                frontier.length = 0;
                frontier.push(...next);
              }
              ok(
                `Impact of "${hits[0].name}" (${dir3}, depth=${depth}):\n` +
                  (results.join('\n') || '  (no dependencies found)'),
              );
            } else if (tool === 'monograph_context') {
              const id = String(input.id || '').slice(0, 4096);
              const hits = ftsSearch(db2, id, 5);
              if (!hits.length) {
                ok(`Node not found: ${id}`);
                return;
              }
              const node = hits[0];
              const outEdges = db2
                .prepare(
                  'SELECT e.relation, n.name FROM edges e JOIN nodes n ON n.id = e.target_id WHERE e.source_id = ? LIMIT 20',
                )
                .all(node.id);
              const inEdges = db2
                .prepare(
                  'SELECT e.relation, n.name FROM edges e JOIN nodes n ON n.id = e.source_id WHERE e.target_id = ? LIMIT 20',
                )
                .all(node.id);
              ok(
                `# ${node.name} (${node.label})\nFile: ${node.filePath || '?'}\n\n**Imports / depends on (${outEdges.length}):**\n${outEdges.map((e) => `  → ${e.name} [${e.relation}]`).join('\n') || '  (none)'}\n\n**Used by / depended on by (${inEdges.length}):**\n${inEdges.map((e) => `  ← ${e.name} [${e.relation}]`).join('\n') || '  (none)'}`,
              );
            } else if (tool === 'monograph_query' || tool === 'monograph_suggest') {
              const q2 = String(input.query || input.task || '').slice(0, 4096);
              const hits2 = ftsSearch(db2, q2, 20);
              ok(
                hits2
                  .map((h) => `${h.name} (${h.label}) — ${h.filePath || '?'}:${h.startLine || '?'}`)
                  .join('\n') || 'No results',
              );
            } else if (tool === 'monograph_unlinked_refs') {
              const limit = input.limit || 50;
              const rows = db2
                .prepare(
                  `SELECT n.name, n.label, n.file_path FROM nodes n LEFT JOIN edges e ON e.target_id = n.id WHERE e.target_id IS NULL AND n.label IN ('Function','Class','Variable','Interface','Method','Module') ORDER BY n.name LIMIT ?`,
                )
                .all(limit);
              if (!rows.length) {
                ok('No unlinked symbols found — all exports appear to be referenced.');
              } else {
                ok(
                  `Unlinked Symbols (${rows.length}) — potentially unused exports:\n${'─'.repeat(50)}\n${rows.map((r) => `  ${r.name} (${r.label})\n    ${r.file_path || '?'}`).join('\n\n')}`,
                );
              }
            } else if (tool === 'monograph_reachability') {
              const limit = input.limit || 30;
              const unreachable = db2
                .prepare(
                  `SELECT n.name, n.file_path, (SELECT COUNT(*) FROM edges WHERE source_id = n.id) as out_deg FROM nodes n LEFT JOIN edges e ON e.target_id = n.id WHERE e.target_id IS NULL AND n.label = 'File' ORDER BY out_deg DESC LIMIT ?`,
                )
                .all(limit);
              const total = db2
                .prepare("SELECT COUNT(*) as c FROM nodes WHERE label = 'File'")
                .get().c;
              if (!unreachable.length) {
                ok(`All ${total} files are reachable from at least one other file.`);
              } else {
                ok(
                  `Unreachable Files (${unreachable.length} of ${total} total):\n${'─'.repeat(50)}\n${unreachable.map((r) => `  ${r.name}${r.out_deg ? ` (imports ${r.out_deg} others)` : ''}\n    ${r.file_path || '?'}`).join('\n\n')}`,
                );
              }
            } else if (tool === 'monograph_boundary_check') {
              const limit = input.limit || 40;
              const rows = db2
                .prepare(
                  `SELECT n1.file_path as src, n2.file_path as dst, e.relation, COUNT(*) as cnt FROM edges e JOIN nodes n1 ON n1.id = e.source_id JOIN nodes n2 ON n2.id = e.target_id WHERE n1.file_path IS NOT NULL AND n2.file_path IS NOT NULL AND n1.file_path != n2.file_path GROUP BY n1.file_path, n2.file_path ORDER BY cnt DESC LIMIT ?`,
                )
                .all(limit);
              const suspicious = rows.filter((r) => {
                const s = (r.src || '').toLowerCase(),
                  t = (r.dst || '').toLowerCase();
                return (
                  (s.includes('test') && !t.includes('test')) ||
                  (s.includes('spec') && !t.includes('spec')) ||
                  (s.includes('/ui/') && t.includes('/db/')) ||
                  (s.includes('/view') && t.includes('/model'))
                );
              });
              if (!suspicious.length) {
                ok(
                  `Boundary check: ${rows.length} cross-file edge groups — no obvious violations.\nTop connections:\n${rows
                    .slice(0, 10)
                    .map((r) => `  ${r.src} → ${r.dst} [${r.cnt}x]`)
                    .join('\n')}`,
                );
              } else {
                ok(
                  `Boundary Violations (${suspicious.length} suspicious):\n${'─'.repeat(50)}\n${suspicious.map((r) => `  ⚠ ${r.src}\n    → ${r.dst}  [${r.cnt} edges]`).join('\n\n')}`,
                );
              }
            } else if (
              tool === 'monograph_regression_check' ||
              tool === 'monograph_baseline_compare'
            ) {
              const n = countNodes(db2),
                e = countEdges(db2);
              const bPath = path.join(d2, '.monomind', 'monograph-baseline.json');
              if (!fs.existsSync(bPath)) {
                fs.writeFileSync(
                  bPath,
                  JSON.stringify({ nodes: n, edges: e, savedAt: new Date().toISOString() }),
                  'utf-8',
                );
                ok(`Baseline saved (${n} nodes, ${e} edges). Run again to compare.`);
              } else {
                const base = JSON.parse(fs.readFileSync(bPath, 'utf-8'));
                const dn = n - base.nodes,
                  de = e - base.edges;
                const sign = (v) => (v > 0 ? `+${v}` : String(v));
                ok(
                  `Comparison vs baseline (${base.savedAt || 'unknown'}):\n${'─'.repeat(50)}\n  Nodes: ${base.nodes} → ${n} (${sign(dn)})\n  Edges: ${base.edges} → ${e} (${sign(de)})\n\n${dn === 0 && de === 0 ? '✓ No structural regressions detected.' : '⚠ Graph has changed since baseline.'}`,
                );
              }
            } else if (tool === 'monograph_clone_detect' || tool === 'monograph_similar_files') {
              const limit = input.limit || 20;
              const fileNodes = db2
                .prepare("SELECT id, name, file_path FROM nodes WHERE label = 'File' LIMIT 300")
                .all();
              const deps = {};
              for (const f of fileNodes) {
                deps[f.id] = {
                  name: f.name,
                  set: new Set(
                    db2
                      .prepare('SELECT target_id FROM edges WHERE source_id = ?')
                      .all(f.id)
                      .map((r) => r.target_id),
                  ),
                };
              }
              const keys = Object.keys(deps),
                pairs = [];
              for (let i = 0; i < Math.min(keys.length, 150); i++) {
                for (let j = i + 1; j < Math.min(keys.length, 150); j++) {
                  const a = deps[keys[i]],
                    b = deps[keys[j]];
                  if (!a.set.size && !b.set.size) continue;
                  const inter = [...a.set].filter((x) => b.set.has(x)).length;
                  const union = new Set([...a.set, ...b.set]).size;
                  const jac = union ? inter / union : 0;
                  if (jac > 0.5) pairs.push({ a: a.name, b: b.name, jac });
                }
              }
              pairs.sort((x, y) => y.jac - x.jac);
              const top = pairs.slice(0, limit);
              if (!top.length) {
                ok('No similar file pairs found (Jaccard threshold: 0.5).');
              } else {
                ok(
                  `Similar File Pairs (${top.length}, by import pattern):\n${'─'.repeat(50)}\n${top.map((p) => `  ${(p.jac * 100).toFixed(0)}% similar\n    ${p.a}\n    ${p.b}`).join('\n\n')}`,
                );
              }
            } else if (tool === 'monograph_mirrored_dirs') {
              const fileNodes = db2
                .prepare(
                  "SELECT file_path FROM nodes WHERE label = 'File' AND file_path IS NOT NULL",
                )
                .all();
              const dirFiles = {};
              for (const f of fileNodes) {
                const dir = path.dirname(f.file_path),
                  base = path.basename(f.file_path);
                if (!dirFiles[dir]) dirFiles[dir] = new Set();
                dirFiles[dir].add(base);
              }
              const dirs = Object.keys(dirFiles),
                pairs = [];
              for (let i = 0; i < dirs.length; i++) {
                for (let j = i + 1; j < dirs.length; j++) {
                  const a = dirFiles[dirs[i]],
                    b = dirFiles[dirs[j]];
                  const inter = [...a].filter((x) => b.has(x)).length;
                  const union = new Set([...a, ...b]).size;
                  const jac = union ? inter / union : 0;
                  if (jac >= 0.5 && inter >= 2)
                    pairs.push({ a: dirs[i], b: dirs[j], overlap: inter, jac });
                }
              }
              pairs.sort((x, y) => y.jac - x.jac);
              if (!pairs.length) {
                ok('No mirrored directory pairs detected (Jaccard ≥ 0.5, min 2 shared files).');
              } else {
                ok(
                  `Mirrored Directories (${pairs.length} pairs):\n${'─'.repeat(50)}\n${pairs
                    .slice(0, 20)
                    .map(
                      (p) =>
                        `  ${(p.jac * 100).toFixed(0)}% overlap (${p.overlap} shared files)\n    ${p.a}\n    ${p.b}`,
                    )
                    .join('\n\n')}`,
                );
              }
            } else if (
              tool === 'monograph_health_score' ||
              tool === 'monograph_vital_signs_snapshot'
            ) {
              const n = countNodes(db2),
                e = countEdges(db2);
              const dead = db2
                .prepare(
                  "SELECT COUNT(*) as c FROM nodes n LEFT JOIN edges e ON e.target_id = n.id WHERE e.target_id IS NULL AND n.label IN ('Function','Class','Method')",
                )
                .get().c;
              const hubs = db2
                .prepare(
                  'SELECT COUNT(*) as c FROM (SELECT source_id FROM edges GROUP BY source_id HAVING COUNT(*) > 20)',
                )
                .get().c;
              const density = n > 1 ? ((2 * e) / (n * (n - 1))).toFixed(4) : '0';
              const deadRatio = n ? ((dead / n) * 100).toFixed(1) : '0';
              const score = Math.max(
                0,
                Math.min(
                  100,
                  100 - Math.min(30, parseFloat(deadRatio) * 0.5) - Math.min(20, hubs * 2),
                ),
              ).toFixed(0);
              const status =
                parseInt(score, 10) >= 70
                  ? '✓ OK'
                  : parseInt(score, 10) >= 40
                    ? '⚠ WARNING'
                    : '✗ CRITICAL';
              ok(
                `Vital Signs — ${new Date().toISOString()}\n${'─'.repeat(50)}\n  Health Score:  ${score}/100  ${status}\n  Nodes:         ${n}\n  Edges:         ${e}\n  Density:       ${density}\n  Dead symbols:  ${dead} (${deadRatio}%)\n  Hub nodes:     ${hubs} nodes with >20 edges`,
              );
            } else if (tool === 'monograph_health_trend') {
              const bPath = path.join(d2, '.monomind', 'monograph-baseline.json');
              if (!fs.existsSync(bPath)) {
                ok(
                  'No trend data yet. Run "Health Score" or "Regression Check" first to save a baseline.',
                );
              } else {
                const base = JSON.parse(fs.readFileSync(bPath, 'utf-8'));
                const n = countNodes(db2),
                  e = countEdges(db2);
                const dn = n - base.nodes,
                  de = e - base.edges;
                const sign = (v) => (v > 0 ? `+${v}` : String(v));
                ok(
                  `Health Trend (vs ${base.savedAt || 'unknown'}):\n${'─'.repeat(50)}\n  Nodes: ${base.nodes} → ${n} (${sign(dn)})\n  Edges: ${base.edges} → ${e} (${sign(de)})\n  Trend: ${dn === 0 && de === 0 ? 'stable' : dn > 0 ? 'growing' : 'shrinking'}`,
                );
              }
            } else if (tool === 'monograph_hotspots') {
              const limit = input.limit || 20;
              const rows = db2
                .prepare(
                  `SELECT n.name, n.file_path, (SELECT COUNT(*) FROM edges WHERE source_id = n.id OR target_id = n.id) as degree, (SELECT COUNT(*) FROM edges WHERE source_id = n.id) as fan_out, (SELECT COUNT(*) FROM edges WHERE target_id = n.id) as fan_in FROM nodes n WHERE n.label = 'File' ORDER BY degree DESC LIMIT ?`,
                )
                .all(limit);
              if (!rows.length) {
                ok('No file hotspots found.');
              } else {
                ok(
                  `Hotspot Files (top ${rows.length} by degree):\n${'─'.repeat(50)}\n${rows.map((r, i) => `  ${i + 1}. ${r.name}  [degree ${r.degree}: ↑${r.fan_in} in, ↓${r.fan_out} out]\n     ${r.file_path || '?'}`).join('\n')}`,
                );
              }
            } else if (tool === 'monograph_maintainability') {
              const limit = input.limit || 25;
              const rows = db2
                .prepare(
                  `SELECT n.name, n.file_path, (SELECT COUNT(*) FROM edges WHERE source_id = n.id) as fan_out, (SELECT COUNT(*) FROM edges WHERE target_id = n.id) as fan_in FROM nodes n WHERE n.label = 'File' ORDER BY fan_out DESC LIMIT ?`,
                )
                .all(limit);
              if (!rows.length) {
                ok('No file data for maintainability analysis.');
              } else {
                const maxOut = Math.max(...rows.map((r) => r.fan_out), 1);
                const lines = rows.map((r) => {
                  const mi = Math.max(
                    0,
                    100 - (r.fan_out / maxOut) * 60 - (r.fan_in > 10 ? 20 : 0),
                  ).toFixed(0);
                  return `  ${parseInt(mi, 10) >= 70 ? '✓' : parseInt(mi, 10) >= 40 ? '⚠' : '✗'} MI:${mi.padStart(3)}  out:${String(r.fan_out).padStart(4)}  in:${String(r.fan_in).padStart(4)}  ${r.name}`;
                });
                ok(
                  `Maintainability Index (estimated from fan-out/fan-in):\n${'─'.repeat(60)}\n${lines.join('\n')}`,
                );
              }
            } else if (tool === 'monograph_complexity' || tool === 'monograph_crap_score') {
              const limit = input.limit || 25;
              const rows = db2
                .prepare(
                  `SELECT n.name, n.label, n.file_path, (SELECT COUNT(*) FROM edges WHERE source_id = n.id) as out_deg FROM nodes n WHERE n.label IN ('Function','Method','Class') ORDER BY out_deg DESC LIMIT ?`,
                )
                .all(limit);
              if (!rows.length) {
                ok('No function/method nodes found. Build the graph first.');
              } else {
                const isCrap = tool === 'monograph_crap_score';
                const header = isCrap
                  ? 'CRAP Score proxy (degree² — lower is better)'
                  : 'Complexity by Out-Degree';
                ok(
                  `${header}:\n${'─'.repeat(50)}\n${rows.map((r) => `  ${r.name} (${r.label})  ${isCrap ? 'CRAP' : 'complexity'}: ${isCrap ? r.out_deg ** 2 : r.out_deg}\n    ${r.file_path || '?'}`).join('\n')}`,
                );
              }
            } else if (tool === 'monograph_risk_profile') {
              const n = countNodes(db2),
                e = countEdges(db2);
              const dead = db2
                .prepare(
                  "SELECT COUNT(*) as c FROM nodes n LEFT JOIN edges e ON e.target_id = n.id WHERE e.target_id IS NULL AND n.label IN ('Function','Class','Method')",
                )
                .get().c;
              const hubs = db2
                .prepare(
                  'SELECT COUNT(*) as c FROM (SELECT source_id FROM edges GROUP BY source_id HAVING COUNT(*) > 15)',
                )
                .get().c;
              const files = db2
                .prepare("SELECT COUNT(*) as c FROM nodes WHERE label = 'File'")
                .get().c;
              const orphans = db2
                .prepare(
                  "SELECT COUNT(*) as c FROM nodes n LEFT JOIN edges e ON e.target_id = n.id WHERE e.target_id IS NULL AND n.label = 'File'",
                )
                .get().c;
              const risks = [];
              if (dead > 10) risks.push(`  HIGH   Dead symbols: ${dead} unreferenced nodes`);
              if (hubs > 3) risks.push(`  MEDIUM Hub nodes: ${hubs} nodes with >15 dependencies`);
              if (orphans > files * 0.3)
                risks.push(`  MEDIUM Orphan files: ${orphans} of ${files} files unreachable`);
              if (n > 0 && e / n < 0.5)
                risks.push(`  LOW    Sparse graph: avg degree ${(e / n).toFixed(2)}`);
              ok(
                `Risk Profile — ${new Date().toISOString().split('T')[0]}\n${'─'.repeat(50)}\n${risks.length ? risks.join('\n') : '  No significant risks detected.'}\n\nSummary: ${n} nodes · ${e} edges · ${files} files`,
              );
            } else if (tool === 'monograph_author_analytics') {
              // Clamp to a safe integer — this value is interpolated into a shell command below.
              const limit = Math.min(Math.max(parseInt(input.limit, 10) || 20, 1), 100);
              const { execSync: execS } = await import('node:child_process');
              try {
                const log = execS(
                  `git log --format="%ae" --no-merges -- . 2>/dev/null | sort | uniq -c | sort -rn | head -${limit}`,
                  { cwd: d2, encoding: 'utf-8', timeout: 5000 },
                );
                if (!log.trim()) {
                  ok('No git history found for this project directory.');
                } else {
                  ok(
                    `Author Analytics (by commit count):\n${'─'.repeat(50)}\n${log
                      .trim()
                      .split('\n')
                      .map((l) => {
                        const m = l.trim().match(/^(\d+)\s+(.+)$/);
                        return m ? `  ${m[2].padEnd(45)} ${m[1]} commits` : l;
                      })
                      .join('\n')}`,
                  );
                }
              } catch {
                ok('Author analytics requires git. Ensure this directory is a git repository.');
              }
            } else if (tool === 'monograph_reachability') {
              // Files with no inbound edges (nothing imports them)
              const allNodes = db2
                .prepare(
                  `SELECT id, name, file_path FROM nodes WHERE label IN ('File','Module') LIMIT 5000`,
                )
                .all();
              const inboundSet = new Set(
                db2
                  .prepare(`SELECT DISTINCT target_id FROM edges`)
                  .all()
                  .map((r) => r.target_id),
              );
              const unreachable = allNodes.filter((n) => !inboundSet.has(n.id)).slice(0, 40);
              const outdeg = db2.prepare(
                `SELECT source_id, COUNT(*) as c FROM edges GROUP BY source_id`,
              );
              const degMap = {};
              for (const r of outdeg.all()) degMap[r.source_id] = r.c;
              if (!unreachable.length) {
                ok('All files have at least one inbound reference.');
              } else
                ok(
                  `Unreachable Files (${unreachable.length} of ${allNodes.length} total):\n${'─'.repeat(50)}\n${unreachable
                    .slice(0, 30)
                    .map(
                      (n) =>
                        `  ${n.name || n.id.split('/').pop()} (imports ${degMap[n.id] || 0} others)\n    ${n.file_path || ''}`,
                    )
                    .join('\n\n')}`,
                );
            } else if (tool === 'monograph_vital_signs_snapshot') {
              // Same as health_score — kept for backward compatibility
              const n = db2.prepare('SELECT COUNT(*) as c FROM nodes').get().c;
              const e = db2.prepare('SELECT COUNT(*) as c FROM edges').get().c;
              const dead = db2
                .prepare(
                  `SELECT COUNT(*) as c FROM nodes n WHERE NOT EXISTS (SELECT 1 FROM edges WHERE source_id=n.id OR target_id=n.id)`,
                )
                .get().c;
              const hubs = db2
                .prepare(
                  `SELECT COUNT(*) as c FROM (SELECT source_id FROM edges GROUP BY source_id HAVING COUNT(*)>20)`,
                )
                .get().c;
              const density = n > 1 ? (e / (n * (n - 1))).toFixed(6) : '0';
              const score = Math.max(
                0,
                Math.min(
                  100,
                  Math.round(100 - (dead / Math.max(n, 1)) * 30 - (hubs / Math.max(n, 1)) * 500),
                ),
              );
              ok(
                `Vital Signs — ${new Date().toISOString()}\n${'─'.repeat(50)}\n  Health Score:  ${score}/100  ${score >= 80 ? '✓ OK' : score >= 60 ? '⚠ Warning' : '✗ Critical'}\n  Nodes:         ${n}\n  Edges:         ${e}\n  Density:       ${density}\n  Dead symbols:  ${dead} (${((dead / Math.max(n, 1)) * 100).toFixed(1)}%)\n  Hub nodes:     ${hubs} nodes with >20 edges`,
              );
            } else if (tool === 'monograph_circular_deps') {
              // Find import cycles using iterative DFS
              const limit = Math.min(parseInt(input.limit || '10', 10) || 10, 20);
              const importEdges = db2
                .prepare(
                  `SELECT source_id, target_id FROM edges WHERE relation IN ('IMPORTS','REQUIRES','USES','DEPENDS_ON') LIMIT 50000`,
                )
                .all();
              const adj = {};
              for (const e of importEdges) {
                (adj[e.source_id] = adj[e.source_id] || []).push(e.target_id);
              }
              const cycles = [];
              const visited = new Set(),
                inStack = new Set();
              function dfs(node, path) {
                if (cycles.length >= limit) return;
                if (inStack.has(node)) {
                  const cycleStart = path.indexOf(node);
                  if (cycleStart >= 0) cycles.push(path.slice(cycleStart).concat(node));
                  return;
                }
                if (visited.has(node)) return;
                visited.add(node);
                inStack.add(node);
                path.push(node);
                for (const nb of adj[node] || []) dfs(nb, path);
                path.pop();
                inStack.delete(node);
              }
              for (const node of Object.keys(adj).slice(0, 2000)) dfs(node, []);
              const getName = (id) => id.split('/').slice(-2).join('/');
              if (!cycles.length)
                ok(
                  `No circular dependencies found among ${Object.keys(adj).length} nodes with import edges.`,
                );
              else
                ok(
                  `Circular Dependencies (${cycles.length} found):\n${'─'.repeat(50)}\n${cycles
                    .slice(0, limit)
                    .map((c, i) => `  ${i + 1}. ${c.map(getName).join(' → ')}`)
                    .join('\n')}`,
                );
            } else if (tool === 'monograph_largest_files') {
              const limit2 = Math.min(parseInt(input.limit || '25', 10) || 25, 50);
              const rows = db2
                .prepare(
                  `SELECT file_path, MAX(end_line) as lines, COUNT(*) as symbols FROM nodes WHERE file_path IS NOT NULL AND end_line IS NOT NULL AND end_line > 0 GROUP BY file_path ORDER BY lines DESC LIMIT ${limit2}`,
                )
                .all();
              if (!rows.length)
                ok(
                  'No line-count data available. Ensure the index was built with source parsing enabled.',
                );
              else
                ok(
                  `Largest Files by Line Count:\n${'─'.repeat(50)}\n${rows.map((r, i) => `  ${String(i + 1).padStart(2)}. ${r.lines.toString().padStart(5)} lines  ${r.symbols} symbols  ${r.file_path.split('/').slice(-2).join('/')}`).join('\n')}`,
                );
            } else if (tool === 'monograph_coupling_balance') {
              // Fan-out (what this file uses) vs Fan-in (what uses this file)
              const limit3 = Math.min(parseInt(input.limit || '20', 10) || 20, 40);
              const fanOut = db2
                .prepare(`SELECT source_id, COUNT(*) as c FROM edges GROUP BY source_id`)
                .all();
              const fanIn = db2
                .prepare(`SELECT target_id, COUNT(*) as c FROM edges GROUP BY target_id`)
                .all();
              const outMap = {},
                inMap = {};
              for (const r of fanOut) outMap[r.source_id] = r.c;
              for (const r of fanIn) inMap[r.target_id] = r.c;
              const allIds = new Set([...Object.keys(outMap), ...Object.keys(inMap)]);
              const nodes3 = db2
                .prepare(`SELECT id, name, file_path FROM nodes WHERE label='File' LIMIT 10000`)
                .all();
              const fileSet = new Set(nodes3.map((n) => n.id));
              const entries = [...allIds]
                .filter((id) => fileSet.has(id))
                .map((id) => {
                  const o = outMap[id] || 0,
                    i = inMap[id] || 0;
                  const n = nodes3.find((x) => x.id === id);
                  return {
                    name: n?.name || id.split('/').pop(),
                    path: n?.file_path || '',
                    out: o,
                    inn: i,
                    ratio: i > 0 ? (o / i).toFixed(1) : '∞',
                  };
                })
                .filter((x) => x.out > 0 || x.inn > 0)
                .sort((a, b) => b.out + b.inn - (a.out + a.inn))
                .slice(0, limit3);
              ok(
                `Coupling Balance (Fan-out vs Fan-in, top ${limit3} by activity):\n${'─'.repeat(60)}\n  ${'File'.padEnd(35)} Out  In  Ratio\n${'─'.repeat(60)}\n${entries.map((e) => `  ${e.name.slice(0, 35).padEnd(35)} ${String(e.out).padStart(3)}  ${String(e.inn).padStart(2)}  ${e.ratio}`).join('\n')}`,
              );
            } else if (tool === 'monograph_dead_exports') {
              // Exported symbols with zero inbound edges
              const exported = db2
                .prepare(
                  `SELECT id, name, label, file_path FROM nodes WHERE is_exported=1 LIMIT 10000`,
                )
                .all();
              const inbound = new Set(
                db2
                  .prepare(`SELECT DISTINCT target_id FROM edges`)
                  .all()
                  .map((r) => r.target_id),
              );
              const dead2 = exported.filter((n) => !inbound.has(n.id));
              if (!dead2.length)
                ok(
                  'No dead exports found — all exported symbols have at least one inbound reference.',
                );
              else
                ok(
                  `Dead Exports — exported but never imported (${dead2.length} of ${exported.length} exported symbols):\n${'─'.repeat(50)}\n${dead2
                    .slice(0, 30)
                    .map(
                      (n) =>
                        `  ${n.label.padEnd(12)} ${n.name}  →  ${(n.file_path || '').split('/').slice(-2).join('/')}`,
                    )
                    .join('\n')}`,
                );
            } else if (tool === 'monograph_language_breakdown') {
              const rows2 = db2
                .prepare(
                  `SELECT language, COUNT(*) as c FROM nodes WHERE language IS NOT NULL AND language != '' GROUP BY language ORDER BY c DESC`,
                )
                .all();
              if (!rows2.length) ok('No language metadata available in this graph index.');
              else {
                const total2 = rows2.reduce((s, r) => s + r.c, 0);
                const maxC = rows2[0].c;
                ok(
                  `Language Breakdown:\n${'─'.repeat(50)}\n${rows2
                    .map((r) => {
                      const bar = '█'.repeat(Math.round((r.c / maxC) * 20));
                      const pct = ((r.c / total2) * 100).toFixed(1);
                      return `  ${r.language.padEnd(15)} ${bar.padEnd(20)} ${String(r.c).padStart(6)} (${pct}%)`;
                    })
                    .join('\n')}\n\n  Total nodes: ${total2}`,
                );
              }
            } else if (tool === 'monograph_instability') {
              // Robert Martin's Instability = Ce / (Ca + Ce)
              // Ca = afferent coupling (in-degree), Ce = efferent coupling (out-degree)
              const _limit4 = Math.min(parseInt(input.limit || '25', 10) || 25, 50);
              const outRows = db2
                .prepare(`SELECT source_id, COUNT(*) as c FROM edges GROUP BY source_id`)
                .all();
              const inRows = db2
                .prepare(`SELECT target_id, COUNT(*) as c FROM edges GROUP BY target_id`)
                .all();
              const Ce = {},
                Ca = {};
              for (const r of outRows) Ce[r.source_id] = r.c;
              for (const r of inRows) Ca[r.target_id] = r.c;
              const fileNodes = db2
                .prepare(`SELECT id, name, file_path FROM nodes WHERE label='File' LIMIT 10000`)
                .all();
              const entries4 = fileNodes
                .map((n) => {
                  const ca = Ca[n.id] || 0,
                    ce = Ce[n.id] || 0;
                  const total = ca + ce;
                  const inst = total > 0 ? ce / total : 0;
                  return { name: n.name || n.id.split('/').pop(), ca, ce, inst };
                })
                .filter((x) => x.ca + x.ce > 0)
                .sort((a, b) => b.inst - a.inst);
              const risky = entries4.filter((x) => x.inst > 0.7 && x.ca > 3);
              const stable = entries4.filter((x) => x.inst < 0.2 && x.ce > 3);
              ok(
                `Instability Index (Ce÷(Ca+Ce), 0=stable 1=unstable):\n${'─'.repeat(60)}\n\n  ⚠  High instability + high dependents (blast radius risk):\n${
                  risky
                    .slice(0, 10)
                    .map(
                      (x) =>
                        `     ${x.name.slice(0, 40).padEnd(40)} I=${x.inst.toFixed(2)}  Ca=${x.ca}  Ce=${x.ce}`,
                    )
                    .join('\n') || '  none'
                }\n\n  ✓  Stable (low instability, many dependents on them):\n${
                  stable
                    .slice(0, 8)
                    .map(
                      (x) =>
                        `     ${x.name.slice(0, 40).padEnd(40)} I=${x.inst.toFixed(2)}  Ca=${x.ca}  Ce=${x.ce}`,
                    )
                    .join('\n') || '  none'
                }\n\n  Total files analyzed: ${entries4.length}`,
              );
            } else if (tool === 'monograph_churn_hotspots') {
              // Combines git churn frequency with structural complexity (out-degree)
              const limit5 = Math.min(parseInt(input.limit || '15', 10) || 15, 30);
              const { execSync: execS2 } = await import('node:child_process');
              const churnMap = {};
              try {
                // Whitelist the --since value — it is interpolated into a shell command below.
                const sinceRaw = String(input.since || '');
                const since = /^\d+ (day|week|month|year)s? ago$/.test(sinceRaw)
                  ? sinceRaw
                  : '6 months ago';
                const log2 = execS2(
                  `git log --since="${since}" --name-only --format="" -- . 2>/dev/null | grep -v '^$' | sort | uniq -c | sort -rn | head -200`,
                  { cwd: d2, encoding: 'utf-8', timeout: 8000 },
                );
                for (const line of log2.trim().split('\n')) {
                  const m = line.trim().match(/^(\d+)\s+(.+)$/);
                  if (m) churnMap[m[2]] = parseInt(m[1], 10);
                }
              } catch {}
              if (!Object.keys(churnMap).length) {
                ok('No git history found — churn analysis requires a git repository.');
              } else {
                const outDeg = db2
                  .prepare(`SELECT source_id, COUNT(*) as c FROM edges GROUP BY source_id`)
                  .all();
                const degMap2 = {};
                for (const r of outDeg) degMap2[r.source_id] = r.c;
                const fileNodes2 = db2
                  .prepare(`SELECT id, name, file_path FROM nodes WHERE label='File' LIMIT 10000`)
                  .all();
                const maxChurn = Math.max(...Object.values(churnMap), 1);
                const maxDeg2 = Math.max(...Object.values(degMap2), 1);
                const scored = fileNodes2
                  .map((n) => {
                    const fp = n.file_path || '';
                    const churn =
                      churnMap[fp] ||
                      Object.entries(churnMap).find(([k]) => fp.endsWith(k))?.[1] ||
                      0;
                    const deg = degMap2[n.id] || 0;
                    const score2 = (churn / maxChurn) * 0.6 + (deg / maxDeg2) * 0.4;
                    return { name: n.name || fp.split('/').pop(), fp, churn, deg, score: score2 };
                  })
                  .filter((x) => x.churn > 0 || x.deg > 5)
                  .sort((a, b) => b.score - a.score)
                  .slice(0, limit5);
                if (!scored.length) ok('No files matched both churn and complexity criteria.');
                else
                  ok(
                    `Churn × Complexity Hotspots (60% churn weight + 40% coupling weight):\n${'─'.repeat(60)}\n  ${'File'.padEnd(38)} Churn  Deps  Score\n${'─'.repeat(60)}\n${scored.map((x) => `  ${x.name.slice(0, 38).padEnd(38)} ${String(x.churn).padStart(5)}  ${String(x.deg).padStart(4)}  ${(x.score * 100).toFixed(0)}%`).join('\n')}\n\n  Analyzed: ${scored.length} hotspot candidates from last ${input.since || '6 months'}`,
                  );
              }
            } else {
              ok(`Tool "${tool}" not implemented in control panel`);
            }
          } finally {
            closeDb(db2);
          }
        } catch (e2) {
          err(String(e2));
        }
      });
      return;
    }

    // -------------------------------------------------------- GET /api/docs
    if (req.method === 'GET' && url === '/api/docs') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const root = path.resolve(dir);
        const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);
        const DOC_EXT = new Set(['.md', '.mdx']);
        const files = [];

        // Dirent.isDirectory() is false for a symlinked directory (it reflects
        // the entry's own type, not the resolved target), so this never
        // follows a symlink into a loop or outside root — no extra guard needed.
        const walk = (abs, rel) => {
          let entries;
          try {
            entries = fs.readdirSync(abs, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries) {
            if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
            const childAbs = path.join(abs, entry.name);
            const childRel = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
              walk(childAbs, childRel);
            } else if (entry.isFile() && DOC_EXT.has(path.extname(entry.name))) {
              let stat;
              try {
                stat = fs.statSync(childAbs);
              } catch {
                continue;
              }
              files.push({ path: childRel, size: stat.size, mtime: stat.mtimeMs });
            }
          }
        };
        walk(root, '');
        files.sort((a, b) => b.mtime - a.mtime);

        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ files, total: files.length }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------------- GET /api/doc-read
    // Returns the raw content of one file discovered by /api/docs. Content
    // exposure is a bigger deal than the metadata /api/docs lists, so
    // containment is checked against known project roots (same allowlist
    // /api/global-doc/read uses) rather than trusting the client-supplied
    // `dir` alone — otherwise `?dir=/` would make any .md file on disk
    // "contained".
    if (req.method === 'GET' && url.startsWith('/api/doc-read')) {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const rel = qs.get('path');
        if (!rel || typeof rel !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'path query param required' }));
          return;
        }
        let resolved = path.resolve(dir, rel);
        try {
          resolved = fs.realpathSync(resolved);
        } catch {}

        const allowedRoots = [path.resolve(projectDir || process.cwd())];
        const projectsBase = path.join(os.homedir(), '.claude', 'projects');
        try {
          for (const slug of fs.readdirSync(projectsBase)) {
            const resolvedProj = resolveSlugToPath(slug, path.join(projectsBase, slug));
            if (resolvedProj) allowedRoots.push(resolvedProj);
          }
        } catch {
          /* projects tree absent — fine */
        }
        const globalBrain =
          process.env.MONOMIND_GLOBAL_BRAIN_DIR ||
          path.join(os.homedir(), '.monomind', 'global-brain');
        if (fs.existsSync(globalBrain)) allowedRoots.push(globalBrain);

        const isAllowed = allowedRoots.some((root) => {
          const relCheck = path.relative(root, resolved);
          return relCheck && !relCheck.startsWith('..') && !path.isAbsolute(relCheck);
        });
        if (!isAllowed || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'path is outside the allowed project roots' }));
          return;
        }
        if (!/\.(md|mdx)$/i.test(resolved)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'only markdown (.md/.mdx) files are readable' }));
          return;
        }
        const body = fs.readFileSync(resolved, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ body }));
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
        // Frontend sends ?range=..., older callers use ?period=... — accept both
        const _periodRaw = qs.get('period') || qs.get('range');
        const period = ['today', 'week', '30days', 'month'].includes(_periodRaw)
          ? _periodRaw
          : 'today';
        const dir = path.resolve(qs.get('dir') || projectDir || process.cwd());
        const trackerPath = path.join(dir, '.claude', 'helpers', 'token-tracker.cjs');
        const fallback = () => {
          const summary = (() => {
            try {
              return JSON.parse(
                fs.readFileSync(
                  path.join(dir, '.monomind', 'metrics', 'token-summary.json'),
                  'utf8',
                ),
              );
            } catch {
              return {};
            }
          })();
          res.writeHead(200, {
            'Content-Type': 'application/json',
            ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
            'Cache-Control': 'no-cache',
          });
          const fbSum = {
            todayCost: summary.todayCost || 0,
            cost: summary.todayCost || 0,
            todayCalls: summary.todayCalls || 0,
            calls: summary.todayCalls || 0,
            totalTokens: 0,
            totalTokensIn: 0,
            totalTokensOut: 0,
            cacheTokens: 0,
            modelCount: 0,
          };
          res.end(
            JSON.stringify({
              summary: fbSum,
              totalCost: summary.todayCost || 0,
              totalCalls: summary.todayCalls || 0,
              totalIn: 0,
              totalOut: 0,
              totalCR: 0,
              totalCW: 0,
              rows: [],
              models: [],
              categories: [],
              tools: [],
              mcpServers: [],
              projects: [],
              modelBreakdown: {},
              categoryBreakdown: {},
              toolBreakdown: {},
              mcpBreakdown: {},
              periodLabel: period,
            }),
          );
        };
        if (!fs.existsSync(trackerPath)) {
          fallback();
          return;
        }
        try {
          const _req = createRequire(import.meta.url);
          const tracker = _req(trackerPath);
          const range = tracker.getDateRange(period);
          const projects = tracker.parseAllSessions(range.start, range.end);
          let totalCost = 0,
            totalIn = 0,
            totalOut = 0,
            totalCR = 0,
            totalCW = 0,
            totalCalls = 0;
          const modelBreakdown = {},
            categoryBreakdown = {},
            toolBreakdown = {},
            mcpBreakdown = {};
          for (const p of projects) {
            totalCost += p.totalCost || 0;
            for (const s of p.sessions || []) {
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
          // Build client-friendly arrays from breakdown dicts
          const models = Object.entries(modelBreakdown)
            .map(([model, m]) => ({ model, cost: m.cost, calls: m.calls, tokens: m.tokens }))
            .sort((a, b) => b.cost - a.cost);
          const categories = Object.entries(categoryBreakdown)
            .map(([category, c]) => ({ category, turns: c.turns, cost: c.cost }))
            .sort((a, b) => b.turns - a.turns);
          const tools = Object.entries(toolBreakdown)
            .map(([tool, t]) => ({ tool, count: t.calls }))
            .sort((a, b) => b.count - a.count);
          const mcpServers = Object.entries(mcpBreakdown)
            .map(([server, m]) => ({ server, count: m.calls }))
            .sort((a, b) => b.count - a.count);
          const projectRows = projects
            .map((p) => ({ project: p.name || p.slug || p.dir || '?', cost: p.totalCost || 0 }))
            .sort((a, b) => b.cost - a.cost);
          // Build rows array from sessions for per-session table
          const rows = [];
          for (const p of projects) {
            for (const s of p.sessions || []) {
              rows.push({
                id: s.id || '',
                session: s.lastPrompt || s.id || '',
                calls: s.apiCalls || 0,
                cost: s.totalCost || 0,
                tokens: (s.totalInputTokens || 0) + (s.totalOutputTokens || 0),
              });
            }
          }
          rows.sort((a, b) => b.cost - a.cost);
          // Summary object matching client expectations
          const summary = {
            todayCost: totalCost,
            cost: totalCost,
            todayCalls: totalCalls,
            calls: totalCalls,
            totalTokens: totalIn + totalOut,
            totalTokensIn: totalIn,
            totalTokensOut: totalOut,
            cacheTokens: totalCR,
            modelCount: models.length,
          };
          res.writeHead(200, {
            'Content-Type': 'application/json',
            ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
            'Cache-Control': 'no-cache',
          });
          res.end(
            JSON.stringify({
              summary,
              totalCost,
              totalCalls,
              totalIn,
              totalOut,
              totalCR,
              totalCW,
              rows,
              models,
              categories,
              tools,
              mcpServers,
              projects: projectRows,
              modelBreakdown,
              categoryBreakdown,
              toolBreakdown,
              mcpBreakdown,
              periodLabel: period,
            }),
          );
        } catch (_e) {
          fallback();
        }
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
          const chunksPath = path.join(
            path.resolve(dir || process.cwd()),
            '.monomind',
            'knowledge',
            'chunks.jsonl',
          );
          let allChunks = [];
          try {
            const raw = fs.readFileSync(chunksPath, 'utf8');
            allChunks = raw
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
          } catch {}
          partial = { knowledge: { ...partial.knowledge, allChunks } };
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
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
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
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

      addSseClient(res);

      req.on('close', () => {
        clearInterval(keepAlive);
        removeSseClient(res);
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

    // ── monoes.me connection routes (extracted to routes-monoes.mjs) ───────
    if (
      await handleMonoesRoutes(req, res, url, corsOrigin, {
        MONOMIND_HOME,
        dashboardPort: _boundPortForCors,
        projectDir,
        _resolveOrgProjectDir,
      })
    )
      return;

    // ── Org/mastermind routes (extracted to routes-org.mjs) ────────────────
    if (
      await handleOrgRoutes(req, res, url, corsOrigin, {
        projectDir,
        activeOrgRuns,
        _resolveOrgProjectDir,
        runStreamClients,
        broadcastMm,
        appendToFile,
        _getActiveRunId,
        removeMmClient,
        _runDb,
        parseAgentDef,
        MONOMIND_HOME,
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
        dashboardAuthValue,
        __dirname,
      })
    )
      return;

    // ------------------------------------------------------------------ 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
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
          let _gfActive = _gfRt.status === 'running';
          if (_gfActive && typeof _gfRt.pid === 'number') {
            try {
              process.kill(_gfRt.pid, 0);
            } catch {
              _gfActive = false;
            }
          }
          if (_gfActive) activeOrgRuns.set(_gfOrg, _gfId);
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Bind to available port (after activeOrgRuns is populated — no race window)
  const boundPort = await bindServer(server, port);
  const url = `http://localhost:${boundPort}`;

  // Self-report the ACTUAL bound port for the spawner (control-start.cjs).
  // An HTTP probe cannot distinguish this server from another project's server
  // already answering on the requested port — this file is identity-proof.
  if (process.env.MONOMIND_BOUND_REPORT) {
    try {
      fs.mkdirSync(path.dirname(process.env.MONOMIND_BOUND_REPORT), { recursive: true });
      fs.writeFileSync(
        process.env.MONOMIND_BOUND_REPORT,
        JSON.stringify({ pid: process.pid, port: boundPort, ts: Date.now() }),
      );
    } catch (_) {
      /* non-fatal — spawner falls back to pid-matched HTTP probe */
    }
  }
  await writeDashboardToken(boundPort);
  propagateDashboardToken(boundPort);

  // ── One-time migration: mastermind-sessions.json → per-session JSONL ─────
  // Runs once on startup. Existing sessions in the old monolithic format are
  // split into individual JSONL files + _index.json for O(1) event writes.
  try {
    const _migDataDir = path.join(projectDir || process.cwd(), 'data');
    const _migOldFile = path.join(_migDataDir, 'mastermind-sessions.json');
    const _migSessDir = path.join(_migDataDir, 'sessions');
    const _migIndexFile = path.join(_migSessDir, '_index.json');
    if (fs.existsSync(_migOldFile) && !fs.existsSync(_migIndexFile)) {
      try {
        const _migOld = JSON.parse(fs.readFileSync(_migOldFile, 'utf8'));
        fs.mkdirSync(_migSessDir, { recursive: true });
        const _migIndex = [];
        for (const sess of _migOld || []) {
          const _msid = String(sess.id || '').trim();
          if (!_msid || !SESSION_ID_RE.test(_msid)) continue;
          // Write per-session JSONL
          const _mEvts = sess.events || [];
          const _mLines = _mEvts.map((e) => JSON.stringify(e)).join('\n');
          fs.writeFileSync(
            path.join(_migSessDir, `${_msid}.jsonl`),
            _mLines + (_mLines ? '\n' : ''),
          );
          _migIndex.push({
            id: _msid,
            ts: sess.ts,
            prompt: sess.prompt || '',
            status: sess.status || 'complete',
            org: sess.org || '',
            startedAt: sess.ts || sess.startedAt,
            endedAt: sess.endTs || sess.endedAt,
            domains: sess.domains || [],
          });
        }
        fs.writeFileSync(_migIndexFile, JSON.stringify(_migIndex));
        console.log(`[server] migrated ${_migIndex.length} sessions to per-session JSONL format`);
      } catch (_me) {
        console.warn('[server] session migration failed:', _me.message);
      }
    }
  } catch (_) {}

  // ---------------------------------------------------------------- Watchers
  let debounceTimer = null;
  const pendingSections = new Set();

  function scheduleRefresh(_event, filename) {
    const sections = pathToSections(filename);
    if (sections) sections.forEach((s) => pendingSections.add(s));
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const changed =
        pendingSections.size > 0
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

  // ── Phase 1: fs.watch orgs dir — pick up run events written directly to JSONL files
  // without going through the HTTP endpoint (e.g. when runorg.md bash writes run:start directly).
  // Also forwards new bytes to per-org SSE clients (runStreamClients) so the chat tab
  // receives bash-written lifecycle events in real-time (Phase 3 gap-fill).
  const _orgsFileSizes = new Map(); // absPath → last known byte offset
  const _MAX_ORGS_FILE_SIZES = 1000;
  function _readNewOrgLines(absPath, orgName, runId) {
    try {
      const stat = fs.statSync(absPath);
      const prevSize = _orgsFileSizes.get(absPath) || 0;
      if (stat.size <= prevSize) return; // nothing new
      if (!_orgsFileSizes.has(absPath) && _orgsFileSizes.size >= _MAX_ORGS_FILE_SIZES) {
        const oldest = _orgsFileSizes.keys().next().value;
        _orgsFileSizes.delete(oldest);
      }
      _orgsFileSizes.set(absPath, stat.size);
      // Read only the new bytes to avoid re-processing existing lines
      const fd = fs.openSync(absPath, 'r');
      const newLen = stat.size - prevSize;
      const buf = Buffer.alloc(newLen);
      fs.readSync(fd, buf, 0, newLen, prevSize);
      fs.closeSync(fd);
      const newText = buf.toString('utf8');
      const newLines = newText.split('\n').filter(Boolean);
      const clients = runStreamClients.get(orgName);
      for (const _rawLine of newLines) {
        let ev;
        try {
          ev = JSON.parse(_rawLine);
        } catch {
          continue;
        }
        if (!ev?.type) continue;
        // Index in SQLite (watcher path — bash-written lifecycle events)
        if (!ev.org) ev.org = orgName;
        if (!ev.runId) ev.runId = runId;
        _insertRunEvent(ev, 'watcher');
        // Update activeOrgRuns based on file-watcher evidence
        if ((ev.type === 'run:start' || ev.type === 'org:start') && ev.runId) {
          activeOrgRuns.set(orgName, String(ev.runId).trim());
        } else if (
          ev.type === 'run:complete' ||
          ev.type === 'org:complete' ||
          ev.type === 'org:stop'
        ) {
          activeOrgRuns.delete(orgName);
        }
        // Forward to per-org SSE clients so the chat tab gets live bash-written events
        if (clients && clients.size > 0) {
          const _sseData = `data: ${_rawLine}\n\n`;
          for (const _cl of clients) {
            try {
              _cl.write(_sseData);
            } catch (_) {
              clients.delete(_cl);
            }
          }
        }
        // Also broadcast to mastermind-stream for the org activity strip
        if (ev.org && ev.org === orgName) broadcastMm({ ...ev, _fromWatcher: true });
      }
    } catch (_) {}
  }

  function watchOrgsDir() {
    const _orgsDir = path.join(MONOMIND_HOME, '.monomind', 'orgs');
    if (!fs.existsSync(_orgsDir)) {
      // Orgs dir may not exist yet; watch parent and re-try when it appears
      const _parentDir = path.join(MONOMIND_HOME, '.monomind');
      if (fs.existsSync(_parentDir)) {
        try {
          fs.watch(_parentDir, (_evType, _fname) => {
            if (_fname === 'orgs' && fs.existsSync(_orgsDir)) watchOrgsDir();
          });
        } catch (_) {}
      }
      return;
    }
    // Seed initial file sizes so the watcher only forwards NEW bytes after startup
    try {
      for (const _org of fs.readdirSync(_orgsDir)) {
        const _runsDir = path.join(_orgsDir, _org, 'runs');
        if (!fs.existsSync(_runsDir)) continue;
        for (const _f of fs
          .readdirSync(_runsDir)
          .filter(
            (f) =>
              f.endsWith('.jsonl') &&
              !f.startsWith('._') &&
              !f.endsWith('.warm.jsonl') &&
              !f.endsWith('.convs.jsonl'),
          )) {
          try {
            const _absF = path.join(_runsDir, _f);
            if (_orgsFileSizes.size >= _MAX_ORGS_FILE_SIZES) {
              const _k = _orgsFileSizes.keys().next().value;
              _orgsFileSizes.delete(_k);
            }
            _orgsFileSizes.set(_absF, fs.statSync(_absF).size);
          } catch (_) {}
        }
      }
    } catch (_) {}
    // Use chokidar when available (Linux requires it — fs.watch { recursive } is macOS/Windows only).
    // Falls back to fs.watch for environments where chokidar is absent.
    let _watcherStarted = false;
    try {
      const chokidar = _require('chokidar');
      const _chokidarWatcher = chokidar.watch(_orgsDir, {
        persistent: false,
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
      _chokidarWatcher.on('add', _handleChokidarPath);
      _chokidarWatcher.on('change', _handleChokidarPath);
      activeWatchers.push({ close: () => _chokidarWatcher.close() });
      _watcherStarted = true;
    } catch (_chokidarErr) {
      /* chokidar unavailable — fall through to fs.watch */
    }
    if (!_watcherStarted) {
      try {
        const _orgsWatcher = fs.watch(
          _orgsDir,
          { recursive: true, persistent: false },
          (_evType, _fname) => {
            if (
              !_fname?.endsWith('.jsonl') ||
              _fname.endsWith('.warm.jsonl') ||
              _fname.endsWith('.convs.jsonl')
            )
              return;
            const _parts = _fname.replace(/\\/g, '/').split('/');
            if (_parts.length >= 3 && _parts[1] === 'runs') {
              const _wOrgName = _parts[0];
              const _wRunId = _parts[2].replace('.jsonl', '');
              if (
                _wOrgName &&
                _wRunId &&
                /^[a-z0-9][a-z0-9_-]*$/i.test(_wOrgName) &&
                /^[a-z0-9][a-z0-9_-]*$/i.test(_wRunId)
              ) {
                _readNewOrgLines(
                  path.join(_orgsDir, _fname.replace(/\\/g, '/')),
                  _wOrgName,
                  _wRunId,
                );
              }
            }
          },
        );
        activeWatchers.push(_orgsWatcher);
      } catch (_wErr) {
        console.warn(
          '[monomind] watchOrgsDir: both chokidar and fs.watch failed — bash-written lifecycle events will not reach SSE clients. HTTP-posted events still work via spool DLQ.',
        );
      }
    }
  }
  watchOrgsDir();

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

  // ── Phase 2: Spool polling — replay undelivered events from capture-handler (Issue 5) ──
  // capture-handler writes events to spool/ before HTTP POST. If the POST fails (server
  // down, timeout), the file stays. We poll every 5s and replay them.
  const _spoolBaseDir = path.join(MONOMIND_HOME, '.monomind', 'capture', 'spool');
  const _spoolTimer = setInterval(() => {
    if (!fs.existsSync(_spoolBaseDir)) return;
    try {
      const _spoolFiles = fs
        .readdirSync(_spoolBaseDir)
        .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
        .sort() // chronological (timestamp prefix)
        .slice(0, 20); // max 20 per cycle to avoid flooding
      for (const _sf of _spoolFiles) {
        const _sfPath = path.join(_spoolBaseDir, _sf);
        try {
          const _spoolEvent = JSON.parse(fs.readFileSync(_sfPath, 'utf8'));
          const _spoolBody = JSON.stringify(_spoolEvent);
          const _spoolReq = http.request(
            {
              hostname: 'localhost',
              port: boundPort,
              path: '/api/mastermind/event',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(_spoolBody),
              },
            },
            (_spoolRes) => {
              // Delete only after confirmed delivery; leave file on failure for next poll cycle
              if (_spoolRes.statusCode >= 200 && _spoolRes.statusCode < 300) {
                try {
                  fs.unlinkSync(_sfPath);
                } catch (_) {}
              }
              _spoolRes.resume();
            },
          );
          _spoolReq.on('error', () => {});
          _spoolReq.setTimeout(2000, () => {
            _spoolReq.destroy();
          });
          _spoolReq.write(_spoolBody);
          _spoolReq.end();
        } catch (_e) {}
      }
    } catch (_) {}
  }, 5000);
  // Clean up spool files older than 8 hours on startup (stale captures from crashed sessions)
  try {
    if (fs.existsSync(_spoolBaseDir)) {
      const _staleMs = 8 * 60 * 60 * 1000;
      fs.readdirSync(_spoolBaseDir)
        .filter((f) => f.endsWith('.json'))
        .forEach((_staleF) => {
          const _staleP = path.join(_spoolBaseDir, _staleF);
          try {
            if (Date.now() - fs.statSync(_staleP).mtimeMs > _staleMs) fs.unlinkSync(_staleP);
          } catch (_) {}
        });
    }
  } catch (_) {}

  // ── Phase 3: Read-batch polling — aggregate file-read events from capture-handler (Issue 9) ──
  // capture-handler writes Read tool calls to capture/read-batch-{ppid}-{pid}.json (per-subagent, no sharing).
  // Server polls every 3s, aggregates all matching files per session, emits agent:read:batch, removes files.
  const _rbDir = path.join(MONOMIND_HOME, '.monomind', 'capture');
  const _rbTimer = setInterval(() => {
    if (!fs.existsSync(_rbDir)) return;
    try {
      fs.readdirSync(_rbDir)
        .filter((f) => f.startsWith('read-batch-') && f.endsWith('.json'))
        .forEach((_rbf) => {
          const _rbPath = path.join(_rbDir, _rbf);
          try {
            const _rbData = JSON.parse(fs.readFileSync(_rbPath, 'utf8'));
            fs.unlinkSync(_rbPath);
            if (!Array.isArray(_rbData) || _rbData.length === 0) return;
            const _rbOrg = String(_rbData[0].org || '').trim();
            const _rbRunId = String(_rbData[0].runId || '').trim();
            const _rbEvent = {
              type: 'agent:read:batch',
              org: _rbOrg,
              runId: _rbRunId,
              paths: _rbData.map((e) => String(e.path || '').slice(0, 256)),
              count: _rbData.length,
              ts: Date.now(),
            };
            const _rbBody = JSON.stringify(_rbEvent);
            const _rbReq = http.request(
              {
                hostname: 'localhost',
                port: boundPort,
                path: '/api/mastermind/event',
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(_rbBody),
                },
              },
              () => {},
            );
            _rbReq.on('error', () => {});
            _rbReq.setTimeout(2000, () => {
              _rbReq.destroy();
            });
            _rbReq.write(_rbBody);
            _rbReq.end();
          } catch (_e) {}
        });
    } catch (_) {}
  }, 3000);

  // ── Phase 4: Daemon heartbeat — ps -p {ppid} liveness check (Issue 8) ──
  // Periodically checks if the Claude Code session (tracked via ppid-keyed files) is still alive.
  // If the parent process is gone, auto-emits org:stop to close stale LIVE orgs in the dashboard.
  const _ppidCheckDir = path.join(MONOMIND_HOME, '.monomind', 'capture', 'active-runs');
  const _heartbeatTimer = setInterval(() => {
    if (!fs.existsSync(_ppidCheckDir)) return;
    try {
      fs.readdirSync(_ppidCheckDir)
        .filter((f) => f.endsWith('.json'))
        .forEach((_ppf) => {
          const _ppPath = path.join(_ppidCheckDir, _ppf);
          try {
            const _ppData = JSON.parse(fs.readFileSync(_ppPath, 'utf8'));
            const _ppid = parseInt(_ppf.replace('.json', ''), 10);
            if (!_ppid || Number.isNaN(_ppid)) return;
            // Check if the ppid process is still alive (signal 0 = probe, no kill)
            try {
              process.kill(_ppid, 0);
              // Process alive — no action
            } catch (_psErr) {
              // Process gone — emit org:stop and remove the ppid file
              fs.unlinkSync(_ppPath);
              const _staleOrg = String(_ppData.org || '').trim();
              const _staleRun = String(_ppData.runId || '').trim();
              if (_staleOrg && activeOrgRuns.has(_staleOrg)) {
                const _stopBody = JSON.stringify({
                  type: 'org:stop',
                  org: _staleOrg,
                  runId: _staleRun,
                  reason: 'ppid-dead',
                  ts: Date.now(),
                });
                const _stopReq = http.request(
                  {
                    hostname: 'localhost',
                    port: boundPort,
                    path: '/api/mastermind/event',
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Content-Length': Buffer.byteLength(_stopBody),
                    },
                  },
                  () => {},
                );
                _stopReq.on('error', () => {});
                _stopReq.setTimeout(2000, () => {
                  _stopReq.destroy();
                });
                _stopReq.write(_stopBody);
                _stopReq.end();
              }
            }
          } catch (_) {}
        });
    } catch (_) {}
  }, 60000); // every 60s — intentionally infrequent, just a safety net

  // Update module-level state
  running = true;
  currentPort = boundPort;
  currentUrl = url;
  _activeServer = server;

  // --------------------------------------------------------- Graceful shutdown
  function shutdown() {
    clearInterval(_spoolTimer);
    clearInterval(_rbTimer);
    clearInterval(_heartbeatTimer);
    // Flush SQLite run-event index to disk before exit (bypasses 1000ms debounce timer)
    clearTimeout(_runDbPersistTimer);
    _writeRunDbSnapshot();
    for (const w of activeWatchers) {
      try {
        w.close();
      } catch {
        // Already closed
      }
    }
    activeWatchers.length = 0;

    // Close all SSE connections
    closeSseClients();

    // Drain in-flight JSONL appends before closing (prevents truncated writes on fast SIGTERM)
    Promise.all([..._writeQueue.values()])
      .catch(() => {})
      .finally(() => {
        server.close(() => {
          running = false;
          currentPort = null;
          currentUrl = null;
          _activeServer = null;
          process.exit(0);
        });
      });
  }

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGHUP', shutdown);

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
    clientCount: getSseClientCount(),
  };
}

// Auto-start when invoked directly: node server.mjs [port]
const _isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (_isMain) {
  const _port = parseInt(process.argv[2] || process.env.CONTROL_PORT || '4242', 10);
  const _dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  startServer({ port: _port, openBrowser: false, projectDir: _dir }).catch((err) => {
    process.stderr.write(`[server] failed to start: ${err.message}\n`);
    process.exit(1);
  });
}
