#!/usr/bin/env node
/**
 * Monomind Control Stop
 * Kills monomind background processes.
 *
 * Usage:
 *   node control-stop.cjs              — kill everything (dashboard, watcher, builds)
 *   node control-stop.cjs --session    — kill session-scoped only (builds), leave dashboard/watcher alive
 *
 * The Stop hook uses --session so the dashboard survives between conversations.
 * Manual invocation (no flag) kills everything.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const sessionOnly = process.argv.includes('--session');

/**
 * Guard against a stale PID file outliving its process and the OS recycling
 * that PID for an unrelated process — verify the live process actually looks
 * like ours (node running something under this project) before signaling it.
 */
function looksLikeOurProcess(pid) {
  try {
    const { execSync } = require('child_process');
    const cmd = execSync(`ps -p ${pid} -o command=`, { timeout: 2000, encoding: 'utf-8' }).trim();
    // Covers direct `node ...` spawns (the common dev/monorepo path) as well
    // as the npx fallback in control-start.cjs's findCliPath(), which shows
    // up in `ps` as "npm exec ..." / "npx ..." with no literal "node".
    const looksLikeNode = cmd.includes('node') || cmd.includes('npx') || cmd.includes('npm exec');
    return looksLikeNode && (cmd.includes('monomind') || cmd.includes(CWD));
  } catch {
    return false; // ps failed (pid gone, or platform without ps) — don't signal
  }
}

function killByPidFile(pidPath) {
  try {
    if (!fs.existsSync(pidPath)) return false;
    if (fs.statSync(pidPath).size > 32) { try { fs.unlinkSync(pidPath); } catch {} return false; }
    const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    if (looksLikeOurProcess(pid)) process.kill(pid, 'SIGTERM');
    try { fs.unlinkSync(pidPath); } catch {}
    return true;
  } catch {
    try { fs.unlinkSync(pidPath); } catch {}
    return false;
  }
}

let stopped = 0;

// --- Shared singletons (skip with --session) ---

if (!sessionOnly) {
  // Dashboard server
  const controlJson = path.join(CWD, '.monomind', 'control.json');
  try {
    if (fs.existsSync(controlJson) && fs.statSync(controlJson).size <= 4 * 1024) {
      const status = JSON.parse(fs.readFileSync(controlJson, 'utf-8'));
      if (status && Number.isInteger(status.pid) && status.pid > 0 && looksLikeOurProcess(status.pid)) {
        try {
          process.kill(status.pid, 'SIGTERM');
          stopped++;
          console.log(`[control-stop] killed dashboard (pid ${status.pid})`);
        } catch {}
      }
      try { fs.unlinkSync(controlJson); } catch {}
    }
  } catch {}

  // Monograph watcher (both PID file variants)
  for (const name of ['monograph.watch.pid', 'monograph-watch.pid']) {
    if (killByPidFile(path.join(CWD, '.monomind', name))) {
      stopped++;
      console.log(`[control-stop] killed monograph watcher (${name})`);
    }
  }
}

// --- Session-scoped processes (always killed) ---

// Monograph background build
if (killByPidFile(path.join(CWD, '.monomind', 'graph', 'build.pid'))) {
  stopped++;
  console.log('[control-stop] killed monograph build');
}

if (stopped === 0) {
  console.log(`[control-stop] no ${sessionOnly ? 'session ' : ''}processes found`);
}
