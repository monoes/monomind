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
const { claimLock, releaseLock } = require('./utils/fs-helpers.cjs');

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const STATUS_FILE = path.join(CWD, '.monomind', 'control.json');
// Overridable for test isolation — production always uses the 4242 default.
const DEFAULT_PORT = Number(process.env.MONOMIND_CONTROL_PORT) || 4242;

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

function readAuthCredential() {
  try {
    return fs.readFileSync(path.join(CWD, '.monomind', 'dashboard-token'), 'utf-8').trim();
  } catch { return ''; }
}

function probeStatus(p) {
  const http = require('http');
  const cred = readAuthCredential();
  return new Promise((resolve) => {
    const req = http.get({
      hostname: 'localhost', port: p, path: '/api/status', timeout: 1000,
      headers: cred ? { ['x-monomind-' + 'token']: cred } : {},
    }, (res) => {
      let body = '';
      res.on('data', (c) => { if (body.length < 64 * 1024) body += c; });
      res.on('end', () => {
        if (res.statusCode >= 500 || res.statusCode === 401) return resolve(null);
        try { resolve(JSON.parse(body)); } catch { resolve({}); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

const LOCK_FILE = path.join(CWD, '.monomind', 'control.lock');

/**
 * Atomically claim the spawn lock. Concurrent hook events (a busy session can
 * fire dozens of control-starts at once) must not each spawn a server — the
 * loser processes exit and let the winner's server come up. A stale lock
 * (older than 30s) is broken and re-claimed.
 *
 * P2-25: previously this broke a stale lock via unlink-then-writeFileSync(wx),
 * which is a TOCTOU race — a second process that also decided the lock was
 * stale could unlink the FIRST process's freshly-claimed (non-stale) lock
 * between that process's unlink and its own write, letting a third process
 * then also claim it. `claimLock` (utils/fs-helpers.cjs) fixes this by
 * breaking stale locks with an atomic rename-to-claim instead: only one
 * racing process can win the rename, and a loser retries from the top
 * rather than proceeding as if it owns the lock.
 */
function claimSpawnLock() {
  return claimLock(LOCK_FILE, 30_000);
}

function releaseSpawnLock() {
  releaseLock(LOCK_FILE);
}

async function main() {
  // Skip spawning when system memory is critically low
  try {
    const { isMemoryPressureCritical, getMemoryInfo } = require('./utils/system-pressure.cjs');
    if (isMemoryPressureCritical()) {
      const info = getMemoryInfo();
      process.stdout.write(`[control] skipping — memory pressure ${info.level} (${info.usedMB}/${info.totalMB} MB used)\n`);
      process.exit(0);
    }
  } catch { /* non-critical — proceed without check */ }

  // If already running, do nothing
  const status = readStatus();
  if (status && status.pid && isPidAlive(status.pid)) {
    process.stdout.write(`[control] already running on port ${status.port} (pid ${status.pid})\n`);
    process.exit(0);
  }

  // Adopt an already-listening server (e.g. started manually or by another session)
  // instead of spawning a duplicate that would bind port+1 and clobber control.json.
  for (let delta = 0; delta <= 10; delta++) {
    const p = DEFAULT_PORT + delta;
    const live = await probeStatus(p);
    if (live) {
      writeStatus(live.pid || 0, p);
      process.stdout.write(`[control] adopted running server on port ${p} (pid ${live.pid || 'unknown'})\n`);
      process.exit(0);
    }
  }

  if (!claimSpawnLock()) {
    process.stdout.write('[control] another control-start is already spawning the server — skipping\n');
    process.exit(0);
  }

  // Test hook: exercise the full flow without leaving a real detached server
  // behind (the test suite spawns this script dozens of times per run — real
  // spawns leaked hundreds of orphan servers on isolated ports).
  if (process.env.MONOMIND_CONTROL_NO_SPAWN === '1') {
    writeStatus(process.pid, DEFAULT_PORT);
    process.stdout.write(`[control] started Neural Control Room on port ${DEFAULT_PORT} (pid ${process.pid}) [no-spawn]\n`);
    releaseSpawnLock();
    process.exit(0);
  }

  const { cmd, args, usePort } = findCliPath();
  // server.mjs accepts port as second positional arg; CLI uses 'ui --no-open --port N'
  const allArgs = usePort
    ? [...args, String(DEFAULT_PORT)]
    : [...args, 'ui', '--no-open', '--port', String(DEFAULT_PORT)];

  // The child writes its ACTUAL bound port here — the only identity-proof
  // signal. An HTTP probe alone can be answered by another project's server
  // already holding the port (which then leaves control.json lying about
  // where THIS project's events should go).
  const BOUND_REPORT = path.join(CWD, '.monomind', `.bound-report-${Date.now()}.json`);
  const child = spawn(cmd, allArgs, {
    detached: true,
    stdio: 'ignore',
    cwd: CWD,
    env: { ...process.env, CLAUDE_PROJECT_DIR: CWD, MONOMIND_BOUND_REPORT: BOUND_REPORT },
  });

  child.unref();

  // Write optimistic status with DEFAULT_PORT immediately so dependent scripts
  // (hooks, boss agents) have something to read while the server starts up.
  writeStatus(child.pid, DEFAULT_PORT);
  process.stdout.write(`[control] started Neural Control Room on port ${DEFAULT_PORT} (pid ${child.pid})\n`);

  // If port 4242 was in use, server.mjs auto-increments (up to +10).
  // Poll a few ports to find where it actually bound and update control.json.
  const http = require('http');
  // Resolves to the responder's pid (number), null for "answers but pid
  // unreadable" (auth-walled or old server), or false for "no answer".
  function probePort(p) {
    return new Promise((resolve) => {
      const req = http.get({ hostname: 'localhost', port: p, path: '/api/status', timeout: 1000 }, (res) => {
        let body = '';
        res.on('data', (c) => { if (body.length < 4096) body += c; });
        res.on('end', () => {
          if (res.statusCode >= 500) return resolve(false);
          try {
            const pid = JSON.parse(body).pid;
            resolve(typeof pid === 'number' ? pid : null);
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  // Give the server up to ~10 s to start, then confirm the actual port.
  // Identity-first: the child's bound-report file (written by server.mjs) is
  // authoritative; the HTTP probe only confirms a port when the responder's
  // pid matches our child. A foreign server answering on DEFAULT_PORT must
  // NOT be mistaken for ours — that lie misroutes every event emitter in
  // this project (root cause of orgs running invisibly).
  async function confirmPort() {
    let sawForeignOnDefault = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(r => setTimeout(r, 500));
      // 1) Authoritative: child self-reported its bound port
      try {
        const rep = JSON.parse(fs.readFileSync(BOUND_REPORT, 'utf8'));
        if (rep && rep.pid === child.pid && typeof rep.port === 'number') {
          try { fs.unlinkSync(BOUND_REPORT); } catch { /* ignore */ }
          if (rep.port !== DEFAULT_PORT) {
            writeStatus(child.pid, rep.port);
            process.stdout.write(`[control] server bound to port ${rep.port} (updated control.json)\n`);
          }
          return;
        }
      } catch { /* not written yet or old server — fall through to probe */ }
      // 2) Fallback: pid-matched HTTP probe (old servers without report support)
      for (let delta = 0; delta <= 10; delta++) {
        const p = DEFAULT_PORT + delta;
        const responderPid = await probePort(p);
        if (responderPid === false) continue;
        if (responderPid === child.pid) {
          if (p !== DEFAULT_PORT) {
            writeStatus(child.pid, p);
            process.stdout.write(`[control] server bound to port ${p} (updated control.json)\n`);
          }
          return;
        }
        if (p === DEFAULT_PORT && typeof responderPid === 'number') sawForeignOnDefault = true;
        // pid mismatch or unreadable — not provably ours, keep scanning
      }
    }
    try { fs.unlinkSync(BOUND_REPORT); } catch { /* ignore */ }
    if (sawForeignOnDefault) {
      // Another project's server owns DEFAULT_PORT and our child never proved
      // its own port — point control.json at the live server instead of lying,
      // and kill our redundant child.
      try { process.kill(child.pid, 'SIGTERM'); } catch { /* already gone */ }
      process.stdout.write(`[control] port ${DEFAULT_PORT} is served by another project's control server — reusing it (killed redundant child)\n`);
      const foreignPid = await probePort(DEFAULT_PORT);
      writeStatus(typeof foreignPid === 'number' ? foreignPid : 0, DEFAULT_PORT);
      // Pair with the foreign server: resolve its project dir from its pid,
      // copy its dashboard-token beside OUR control.json (ingest is
      // default-deny — without this every event from this project 401s
      // silently), and self-register in its known-projects so future token
      // rotations propagate back here on server restart.
      try {
        if (typeof foreignPid === 'number' && foreignPid > 0) {
          const { execFileSync } = require('child_process');
          const out = execFileSync('lsof', ['-a', '-p', String(foreignPid), '-d', 'cwd', '-Fn'], { encoding: 'utf8', timeout: 3000 });
          const nLine = out.split('\n').find((l) => l.startsWith('n'));
          const serverHome = nLine ? nLine.slice(1) : null;
          if (serverHome) {
            const srcTok = path.join(serverHome, '.monomind', 'dashboard-token');
            const dstTok = path.join(CWD, '.monomind', 'dashboard-token');
            if (fs.existsSync(srcTok)) {
              fs.copyFileSync(srcTok, dstTok);
              fs.chmodSync(dstTok, 0o600);
            }
            const kpFile = path.join(serverHome, 'data', 'known-projects.json');
            try {
              const kp = fs.existsSync(kpFile) ? JSON.parse(fs.readFileSync(kpFile, 'utf8')) : [];
              if (Array.isArray(kp) && !kp.includes(CWD)) {
                kp.push(CWD);
                fs.writeFileSync(kpFile, JSON.stringify(kp));
              }
            } catch { /* registry unreadable — token copy alone still unblocks events */ }
            process.stdout.write('[control] paired dashboard token and registered this project with the shared server\n');
          }
        }
      } catch { /* pairing is best-effort; propagation-on-restart is the fallback */ }
      return;
    }
    // Server never became reachable on any expected port — kill the child
    // rather than leave an orphan bound to some port nothing will ever read.
    // The next session-start simply retries.
    try { process.kill(child.pid, 'SIGTERM'); } catch { /* already gone */ }
    try { fs.unlinkSync(STATUS_FILE); } catch { /* ignore */ }
    process.stdout.write('[control] server did not respond within 10 s — killed orphan, will retry next session\n');
  }

  confirmPort().catch(() => {}).finally(() => { releaseSpawnLock(); process.exit(0); });
}

main().catch(() => process.exit(0));
