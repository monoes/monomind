/**
 * `monomind init --project <dir> --if-missing --json` (issue #358) — the
 * headless, idempotent workspace-init contract for coder sessions.
 * Contract: doc/agent-exec-protocol.md §11.
 *
 * These run the real CLI as a child process (like init-watch-non-interactive
 * test.ts) so the assertions cover the actual stdout contract a caller
 * (mono-agent) depends on: exactly one JSON document, human output
 * suppressed, real filesystem side effects.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'cli.js');

/** Baseline flags for a fast, deterministic init: Claude-only (no
 *  antigravity/opencode/kimicode/codex adapters), no monograph, no memory DB,
 *  no background watcher, no doctor --install pass. */
const FAST_FLAGS = [
  '--minimal',
  '--target',
  'claude',
  '--no-graph',
  '--no-memory',
  '--no-watch',
  '--no-install',
];

interface RunResult {
  stdout: string;
  stderr: string;
  status: number | null;
  json: Record<string, unknown>;
}

function runInit(cwd: string, home: string, args: string[]): RunResult {
  const res = spawnSync(process.execPath, [CLI, 'init', ...FAST_FLAGS, ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 60_000,
    env: { ...process.env, CI: '', HOME: home },
  });
  const stdout = res.stdout ?? '';
  const stderr = res.stderr ?? '';
  let json: Record<string, unknown> = {};
  const lastLine = stdout.trim().split('\n').filter(Boolean).pop();
  if (lastLine) {
    try {
      json = JSON.parse(lastLine);
    } catch {
      /* left {} — assertions below will fail loudly on the missing fields */
    }
  }
  return { stdout, stderr, status: res.status, json };
}

let home: string;
let cwd: string;

describe('monomind init --json (workspace init, #358)', () => {
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'init-json-home-')));
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'init-json-project-')));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('initializes an empty dir, printing exactly one JSON document with human output suppressed', () => {
    const { stdout, stderr, status, json } = runInit(cwd, home, ['--json', '--yes']);

    expect(status).toBe(0);
    // Every non-blank stdout line must be that one JSON document — nothing
    // else may share the stream.
    const lines = stdout.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0])).not.toThrow();

    expect(json.root).toBe(cwd);
    expect(Array.isArray(json.created)).toBe(true);
    expect(json.created).toContain('CLAUDE.md');
    expect(json.created).toContain('.claude/settings.json');
    expect(Array.isArray(json.skipped)).toBe(true);
    expect(json.claude_project_registered).toBe(false);
    expect(typeof json.duration_ms).toBe('number');
    expect(json.duration_ms as number).toBeGreaterThanOrEqual(0);

    // Spinner/box/prompt ceremony must not leak into stderr either, beyond
    // whatever non-fatal diagnostics init already prints there.
    expect(stderr).not.toMatch(/Initializing Monomind/);
  });

  it('--if-missing never touches an existing CLAUDE.md or .claude/settings.json, and reports them skipped', () => {
    const ownClaudeMd = '# My own CLAUDE.md\n\nHand-authored, do not touch.\n';
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    writeFileSync(join(cwd, 'CLAUDE.md'), ownClaudeMd);
    const ownSettings = '{\n  "mySetting": "kept-as-is"\n}\n';
    writeFileSync(join(cwd, '.claude', 'settings.json'), ownSettings);

    const { status, json } = runInit(cwd, home, ['--if-missing', '--json', '--yes']);

    expect(status).toBe(0);
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf-8')).toBe(ownClaudeMd);
    expect(readFileSync(join(cwd, '.claude', 'settings.json'), 'utf-8')).toBe(ownSettings);
    expect(json.skipped).toContain('CLAUDE.md');
    expect(json.skipped).toContain('.claude/settings.json');
    expect(json.created).not.toContain('CLAUDE.md');
    expect(json.created).not.toContain('.claude/settings.json');
  });

  it('is idempotent: a second --if-missing run touches none of the files it guards', () => {
    const first = runInit(cwd, home, ['--if-missing', '--json', '--yes']);
    expect(first.status).toBe(0);
    expect(first.json.created).toContain('CLAUDE.md');
    expect(first.json.created).toContain('.claude/settings.json');

    const second = runInit(cwd, home, ['--if-missing', '--json', '--yes']);
    expect(second.status).toBe(0);
    // The files --if-missing exists to protect (config, settings, generated
    // assets it copies) must never reappear in `created` on a re-run — that
    // is the actual safety contract. A couple of purely informational
    // bookkeeping entries this init system already reports on every run
    // regardless of --if-missing (e.g. re-indexing notes) are not part of
    // that contract and are deliberately not asserted against here.
    const second_created = second.json.created as string[];
    for (const guarded of [
      'CLAUDE.md',
      '.claude/settings.json',
      '.mcp.json',
      'platform claude: CLAUDE.md',
    ]) {
      expect(second_created, `${guarded} must not be re-created`).not.toContain(guarded);
    }
    expect(second_created.filter((f) => f.startsWith('.claude/skills/'))).toEqual([]);
  });

  it('--project <dir> is equivalent to `cd <dir> && monomind init`', () => {
    const viaProject = runInit(home, home, ['--project', cwd, '--json', '--yes']);
    expect(viaProject.status).toBe(0);
    expect(viaProject.json.root).toBe(cwd);
    expect(viaProject.json.created).toContain('CLAUDE.md');
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf-8')).toMatch(/monomind|Monomind/);
  });

  it('--target claude adds only Claude Code files — no .gemini/ or .agents/ (#372)', () => {
    const { status, json } = runInit(cwd, home, ['--if-missing', '--json', '--yes']);
    expect(status).toBe(0);
    expect(existsSync(join(cwd, '.claude'))).toBe(true);
    expect(existsSync(join(cwd, '.gemini'))).toBe(false);
    expect(existsSync(join(cwd, '.agents'))).toBe(false);
    expect((json.created as string[]).filter((f) => /^\.(gemini|agents)\b/.test(f))).toEqual([]);
  });

  it('--project rejects a directory that does not exist', () => {
    const missing = join(cwd, 'does-not-exist');
    const { status, json, stdout } = runInit(home, home, ['--project', missing, '--json', '--yes']);
    expect(status).not.toBe(0);
    const lines = stdout.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(json.success).toBe(false);
    expect(String(json.error)).toContain(missing);
  });

  it('--register-claude-project creates ~/.claude/projects/<slug>/ without a model call', () => {
    const { status, json } = runInit(cwd, home, ['--json', '--yes', '--register-claude-project']);
    expect(status).toBe(0);
    expect(json.claude_project_registered).toBe(true);
    const slug = cwd.split('/').join('-');
    const projectDir = join(home, '.claude', 'projects', slug);
    expect(existsSync(projectDir)).toBe(true);
    expect(statSync(projectDir).isDirectory()).toBe(true);
  });

  it('the fast path (--no-graph, --minimal) finishes in a few seconds, not the documented 30-60s full init', () => {
    const wallStart = Date.now();
    const { status, json } = runInit(cwd, home, ['--json', '--yes']);
    const wallElapsed = Date.now() - wallStart;

    expect(status).toBe(0);
    // Loose bound: generous enough to absorb CI/sandbox contention, tight
    // enough to catch a regression that drags the fast path back to the
    // documented full-init 30-60s range.
    expect(json.duration_ms as number).toBeLessThan(20_000);
    expect(wallElapsed).toBeLessThan(25_000);
  });
});
