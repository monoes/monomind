/**
 * End-to-end tests for `monomind init` against a real, writable temp directory.
 *
 * Unlike p1-commands.test.ts (which mocks fs entirely and can't exercise
 * executeInit's real file-writing pipeline), these tests let executeInit
 * write real files and assert on the actual resulting directory tree.
 *
 * child_process is mocked so init's best-effort side calls (npx daemon
 * start, npx doctor --install, npx memory store seeding, npm config get
 * prefix) fail fast instead of making real network/npx calls — they're
 * all wrapped in try/catch in production code and don't affect
 * result.success either way.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { initCommand } from '../src/commands/init.js';
import { output } from '../src/output.js';
import type { CommandContext } from '../src/types.js';

// Real output.js is used (not mocked) so init's actual code paths run
// unmodified — just quieted so the test log isn't flooded with init's UI output.
output.setVerbosity('quiet');

vi.mock('child_process', () => ({
  execSync: vi.fn(() => {
    throw new Error('mocked: no real process execution in tests');
  }),
  execFileSync: vi.fn(() => {
    throw new Error('mocked: no real process execution in tests');
  }),
  spawn: vi.fn(() => {
    const proc = new EventEmitter() as EventEmitter & {
      unref: () => void;
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    proc.unref = () => {};
    proc.kill = () => {};
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    return proc;
  }),
}));

describe('Init Command E2E (real fs)', () => {
  let tmpDir: string;
  let ctx: CommandContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-e2e-'));
    ctx = {
      args: [],
      flags: { _: [], 'no-watch': true },
      cwd: tmpDir,
      interactive: false
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should initialize with default configuration', async () => {
    const result = await initCommand.action!(ctx);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'config.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.md'))).toBe(true);
  });

  it('should initialize with minimal configuration', async () => {
    ctx.flags = { minimal: true, _: [], 'no-watch': true };
    const result = await initCommand.action!(ctx);

    expect(result.success).toBe(true);
    // Minimal still writes settings and runtime config...
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'config.yaml'))).toBe(true);
    // ...but skips populating commands/agents (MINIMAL_INIT_OPTIONS.components) —
    // the directories are always created by createDirectories(), only their
    // contents are gated by the component flags.
    expect(fs.readdirSync(path.join(tmpDir, '.claude', 'commands'))).toHaveLength(0);
    expect(fs.readdirSync(path.join(tmpDir, '.claude', 'agents'))).toHaveLength(0);
  });

  it('should initialize with full configuration', async () => {
    ctx.flags = { full: true, _: [], 'no-watch': true };
    const result = await initCommand.action!(ctx);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'commands'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'agents'))).toBe(true);
  });

  it('should reinitialize with force flag', async () => {
    // First init
    const first = await initCommand.action!(ctx);
    expect(first.success).toBe(true);

    // Re-run with --force --yes (yes skips the non-interactive "already initialized" error)
    ctx.flags = { force: true, yes: true, _: [], 'no-watch': true };
    const second = await initCommand.action!(ctx);

    expect(second.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(true);
  });
});
