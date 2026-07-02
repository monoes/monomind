/**
 * Hive Mind communication subcommands — join, leave, consensus, broadcast, memory, shutdown
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { confirm } from '../prompt.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import {
  MAX_MESSAGE_LEN,
  MAX_KEY_LEN,
  MAX_VALUE_LEN,
  MAX_AGENT_ID_LEN,
} from './hive-mind-helpers.js';

export const joinCommand: Command = {
  name: 'join',
  description: 'Join an agent to the hive mind',
  options: [
    { name: 'agent-id', short: 'a', description: 'Agent ID to join', type: 'string' },
    { name: 'role', short: 'r', description: 'Agent role (worker, specialist, scout)', type: 'string', default: 'worker' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const agentId = (ctx.args[0] || ctx.flags['agent-id'] as string || ctx.flags.agentId as string || '').slice(0, MAX_AGENT_ID_LEN);
    if (!agentId) {
      output.printError('Agent ID is required. Use --agent-id or -a flag, or provide as argument.');
      return { success: false, exitCode: 1 };
    }
    try {
      const result = await callMCPTool<{ success: boolean; agentId: string; totalWorkers: number; error?: string }>('hive-mind_join', { agentId, role: ctx.flags.role });
      if (!result.success) { output.printError(result.error || 'Failed'); return { success: false, exitCode: 1 }; }
      output.printSuccess(`Agent ${agentId} joined hive (${result.totalWorkers} workers)`);
      return { success: true, data: result };
    } catch (error) {
      output.printError(`Join error: ${error instanceof MCPClientError ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  }
};

export const leaveCommand: Command = {
  name: 'leave',
  description: 'Remove an agent from the hive mind',
  options: [
    { name: 'agent-id', short: 'a', description: 'Agent ID to remove', type: 'string' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const agentId = (ctx.args[0] || ctx.flags['agent-id'] as string || ctx.flags.agentId as string || '').slice(0, MAX_AGENT_ID_LEN);
    if (!agentId) { output.printError('Agent ID required.'); return { success: false, exitCode: 1 }; }
    try {
      const result = await callMCPTool<{ success: boolean; agentId: string; remainingWorkers: number; error?: string }>('hive-mind_leave', { agentId });
      if (!result.success) { output.printError(result.error || 'Failed'); return { success: false, exitCode: 1 }; }
      output.printSuccess(`Agent ${agentId} left hive (${result.remainingWorkers} remaining)`);
      return { success: true, data: result };
    } catch (error) {
      output.printError(`Leave error: ${error instanceof MCPClientError ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  }
};

export const consensusCommand: Command = {
  name: 'consensus',
  description: 'Manage consensus proposals and voting',
  options: [
    { name: 'action', short: 'a', description: 'Consensus action', type: 'string', choices: ['propose', 'vote', 'status', 'list'], default: 'list' },
    { name: 'proposal-id', short: 'p', description: 'Proposal ID', type: 'string' },
    { name: 'type', short: 't', description: 'Proposal type', type: 'string' },
    { name: 'value', description: 'Proposal value', type: 'string' },
    { name: 'vote', short: 'v', description: 'Vote (yes/no)', type: 'string' },
    { name: 'voter-id', description: 'Voter agent ID', type: 'string' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const action = ctx.flags.action as string || 'list';
    try {
      const result = await callMCPTool<Record<string, unknown>>('hive-mind_consensus', {
        action,
        proposalId: ctx.flags['proposal-id'],
        type: ctx.flags.type,
        value: ctx.flags.value,
        vote: ctx.flags.vote === 'yes',
        voterId: ctx.flags['voter-id']
      });
      if (ctx.flags.format === 'json') { output.printJson(result); return { success: true, data: result }; }
      if (action === 'list') {
        output.writeln(output.bold('\nPending Proposals'));
        const pending = (result.pending as Array<Record<string, unknown>>) || [];
        if (pending.length === 0) output.printInfo('No pending proposals');
        else output.printTable({ columns: [{ key: 'proposalId', header: 'ID', width: 30 }, { key: 'type', header: 'Type', width: 12 }], data: pending });
      } else if (action === 'propose') {
        output.printSuccess(`Proposal created: ${result.proposalId}`);
      } else if (action === 'vote') {
        output.printSuccess(`Vote recorded (For: ${result.votesFor}, Against: ${result.votesAgainst})`);
      }
      return { success: true, data: result };
    } catch (error) {
      output.printError(`Consensus error: ${error instanceof MCPClientError ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  }
};

export const broadcastCommand: Command = {
  name: 'broadcast',
  description: 'Broadcast a message to all workers in the hive',
  options: [
    { name: 'message', short: 'm', description: 'Message to broadcast', type: 'string', required: true },
    { name: 'priority', short: 'p', description: 'Message priority', type: 'string', choices: ['low', 'normal', 'high', 'critical'], default: 'normal' },
    { name: 'from', short: 'f', description: 'Sender agent ID', type: 'string' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const message = (ctx.args.join(' ') || ctx.flags.message as string || '').slice(0, MAX_MESSAGE_LEN);
    if (!message) { output.printError('Message required. Use --message or -m flag.'); return { success: false, exitCode: 1 }; }
    try {
      const result = await callMCPTool<{ success: boolean; messageId: string; recipients: number; error?: string }>('hive-mind_broadcast', {
        message,
        priority: ctx.flags.priority,
        fromId: typeof ctx.flags.from === 'string' ? ctx.flags.from.slice(0, MAX_AGENT_ID_LEN) : undefined
      });
      if (!result.success) { output.printError(result.error || 'Failed'); return { success: false, exitCode: 1 }; }
      output.printSuccess(`Message broadcast to ${result.recipients} workers (ID: ${result.messageId})`);
      return { success: true, data: result };
    } catch (error) {
      output.printError(`Broadcast error: ${error instanceof MCPClientError ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  }
};

export const memorySubCommand: Command = {
  name: 'memory',
  description: 'Access hive shared memory',
  options: [
    { name: 'action', short: 'a', description: 'Memory action', type: 'string', choices: ['get', 'set', 'delete', 'list'], default: 'list' },
    { name: 'key', short: 'k', description: 'Memory key', type: 'string' },
    { name: 'value', short: 'v', description: 'Value to store', type: 'string' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const action = ctx.flags.action as string || 'list';
    const key = typeof ctx.flags.key === 'string' ? ctx.flags.key.slice(0, MAX_KEY_LEN) : undefined;
    const value = typeof ctx.flags.value === 'string' ? ctx.flags.value.slice(0, MAX_VALUE_LEN) : undefined;
    if ((action === 'get' || action === 'delete') && !key) { output.printError('Key required for get/delete.'); return { success: false, exitCode: 1 }; }
    if (action === 'set' && (!key || value === undefined)) { output.printError('Key and value required for set.'); return { success: false, exitCode: 1 }; }
    try {
      const result = await callMCPTool<Record<string, unknown>>('hive-mind_memory', { action, key, value });
      if (ctx.flags.format === 'json') { output.printJson(result); return { success: true, data: result }; }
      if (action === 'list') {
        const keys = (result.keys as string[]) || [];
        output.writeln(output.bold(`\nShared Memory (${result.count} keys)`));
        if (keys.length === 0) output.printInfo('No keys in shared memory');
        else output.printList(keys.map(k => output.highlight(k)));
      } else if (action === 'get') {
        output.writeln(output.bold(`\nKey: ${key}`));
        output.writeln(result.exists ? `Value: ${JSON.stringify(result.value, null, 2)}` : 'Key not found');
      } else if (action === 'set') {
        output.printSuccess(`Set ${key} in shared memory`);
      } else if (action === 'delete') {
        output.printSuccess(result.deleted ? `Deleted ${key}` : `Key ${key} did not exist`);
      }
      return { success: true, data: result };
    } catch (error) {
      output.printError(`Memory error: ${error instanceof MCPClientError ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  }
};

export const shutdownCommand: Command = {
  name: 'shutdown',
  description: 'Shutdown the hive mind',
  options: [
    { name: 'force', short: 'f', description: 'Force shutdown', type: 'boolean', default: false },
    { name: 'save-state', short: 's', description: 'Save state before shutdown', type: 'boolean', default: true }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const force = ctx.flags.force as boolean;
    const saveState = ctx.flags['save-state'] as boolean;

    if (!force && ctx.interactive) {
      const confirmed = await confirm({
        message: 'Shutdown the hive mind? All agents will be terminated.',
        default: false
      });
      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    output.printInfo('Shutting down hive mind...');
    const spinner = output.createSpinner({ text: 'Graceful shutdown in progress...', spinner: 'dots' });
    spinner.start();

    try {
      const result = await callMCPTool<{
        shutdown: boolean;
        agentsTerminated: number;
        stateSaved: boolean;
        shutdownTime: string;
      }>('hive-mind_shutdown', { force, saveState });

      spinner.succeed('Hive mind shutdown complete');
      output.writeln();
      output.printList([
        `Agents terminated: ${result.agentsTerminated}`,
        `State saved: ${result.stateSaved ? 'Yes' : 'No'}`,
        `Shutdown time: ${result.shutdownTime}`
      ]);

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Shutdown failed');
      if (error instanceof MCPClientError) {
        output.printError(`Shutdown error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};
