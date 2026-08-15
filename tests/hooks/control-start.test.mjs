/**
 * Tests for .claude/helpers/control-start.cjs
 * Spawn-based: script calls process.exit(0) in main().
 * Uses CLAUDE_PROJECT_DIR env to control where control.json is read/written.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../.claude/helpers/control-start.cjs');

function run({ cwd, env } = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: cwd || os.tmpdir(),
    encoding: 'utf-8',
    timeout: 8000,
    // MONOMIND_CONTROL_NO_SPAWN: exercise the full flow (status read, adoption
    // probe, lock, control.json write, log lines) WITHOUT spawning a real
    // detached server — real spawns from this suite leaked ~900 orphan server
    // processes on isolated ports and exhausted the machine's process table.
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd || os.tmpdir(), MONOMIND_CONTROL_NO_SPAWN: '1', MONOMIND_HOOK_QUIET: '', ...env },
  });
}

function writeControlJson(dir, pid, port = 4242) {
  const statusFile = path.join(dir, '.monomind', 'control.json');
  fs.mkdirSync(path.dirname(statusFile), { recursive: true });
  fs.writeFileSync(statusFile, JSON.stringify({
    pid,
    port,
    url: `http://localhost:${port}`,
    startedAt: new Date().toISOString(),
  }), 'utf-8');
}

function readControlJson(dir) {
  const statusFile = path.join(dir, '.monomind', 'control.json');
  return JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
}

let tmpDir;
// Bump per-test so concurrent/successive tests in this file never share a port —
// each "not running" test may cause control-start.cjs to spawn a real, detached
// server process, and reusing the default port 4242 both risks colliding with a
// real control-room daemon already running on the developer's machine and leaks
// a process across test runs on a persistent host (see kill-in-afterEach below).
let portCounter = 0;
function isolatedPort() {
  portCounter += 1;
  return 40000 + (process.pid % 10000) + portCounter;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-test-'));
});

afterEach(() => {
  // control-start.cjs may have spawned a real detached server process for this
  // test — kill it so it doesn't leak past the test (it would otherwise stay
  // alive indefinitely on a persistent host, making a later run flaky).
  // NEVER kill process.pid itself — the "already running" tests deliberately
  // write this test process's own pid into control.json as a live sentinel,
  // and killing it would crash the test runner.
  try {
    const data = readControlJson(tmpDir);
    if (data.pid && data.pid !== process.pid) process.kill(data.pid, 'SIGTERM');
  } catch { /* no control.json, or pid already gone — fine */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── already running ──────────────────────────────────────────────────────────

describe('control-start: already running', () => {
  it('exits 0 when control.json exists with alive pid', () => {
    writeControlJson(tmpDir, process.pid, 4242);
    const r = run({ cwd: tmpDir });
    expect(r.status).toBe(0);
  });

  it('logs "already running on port N (pid M)" when alive pid', () => {
    writeControlJson(tmpDir, process.pid, 4242);
    const r = run({ cwd: tmpDir });
    expect(r.stdout).toContain('[control] already running on port 4242');
    expect(r.stdout).toContain(`(pid ${process.pid})`);
  });

  it('does not overwrite control.json when already running', () => {
    writeControlJson(tmpDir, process.pid, 4242);
    run({ cwd: tmpDir });
    const data = readControlJson(tmpDir);
    expect(data.pid).toBe(process.pid);
    expect(data.port).toBe(4242);
  });
});

describe('control-start: stale-token pairing self-heals instead of being trusted', () => {
  // Regression: probeStatus() used to collapse "no server there" and
  // "a server answered but rejected our dashboard-token" into the same null
  // result, so a live-but-mismatched server (e.g. left over from a port
  // collision that pushed the real dashboard onto a different port while
  // control.json still pointed at the old one) was indistinguishable from a
  // healthy one — the "already running" check trusted it and exited 0
  // without ever actually being able to talk to it.
  it('treats a 401 from the recorded port as stale and attempts a restart, not "already running"', async () => {
    const { spawn } = await import('child_process');
    const port = isolatedPort();
    // run() below uses spawnSync, which blocks this test process's entire
    // event loop until control-start.cjs exits — an in-process
    // http.createServer() mock would never get a chance to answer the very
    // request that spawnSync is synchronously waiting on. The mock server
    // has to live in its own separate process so its event loop keeps
    // running independently of this one being blocked.
    const mockScript = path.join(tmpDir, 'mock401.cjs');
    fs.writeFileSync(mockScript, `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: missing or invalid auth token' }));
      });
      server.listen(${port}, 'localhost', () => process.stderr.write('READY'));
    `);
    const mock = spawn(process.execPath, [mockScript], { stdio: ['ignore', 'ignore', 'pipe'] });
    await new Promise((resolve) => mock.stderr.on('data', resolve));
    // control-start.cjs's own staleAuth restart path SIGTERMs the recorded
    // pid — must NOT be this test process's own pid (would kill the test
    // runner). Use a real, alive, harmless child instead.
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    try {
      writeControlJson(tmpDir, sentinel.pid, port);
      const r = run({ cwd: tmpDir });
      expect(r.stdout).not.toContain('already running');
      expect(r.stdout).toContain('restarting stale server');
      expect(r.stdout).toContain('token mismatch');
    } finally {
      sentinel.kill('SIGTERM');
      mock.kill('SIGTERM');
    }
  });

  // Regression in the fix above: probeStatus() started returning the string
  // 'unauthorized' instead of null for a 401 (needed so the "already
  // running" check above could tell the two apart) — but the separate
  // "adopt an already-listening server" loop in main() only checked
  // `if (live)`, and a non-empty string is truthy in JS. So it "adopted" a
  // 401-rejecting server exactly like a healthy one: `live.pid` is
  // undefined on a string, so `writeStatus(live.pid || 0, p)` wrote pid:0
  // into control.json and printed "adopted running server (pid unknown)" —
  // silently leaving the mismatch in place instead of moving past it.
  it('does not adopt a 401-rejecting server as if it were healthy', async () => {
    const { spawn } = await import('child_process');
    const port = isolatedPort();
    const mockScript = path.join(tmpDir, 'mock401-adopt.cjs');
    fs.writeFileSync(mockScript, `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: missing or invalid auth token' }));
      });
      server.listen(${port}, 'localhost', () => process.stderr.write('READY'));
    `);
    const mock = spawn(process.execPath, [mockScript], { stdio: ['ignore', 'ignore', 'pipe'] });
    await new Promise((resolve) => mock.stderr.on('data', resolve));
    try {
      // No control.json written — main() reaches the adopt loop directly,
      // which scans MONOMIND_CONTROL_PORT (== port here) for a live server.
      const r = run({ cwd: tmpDir, env: { MONOMIND_CONTROL_PORT: String(port) } });
      expect(r.stdout).not.toContain('adopted running server');
      const data = readControlJson(tmpDir);
      expect(data.pid).not.toBe(0);
    } finally {
      mock.kill('SIGTERM');
    }
  });
});

// ── not running ──────────────────────────────────────────────────────────────

describe('control-start: not running', () => {
  // Every test in this block causes control-start.cjs to spawn a real,
  // detached server process on the default port 4242 unless given an
  // isolated one — see isolatedPort() and the kill-in-afterEach above.

  it('exits 0 when no control.json exists', () => {
    const r = run({ cwd: tmpDir, env: { MONOMIND_CONTROL_PORT: String(isolatedPort()) } });
    expect(r.status).toBe(0);
  });

  it('writes control.json when no prior status', () => {
    run({ cwd: tmpDir, env: { MONOMIND_CONTROL_PORT: String(isolatedPort()) } });
    const statusFile = path.join(tmpDir, '.monomind', 'control.json');
    expect(fs.existsSync(statusFile)).toBe(true);
  });

  it('control.json contains pid, port, url, startedAt', () => {
    const port = isolatedPort();
    run({ cwd: tmpDir, env: { MONOMIND_CONTROL_PORT: String(port) } });
    const data = readControlJson(tmpDir);
    expect(data).toHaveProperty('pid');
    expect(data).toHaveProperty('port', port);
    expect(data).toHaveProperty('url', `http://localhost:${port}`);
    expect(data).toHaveProperty('startedAt');
  });

  it('logs "started Neural Control Room" when spawning new process', () => {
    const r = run({ cwd: tmpDir, env: { MONOMIND_CONTROL_PORT: String(isolatedPort()) } });
    expect(r.stdout).toContain('[control] started Neural Control Room');
  });

  it('exits 0 when control.json has a dead pid', () => {
    // Use a PID that's extremely unlikely to be alive, and an isolated port —
    // on the default port 4242 a real control-room daemon could be adopted
    // instead of a new one spawned, and afterEach's cleanup would then kill
    // that real, unrelated server.
    const port = isolatedPort();
    writeControlJson(tmpDir, 9999999, port);
    const r = run({ cwd: tmpDir, env: { MONOMIND_CONTROL_PORT: String(port) } });
    expect(r.status).toBe(0);
  });

  it('writes new control.json when old pid is dead', () => {
    const port = isolatedPort();
    writeControlJson(tmpDir, 9999999, port);
    run({ cwd: tmpDir, env: { MONOMIND_CONTROL_PORT: String(port) } });
    const data = readControlJson(tmpDir);
    // New pid should differ from the dead one
    expect(data.pid).not.toBe(9999999);
  });
});

describe('control-start: confirmPort timeout budget (#142)', () => {
  // MONOMIND_CONTROL_NO_SPAWN short-circuits before findCliPath()/confirmPort()
  // ever run, and a real npx-fallback spawn takes 3-12s+ (the exact bug this
  // covers) — too slow/flaky for a unit test. Assert on the source instead:
  // the npx-fallback branch (cmd isn't process.execPath) must get a longer
  // confirmPort budget than every other branch, which spawns node directly
  // against an already-resolved path and pays no npx-resolve cost.
  it('gives the npx-fallback path a longer confirmPort budget than the direct-spawn paths', () => {
    const src = fs.readFileSync(SCRIPT, 'utf-8');
    expect(src).toMatch(/isNpxFallback\s*=\s*cmd\s*!==\s*process\.execPath/);
    const match = src.match(/CONFIRM_ATTEMPTS\s*=\s*isNpxFallback\s*\?\s*(\d+)\s*:\s*(\d+)/);
    expect(match).not.toBeNull();
    const [npxAttempts, directAttempts] = match.slice(1).map(Number);
    expect(npxAttempts).toBeGreaterThan(directAttempts);
    // #142: cold npx resolve measured at ~12.4s — budget must clear that.
    expect(npxAttempts * 500).toBeGreaterThanOrEqual(25_000);
  });
});

describe('control-start: BOUND_REPORT identity check survives shell:true (#143)', () => {
  // Same real-spawn-too-slow constraint as #142's test. Under shell:true
  // (#141's Windows fix), child.pid is the wrapping cmd.exe's pid, not the
  // real server's — a `rep.pid === child.pid` comparison against the
  // server-reported pid can never succeed on that path, no matter the
  // timeout (#143). Assert the check no longer depends on child.pid, and
  // that control.json gets the real, server-reported pid instead.
  it('confirms ownership from BOUND_REPORT alone, not a child.pid match', () => {
    const src = fs.readFileSync(SCRIPT, 'utf-8');
    expect(src).not.toMatch(/rep\.pid\s*===\s*child\.pid/);
    expect(src).toMatch(/writeStatus\(rep\.pid,\s*rep\.port\)/);
  });
});

describe('control-start: confirmPort waits on liveness, not a fixed budget (#142 follow-up)', () => {
  // A live child that simply hasn't reported yet (npm/AV contention on a
  // freshly-written node_modules right after install — measured once at
  // ~142s vs the normal ~5-9s) must not be killed just because
  // CONFIRM_ATTEMPTS elapsed. Assert CONFIRM_ATTEMPTS is now only a minimum
  // grace period before liveness is checked, bounded by an absolute
  // ceiling — not the hard budget itself.
  it('only gives up early, before the hard ceiling, once the child has actually exited', () => {
    const src = fs.readFileSync(SCRIPT, 'utf-8');
    expect(src).toMatch(/attempt\s*<\s*HARD_CEILING_ATTEMPTS/);
    // childPid, not child.pid: runConfirm (see #144 below) takes a plain pid
    // number, since it runs in its own process and no longer has the
    // original ChildProcess object to read .pid off of.
    expect(src).toMatch(/attempt\s*>=\s*CONFIRM_ATTEMPTS\s*&&\s*!isPidAlive\(childPid\)/);
    const ceilingMatch = src.match(/HARD_CEILING_ATTEMPTS\s*=\s*(\d+)/);
    expect(ceilingMatch).not.toBeNull();
    const hardCeilingAttempts = Number(ceilingMatch[1]);
    const budgetMatch = src.match(/CONFIRM_ATTEMPTS\s*=\s*isNpxFallback\s*\?\s*(\d+)\s*:\s*\d+/);
    const npxAttempts = Number(budgetMatch[1]);
    // The ceiling must be strictly larger than the npx-fallback grace period,
    // or it isn't a safety net at all — just the same budget renamed.
    expect(hardCeilingAttempts).toBeGreaterThan(npxAttempts);
  });
});

describe('control-start: confirmation runs detached from the hook-invoked process (#144)', () => {
  // The SessionStart hook that invokes this script has only a 5s timeout
  // (settings.json), far short of what confirmPort/runConfirm can
  // legitimately need (up to HARD_CEILING_ATTEMPTS's ~5 min). Awaiting
  // confirmation inline meant the hook almost always got the process killed
  // mid-wait before #142/#143's own fixes ever got a chance to run — control
  // .json stayed stuck on its pre-confirmation optimistic guess every time
  // resolution took longer than ~4.5s, which per #142's own measurements is
  // the common case, not the exception. Confirmation now runs in a second,
  // fully independent detached process instead, so the hook-invoked process
  // can write the optimistic status and exit immediately — matching this
  // file's own module docstring ("exits immediately after spawning").
  it('spawns a detached confirm-mode process and returns without awaiting it', () => {
    const src = fs.readFileSync(SCRIPT, 'utf-8');
    expect(src).toMatch(/MONOMIND_CONTROL_CONFIRM_MODE:\s*'1'/);
    expect(src).toMatch(/detached:\s*true/);
    // main() must not itself await runConfirm/confirmPort — it hands off and
    // returns. There should be no `await runConfirm` or `await confirmPort`
    // left anywhere in the file.
    expect(src).not.toMatch(/await\s+(runConfirm|confirmPort)\(/);
  });
});
