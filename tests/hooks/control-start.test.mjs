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

function run({ cwd } = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: cwd || os.tmpdir(),
    encoding: 'utf-8',
    timeout: 8000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd || os.tmpdir() },
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

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-test-'));
});

afterEach(() => {
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
  it('exits 0 when no control.json exists', () => {
    const r = run({ cwd: tmpDir });
    expect(r.status).toBe(0);
  });

  it('writes control.json when no prior status', () => {
    run({ cwd: tmpDir });
    const statusFile = path.join(tmpDir, '.monomind', 'control.json');
    expect(fs.existsSync(statusFile)).toBe(true);
  });

  it('control.json contains pid, port, url, startedAt', () => {
    run({ cwd: tmpDir });
    const data = readControlJson(tmpDir);
    expect(data).toHaveProperty('pid');
    expect(data).toHaveProperty('port', 4242);
    expect(data).toHaveProperty('url', 'http://localhost:4242');
    expect(data).toHaveProperty('startedAt');
  });

  it('logs "started Neural Control Room" when spawning new process', () => {
    const r = run({ cwd: tmpDir });
    expect(r.stdout).toContain('[control] started Neural Control Room');
  });

  it('exits 0 when control.json has a dead pid', () => {
    // Use a PID that's extremely unlikely to be alive
    writeControlJson(tmpDir, 9999999, 4242);
    const r = run({ cwd: tmpDir });
    expect(r.status).toBe(0);
  });

  it('writes new control.json when old pid is dead', () => {
    writeControlJson(tmpDir, 9999999, 4242);
    run({ cwd: tmpDir });
    const data = readControlJson(tmpDir);
    // New pid should differ from the dead one
    expect(data.pid).not.toBe(9999999);
  });
});
