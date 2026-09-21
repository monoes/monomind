/**
 * Commander-to-internal adapter.
 *
 * `action` and `platform` are written against commander, while `browse`'s own
 * subcommands use this package's internal Command shape. This wraps one as the
 * other so both can sit in the same subcommand list.
 */

import type { Command, CommandContext, CommandResult } from './types.js';

/**
 * Wraps a commander.Command instance as an internal Command object so it can
 * participate in the browse command's subcommands array.  The adapter
 * reconstructs a raw argv string from the context that was parsed by the
 * internal CLI, then hands it off to commander's parseAsync.
 */
export function wrapCommanderCommand(factory: () => import('commander').Command): Command {
  // Lazily instantiate so we don't pay import cost at startup
  let _cmd: import('commander').Command | null = null;
  const getCmd = () => {
    if (!_cmd) _cmd = factory();
    return _cmd;
  };

  const cmd = getCmd();
  const subcommandDefs: Command[] = (cmd.commands as import('commander').Command[]).map((sub) => ({
    name: sub.name(),
    description: sub.description(),
    action: async (ctx: CommandContext): Promise<CommandResult> => {
      // Rebuild argv: node <cmd> <sub> [positional args] [--flag [value] ...]
      const argv = ['node', cmd.name(), sub.name(), ...ctx.args];
      for (const [key, val] of Object.entries(ctx.flags)) {
        if (key === '_') continue;
        if (typeof val === 'boolean') {
          if (val) argv.push(`--${key}`);
        } else if (val !== undefined && val !== null) {
          argv.push(`--${key}`, String(val));
        }
      }
      // Re-use the same commander instance to keep state (e.g. option defaults)
      await getCmd().parseAsync(argv, { from: 'user' });
      return { success: true };
    },
  }));

  return {
    name: cmd.name(),
    description: cmd.description(),
    subcommands: subcommandDefs,
    action: async (ctx: CommandContext): Promise<CommandResult> => {
      // No subcommand provided — show commander help
      const argv = ['node', cmd.name(), ...ctx.args];
      for (const [key, val] of Object.entries(ctx.flags)) {
        if (key === '_') continue;
        if (typeof val === 'boolean') {
          if (val) argv.push(`--${key}`);
        } else if (val !== undefined && val !== null) {
          argv.push(`--${key}`, String(val));
        }
      }
      await getCmd().parseAsync(argv, { from: 'user' });
      return { success: true };
    },
  };
}
