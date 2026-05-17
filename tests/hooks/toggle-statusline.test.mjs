/**
 * Tests for .claude/helpers/toggle-statusline.cjs
 * Spawn-based: script processes argv at module level and exits.
 * Uses CLAUDE_PROJECT_DIR env to control where statusline-mode.txt is read/written.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../.claude/helpers/toggle-statusline.cjs');

function run(args = [], { cwd } = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: cwd || os.tmpdir(),
    encoding: 'utf-8',
    timeout: 5000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd || os.tmpdir() },
  });
}

function readModeFile(dir) {
  return fs.readFileSync(path.join(dir, '.monomind', 'statusline-mode.txt'), 'utf-8').trim();
}

function writeModeFile(dir, mode) {
  const p = path.join(dir, '.monomind', 'statusline-mode.txt');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, mode, 'utf-8');
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── --get ────────────────────────────────────────────────────────────────────

describe('toggle-statusline --get', () => {
  it('--get prints "full" when no mode file exists (default)', () => {
    const r = run(['--get'], { cwd: tmpDir });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('full');
  });

  it('--get prints current mode when mode file exists', () => {
    writeModeFile(tmpDir, 'compact');
    const r = run(['--get'], { cwd: tmpDir });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('compact');
  });

  it('--get prints "full" when mode file contains "full"', () => {
    writeModeFile(tmpDir, 'full');
    const r = run(['--get'], { cwd: tmpDir });
    expect(r.stdout.trim()).toBe('full');
  });
});

// ── --set ────────────────────────────────────────────────────────────────────

describe('toggle-statusline --set', () => {
  it('--set full exits 0 and writes "full" to mode file', () => {
    const r = run(['--set', 'full'], { cwd: tmpDir });
    expect(r.status).toBe(0);
    expect(readModeFile(tmpDir)).toBe('full');
  });

  it('--set compact exits 0 and writes "compact" to mode file', () => {
    const r = run(['--set', 'compact'], { cwd: tmpDir });
    expect(r.status).toBe(0);
    expect(readModeFile(tmpDir)).toBe('compact');
  });

  it('--set full logs "statusline mode → full"', () => {
    const r = run(['--set', 'full'], { cwd: tmpDir });
    expect(r.stdout).toContain('statusline mode → full');
  });

  it('--set compact logs "statusline mode → compact"', () => {
    const r = run(['--set', 'compact'], { cwd: tmpDir });
    expect(r.stdout).toContain('statusline mode → compact');
  });

  it('--set invalid exits 1 and writes to stderr', () => {
    const r = run(['--set', 'rainbow'], { cwd: tmpDir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Usage');
  });

  it('--set without value exits 1', () => {
    const r = run(['--set'], { cwd: tmpDir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Usage');
  });
});

// ── toggle (no args) ─────────────────────────────────────────────────────────

describe('toggle-statusline toggle', () => {
  it('no args toggles from default "full" to "compact"', () => {
    const r = run([], { cwd: tmpDir });
    expect(r.status).toBe(0);
    expect(readModeFile(tmpDir)).toBe('compact');
  });

  it('logs "statusline mode → compact  (was: full)" on first toggle', () => {
    const r = run([], { cwd: tmpDir });
    expect(r.stdout).toContain('statusline mode → compact');
    expect(r.stdout).toContain('(was: full)');
  });

  it('toggles from compact to full on second call', () => {
    run([], { cwd: tmpDir }); // full → compact
    const r = run([], { cwd: tmpDir }); // compact → full
    expect(r.status).toBe(0);
    expect(readModeFile(tmpDir)).toBe('full');
    expect(r.stdout).toContain('statusline mode → full');
    expect(r.stdout).toContain('(was: compact)');
  });

  it('three toggles returns to compact', () => {
    run([], { cwd: tmpDir }); // full → compact
    run([], { cwd: tmpDir }); // compact → full
    run([], { cwd: tmpDir }); // full → compact
    expect(readModeFile(tmpDir)).toBe('compact');
  });

  it('toggle after --set compact toggles to full', () => {
    run(['--set', 'compact'], { cwd: tmpDir });
    run([], { cwd: tmpDir });
    expect(readModeFile(tmpDir)).toBe('full');
  });
});
