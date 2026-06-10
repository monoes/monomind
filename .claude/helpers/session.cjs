'use strict';
/**
 * Session state management for hook-handler.cjs
 * Persists session data to .monomind/session-state.json
 */

const path = require('path');
const fs = require('fs');

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const SESSION_FILE = path.join(CWD, '.monomind', 'session-state.json');

function ensureDir() {
  try { fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true }); } catch (_) {}
}

function restore() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return null;
    var raw = fs.readFileSync(SESSION_FILE, 'utf-8');
    var data = JSON.parse(raw);
    if (!data || !data.sessionId) return null;
    console.log('[OK] Session restored: ' + data.sessionId);
    return data;
  } catch (_) {
    return null;
  }
}

function start() {
  ensureDir();
  var sessionId = 'session-' + Date.now();
  var data = { sessionId: sessionId, startedAt: new Date().toISOString(), editCount: 0, taskCount: 0 };
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), 'utf-8');
    console.log('[OK] Session started: ' + sessionId);
  } catch (_) {}
  return data;
}

function update(patch) {
  ensureDir();
  try {
    var existing = restore() || start();
    var merged = Object.assign({}, existing, patch, { updatedAt: new Date().toISOString() });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(merged, null, 2), 'utf-8');
    return merged;
  } catch (_) {
    return null;
  }
}

function end() {
  try {
    var data = restore();
    if (data) {
      update({ endedAt: new Date().toISOString() });
      console.log('[OK] Session ended: ' + data.sessionId);
    }
  } catch (_) {}
}

module.exports = { restore, start, update, end };
