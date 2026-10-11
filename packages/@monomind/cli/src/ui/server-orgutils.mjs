import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './org-hil.mjs';
import { _getGitMonomindDir } from './server-fileutils.mjs';

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
      writeFileAtomic(file, JSON.stringify(cur, null, 2));
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
        writeFileAtomic(file, JSON.stringify(rs, null, 2));
      } catch (_) {}
    }, 5000);
    _runstateDebouncers.set(orgName, { timer });
  }
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

export {
  _detectMimeType,
  _getActiveRunId,
  _getAllowedArtifactDirs,
  _readRunState,
  _resolveOrgProjectDir,
  _updateRunState,
  parseAgentDef,
};
