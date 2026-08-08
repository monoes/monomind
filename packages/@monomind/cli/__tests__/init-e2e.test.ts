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
 *
 * All runs pass --no-start-all: the startAll block (in-process memory DB
 * init with the real @monoes/memory backend registry, npx swarm init, worker
 * metrics seeding) is by far the slowest part of init and none of the
 * assertions below cover it — under full-suite parallel load it alone pushed
 * these tests past even a 90s timeout. The watcher is gated by --watch, not
 * startAll, so watch behavior is still exercised where asserted.
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
  let fakeHome: string;
  let realHome: string | undefined;
  let ctx: CommandContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-e2e-'));
    // executeInit's _registerMonomindProject() writes to
    // ~/.monomind-projects.json via os.homedir() (which reads $HOME on
    // Unix) — redirect it to a throwaway dir so real init runs don't get
    // this test's tmpdir permanently registered in the user's actual
    // project registry.
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-e2e-home-'));
    realHome = process.env.HOME;
    process.env.HOME = fakeHome;
    ctx = {
      args: [],
      flags: { _: [], 'no-watch': true, 'no-start-all': true },
      cwd: tmpDir,
      interactive: false
    };
  });

  afterEach(async () => {
    try {
      // Close any SQLite backends init opened in this process so the tmpdir
      // rmSync below can't trip over live file handles. (The previous cleanup
      // called MemoryStore.closeAll — an API that does not exist — and
      // silently no-oped.)
      const bridge = await import('../src/memory/memory-bridge.js');
      await bridge.shutdownBridge();
    } catch {}
    process.env.HOME = realHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it('should initialize with default configuration', async () => {
    const result = await initCommand.action!(ctx);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'config.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.md'))).toBe(true);
  }, 30000); // real-fs init under full-suite parallel load can exceed the 15s default (#33)

  it('should initialize with minimal configuration', async () => {
    ctx.flags = { minimal: true, _: [], 'no-watch': true, 'no-start-all': true };
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
  }, 30000); // #33

  it('should initialize with full configuration', async () => {
    ctx.flags = { full: true, _: [], 'no-watch': true, 'no-start-all': true };
    const result = await initCommand.action!(ctx);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'commands'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'agents'))).toBe(true);
  }, 60000); // #33 — full config copies the most; only test here without an explicit timeout

  it('should always write auto-memory-hook.mjs even when it is absent from the source helpers dir', async () => {
    // Regression test: writeHelpers() used to return early as soon as it copied
    // *any* file from the source .claude/helpers dir, skipping the fallback
    // generator for files missing from that source dir specifically. Since the
    // packaged source helpers dir has never actually shipped auto-memory-hook.mjs,
    // every real init wired SessionStart/SessionEnd/Stop hooks to a file that
    // was never written, crashing with MODULE_NOT_FOUND on every session end.
    const result = await initCommand.action!(ctx);

    expect(result.success).toBe(true);
    const hookPath = path.join(tmpDir, '.claude', 'helpers', 'auto-memory-hook.mjs');
    expect(fs.existsSync(hookPath)).toBe(true);
  });

  it('should reinitialize with force flag', async () => {
    // First init
    const first = await initCommand.action!(ctx);
    expect(first.success).toBe(true);

    // Re-run with --force --yes (yes skips the non-interactive "already initialized" error)
    ctx.flags = { force: true, yes: true, _: [], 'no-watch': true, 'no-start-all': true };
    const second = await initCommand.action!(ctx);

    expect(second.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(true);
  }, 90000); // two real-fs init runs + first-use embedding-model load — #33
});
