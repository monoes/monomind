'use strict';
/**
 * Intelligence context module for hook-handler.cjs
 * Provides context injection, trajectory logging, and feedback recording.
 */

const path = require('path');
const fs = require('fs');

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const INTEL_DIR = path.join(CWD, '.monomind', 'intelligence');
const PATTERNS_FILE = path.join(INTEL_DIR, 'patterns.json');
const TRAJECTORY_FILE = path.join(INTEL_DIR, 'trajectory.json');

var _initialized = false;
var _patterns = [];
var _trajectory = [];

function ensureDir() {
  try { fs.mkdirSync(INTEL_DIR, { recursive: true }); } catch (_) {}
}

var MAX_PATTERNS_SIZE = 10 * 1024 * 1024; // 10 MiB guard

function loadPatterns() {
  try {
    if (fs.existsSync(PATTERNS_FILE)) {
      var st = fs.statSync(PATTERNS_FILE);
      if (st.size > MAX_PATTERNS_SIZE) { _patterns = []; return; }
      _patterns = JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf-8'));
    }
  } catch (_) { _patterns = []; }
}

function init() {
  if (_initialized) return { ok: true, patternCount: _patterns.length };
  ensureDir();
  loadPatterns();
  _initialized = true;
  return { ok: true, patternCount: _patterns.length };
}

function getContext(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;
  if (!_initialized) init();
  // Match patterns against prompt
  var matches = _patterns.filter(function(p) {
    return p.keywords && p.keywords.some(function(kw) {
      return prompt.toLowerCase().includes(kw.toLowerCase());
    });
  });
  if (matches.length === 0) return null;
  var top = matches[0];
  return '[INTELLIGENCE] Pattern match: ' + (top.name || top.id || 'pattern') +
         (top.suggestion ? ' — ' + top.suggestion : '');
}

function logTrajectory(step) {
  ensureDir();
  _trajectory.push(Object.assign({ ts: new Date().toISOString() }, step || {}));
  // Flush every 10 steps to avoid excessive writes
  if (_trajectory.length % 10 === 0) {
    try {
      fs.writeFileSync(TRAJECTORY_FILE, JSON.stringify(_trajectory.slice(-200), null, 2), 'utf-8');
    } catch (_) {}
  }
}

function feedback(success) {
  // Record outcome for last trajectory step
  if (_trajectory.length > 0) {
    _trajectory[_trajectory.length - 1].outcome = success ? 'success' : 'failure';
  }
  // Persist
  ensureDir();
  try {
    fs.writeFileSync(TRAJECTORY_FILE, JSON.stringify(_trajectory.slice(-200), null, 2), 'utf-8');
  } catch (_) {}
}

function storePattern(pattern) {
  ensureDir();
  loadPatterns();
  var safeId = String(pattern.id || '').slice(0, 256);
  _patterns = _patterns.filter(function(p) { return p.id !== safeId; });
  _patterns.push(Object.assign({ storedAt: new Date().toISOString() }, pattern, { id: safeId }));
  try {
    fs.writeFileSync(PATTERNS_FILE, JSON.stringify(_patterns.slice(-500), null, 2), 'utf-8');
  } catch (_) {}
}

module.exports = { init, getContext, logTrajectory, feedback, storePattern };
