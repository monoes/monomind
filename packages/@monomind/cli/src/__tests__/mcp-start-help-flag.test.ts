/**
 * Regression test for release-blocking QA findings against `monomind mcp
 * start`:
 *
 *  - `monomind mcp start --help` / `-h` did NOT print help — it silently
 *    started a real MCP server instead (reproducible 2x).
 *
 * Root cause (parser.ts's buildScopedAliases(), by design — see its own
 * comment: "The resolved command's short flags take priority over global
 * ones, fixing collisions where multiple subcommands use the same short
 * flag"): `mcp start` declared its own `host` option with `short: 'h'`,
 * which shadowed the global `-h` → `--help` alias for that command's scope.
 * `-h` therefore set `flags.host` instead of `flags.help`, so index.ts's
 * `flags.help || flags.h` help short-circuit never fired and the command's
 * own action ran instead. This was the only option in the entire CLI that
 * reassigned `-h` (confirmed by grep across commands/*.ts).
 *
 * Fix: removed `short: 'h'` from `mcp start`'s `host` option (mcp.ts).
 * `--host` still works by its long form; `-h` now means help everywhere,
 * including `mcp start`, as it does for every other command.
 *
 * (The other half of the bug — bin/cli.js's raw stdio fast path bypassing
 * the parser entirely for ANY `mcp start ...` invocation, regardless of
 * flags, whenever stdin was non-TTY — is covered separately in
 * bin-cli-mcp-fast-path.test.ts, since it's a property of the entry-point
 * script rather than of the parser/command tree.)
 */

import { describe, expect, it } from 'vitest';
import { loadAllCommands } from '../commands/index.js';
import { CommandParser } from '../parser.js';

async function realParser(): Promise<CommandParser> {
  const parser = new CommandParser({ allowUnknownFlags: true });
  const commands = await loadAllCommands();
  for (const cmd of commands) parser.registerCommand(cmd);
  return parser;
}

describe('`mcp start -h` / `--help`', () => {
  it('-h resolves to the global help flag, not --host', async () => {
    const parser = await realParser();
    const result = parser.parse(['mcp', 'start', '-h']);

    expect(result.command).toEqual(['mcp', 'start']);
    expect(result.flags.help).toBe(true);
    // Untouched by -h — still the declared default, not `true` (which is
    // what the pre-fix bug coerced a bare -h into, since 'host' is a string
    // option with no following value token).
    expect(result.flags.host).toBe('localhost');
  });

  it('--help (long form) also resolves to the global help flag', async () => {
    const parser = await realParser();
    const result = parser.parse(['mcp', 'start', '--help']);

    expect(result.flags.help).toBe(true);
  });

  it('--host (long form) still sets the host option', async () => {
    const parser = await realParser();
    const result = parser.parse(['mcp', 'start', '--host', 'example.com']);

    expect(result.flags.host).toBe('example.com');
    expect(result.flags.help).toBe(false);
  });
});
