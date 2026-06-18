'use strict';
/**
 * Session state management for hook-handler.cjs
 * Persists session data to .git/monomind/sessions/current.json (branch-agnostic,
 * shared across git worktrees). Falls back to .monomind/sessions/ if not in a git repo.
 *
 * API: start(), restore(), end(), status(), metric(key), update(patch)
 */

const path = require('path');
const fs = require('fs');

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function getMonoDir(workDir) {
  try {
    const gitEntry = path.join(workDir, '.git');
    const st = fs.statSync(gitEntry);
    if (st.isDirectory()) return path.join(gitEntry, 'monomind');
    if (st.isFile()) {
      const m = fs.readFileSync(gitEntry, 'utf8').match(/^gitdir:\s*(.+)/m);
      if (m) {
        const worktreeDir = path.resolve(workDir, m[1].trim());
        return path.join(path.dirname(path.dirname(worktreeDir)), 'monomind');
      }
    }
  } catch {}
  return path.join(workDir, '.monomind');
}

const SESSIONS_DIR = path.join(getMonoDir(CWD), 'sessions');
const CURRENT_FILE = path.join(SESSIONS_DIR, 'current.json');

var KNOWN_METRICS = new Set(['edits', 'commands', 'tasks', 'errors']);

function ensureDir() {
  try { fs.mkdirSync(SESSIONS_DIR, { recursive: true }); } catch (_) {}
}

function readCurrent() {
  try {
    if (!fs.existsSync(CURRENT_FILE)) return null;
    var st = fs.statSync(CURRENT_FILE);
    if (st.size > 1 * 1024 * 1024) return null;
    var raw = fs.readFileSync(CURRENT_FILE, 'utf-8');
    var data = JSON.parse(raw);
    if (!data || !data.id) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function writeCurrent(data) {
  ensureDir();
  try {
    fs.writeFileSync(CURRENT_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (_) {}
}

// ── start ──────────────────────────────────────────────────────────────────────

function start() {
  var sessionId = 'session-' + Date.now();
  var sess = {
    id: sessionId,
    startedAt: new Date().toISOString(),
    context: {},
    metrics: { edits: 0, commands: 0, tasks: 0, errors: 0 },
  };
  writeCurrent(sess);
  return sess;
}

// ── restore ────────────────────────────────────────────────────────────────────

function restore() {
  var data = readCurrent();
  if (!data) return null;
  data.restoredAt = new Date().toISOString();
  writeCurrent(data);
  return data;
}

// ── end ────────────────────────────────────────────────────────────────────────

function end() {
  var data = readCurrent();
  if (!data) return null;

  var startTs = new Date(data.startedAt).getTime();
  var endTs = Date.now();
  var duration = endTs - startTs;

  var archived = Object.assign({}, data, {
    endedAt: new Date(endTs).toISOString(),
    duration: duration,
  });

  // Archive to <session-id>.json
  try {
    var archivePath = path.join(SESSIONS_DIR, data.id + '.json');
    fs.writeFileSync(archivePath, JSON.stringify(archived, null, 2), 'utf-8');
  } catch (_) {}

  // Remove current.json
  try { fs.unlinkSync(CURRENT_FILE); } catch (_) {}

  return archived;
}

// ── status ─────────────────────────────────────────────────────────────────────

function status() {
  return readCurrent();
}

// ── metric ─────────────────────────────────────────────────────────────────────

function metric(key) {
  var data = readCurrent();
  if (!data) return null;
  if (!KNOWN_METRICS.has(key)) return data;

  data.metrics[key] = (data.metrics[key] || 0) + 1;
  writeCurrent(data);
  return data;
}

// ── update ─────────────────────────────────────────────────────────────────────

function update(patch) {
  var existing = readCurrent();
  if (!existing) return null;
  var merged = Object.assign({}, existing, patch, { updatedAt: new Date().toISOString() });
  writeCurrent(merged);
  return merged;
}

module.exports = { start, restore, end, status, metric, update };
