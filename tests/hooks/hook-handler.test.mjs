/**
 * Tests for .claude/helpers/hook-handler.cjs
 * Spawns hook-handler as a child process (it calls process.exit(0) itself)
 * and verifies stdout, exit code, and per-command dispatch behavior.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HANDLER = path.resolve(__dirname, '../../.claude/helpers/hook-handler.cjs');

function run(command, opts = {}) {
  // Remove SDK agent env vars that cause hook scripts to exit silently
  const cleanEnv = { ...process.env };
  delete cleanEnv.MONOMIND_SDK_AGENT;
  delete cleanEnv.MONOMIND_HOOK_QUIET;

  const args = command ? [HANDLER, command] : [HANDLER];
  return spawnSync(process.execPath, args, {
    env: { ...cleanEnv, CLAUDE_PROJECT_DIR: opts.cwd || os.tmpdir(), ...(opts.env || {}) },
    input: opts.stdin || '',
    encoding: 'utf-8',
    timeout: 8000,
    cwd: opts.cwd || os.tmpdir(),
  });
}

// ── basic dispatch ─────────────────────────────────────────────────────────────

describe('hook-handler.cjs dispatch', () => {
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

// ── slash commands vs. paths on the route hook ─────────────────────────────────

describe('hook-handler.cjs route — slash commands', () => {
  let dir;

  function routeIn(prompt) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-slash-'));
    fs.mkdirSync(path.join(dir, '.monomind'));
    fs.writeFileSync(
      path.join(dir, '.monomind', 'registry.json'),
      JSON.stringify({
        agents: [
          {
            slug: 'planner',
            name: 'planner',
            category: 'core',
            description: 'Plans caching work and features',
          },
          { slug: 'coder', name: 'coder', category: 'core', description: 'Writes code' },
        ],
      }),
    );
    const r = run('route', {
      cwd: dir,
      env: { MONOMIND_JEV: 'off' },
      stdin: JSON.stringify({ session_id: 'slash-1', prompt }),
    });
    const f = path.join(dir, '.monomind', 'route-outcomes.jsonl');
    const outcomes = fs.existsSync(f)
      ? fs.readFileSync(f, 'utf-8').trim().split('\n').filter(Boolean)
      : [];
    const last = JSON.parse(
      fs.readFileSync(path.join(dir, '.monomind', 'last-route.json'), 'utf-8'),
    );
    fs.rmSync(dir, { recursive: true, force: true });
    return { r, outcomes, last };
  }

  it('treats a namespaced command (/mastermind:plan) as a command: no [PICK], no pick record', () => {
    const { r, outcomes, last } = routeIn('/mastermind:plan add caching to the planner');
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('[PICK]');
    expect(outcomes).toEqual([]);
    expect(last).toMatchObject({ agent: null, skill: '/mastermind:plan' });
    expect(last.routeId).toBeUndefined();
  });

  it('treats a prompt that starts with a file path as a normal prompt', () => {
    const { r, outcomes, last } = routeIn('/var/log/app.log shows the planner crashing on caching');
    expect(r.status).toBe(0);
    expect(outcomes).toHaveLength(1);
    expect(last.routeId).toBeTruthy();
  });
});
