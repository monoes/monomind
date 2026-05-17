/**
 * Tests for .claude/helpers/hook-handler.cjs
 * Spawns hook-handler as a child process (it calls process.exit(0) itself)
 * and verifies stdout, exit code, and per-command dispatch behavior.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HANDLER = path.resolve(__dirname, '../../.claude/helpers/hook-handler.cjs');

function run(command, opts = {}) {
  const args = command ? [HANDLER, command] : [HANDLER];
  return spawnSync(process.execPath, args, {
    env: { ...process.env, CLAUDE_PROJECT_DIR: opts.cwd || os.tmpdir(), ...(opts.env || {}) },
    input: opts.stdin || '',
    encoding: 'utf-8',
    timeout: 8000,
    cwd: opts.cwd || os.tmpdir(),
  });
}

// ── basic dispatch ─────────────────────────────────────────────────────────────

describe('hook-handler.cjs dispatch', () => {
  it('exits 0 for "status" and prints [OK] Status check', () => {
    const r = run('status');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[OK] Status check');
  });

  it('exits 0 for unknown command and echoes [OK] Hook: <name>', () => {
    const r = run('totally-unknown-command-xyz');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[OK] Hook: totally-unknown-command-xyz');
  });

  it('exits 0 with no command and prints Usage:', () => {
    const r = run('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Usage:');
  });
});

// ── handler-specific output ────────────────────────────────────────────────────

describe('hook-handler.cjs — per-handler output', () => {
  it('"compact-manual" exits 0 and logs [COMPACT]', () => {
    const r = run('compact-manual');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[COMPACT]');
  });

  it('"compact-auto" exits 0 and logs [COMPACT] + GOLDEN RULE', () => {
    const r = run('compact-auto');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[COMPACT]');
    expect(r.stdout).toContain('GOLDEN RULE');
  });

  it('"budget-status" exits 0', () => {
    const r = run('budget-status');
    expect(r.status).toBe(0);
  });

  it('"loops-status" exits 0 (no loops dir in tmpdir)', () => {
    const r = run('loops-status');
    expect(r.status).toBe(0);
  });

  it('"agent-start" exits 0', () => {
    const r = run('agent-start');
    expect(r.status).toBe(0);
  });

  it('"adr-draft" exits 0', () => {
    const r = run('adr-draft');
    expect(r.status).toBe(0);
  });
});

// ── stdin JSON hook input ──────────────────────────────────────────────────────

describe('hook-handler.cjs — stdin hook data', () => {
  it('accepts valid JSON on stdin without crashing', () => {
    const hookData = JSON.stringify({ command: 'status', prompt: 'test prompt' });
    const r = run('status', { stdin: hookData });
    expect(r.status).toBe(0);
  });

  it('accepts malformed JSON on stdin gracefully', () => {
    const r = run('status', { stdin: 'not-json{{{}' });
    expect(r.status).toBe(0);
  });
});
