/**
 * Regression test for `config set --help`'s own printed example failing
 * verbatim: `monomind config set monoswarm.maxAgents 20` errored with
 * "[ERROR] Required option missing: --key/--value" even though the action
 * (config.ts's setCommand) has always accepted key/value as either `-k/-v`
 * flags OR two positional arguments.
 *
 * Root cause: both options were declared `required: true`. index.ts runs
 * `parser.validateFlags(flags, targetCommand)` BEFORE dispatching to the
 * action, and validateFlags only looks at `flags.key`/`flags.value` — it has
 * no notion of the positional-argument fallback the action implements. So a
 * purely-positional invocation (exactly what the command's own first
 * example demonstrates) was rejected by the parser layer before the action,
 * which would have handled it correctly, ever ran.
 *
 * Fix: dropped `required: true` from both options (config.ts). The action's
 * own `if (!key || value === undefined)` check — which already correctly
 * resolves key/value from either source — is the sole "both required"
 * enforcement now, so it applies uniformly regardless of which form the
 * user chose.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configCommand } from '../commands/config.js';
import { CommandParser } from '../parser.js';
import { configManager } from '../services/config-file-manager.js';
import type { CommandContext } from '../types.js';

function realParser(): CommandParser {
  const parser = new CommandParser({ allowUnknownFlags: true });
  parser.registerCommand(configCommand);
  return parser;
}

const setCommand = configCommand.subcommands?.find((sc) => sc.name === 'set');

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'config-set-positional-test-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('`config set` accepts key/value positionally, as its own example documents', () => {
  it('the parser no longer rejects the positional form before the action runs', () => {
    const parser = realParser();
    const result = parser.parse(['config', 'set', 'monoswarm.maxAgents', '20']);
    const errors = parser.validateFlags(result.flags, setCommand);

    expect(errors).toEqual([]);
  });

  it('the exact example from --help actually sets the value', async () => {
    expect(setCommand?.action).toBeTypeOf('function');
    const parser = realParser();
    const result = parser.parse(['config', 'set', 'monoswarm.maxAgents', '20']);
    expect(parser.validateFlags(result.flags, setCommand)).toEqual([]);

    const ctx: CommandContext = {
      args: result.positional,
      flags: result.flags,
      cwd,
      interactive: false,
    };
    const commandResult = await setCommand?.action?.(ctx);

    expect(commandResult?.success).toBe(true);
    expect(configManager.get(cwd, 'monoswarm.maxAgents')).toBe(20);
  });

  it('the -k/-v flag form still works (not a regression on the alternative path)', async () => {
    const parser = realParser();
    const result = parser.parse(['config', 'set', '-k', 'memory.backend', '-v', 'sqlite']);
    expect(parser.validateFlags(result.flags, setCommand)).toEqual([]);

    const ctx: CommandContext = {
      args: result.positional,
      flags: result.flags,
      cwd,
      interactive: false,
    };
    const commandResult = await setCommand?.action?.(ctx);

    expect(commandResult?.success).toBe(true);
    expect(configManager.get(cwd, 'memory.backend')).toBe('sqlite');
  });

  it('still reports a clear error when both key and value are missing', async () => {
    const ctx: CommandContext = { args: [], flags: { _: [] }, cwd, interactive: false };
    const commandResult = await setCommand?.action?.(ctx);

    expect(commandResult?.success).toBe(false);
  });
});
