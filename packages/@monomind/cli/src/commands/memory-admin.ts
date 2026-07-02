/**
 * Memory Admin Commands
 * deleteCommand, statsCommand, configureCommand, cleanupCommand
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { select, confirm } from '../prompt.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import { configManager } from '../services/config-file-manager.js';

// Memory backends (needed for configureCommand)
const BACKENDS = [
  { value: 'lancedb', label: 'LanceDB', hint: 'Vector database with ANN indexing' },
  { value: 'sqlite', label: 'SQLite', hint: 'Lightweight local storage' },
  { value: 'hybrid', label: 'Hybrid', hint: 'SQLite + LanceDB (recommended)' },
  { value: 'memory', label: 'In-Memory', hint: 'Fast but non-persistent' }
];

// Delete command
export const deleteCommand: Command = {
  name: 'delete',
  aliases: ['rm'],
  description: 'Delete a memory entry (LanceDB, Memory Palace, or knowledge chunk)',
  options: [
    {
      name: 'key',
      short: 'k',
      description: 'Storage key',
      type: 'string'
    },
    {
      name: 'namespace',
      short: 'n',
      description: 'Memory namespace',
      type: 'string',
      default: 'default'
    },
    {
      name: 'source',
      short: 's',
      description: 'Source to delete from: lancedb, palace, knowledge',
      type: 'string',
      default: 'lancedb',
      choices: ['lancedb', 'palace', 'knowledge']
    },
    {
      name: 'id',
      description: 'Entry ID (palace/knowledge)',
      type: 'string'
    },
    {
      name: 'force',
      short: 'f',
      description: 'Skip confirmation',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'monomind memory delete -k "mykey"', description: 'Delete memory entry' },
    { command: 'monomind memory delete -k "lesson" -n "lessons"', description: 'Delete from specific namespace' },
    { command: 'monomind memory delete --source palace --id "abc123"', description: 'Delete Memory Palace drawer' },
    { command: 'monomind memory delete --source knowledge --id "chunk-42" -f', description: 'Delete knowledge chunk (no confirm)' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const source = (ctx.flags.source as string) || 'lancedb';
    const force = ctx.flags.force as boolean;

    if (source === 'lancedb') {
      const key = (ctx.flags.key as string) || ctx.args[0];
      const namespace = (ctx.flags.namespace as string) || 'default';
      if (!key) {
        output.printError('Key is required. Use: memory delete -k "key" [-n "namespace"]');
        return { success: false, exitCode: 1 };
      }
      if (!force && ctx.interactive) {
        const confirmed = await confirm({
          message: `Delete memory entry "${key}" from namespace "${namespace}"?`,
          default: false
        });
        if (!confirmed) {
          output.printInfo('Operation cancelled');
          return { success: true };
        }
      }
      try {
        const { deleteEntry } = await import('../memory/memory-initializer.js');
        const result = await deleteEntry({ key, namespace });
        if (!result.success) {
          output.printError((result as any).error || 'Failed to delete');
          return { success: false, exitCode: 1 };
        }
        if (result.deleted) {
          output.printSuccess(`Deleted "${key}" from namespace "${namespace}"`);
          output.printInfo(`Remaining entries: ${result.remainingEntries}`);
        } else {
          output.printWarning(`Key not found: "${key}" in namespace "${namespace}"`);
        }
        return { success: result.deleted, data: result };
      } catch (error) {
        output.printError(`Failed to delete: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return { success: false, exitCode: 1 };
      }
    }

    // palace or knowledge — JSONL file delete
    const id = (ctx.flags.id as string) || ctx.args[0];
    if (!id) {
      output.printError('Entry ID is required for palace/knowledge delete. Use --id');
      return { success: false, exitCode: 1 };
    }
    if (!/^[a-zA-Z0-9_\-]{1,128}$/.test(id)) {
      output.printError('ID must be 1-128 chars: alphanumeric, underscore, or hyphen only');
      return { success: false, exitCode: 1 };
    }
    const fs = await import('fs');
    const path = await import('path');
    const filePath = source === 'palace'
      ? path.join(process.cwd(), '.monomind', 'palace', 'drawers.jsonl')
      : path.join(process.cwd(), '.monomind', 'knowledge', 'chunks.jsonl');

    if (!fs.existsSync(filePath)) {
      output.printError(`File not found: ${filePath}`);
      return { success: false, exitCode: 1 };
    }
    const MAX_MEMORY_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
    if (fs.statSync(filePath).size > MAX_MEMORY_FILE_BYTES) {
      output.printError(`Memory file too large (> 50 MB): ${filePath}`);
      return { success: false, exitCode: 1 };
    }

    let entries: any[];
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      entries = [];
      for (const line of raw.split('\n').filter(Boolean)) {
        try {
          entries.push(JSON.parse(line));
        } catch {
          output.printError(`Malformed JSONL entry in ${source} file`);
          return { success: false, exitCode: 1 };
        }
      }
    } catch (err) {
      output.printError(`Failed to read ${source} file: ${err instanceof Error ? err.message : 'Unknown error'}`);
      return { success: false, exitCode: 1 };
    }

    const idx = entries.findIndex(e => e.id === id);
    if (idx === -1) {
      output.printWarning(`Entry not found with id "${id}"`);
      return { success: false, exitCode: 1 };
    }

    if (!force && ctx.interactive) {
      const confirmed = await confirm({
        message: `Delete ${source} entry "${id}"?`,
        default: false
      });
      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    entries.splice(idx, 1);
    try {
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
      fs.renameSync(tmpPath, filePath);
      output.printSuccess(`Deleted ${source} entry "${id}"`);
      output.printInfo(`Remaining entries: ${entries.length}`);
      return { success: true, data: { id, deleted: true, remainingEntries: entries.length } };
    } catch (err) {
      output.printError(`Failed to write ${source} file: ${err instanceof Error ? err.message : 'Unknown error'}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Stats command
export const statsCommand: Command = {
  name: 'stats',
  description: 'Show memory statistics',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Call MCP memory/stats tool for real statistics
    try {
      const statsResult = await callMCPTool('memory_stats', {}) as {
        totalEntries: number;
        totalSize: string;
        version: string;
        backend: string;
        location: string;
        oldestEntry: string | null;
        newestEntry: string | null;
      };

      const stats = {
        backend: statsResult.backend,
        entries: {
          total: statsResult.totalEntries,
          vectors: 0, // Would need vector backend support
          text: statsResult.totalEntries
        },
        storage: {
          total: statsResult.totalSize,
          location: statsResult.location
        },
        version: statsResult.version,
        oldestEntry: statsResult.oldestEntry,
        newestEntry: statsResult.newestEntry
      };

      if (ctx.flags.format === 'json') {
        output.printJson(stats);
        return { success: true, data: stats };
      }

      output.writeln();
      output.writeln(output.bold('Memory Statistics'));
      output.writeln();

      output.writeln(output.bold('Overview'));
      output.printTable({
        columns: [
          { key: 'metric', header: 'Metric', width: 20 },
          { key: 'value', header: 'Value', width: 30, align: 'right' }
        ],
        data: [
          { metric: 'Backend', value: stats.backend },
          { metric: 'Version', value: stats.version },
          { metric: 'Total Entries', value: stats.entries.total.toLocaleString() },
          { metric: 'Total Storage', value: stats.storage.total },
          { metric: 'Location', value: stats.storage.location }
        ]
      });

      output.writeln();
      output.writeln(output.bold('Timeline'));
      output.printTable({
        columns: [
          { key: 'metric', header: 'Metric', width: 20 },
          { key: 'value', header: 'Value', width: 30, align: 'right' }
        ],
        data: [
          { metric: 'Oldest Entry', value: stats.oldestEntry || 'N/A' },
          { metric: 'Newest Entry', value: stats.newestEntry || 'N/A' }
        ]
      });

      output.writeln();
      output.printInfo('v1 Performance: O(log n) pure-JS HNSW vector search');

      return { success: true, data: stats };
    } catch (error) {
      output.printError(`Failed to get stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Configure command
export const configureCommand: Command = {
  name: 'configure',
  aliases: ['config'],
  description: 'Configure memory backend',
  options: [
    {
      name: 'backend',
      short: 'b',
      description: 'Memory backend',
      type: 'string',
      choices: BACKENDS.map(b => b.value)
    },
    {
      name: 'path',
      description: 'Storage path',
      type: 'string'
    },
    {
      name: 'cache-size',
      description: 'Cache size in MB',
      type: 'number'
    },
    {
      name: 'hnsw-m',
      description: 'HNSW M parameter',
      type: 'number',
      default: 16
    },
    {
      name: 'hnsw-ef',
      description: 'HNSW ef parameter',
      type: 'number',
      default: 200
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let backend = ctx.flags.backend as string;

    if (!backend && ctx.interactive) {
      backend = await select({
        message: 'Select memory backend:',
        options: BACKENDS,
        default: 'hybrid'
      });
    }

    const config = {
      backend: backend || 'hybrid',
      path: ctx.flags.path || './data/memory',
      cacheSize: ctx.flags['cache-size'] || 256,
      hnsw: {
        m: ctx.flags['hnsw-m'] || 16,
        ef: ctx.flags['hnsw-ef'] || 200
      }
    };

    output.writeln();
    output.printInfo('Memory Configuration');
    output.writeln();

    output.printTable({
      columns: [
        { key: 'setting', header: 'Setting', width: 20 },
        { key: 'value', header: 'Value', width: 25 }
      ],
      data: [
        { setting: 'Backend', value: config.backend },
        { setting: 'Storage Path', value: config.path },
        { setting: 'Cache Size', value: `${config.cacheSize} MB` },
        { setting: 'HNSW M', value: config.hnsw.m },
        { setting: 'HNSW ef', value: config.hnsw.ef }
      ]
    });

    output.writeln();
    configManager.set(ctx.cwd, 'memory', config);
    output.printSuccess('Memory configuration updated');

    return { success: true, data: config };
  }
};

// Cleanup command
export const cleanupCommand: Command = {
  name: 'cleanup',
  description: 'Clean up stale and expired memory entries',
  options: [
    {
      name: 'dry-run',
      short: 'd',
      description: 'Show what would be deleted',
      type: 'boolean',
      default: false
    },
    {
      name: 'older-than',
      short: 'o',
      description: 'Delete entries older than (e.g., "7d", "30d")',
      type: 'string'
    },
    {
      name: 'expired-only',
      short: 'e',
      description: 'Only delete expired TTL entries',
      type: 'boolean',
      default: false
    },
    {
      name: 'low-quality',
      short: 'l',
      description: 'Delete low quality patterns (threshold)',
      type: 'number'
    },
    {
      name: 'namespace',
      short: 'n',
      description: 'Clean specific namespace only',
      type: 'string'
    },
    {
      name: 'force',
      short: 'f',
      description: 'Skip confirmation',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'monomind memory cleanup --dry-run', description: 'Preview cleanup' },
    { command: 'monomind memory cleanup --older-than 30d', description: 'Delete entries older than 30 days' },
    { command: 'monomind memory cleanup --expired-only', description: 'Clean expired entries' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const dryRun = ctx.flags['dry-run'] as boolean;
    const force = ctx.flags.force as boolean;

    if (dryRun) {
      output.writeln(output.warning('DRY RUN - No changes will be made'));
    }

    output.printInfo('Analyzing memory for cleanup...');

    try {
      const result = await callMCPTool<{
        dryRun: boolean;
        candidates: {
          expired: number;
          stale: number;
          lowQuality: number;
          total: number;
        };
        deleted: {
          entries: number;
          vectors: number;
          patterns: number;
        };
        freed: {
          bytes: number;
          formatted: string;
        };
        duration: number;
      }>('memory_cleanup', {
        dryRun,
        olderThan: ctx.flags['older-than'],
        expiredOnly: ctx.flags['expired-only'],
        lowQualityThreshold: ctx.flags['low-quality'],
        namespace: ctx.flags.namespace,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Cleanup Analysis'));
      output.printTable({
        columns: [
          { key: 'category', header: 'Category', width: 20 },
          { key: 'count', header: 'Count', width: 15, align: 'right' }
        ],
        data: [
          { category: 'Expired (TTL)', count: result.candidates.expired },
          { category: 'Stale (unused)', count: result.candidates.stale },
          { category: 'Low Quality', count: result.candidates.lowQuality },
          { category: output.bold('Total'), count: output.bold(String(result.candidates.total)) }
        ]
      });

      if (!dryRun && result.candidates.total > 0 && !force) {
        const confirmed = await confirm({
          message: `Delete ${result.candidates.total} entries (${result.freed.formatted})?`,
          default: false
        });

        if (!confirmed) {
          output.printInfo('Cleanup cancelled');
          return { success: true, data: result };
        }
      }

      if (!dryRun) {
        output.writeln();
        output.printSuccess(`Cleaned ${result.deleted.entries} entries`);
        output.printList([
          `Vectors removed: ${result.deleted.vectors}`,
          `Patterns removed: ${result.deleted.patterns}`,
          `Space freed: ${result.freed.formatted}`,
          `Duration: ${result.duration}ms`
        ]);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Cleanup error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};
