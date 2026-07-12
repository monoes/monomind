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
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd || os.tmpdir(), MONOMIND_CONTROL_NO_SPAWN: '1', ...env },
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
