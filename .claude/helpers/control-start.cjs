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
      // Guard against OOM: control.json should never exceed 4 KiB
      const stat = fs.statSync(STATUS_FILE);
      if (stat.size > 4 * 1024) return null;
      return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}

function isPidAlive(pid) {
  // Validate pid is a positive integer — negative or zero pid would signal the process group
  if (!Number.isInteger(pid) || pid <= 0) return false;
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

  // Try global npm install paths for both package names
  // npm root -g is slow; probe known conventional paths instead
  const globalCandidates = [];
  try {
    const { execSync } = require('child_process');
    const npmRoot = execSync('npm root -g', { timeout: 3000, encoding: 'utf-8' }).trim();
    if (npmRoot) {
      globalCandidates.push(
        path.join(npmRoot, 'monomind', 'packages', '@monomind', 'cli', 'dist', 'src', 'ui', 'server.mjs'),
        path.join(npmRoot, '@monoes', 'monomindcli', 'dist', 'src', 'ui', 'server.mjs'),
        path.join(npmRoot, 'monomind', 'packages', '@monomind', 'cli', 'bin', 'cli.js'),
        path.join(npmRoot, '@monoes', 'monomindcli', 'bin', 'cli.js'),
      );
    }
  } catch { /* npm root -g failed — skip */ }

  for (const candidate of globalCandidates) {
    if (fs.existsSync(candidate)) {
      const usePort = candidate.endsWith('server.mjs');
      return { cmd: process.execPath, args: [candidate], usePort };
    }
  }

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

  // Write optimistic status with DEFAULT_PORT immediately so dependent scripts
  // (hooks, boss agents) have something to read while the server starts up.
  writeStatus(child.pid, DEFAULT_PORT);
  process.stdout.write(`[control] started Neural Control Room on port ${DEFAULT_PORT} (pid ${child.pid})\n`);

  // If port 4242 was in use, server.mjs auto-increments (up to +10).
  // Poll a few ports to find where it actually bound and update control.json.
  const http = require('http');
  function probePort(p) {
    return new Promise((resolve) => {
      const req = http.get({ hostname: 'localhost', port: p, path: '/api/status', timeout: 1000 }, (res) => {
        res.resume();
        resolve(res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  // Give the server up to ~3 s to start, then confirm the actual port.
  async function confirmPort() {
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise(r => setTimeout(r, 500));
      for (let delta = 0; delta <= 10; delta++) {
        const p = DEFAULT_PORT + delta;
        if (await probePort(p)) {
          if (p !== DEFAULT_PORT) {
            writeStatus(child.pid, p);
            process.stdout.write(`[control] server bound to port ${p} (updated control.json)\n`);
          }
          return;
        }
      }
    }
    // Server didn't respond in time — leave control.json as-is (best-effort)
    process.stdout.write('[control] server did not respond within 3 s — control.json may have wrong port\n');
  }

  confirmPort().catch(() => {}).finally(() => process.exit(0));
}

main();
