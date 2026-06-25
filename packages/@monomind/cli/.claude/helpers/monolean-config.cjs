'use strict';
const path = require('path');
const fs = require('fs');

const VALID_MODES = ['off', 'lite', 'full', 'ultra', 'review'];
const DEFAULT_MODE = 'full';
const STATE_RELPATH = '.monomind/state/monolean-mode';

// Walk up from CLAUDE_PROJECT_DIR then cwd to find the project root containing the state file.
// Required for SubagentStart hooks where CLAUDE_PROJECT_DIR may differ from the parent project.
function findStateFile() {
  const candidates = [];
  if (process.env.CLAUDE_PROJECT_DIR) {
    candidates.push(process.env.CLAUDE_PROJECT_DIR);
  }
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    candidates.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const base of candidates) {
    const p = path.join(base, STATE_RELPATH);
    if (fs.existsSync(p)) return p;
  }
  // Fall back to writing relative to CLAUDE_PROJECT_DIR or cwd (for setMode)
  return path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), STATE_RELPATH);
}

function normalizeMode(mode) {
  if (typeof mode !== 'string') return null;
  const normalized = mode.trim().toLowerCase();
  return ['off', 'lite', 'full', 'ultra'].includes(normalized) ? normalized : null;
}

function normalizePersistedMode(mode) {
  if (typeof mode !== 'string') return null;
  const normalized = mode.trim().toLowerCase();
  return VALID_MODES.includes(normalized) ? normalized : null;
}

function getDefaultMode() {
  const env = process.env.MONOLEAN_DEFAULT_MODE;
  if (env && VALID_MODES.includes(env.toLowerCase())) return env.toLowerCase();
  try {
    const val = fs.readFileSync(findStateFile(), 'utf8').trim();
    if (val && VALID_MODES.includes(val)) return val;
  } catch { /* fall through */ }
  return DEFAULT_MODE;
}

function setMode(mode) {
  const f = findStateFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, mode);
}

function readMode() {
  try { return fs.readFileSync(findStateFile(), 'utf8').trim() || null; } catch { return null; }
}

function clearMode() {
  try { fs.unlinkSync(findStateFile()); } catch {}
}

function isDeactivationCommand(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[.!?\s]+$/, '');
  return t === 'stop monolean' || t === 'normal mode';
}

module.exports = {
  VALID_MODES, DEFAULT_MODE,
  normalizeMode, normalizePersistedMode,
  getDefaultMode, setMode, readMode, clearMode, isDeactivationCommand,
};
