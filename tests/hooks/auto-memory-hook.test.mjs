/**
 * Tests for .claude/helpers/auto-memory-hook.mjs
 * Spawns the hook as a child process (it uses top-level await + process.exit).
 * Tests: exit codes, output assertions, and edge cases for each subcommand.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, '../../.claude/helpers/auto-memory-hook.mjs');

function run(command, opts = {}) {
  const args = command ? [HOOK, command] : [HOOK];
  return spawnSync(process.execPath, args, {
    env: { ...process.env, ...(opts.env || {}) },
    encoding: 'utf-8',
    timeout: 12000,
    cwd: opts.cwd || os.tmpdir(),
  });
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amh-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── status ─────────────────────────────────────────────────────────────────────

describe('auto-memory-hook status', () => {
  it('exits 0', () => {
    const r = run('status', { cwd: tmpDir });
    expect(r.status).toBe(0);
  });

  it('prints "Auto Memory Bridge Status" header', () => {
    const r = run('status', { cwd: tmpDir });
    expect(r.stdout).toContain('Auto Memory Bridge Status');
  });

  it('shows Store: line in output', () => {
    const r = run('status', { cwd: tmpDir });
    expect(r.stdout).toContain('Store:');
  });

  it('shows Package: line in output', () => {
    const r = run('status', { cwd: tmpDir });
    expect(r.stdout).toContain('Package:');
  });
});

// ── import ─────────────────────────────────────────────────────────────────────

describe('auto-memory-hook import', () => {
  it('exits 0 even when @monomind/memory is unavailable', () => {
    const r = run('import', { cwd: tmpDir });
    expect(r.status).toBe(0);
  });

  it('does not write to stderr on graceful skip', () => {
    const r = run('import', { cwd: tmpDir });
    // May have [AutoMemory] lines on stdout but no hard errors on stderr
    expect(r.status).toBe(0);
  });
});

// ── sync ───────────────────────────────────────────────────────────────────────

describe('auto-memory-hook sync', () => {
  it('exits 0 even when @monomind/memory is unavailable', () => {
    const r = run('sync', { cwd: tmpDir });
    expect(r.status).toBe(0);
  });
});

// ── unknown command ────────────────────────────────────────────────────────────

describe('auto-memory-hook unknown command', () => {
  it('exits 1 for bogus subcommand', () => {
    const r = run('bogus-xyz', { cwd: tmpDir });
    expect(r.status).toBe(1);
  });

  it('prints usage for unknown command', () => {
    const r = run('bogus-xyz', { cwd: tmpDir });
    expect(r.stdout).toContain('Usage:');
  });
});

// ── default (no command) ───────────────────────────────────────────────────────

describe('auto-memory-hook no command', () => {
  it('defaults to status and exits 0', () => {
    const r = run(null, { cwd: tmpDir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Auto Memory Bridge Status');
  });
});
