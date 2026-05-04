#!/usr/bin/env node
/**
 * Monomind Control Start
 * Ensures the Monomind Neural Control Room (web UI) is running.
 * Called from SessionStart hook — exits immediately after spawning.
 *
 * Status written to: .monomind/control.json
 * Port: 4242 (default, auto-increments on collision)
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const STATUS_FILE = path.join(CWD, '.monomind', 'control.json');
const DEFAULT_PORT = 4242;

function readStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeStatus(pid, port) {
  try {
    fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify({
      pid,
      port,
      url: `http://localhost:${port}`,
      startedAt: new Date().toISOString(),
    }), 'utf-8');
  } catch { /* ignore */ }
}

function findCliPath() {
  // Try local monorepo server.mjs first (direct — no CLI subcommand needed)
  const serverMjs = path.join(CWD, 'packages', '@monomind', 'cli', 'dist', 'src', 'ui', 'server.mjs');
  if (fs.existsSync(serverMjs)) return { cmd: process.execPath, args: [serverMjs], usePort: true };

  // Try local CLI bin as fallback
  const local = path.join(CWD, 'packages', '@monomind', 'cli', 'bin', 'cli.js');
  if (fs.existsSync(local)) return { cmd: process.execPath, args: [local], usePort: false };

  // Try npx monomind as last resort
  return { cmd: 'npx', args: ['monomind@latest'], usePort: false };
}

function main() {
  // If already running, do nothing
  const status = readStatus();
  if (status && status.pid && isPidAlive(status.pid)) {
    process.stdout.write(`[control] already running on port ${status.port} (pid ${status.pid})\n`);
    process.exit(0);
  }

  const { cmd, args, usePort } = findCliPath();
  // server.mjs accepts port as second positional arg; CLI uses 'ui --no-open --port N'
  const allArgs = usePort
    ? [...args, String(DEFAULT_PORT)]
    : [...args, 'ui', '--no-open', '--port', String(DEFAULT_PORT)];

  const child = spawn(cmd, allArgs, {
    detached: true,
    stdio: 'ignore',
    cwd: CWD,
    env: { ...process.env, CLAUDE_PROJECT_DIR: CWD },
  });

  child.unref();

  writeStatus(child.pid, DEFAULT_PORT);
  process.stdout.write(`[control] started Neural Control Room on port ${DEFAULT_PORT} (pid ${child.pid})\n`);
  process.exit(0);
}

main();
