/**
 * CLI Replay Command (Task 14)
 * Session replay and inspection
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

const showSubcommand: Command = {
  name: 'show',
  description: 'Show replay for a session',
  options: [
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const sessionId = ctx.args[0];
    if (!sessionId) {
      output.error('Session ID is required: replay show <sessionId>');
      return { success: false, message: 'Missing session ID' };
    }
    try {
      const { ReplayReader } = await import('../observability/replay-reader.js');
      const reader = new ReplayReader();
      const data = await reader.show(sessionId);
      const asJson = ctx.flags['json'] as boolean;
      output.log(asJson ? JSON.stringify(data, null, 2) : `Replay for session ${sessionId}`);
      return { success: true, data };
    } catch {
      output.log(`No replay data for session ${sessionId}`);
      return { success: true, message: 'No replay data' };
    }
  },
};

const listSubcommand: Command = {
  name: 'list',
  description: 'List available session replays',
  options: [
    { name: 'limit', short: 'n', type: 'number', description: 'Max entries', default: 20 },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const { ReplayReader } = await import('../observability/replay-reader.js');
      const reader = new ReplayReader();
      const data = await reader.list(ctx.flags['limit'] as number);
      const asJson = ctx.flags['json'] as boolean;
      output.log(asJson ? JSON.stringify(data, null, 2) : 'Available replays listed');
      return { success: true, data };
    } catch {
      output.log('No replay sessions available');
      return { success: true, message: 'No sessions' };
    }
  },
};

export const replayCommand: Command = {
  name: 'replay',
  description: 'Session replay and inspection',
  subcommands: [showSubcommand, listSubcommand],
};

export default replayCommand;
