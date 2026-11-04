import type { Command, CommandContext, CommandResult } from '../types.js';
import { postCommandCommand, preCommandCommand } from './hooks-core-commands.js';
import { routeCommand } from './hooks-routing-commands.js';
import { sessionRestoreCommand } from './hooks-session-commands.js';

// Backward-compatible aliases for v2 hooks
// These ensure old settings.json files continue to work
export const routeTaskCommand: Command = {
  name: 'route-task',
  description: '(DEPRECATED: Use "route" instead) Route task to optimal agent',
  options: routeCommand.options,
  examples: [
    {
      command: 'monomind hooks route-task --auto-swarm true',
      description: 'Route with the removed --auto-swarm flag (accepted and ignored, v2 compat)',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Silently handle v2-specific flags that don't exist in v1
    // --auto-swarm, --detect-complexity are ignored but don't fail
    if (routeCommand.action) {
      const result = await routeCommand.action(ctx);
      return result || { success: true };
    }
    return { success: true };
  },
};

export const sessionStartCommand: Command = {
  name: 'session-start',
  description: '(DEPRECATED: Use "session-restore" instead) Start/restore session',
  options: [
    ...(sessionRestoreCommand.options || []),
    // V2-compatible options that are silently ignored
    {
      name: 'auto-configure',
      description: '(v2 compat) Auto-configure session',
      type: 'boolean',
      default: false,
    },
    {
      name: 'restore-context',
      description: '(v2 compat) Restore context',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    {
      command: 'monomind hooks session-start --auto-configure true',
      description: 'Start session (v2 compat)',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Map to session-restore for backward compatibility
    if (sessionRestoreCommand.action) {
      const result = await sessionRestoreCommand.action(ctx);
      return result || { success: true };
    }
    return { success: true };
  },
};

// Pre-bash alias for pre-command (v2 compat)
export const preBashCommand: Command = {
  name: 'pre-bash',
  description: '(ALIAS) Same as pre-command',
  options: preCommandCommand.options,
  examples: preCommandCommand.examples,
  action: preCommandCommand.action,
};

// Post-bash alias for post-command (v2 compat)
export const postBashCommand: Command = {
  name: 'post-bash',
  description: '(ALIAS) Same as post-command',
  options: postCommandCommand.options,
  examples: postCommandCommand.examples,
  action: postCommandCommand.action,
};
