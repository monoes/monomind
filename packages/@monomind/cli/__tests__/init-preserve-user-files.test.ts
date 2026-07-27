/**
 * Regression tests: `monomind init` must never delete a file it did not write.
 *
 * The "stale cleanup" passes in copySkills/copyCommands/copyAgents used to
 * `fs.rmSync` every entry under .claude/{skills,commands,agents} that wasn't in
 * the current version's SKILLS_MAP/COMMANDS_MAP/AGENTS_MAP — which is every
 * user-authored command and skill. That is unconditional data loss on the first
 * command a new user runs in an existing project.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { initCommand } from '../src/commands/init.js';
import { statusCommand } from '../src/commands/status.js';
import { CommandParser } from '../src/parser.js';
import { output } from '../src/output.js';
import type { CommandContext } from '../src/types.js';

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

describe('init preserves user-authored .claude content', () => {
  let tmpDir: string;
  let fakeHome: string;
  let realHome: string | undefined;
  let ctx: CommandContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-preserve-'));
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-preserve-home-'));
    realHome = process.env.HOME;
    process.env.HOME = fakeHome;
    ctx = {
      args: [],
      flags: { _: [], 'no-watch': true },
      cwd: tmpDir,
      interactive: false,
    };
  });

  afterEach(() => {
    process.env.HOME = realHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it('does not delete a user-authored command file or skill directory', async () => {
    const cmdDir = path.join(tmpDir, '.claude', 'commands');
    const skillDir = path.join(tmpDir, '.claude', 'skills', 'mine');
    const agentDir = path.join(tmpDir, '.claude', 'agents', 'my-team');
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.mkdirSync(skillDir, { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(cmdDir, 'my-own.md'), 'MY OWN COMMAND CONTENT\n');
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'MY OWN SKILL CONTENT\n');
    fs.writeFileSync(path.join(agentDir, 'my-agent.md'), 'MY OWN AGENT CONTENT\n');

    const result = await initCommand.action!(ctx);
    expect(result.success).toBe(true);

    expect(fs.existsSync(path.join(cmdDir, 'my-own.md'))).toBe(true);
    expect(fs.readFileSync(path.join(cmdDir, 'my-own.md'), 'utf8')).toContain('MY OWN COMMAND CONTENT');
    expect(fs.existsSync(path.join(skillDir, 'SKILL.md'))).toBe(true);
    expect(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')).toContain('MY OWN SKILL CONTENT');
    expect(fs.existsSync(path.join(agentDir, 'my-agent.md'))).toBe(true);
    expect(fs.readFileSync(path.join(agentDir, 'my-agent.md'), 'utf8')).toContain('MY OWN AGENT CONTENT');
  }, 60000);

  it('still removes stale generated content it wrote in a previous run', async () => {
    // First init records a provenance manifest of everything it generated.
    const first = await initCommand.action!(ctx);
    expect(first.success).toBe(true);

    const manifestPath = path.join(tmpDir, '.monomind', 'init-manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(Array.isArray(manifest.commands)).toBe(true);
    expect(manifest.commands.length).toBeGreaterThan(0);

    // Simulate a command that this version no longer ships but a previous
    // version generated: record it as generated, then re-run init.
    const staleName = 'zz-removed-in-this-version.md';
    fs.writeFileSync(
      path.join(tmpDir, '.claude', 'commands', staleName),
      'stale generated content\n'
    );
    manifest.commands.push(staleName);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    ctx.flags = { force: true, yes: true, _: [], 'no-watch': true };
    const second = await initCommand.action!(ctx);
    expect(second.success).toBe(true);

    expect(fs.existsSync(path.join(tmpDir, '.claude', 'commands', staleName))).toBe(false);
  }, 90000);
});

describe('init --no-watch has an observable effect', () => {
  let tmpDir: string;
  let fakeHome: string;
  let realHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-watch-'));
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-watch-home-'));
    realHome = process.env.HOME;
    process.env.HOME = fakeHome;
  });

  afterEach(() => {
    process.env.HOME = realHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  const pidFile = () => path.join(tmpDir, '.monomind', 'monograph.watch.pid');

  /**
   * Parse a real argv through a parser that also has `status` registered.
   * That matters: getBooleanFlags() is global across every registered command,
   * so `status`'s boolean `--watch` is what made `--no-watch` on init resolve
   * to the wrong key. Hand-building ctx.flags would hide the whole bug.
   */
  const runInit = async (argv: string[]) => {
    const parser = new CommandParser();
    parser.registerCommand(initCommand);
    parser.registerCommand(statusCommand);
    const parsed = parser.parse(argv);
    return initCommand.action!({
      args: parsed.args ?? [],
      flags: parsed.flags,
      cwd: tmpDir,
      interactive: false,
    } as CommandContext);
  };

  // `--watch` is explicit here on purpose. The watcher used to start on every
  // init, including non-interactive ones, which orphaned a permanent process
  // per throwaway sandbox (#50). It now auto-starts only for an interactive
  // user; this test runs without a TTY, so it must ask.
  it('starts the graph watcher when --watch is passed (writes a watcher pid file)', async () => {
    const result = await runInit(['init', '--watch']);

    expect(result.success).toBe(true);
    expect(fs.existsSync(pidFile())).toBe(true);
  }, 60000);

  it('starts no watcher in a non-interactive run when the flag is absent', async () => {
    const result = await runInit(['init']);

    expect(result.success).toBe(true);
    expect(fs.existsSync(pidFile())).toBe(false);
  }, 60000);

  it('skips the graph watcher when --no-watch is passed on the command line', async () => {
    const result = await runInit(['init', '--no-watch']);

    expect(result.success).toBe(true);
    expect(fs.existsSync(pidFile())).toBe(false);
  }, 60000);

  it('declares watch as a boolean option so --no-watch actually reaches it', () => {
    const watchOpt = initCommand.options?.find(o => o.name === 'watch');
    expect(watchOpt).toBeDefined();
    expect(watchOpt!.type).toBe('boolean');
    // No default: the value must stay undefined when nobody passed the flag,
    // so init can distinguish "not asked" from "asked for true" and only
    // auto-start for an interactive user.
    expect(watchOpt!.default).toBeUndefined();
    // A boolean literally named 'no-watch' can never be set by the parser:
    // parseFlag strips the `--no-` prefix before lookup.
    expect(initCommand.options?.some(o => o.name === 'no-watch')).toBe(false);
  });
});
