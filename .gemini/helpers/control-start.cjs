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
// SDK-spawned org agents skip control-server startup — they don't need the dashboard
if (String(process.env.MONOMIND_SDK_AGENT || '') === '1') process.exit(0);
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
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return { cmd: npxCmd, args: ['monomind@latest'], usePort: false };
}

function readAuthCredential() {
  try {
    return fs.readFileSync(path.join(CWD, '.monomind', 'dashboard-token'), 'utf-8').trim();
  } catch { return ''; }
}

// Resolves to the parsed /api/status body, 'unauthorized' if a server answered
// but rejected our current dashboard-token (401 — the pairing recorded in
// control.json no longer matches what that server actually expects, e.g.
// stale state left over from a prior collision/restart), or null for "no
// server there at all" (connection error, timeout, or 5xx). These used to
// collapse into a single null result, which meant a stale-token server was
// indistinguishable from a healthy one to the caller below — the "already
// running" check had no way to tell "reachable but I can't actually talk to
// it" from "not reachable", so it trusted a server it could never
// authenticate against as healthy and exited immediately instead of fixing
// the pairing.
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
        if (res.statusCode === 401) return resolve('unauthorized');
        if (res.statusCode >= 500) return resolve(null);
        try { resolve(JSON.parse(body)); } catch { resolve({}); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// Resolves to the responder's pid (number), 'foreign-authwalled' for an
// auth-gated monomind server, null for unreadable, or false for "no answer".
function probePort(p) {
  const http = require('http');
  return new Promise((resolve) => {
    const req = http.get({ hostname: 'localhost', port: p, path: '/api/status', timeout: 1000 }, (res) => {
      let body = '';
      res.on('data', (c) => { if (body.length < 4096) body += c; });
      res.on('end', () => {
        if (res.statusCode >= 500) return resolve(false);
        try {
          const parsed = JSON.parse(body);
          if (typeof parsed.pid === 'number') return resolve(parsed.pid);
          if (res.statusCode === 401 && parsed.error) return resolve('foreign-authwalled');
          resolve(null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
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

/**
 * Confirms the spawned dashboard child actually bound a port, and updates
 * control.json with the authoritative pid/port once it does.
 *
 * Runs in its own detached, fully independent process (see the
 * MONOMIND_CONTROL_CONFIRM_MODE branch at the bottom of this file) — NOT
 * inline inside the SessionStart-hook-invoked process. This can legitimately
 * take up to HARD_CEILING_ATTEMPTS (~5 min: slow npx cold-resolve + AV/FS
 * contention right after an install, #142) but the hook that spawns the
 * dashboard is configured with a 5s timeout in settings.json — an inline
 * await here would almost always get truncated by that hook timeout before
 * ever reaching the slow paths #142/#143 were specifically added to
 * tolerate, silently defeating those fixes and leaving control.json stuck on
 * its pre-confirmation optimistic guess. Running this as a separate spawned
 * process means the hook-invoked process can write the optimistic status and
 * exit immediately (matching this file's own module docstring), while
 * confirmation proceeds independently for as long as it legitimately needs.
 */
async function runConfirm({ childPid, port: defaultPort, boundReportPath, isNpxFallback }) {
  const CONFIRM_ATTEMPTS = isNpxFallback ? 60 : 20; // 500ms/attempt: 30s vs 10s
  const HARD_CEILING_ATTEMPTS = 600; // 500ms/attempt: 5 min — see doc comment above
  let sawForeignOnDefault = false;
  let attempt = 0;
  for (; attempt < HARD_CEILING_ATTEMPTS; attempt++) {
    await new Promise(r => setTimeout(r, 500));
    // Past the minimum grace period, a dead child means it's not coming
    // back — stop waiting immediately instead of burning the rest of the
    // budget. A LIVE child that simply hasn't reported yet keeps getting the
    // benefit of the doubt up to HARD_CEILING_ATTEMPTS instead of being
    // killed on a fixed guess.
    if (attempt >= CONFIRM_ATTEMPTS && !isPidAlive(childPid)) break;
    // 1) Authoritative: child self-reported its bound port. Identity comes
    // from boundReportPath's own per-invocation-unique path (nothing else on
    // the machine knows it, since it's only handed to this child via env),
    // NOT a pid match: under shell:true (#141's Windows EINVAL fix), childPid
    // is the wrapping cmd.exe's pid, not the real server's — rep.pid !==
    // childPid always, so a pid comparison here can never succeed on the
    // npx-fallback path regardless of how long we wait (#143). rep.pid is
    // the real server pid — use it for control.json.
    try {
      const rep = JSON.parse(fs.readFileSync(boundReportPath, 'utf8'));
      if (rep && typeof rep.pid === 'number' && typeof rep.port === 'number') {
        try { fs.unlinkSync(boundReportPath); } catch { /* ignore */ }
        writeStatus(rep.pid, rep.port);
        if (String(process.env.MONOMIND_HOOK_QUIET || "") !== "1") process.stdout.write(`[control] server bound to port ${rep.port} (pid ${rep.pid})\n`);
        return;
      }
    } catch { /* not written yet or old server — fall through to probe */ }
    // 2) Fallback: pid-matched HTTP probe (old servers without report support)
    for (let delta = 0; delta <= 10; delta++) {
      const p = defaultPort + delta;
      const responderPid = await probePort(p);
      if (responderPid === false) continue;
      if (responderPid === childPid) {
        if (p !== defaultPort) {
          writeStatus(childPid, p);
          if (String(process.env.MONOMIND_HOOK_QUIET || "") !== "1") process.stdout.write(`[control] server bound to port ${p} (updated control.json)\n`);
        }
        return;
      }
      if (p === defaultPort && (typeof responderPid === 'number' || responderPid === 'foreign-authwalled')) {
        sawForeignOnDefault = true;
      }
      // pid mismatch or unreadable — not provably ours, keep scanning
    }
  }
  try { fs.unlinkSync(boundReportPath); } catch { /* ignore */ }
  if (sawForeignOnDefault) {
    // Another project's server owns defaultPort and our child never proved
    // its own port — point control.json at the live server instead of lying,
    // and kill our redundant child.
    try { process.kill(childPid, 'SIGTERM'); } catch { /* already gone */ }
    if (String(process.env.MONOMIND_HOOK_QUIET || "") !== "1") process.stdout.write(`[control] port ${defaultPort} is served by another project's control server — reusing it (killed redundant child)\n`);
    let foreignPid = await probePort(defaultPort);
    if (typeof foreignPid !== 'number' || foreignPid <= 0) {
      try {
        const { execFileSync } = require('child_process');
        const lsofOut = execFileSync('lsof', ['-ti', `:${defaultPort}`, '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 3000 }).trim();
        const parsedPid = parseInt(lsofOut.split('\n')[0], 10);
        if (Number.isInteger(parsedPid) && parsedPid > 0) foreignPid = parsedPid;
      } catch { /* ignore */ }
    }
    writeStatus(typeof foreignPid === 'number' ? foreignPid : 0, defaultPort);
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
  try { process.kill(childPid, 'SIGTERM'); } catch { /* already gone */ }
  try { fs.unlinkSync(STATUS_FILE); } catch { /* ignore */ }
  process.stdout.write(`[control] server did not respond within ${((attempt + 1) * 500 / 1000).toFixed(1)} s — killed orphan, will retry next session\n`);
}

async function main() {
  // Skip spawning when system memory is critically low
  try {
    const { isMemoryPressureCritical, getMemoryInfo } = require('./utils/system-pressure.cjs');
    if (isMemoryPressureCritical()) {
      const info = getMemoryInfo();
      if (String(process.env.MONOMIND_HOOK_QUIET || "") !== "1") process.stdout.write(`[control] skipping — memory pressure ${info.level} (${info.usedMB}/${info.totalMB} MB used)\n`);
      process.exit(0);
    }
  } catch { /* non-critical — proceed without check */ }

  // If already running, check if it's serving THIS project and a current build.
  const status = readStatus();
  if (status && status.pid && isPidAlive(status.pid)) {
    const live = await probeStatus(status.port);
    // A server that's up but rejects our token is unusable to us regardless
    // of whose project it's rooted in or how old it is — force a restart the
    // same as any other staleness reason instead of accepting it as healthy.
    const staleAuth = live === 'unauthorized';
    const staleProject = live && live !== 'unauthorized' && live.dir && path.resolve(live.dir) !== path.resolve(CWD);
    const startedMs = status.startedAt ? Date.now() - new Date(status.startedAt).getTime() : 0;
    const staleBuild = startedMs > 7 * 24 * 3600_000; // older than 7 days
    if (staleAuth || staleProject || staleBuild) {
      const reason = staleAuth
        ? `token mismatch — server on port ${status.port} rejected our dashboard-token`
        : staleProject
          ? `rooted in ${live.dir}, not ${CWD}`
          : `started ${Math.round(startedMs / 86400_000)}d ago`;
      if (String(process.env.MONOMIND_HOOK_QUIET || "") !== "1") process.stdout.write(`[control] restarting stale server (${reason})\n`);
      try { process.kill(status.pid, 'SIGTERM'); } catch { /* already gone */ }
      // Give it a moment to release the port
      await new Promise(r => setTimeout(r, 1000));
    } else {
      if (String(process.env.MONOMIND_HOOK_QUIET || "") !== "1") process.stdout.write(`[control] already running on port ${status.port} (pid ${status.pid})\n`);
      process.exit(0);
    }
  }

  // Adopt an already-listening server (e.g. started manually or by another session)
  // instead of spawning a duplicate that would bind port+1 and clobber control.json.
  // probeStatus() returns the string 'unauthorized' (not null) for a server that
  // answers but rejects our dashboard-token (added for the staleAuth check above,
  // #150) — a non-empty string is truthy in JS, so `if (live)` alone would "adopt"
  // an auth-mismatched server exactly like a healthy one, writing pid:0 (a string
  // has no .pid) and leaving the mismatch in place instead of fixing it. Skip it
  // and keep scanning for an actually-adoptable server on a later port instead.
  for (let delta = 0; delta <= 10; delta++) {
    const p = DEFAULT_PORT + delta;
    const live = await probeStatus(p);
    if (live && live !== 'unauthorized') {
      writeStatus(live.pid || 0, p);
      if (String(process.env.MONOMIND_HOOK_QUIET || "") !== "1") process.stdout.write(`[control] adopted running server on port ${p} (pid ${live.pid || 'unknown'})\n`);
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
    if (String(process.env.MONOMIND_HOOK_QUIET || "") !== "1") process.stdout.write(`[control] started Neural Control Room on port ${DEFAULT_PORT} (pid ${process.pid}) [no-spawn]\n`);
    releaseSpawnLock();
    process.exit(0);
  }

  const { cmd, args, usePort } = findCliPath();
  // server.mjs accepts port as second positional arg; CLI uses 'ui --no-open --port N'
  const allArgs = usePort
    ? [...args, String(DEFAULT_PORT)]
    : [...args, 'ui', '--no-open', '--port', String(DEFAULT_PORT)];

  // Every other findCliPath() branch spawns `process.execPath` directly
  // against an already-resolved .mjs/.js path — no resolve cost. Only the
  // npx-fallback branch (cmd is 'npx'/'npx.cmd') pays npx's own first-time
  // package resolve into its `_npx` cache, measured at ~12s cold vs ~3s warm
  // (#142) — comfortably over the 10s budget every other branch needs.
  // (Passed to the detached confirm process below — see runConfirm.)
  const isNpxFallback = cmd !== process.execPath;

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
    // Windows cannot exec a .cmd/.bat file directly — without shell:true,
    // spawning the npx.cmd fallback throws EINVAL synchronously.
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd),
  });

  child.on('error', (err) => {
    if (String(process.env.MONOMIND_HOOK_QUIET || "") !== "1") {
      process.stderr.write(`[control] spawn error: ${err.message}\n`);
    }
    releaseSpawnLock();
  });

  child.unref();

  // Write optimistic status with DEFAULT_PORT immediately so dependent scripts
  // (hooks, boss agents) have something to read while the server starts up.
  writeStatus(child.pid, DEFAULT_PORT);
  if (String(process.env.MONOMIND_HOOK_QUIET || "") !== "1") process.stdout.write(`[control] started Neural Control Room on port ${DEFAULT_PORT} (pid ${child.pid})\n`);

  // Hand off confirmation to a fully independent detached process instead of
  // awaiting it inline (see runConfirm's doc comment for why: the hook that
  // invokes THIS process has only a 5s timeout, far short of what
  // confirmation can legitimately need). This process's job — spawn the
  // dashboard and report the optimistic status — is done; exit immediately.
  const confirmChild = spawn(process.execPath, [__filename], {
    detached: true,
    stdio: 'ignore',
    cwd: CWD,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: CWD,
      MONOMIND_CONTROL_CONFIRM_MODE: '1',
      MONOMIND_CONTROL_CONFIRM_PID: String(child.pid),
      MONOMIND_CONTROL_CONFIRM_PORT: String(DEFAULT_PORT),
      MONOMIND_CONTROL_CONFIRM_REPORT: BOUND_REPORT,
      MONOMIND_CONTROL_CONFIRM_NPX: isNpxFallback ? '1' : '0',
    },
  });
  confirmChild.unref();

  releaseSpawnLock();
  process.exit(0);
}

if (String(process.env.MONOMIND_CONTROL_CONFIRM_MODE || '') === '1') {
  // Standalone confirmation process spawned by main() above — see runConfirm's
  // doc comment. Not itself subject to the SessionStart hook's 5s timeout.
  runConfirm({
    childPid: Number(process.env.MONOMIND_CONTROL_CONFIRM_PID),
    port: Number(process.env.MONOMIND_CONTROL_CONFIRM_PORT) || DEFAULT_PORT,
    boundReportPath: process.env.MONOMIND_CONTROL_CONFIRM_REPORT,
    isNpxFallback: process.env.MONOMIND_CONTROL_CONFIRM_NPX === '1',
  }).catch(() => {}).finally(() => process.exit(0));
} else {
  main().catch((err) => {
    if (String(process.env.MONOMIND_HOOK_QUIET || "") !== "1") {
      process.stderr.write(`[control] failed to start: ${err && err.message ? err.message : err}\n`);
    }
    releaseSpawnLock();
    process.exit(0);
  });
}
