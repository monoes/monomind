/**
 * Dispatcher safety regressions.
 *
 * Two distinct bugs, both silent:
 *
 * 1. An unrecognised FIRST token was discarded and the SECOND token was
 *    dispatched as the command. `monomind zzzgarbage status` ran `status` —
 *    a typo could run something the user never asked for. The parser's
 *    positional loop only guarded on "no command resolved yet", so it kept
 *    scanning until *some* token matched a registered command name.
 *
 * 2. Options declared on a subcommand nested 2+ levels deep were invisible to
 *    the parser's alias/boolean scan, which resolved only one subcommand level
 *    before scoping. `monomind hooks worker run -n audit` therefore resolved
 *    `-n` out of the global last-write-wins alias pool (where it meant
 *    `--limit`) instead of `run`'s own `-n, --name`, and failed with "Worker
 *    name is required" while `--name audit` worked.
 *
 * Both are asserted here at the parser level (deterministic, no process spawn)
 * plus at the CLI level for the user-visible error and exit code.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAllCommands } from '../commands/index.js';
import { CLI } from '../index.js';
import { CommandParser } from '../parser.js';
import type { Command } from '../types.js';

async function realParser(): Promise<CommandParser> {
  const parser = new CommandParser({ allowUnknownFlags: true });
  const commands = await loadAllCommands();
  for (const cmd of commands) parser.registerCommand(cmd);
  return parser;
}

describe('unknown command is never silently replaced by a later token', () => {
  it('does not promote the second token to the command when the first is unknown', async () => {
    const parser = await realParser();
    const result = parser.parse(['zzzgarbage', 'status']);

    // Before the fix: command === ['status'], positional === ['zzzgarbage'].
    expect(result.command).toEqual([]);
    expect(result.positional).toEqual(['zzzgarbage', 'status']);
  });

  it('still resolves a real command that follows only global flags', async () => {
    const parser = await realParser();
    // `--verbose` is a declared global boolean, so it consumes no value and
    // `status` is still the first non-flag token.
    expect(parser.parse(['--verbose', 'status']).command).toEqual(['status']);
    expect(parser.parse(['status']).command).toEqual(['status']);
  });

  it('does not treat a subcommand name as the command when the parent is a typo', async () => {
    const parser = await realParser();
    // `list` exists as a subcommand of several commands but not top-level;
    // `memory` does. A typo'd parent must not fall through to anything.
    const result = parser.parse(['memry', 'memory', 'list']);
    expect(result.command).toEqual([]);
    expect(result.positional[0]).toBe('memry');
  });

  it('keeps positional args of a resolved command working', async () => {
    const parser = await realParser();
    const result = parser.parse(['status', 'zzzgarbage']);
    expect(result.command).toEqual(['status']);
    expect(result.positional).toEqual(['zzzgarbage']);
  });
});

describe('options on subcommands nested 2+ levels deep are visible to the parser', () => {
  it('resolves a depth-2 short flag to its own option, not the global alias pool', async () => {
    const parser = await realParser();
    const result = parser.parse(['hooks', 'worker', 'run', '-n', 'audit']);

    // Before the fix: flags.name was undefined and flags.limit === 'audit',
    // so `hooks worker run -n audit` errored with "Worker name is required".
    expect(result.command).toEqual(['hooks', 'worker', 'run']);
    expect(result.flags.name).toBe('audit');
  });

  it('treats a depth-2 boolean option as boolean instead of eating the next arg', () => {
    const parser = new CommandParser({ allowUnknownFlags: true });
    const leaf: Command = {
      name: 'run',
      description: 'leaf',
      options: [
        { name: 'name', short: 'n', description: 'name', type: 'string' },
        { name: 'deep-flag', description: 'boolean at depth 2', type: 'boolean' },
      ],
      action: async () => ({ success: true }),
    };
    const mid: Command = { name: 'worker', description: 'group', subcommands: [leaf] };
    const root: Command = { name: 'hooks', description: 'group', subcommands: [mid] };
    parser.registerCommand(root);

    const result = parser.parse(['hooks', 'worker', 'run', '--deep-flag', 'positional']);
    expect(result.flags.deepFlag).toBe(true);
    expect(result.positional).toEqual(['positional']);
  });

  it('resolves options at depth 3, so the fix is not another fixed limit', () => {
    const parser = new CommandParser({ allowUnknownFlags: true });
    const leaf: Command = {
      name: 'd',
      description: 'leaf',
      options: [{ name: 'zulu', short: 'z', description: 'z', type: 'string' }],
      action: async () => ({ success: true }),
    };
    const c: Command = { name: 'c', description: '', subcommands: [leaf] };
    const b: Command = { name: 'b', description: '', subcommands: [c] };
    const a: Command = { name: 'a', description: '', subcommands: [b] };
    parser.registerCommand(a);

    const result = parser.parse(['a', 'b', 'c', 'd', '-z', 'value']);
    expect(result.command).toEqual(['a', 'b', 'c', 'd']);
    expect(result.flags.zulu).toBe('value');
  });

  it("a parent's own options still win over globals when the leaf does not redeclare them", () => {
    const parser = new CommandParser({ allowUnknownFlags: true });
    const leaf: Command = {
      name: 'run',
      description: 'leaf',
      action: async () => ({ success: true }),
    };
    const mid: Command = {
      name: 'worker',
      description: 'group',
      // `-c` is the global `--config`; the depth-1 parent overrides it, and the
      // leaf (which declares nothing) must not lose that override.
      options: [{ name: 'channel', short: 'c', description: 'channel', type: 'string' }],
      subcommands: [leaf],
    };
    const root: Command = { name: 'hooks', description: 'group', subcommands: [mid] };
    parser.registerCommand(root);

    const result = parser.parse(['hooks', 'worker', 'run', '-c', 'alpha']);
    expect(result.flags.channel).toBe('alpha');
  });
});

describe('CLI surfaces unknown commands', () => {
  let out: string[];
  let cli: CLI;

  beforeEach(() => {
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => {
      out.push(String(s));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => {
      out.push(String(s));
      return true;
    });
    vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit: ${code}`);
    });
    cli = new CLI({ interactive: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('errors and exits non-zero instead of running the following token', async () => {
    await expect(cli.run(['zzzgarbage', 'status', '--no-update'])).rejects.toThrow(
      'process.exit: 1',
    );
    const text = out.join('');
    expect(text).toContain('Unknown command: zzzgarbage');
    // The `status` action prints one of these; neither may appear.
    expect(text).not.toContain('MonoMind is not initialized');
    expect(text).not.toContain('System Status');
  });

  it('offers a "did you mean" suggestion for a near-miss typo', async () => {
    await expect(cli.run(['statuss', '--no-update'])).rejects.toThrow('process.exit: 1');
    const text = out.join('');
    expect(text).toContain('Unknown command: statuss');
    expect(text).toContain('status');
  });

  it('bare invocation still prints the main help and does not exit non-zero', async () => {
    await cli.run(['--no-update']);
    const text = out.join('');
    expect(text).toContain('USAGE:');
    expect(text).toContain('GLOBAL OPTIONS:');
  });
});
