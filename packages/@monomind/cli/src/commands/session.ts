/**
 * CLI Session Command
 * Session management for Monomind
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { confirm, input, select } from '../prompt.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';

// Format date for display
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  // Less than 24 hours - show relative time
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));

    if (hours > 0) {
      return `${hours}h ${minutes}m ago`;
    }
    return `${minutes}m ago`;
  }

  // Otherwise show date
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

// Format session status
function formatStatus(status: string): string {
  switch (status) {
    case 'active':
      return output.success(status);
    case 'saved':
      return output.info(status);
    case 'archived':
      return output.dim(status);
    default:
      return status;
  }
}

// List subcommand
const listCommand: Command = {
  name: 'list',
  aliases: ['ls'],
  description: 'List all sessions',
  options: [
    {
      name: 'active',
      short: 'a',
      description: 'Show only active sessions',
      type: 'boolean',
      default: false
    },
    {
      name: 'all',
      description: 'Include archived sessions',
      type: 'boolean',
      default: false
    },
    {
      name: 'limit',
      short: 'l',
      description: 'Maximum sessions to show',
      type: 'number',
      default: 20
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const activeOnly = ctx.flags.active as boolean;
    const includeArchived = ctx.flags.all as boolean;
    const rawLimit = ctx.flags.limit as number;
    // Cap limit to prevent unbounded MCP calls
    const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(Math.floor(rawLimit), 200))
      : 20;

    try {
      const result = await callMCPTool<{
        sessions: Array<{
          id: string;
          name?: string;
          description?: string;
          status: 'active' | 'saved' | 'archived';
          createdAt: string;
          updatedAt: string;
          agentCount: number;
          taskCount: number;
          memorySize: number;
        }>;
        total: number;
      }>('session_list', {
        status: activeOnly ? 'active' : includeArchived ? 'all' : 'active,saved',
        limit
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Sessions'));
      output.writeln();

      if (result.sessions.length === 0) {
        output.printInfo('No sessions found');
        output.printInfo('Run "monomind session save" to create a session');
        return { success: true, data: result };
      }

      output.printTable({
        columns: [
          { key: 'id', header: 'ID', width: 20 },
          { key: 'name', header: 'Name', width: 20 },
          { key: 'status', header: 'Status', width: 10 },
          { key: 'agents', header: 'Agents', width: 8, align: 'right' },
          { key: 'tasks', header: 'Tasks', width: 8, align: 'right' },
          { key: 'updated', header: 'Last Updated', width: 18 }
        ],
        data: result.sessions.map(s => ({
          id: s.id,
          name: s.name || '-',
          status: formatStatus(s.status),
          agents: s.agentCount,
          tasks: s.taskCount,
          updated: formatDate(s.updatedAt)
        }))
      });

      output.writeln();
      output.printInfo(`Showing ${result.sessions.length} of ${result.total} sessions`);

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to list sessions: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Save subcommand
const saveCommand: Command = {
  name: 'save',
  aliases: ['create', 'checkpoint'],
  description: 'Save current session state',
  options: [
    {
      name: 'name',
      short: 'n',
      description: 'Session name',
      type: 'string'
    },
    {
      name: 'description',
      short: 'd',
      description: 'Session description',
      type: 'string'
    },
    {
      name: 'include-memory',
      description: 'Include memory state in session',
      type: 'boolean',
      default: true
    },
    {
      name: 'include-agents',
      description: 'Include agent state in session',
      type: 'boolean',
      default: true
    },
    {
      name: 'include-tasks',
      description: 'Include task state in session',
      type: 'boolean',
      default: true
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let sessionName = ctx.flags.name as string;
    let description = ctx.flags.description as string;

    // Interactive mode
    if (!sessionName && ctx.interactive) {
      sessionName = await input({
        message: 'Session name:',
        default: `session-${Date.now().toString(36)}`,
        validate: (v) => v.length > 0 || 'Name is required'
      });
    }

    if (!description && ctx.interactive) {
      description = await input({
        message: 'Session description (optional):',
        default: ''
      });
    }

    // Cap name and description lengths to prevent DoS / oversized storage
    if (typeof sessionName === 'string' && sessionName.length > 200) {
      sessionName = sessionName.slice(0, 200);
    }
    if (typeof description === 'string' && description.length > 2000) {
      description = description.slice(0, 2000);
    }

    const spinner = output.createSpinner({ text: 'Saving session...' });
    spinner.start();

    try {
      const result = await callMCPTool<{
        sessionId: string;
        name: string;
        description?: string;
        savedAt: string;
        includes: {
          memory: boolean;
          agents: boolean;
          tasks: boolean;
        };
        stats: {
          agentCount: number;
          taskCount: number;
          memoryEntries: number;
          totalSize: number;
        };
      }>('session_save', {
        name: sessionName,
        description,
        includeMemory: ctx.flags['include-memory'] !== false,
        includeAgents: ctx.flags['include-agents'] !== false,
        includeTasks: ctx.flags['include-tasks'] !== false
      });

      spinner.succeed('Session saved');
      output.writeln();

      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 18 },
          { key: 'value', header: 'Value', width: 35 }
        ],
        data: [
          { property: 'Session ID', value: result.sessionId },
          { property: 'Name', value: result.name },
          { property: 'Description', value: result.description || '-' },
          { property: 'Saved At', value: new Date(result.savedAt).toLocaleString() },
          { property: 'Agents', value: result.stats.agentCount },
          { property: 'Tasks', value: result.stats.taskCount },
          { property: 'Memory Entries', value: result.stats.memoryEntries },
          { property: 'Total Size', value: formatSize(result.stats.totalSize) }
        ]
      });

      output.writeln();
      output.printSuccess(`Session saved: ${result.sessionId}`);
      output.printInfo(`Restore with: monomind session restore ${result.sessionId}`);

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Failed to save session');
      if (error instanceof MCPClientError) {
        output.printError(`Error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Restore subcommand
const restoreCommand: Command = {
  name: 'restore',
  aliases: ['load'],
  description: 'Restore a saved session',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Overwrite current state without confirmation',
      type: 'boolean',
      default: false
    },
    {
      name: 'memory-only',
      description: 'Only restore memory state',
      type: 'boolean',
      default: false
    },
    {
      name: 'agents-only',
      description: 'Only restore agent state',
      type: 'boolean',
      default: false
    },
    {
      name: 'tasks-only',
      description: 'Only restore task state',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let sessionId = ctx.args[0];
    const force = ctx.flags.force as boolean;

    if (!sessionId && ctx.interactive) {
      // Show list to select from
      try {
        const sessions = await callMCPTool<{
          sessions: Array<{ id: string; name?: string; status: string; updatedAt: string }>;
        }>('session_list', { status: 'saved', limit: 20 });

        if (sessions.sessions.length === 0) {
          output.printWarning('No saved sessions found');
          return { success: false, exitCode: 1 };
        }

        sessionId = await select({
          message: 'Select session to restore:',
          options: sessions.sessions.map(s => ({
            value: s.id,
            label: s.name || s.id,
            hint: formatDate(s.updatedAt)
          }))
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'User cancelled') {
          output.printInfo('Operation cancelled');
          return { success: true };
        }
        throw error;
      }
    }

    if (!sessionId) {
      output.printError('Session ID is required');
      return { success: false, exitCode: 1 };
    }

    // Confirm unless forced
    if (!force && ctx.interactive) {
      const confirmed = await confirm({
        message: 'This will overwrite current state. Continue?',
        default: false
      });

      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    const spinner = output.createSpinner({ text: 'Restoring session...' });
    spinner.start();

    try {
      // Determine what to restore
      const restoreMemory = !ctx.flags['agents-only'] && !ctx.flags['tasks-only'];
      const restoreAgents = !ctx.flags['memory-only'] && !ctx.flags['tasks-only'];
      const restoreTasks = !ctx.flags['memory-only'] && !ctx.flags['agents-only'];

      const result = await callMCPTool<{
        sessionId: string;
        restoredAt: string;
        restored: {
          memory: boolean;
          agents: boolean;
          tasks: boolean;
        };
        stats: {
          agentsRestored: number;
          tasksRestored: number;
          memoryEntriesRestored: number;
        };
      }>('session_restore', {
        sessionId,
        restoreMemory,
        restoreAgents,
        restoreTasks
      });

      spinner.succeed('Session restored');
      output.writeln();

      output.printTable({
        columns: [
          { key: 'component', header: 'Component', width: 20 },
          { key: 'status', header: 'Status', width: 15 },
          { key: 'count', header: 'Items', width: 10, align: 'right' }
        ],
        data: [
          {
            component: 'Memory',
            status: result.restored.memory ? output.success('Restored') : output.dim('Skipped'),
            count: result.stats.memoryEntriesRestored
          },
          {
            component: 'Agents',
            status: result.restored.agents ? output.success('Restored') : output.dim('Skipped'),
            count: result.stats.agentsRestored
          },
          {
            component: 'Tasks',
            status: result.restored.tasks ? output.success('Restored') : output.dim('Skipped'),
            count: result.stats.tasksRestored
          }
        ]
      });

      output.writeln();
      output.printSuccess(`Session ${sessionId} restored successfully`);

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Failed to restore session');
      if (error instanceof MCPClientError) {
        output.printError(`Error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Delete subcommand
const deleteCommand: Command = {
  name: 'delete',
  aliases: ['rm', 'remove'],
  description: 'Delete a saved session',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Delete without confirmation',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const sessionId = ctx.args[0];
    const force = ctx.flags.force as boolean;

    if (!sessionId) {
      output.printError('Session ID is required');
      return { success: false, exitCode: 1 };
    }

    if (!force && ctx.interactive) {
      const confirmed = await confirm({
        message: `Delete session ${sessionId}? This cannot be undone.`,
        default: false
      });

      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    try {
      const result = await callMCPTool<{
        sessionId: string;
        deleted: boolean;
        deletedAt: string;
      }>('session_delete', { sessionId });

      output.writeln();
      output.printSuccess(`Session ${sessionId} deleted`);

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to delete session: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Current subcommand
const currentCommand: Command = {
  name: 'current',
  description: 'Show current active session',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const result = await callMCPTool<{
        sessionId: string;
        name?: string;
        status: string;
        startedAt: string;
        stats: {
          agentCount: number;
          taskCount: number;
          memoryEntries: number;
          duration: number;
        };
      }>('session_info', { includeStats: true });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Current Session'));
      output.writeln();

      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 18 },
          { key: 'value', header: 'Value', width: 35 }
        ],
        data: [
          { property: 'Session ID', value: result.sessionId },
          { property: 'Name', value: result.name || '-' },
          { property: 'Status', value: formatStatus(result.status) },
          { property: 'Started', value: new Date(result.startedAt).toLocaleString() },
          { property: 'Duration', value: formatDuration(result.stats.duration) },
          { property: 'Agents', value: result.stats.agentCount },
          { property: 'Tasks', value: result.stats.taskCount },
          { property: 'Memory Entries', value: result.stats.memoryEntries }
        ]
      });

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printWarning('No active session');
        output.printInfo('Start a session with "monomind start"');
        return { success: true, data: { active: false } };
      }
      output.printError(`Unexpected error: ${String(error)}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Replay subcommand (session replay and inspection, merged from `replay` command)
const replayShowCommand: Command = {
  name: 'show',
  description: 'Show replay for a session',
  options: [
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Cap session ID to prevent DoS via oversized string and unbounded output reflection.
    const sessionId = (ctx.args[0] || '').slice(0, 128);
    if (!sessionId) {
      output.printError('Session ID is required: session replay show <sessionId>');
      return { success: false, message: 'Missing session ID' };
    }

    try {
      const { ReplayReader } = await import('../observability/replay-reader.js');
      const reader = new ReplayReader();
      const data = await reader.show(sessionId);
      if (!data) {
        output.writeln(`No replay data for session ${sessionId}`);
        return { success: true, message: 'No replay data' };
      }

      if (ctx.flags['json'] as boolean) {
        output.writeln(JSON.stringify(data, null, 2));
        return { success: true, data };
      }

      // Human-readable summary derived from the session replay data
      const started = new Date(data.startedAt);
      const ended = data.endedAt ? new Date(data.endedAt) : null;
      const duration = ended && !isNaN(started.getTime()) && !isNaN(ended.getTime())
        ? formatDuration(ended.getTime() - started.getTime())
        : 'in progress';

      output.writeln();
      output.writeln(output.bold(`Replay: ${data.id}`));
      output.writeln();
      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 18 },
          { key: 'value', header: 'Value', width: 45 }
        ],
        data: [
          { property: 'Started', value: isNaN(started.getTime()) ? data.startedAt : started.toLocaleString() },
          { property: 'Ended', value: ended ? ended.toLocaleString() : '-' },
          { property: 'Duration', value: duration },
          { property: 'Tasks', value: data.taskCount != null ? String(data.taskCount) : '-' },
          { property: 'Tokens', value: data.tokenUsage?.total != null ? String(data.tokenUsage.total) : '-' },
          { property: 'File', value: data.filePath }
        ]
      });

      // Key steps: surface recorded metrics from the raw session data if present
      const metrics = data.raw?.metrics;
      if (metrics && typeof metrics === 'object') {
        const entries = Object.entries(metrics as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'number' || typeof v === 'string');
        if (entries.length > 0) {
          output.writeln();
          output.writeln(output.bold('Metrics'));
          output.printList(entries.map(([k, v]) => `${k}: ${String(v)}`));
        }
      }

      return { success: true, data };
    } catch {
      output.writeln(`No replay data for session ${sessionId}`);
      return { success: true, message: 'No replay data' };
    }
  },
};

const replayListCommand: Command = {
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
      const rawLimit = ctx.flags['limit'] as number;
      // Cap limit to prevent DoS
      const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(Math.floor(rawLimit), 500))
        : 20;
      const data = await reader.list(limit);

      if (ctx.flags['json'] as boolean) {
        output.writeln(JSON.stringify(data, null, 2));
        return { success: true, data };
      }

      if (data.length === 0) {
        output.writeln('No replay sessions available');
        return { success: true, data };
      }

      output.writeln();
      output.writeln(output.bold(`Session Replays (${data.length})`));
      output.writeln();
      output.printTable({
        columns: [
          { key: 'id', header: 'ID', width: 26 },
          { key: 'started', header: 'Started', width: 20 },
          { key: 'ended', header: 'Ended', width: 20 },
          { key: 'tasks', header: 'Tasks', width: 8, align: 'right' }
        ],
        data: data.map(s => ({
          id: s.id,
          started: formatDate(s.startedAt),
          ended: s.endedAt ? formatDate(s.endedAt) : '-',
          tasks: s.taskCount != null ? String(s.taskCount) : '-'
        }))
      });
      output.writeln();
      output.printInfo('Show details with: monomind session replay show <sessionId>');

      return { success: true, data };
    } catch {
      output.writeln('No replay sessions available');
      return { success: true, message: 'No sessions' };
    }
  },
};

const replayCommand: Command = {
  name: 'replay',
  description: 'Session replay and inspection',
  subcommands: [replayShowCommand, replayListCommand],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Session Replay'));
    output.writeln();
    output.writeln('Usage: monomind session replay <show|list> [options]');
    output.printList([
      `${output.highlight('show <sessionId>')} - Show replay for a session`,
      `${output.highlight('list')}             - List available session replays`
    ]);
    return { success: true };
  },
};

// Helper functions
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

// Main session command
export const sessionCommand: Command = {
  name: 'session',
  description: 'Session management commands',
  subcommands: [
    listCommand,
    saveCommand,
    restoreCommand,
    deleteCommand,
    currentCommand,
    replayCommand
  ],
  options: [],
  examples: [
    { command: 'monomind session list', description: 'List all sessions' },
    { command: 'monomind session save -n "checkpoint-1"', description: 'Save current session' },
    { command: 'monomind session restore session-123', description: 'Restore a session' },
    { command: 'monomind session delete session-123', description: 'Delete a session' },
    { command: 'monomind session current', description: 'Show current session' },
    { command: 'monomind session replay list', description: 'List available session replays' },
    { command: 'monomind session replay show session-123', description: 'Show replay for a session' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Show help if no subcommand
    output.writeln();
    output.writeln(output.bold('Session Management Commands'));
    output.writeln();
    output.writeln('Usage: monomind session <subcommand> [options]');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('list')}    - List all sessions`,
      `${output.highlight('save')}    - Save current session state`,
      `${output.highlight('restore')} - Restore a saved session`,
      `${output.highlight('delete')}  - Delete a saved session`,
      `${output.highlight('current')} - Show current active session`,
      `${output.highlight('replay')}  - Session replay and inspection (show, list)`
    ]);
    output.writeln();
    output.writeln('Run "monomind session <subcommand> --help" for subcommand help');

    return { success: true };
  }
};

export default sessionCommand;
