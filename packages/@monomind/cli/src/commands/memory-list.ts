/**
 * Memory List Commands
 * formatRelativeTime, listCommand, editCommand, templatesCommand
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { input } from '../prompt.js';

// Helper function to format relative time
export function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const date = new Date(isoDate).getTime();
  const diff = now - date;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

// List command
export const listCommand: Command = {
  name: 'list',
  aliases: ['ls'],
  description: 'List memory entries',
  options: [
    {
      name: 'namespace',
      short: 'n',
      description: 'Filter by namespace',
      type: 'string'
    },
    {
      name: 'tags',
      short: 't',
      description: 'Filter by tags (comma-separated)',
      type: 'string'
    },
    {
      name: 'limit',
      short: 'l',
      description: 'Maximum entries',
      type: 'number',
      default: 20
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const namespace = ctx.flags.namespace as string;
    const limit = ctx.flags.limit as number;

    // Use sql.js directly for consistent data access
    try {
      const { listEntries } = await import('../memory/memory-initializer.js');
      const listResult = await listEntries({ namespace, limit, offset: 0 });

      if (!listResult.success) {
        output.printError(`Failed to list: ${listResult.error}`);
        return { success: false, exitCode: 1 };
      }

      // Format entries for display
      const entries = listResult.entries.map(e => ({
        key: e.key,
        namespace: e.namespace,
        size: e.size + ' B',
        vector: e.hasEmbedding ? '✓' : '-',
        accessCount: e.accessCount,
        updated: formatRelativeTime(e.updatedAt)
      }));

      if (ctx.flags.format === 'json') {
        output.printJson(listResult.entries);
        return { success: true, data: listResult.entries };
      }

      output.writeln();
      output.writeln(output.bold('Memory Entries'));
      output.writeln();

      if (entries.length === 0) {
        output.printWarning('No entries found');
        output.printInfo('Store data: monomind memory store -k "key" --value "data"');
        return { success: true, data: [] };
      }

      output.printTable({
        columns: [
          { key: 'key', header: 'Key', width: 25 },
          { key: 'namespace', header: 'Namespace', width: 12 },
          { key: 'size', header: 'Size', width: 10, align: 'right' },
          { key: 'vector', header: 'Vector', width: 8, align: 'center' },
          { key: 'accessCount', header: 'Accessed', width: 10, align: 'right' },
          { key: 'updated', header: 'Updated', width: 12 }
        ],
        data: entries
      });

      output.writeln();
      output.printInfo(`Showing ${entries.length} of ${listResult.total} entries`);

      return { success: true, data: listResult.entries };
    } catch (error) {
      output.printError(`Failed to list: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Edit command
export const editCommand: Command = {
  name: 'edit',
  description: 'Edit a memory entry (LanceDB, Memory Palace, or knowledge chunk)',
  options: [
    { name: 'key', short: 'k', description: 'Storage key', type: 'string' },
    { name: 'namespace', short: 'n', description: 'Memory namespace', type: 'string', default: 'default' },
    { name: 'value', description: 'New value/content', type: 'string' },
    { name: 'source', short: 's', description: 'Source to edit: lancedb, palace, knowledge', type: 'string', default: 'lancedb', choices: ['lancedb', 'palace', 'knowledge'] },
    { name: 'id', description: 'Entry ID (palace/knowledge)', type: 'string' }
  ],
  examples: [
    { command: 'monomind memory edit -k "pattern/auth" --value "updated content"', description: 'Edit LanceDB entry' },
    { command: 'monomind memory edit --source palace --id "abc123" --value "new content"', description: 'Edit Memory Palace drawer' },
    { command: 'monomind memory edit --source knowledge --id "chunk-42" --value "updated"', description: 'Edit knowledge chunk' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const source = (ctx.flags.source as string) || 'lancedb';
    let value = (ctx.flags.value as string) || ctx.args[0];
    const fs = await import('fs');
    const path = await import('path');

    if (source === 'lancedb') {
      const key = ctx.flags.key as string;
      const namespace = (ctx.flags.namespace as string) || 'default';
      if (!key) {
        output.printError('Key is required for lancedb edit. Use --key or -k');
        return { success: false, exitCode: 1 };
      }
      if (!value && ctx.interactive) {
        value = await input({ message: 'Enter new value:', validate: v => v.length > 0 || 'Value required' });
      }
      if (!value) {
        output.printError('Value is required. Use --value');
        return { success: false, exitCode: 1 };
      }
      try {
        const { storeEntry } = await import('../memory/memory-initializer.js');
        const result = await storeEntry({ key, value, namespace, generateEmbeddingFlag: true, upsert: true });
        if (!result.success) {
          output.printError((result as any).error || 'Failed to update');
          return { success: false, exitCode: 1 };
        }
        output.printSuccess(`Updated "${key}" in namespace "${namespace}"`);
        return { success: true, data: result };
      } catch (error) {
        output.printError(`Failed to edit: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return { success: false, exitCode: 1 };
      }
    }

    // palace or knowledge — JSONL file edit
    const id = ctx.flags.id as string;
    if (!id) {
      output.printError('Entry ID is required for palace/knowledge edit. Use --id');
      return { success: false, exitCode: 1 };
    }
    if (!/^[a-zA-Z0-9_\-]{1,128}$/.test(id)) {
      output.printError('ID must be 1-128 chars: alphanumeric, underscore, or hyphen only');
      return { success: false, exitCode: 1 };
    }
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

    if (!value && ctx.interactive) {
      output.writeln(output.dim('Current content:'));
      output.writeln(entries[idx].content || '(empty)');
      output.writeln();
      value = await input({ message: 'Enter new content:', validate: v => v.length > 0 || 'Content required' });
    }
    if (!value) {
      output.printError('Value is required. Use --value');
      return { success: false, exitCode: 1 };
    }

    entries[idx] = { ...entries[idx], content: value, ts: new Date().toISOString() };
    try {
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
      fs.renameSync(tmpPath, filePath);
      output.printSuccess(`Updated ${source} entry "${id}"`);
      return { success: true, data: entries[idx] };
    } catch (err) {
      output.printError(`Failed to write ${source} file: ${err instanceof Error ? err.message : 'Unknown error'}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Templates command
export const templatesCommand: Command = {
  name: 'templates',
  description: 'Show best-practice templates for memory entries',
  options: [
    { name: 'type', short: 't', description: 'Template type: user, feedback, project, reference', type: 'string', choices: ['user', 'feedback', 'project', 'reference'] }
  ],
  examples: [
    { command: 'monomind memory templates', description: 'Show all templates' },
    { command: 'monomind memory templates -t feedback', description: 'Show feedback template only' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const filter = ctx.flags.type as string | undefined;
    const templates: Record<string, { label: string; description: string; example: string }> = {
      user: {
        label: 'User Memory',
        description: 'Role, goals, preferences, knowledge level',
        example: [
          '---',
          'name: user_role',
          'description: <one-line summary of user role and context>',
          'type: user',
          '---',
          '',
          '<Role and experience description. What does the user know well? What are they new to?>',
          'Frame explanations accordingly.'
        ].join('\n')
      },
      feedback: {
        label: 'Feedback Memory',
        description: 'How to approach work — corrections and validated choices',
        example: [
          '---',
          'name: feedback_<topic>',
          'description: <one-line rule that triggers on lookup>',
          'type: feedback',
          '---',
          '',
          '<The rule itself — what to do or avoid.>',
          '',
          '**Why:** <Reason the user gave — past incident, strong preference, etc.>',
          '',
          '**How to apply:** <When does this kick in? What edge cases does it cover?>'
        ].join('\n')
      },
      project: {
        label: 'Project Memory',
        description: 'Ongoing work context, goals, decisions, deadlines',
        example: [
          '---',
          'name: project_<initiative>',
          'description: <one-line fact about the project decision or constraint>',
          'type: project',
          '---',
          '',
          '<The fact or decision — what is happening and what was decided.>',
          '',
          '**Why:** <Motivation — constraint, deadline, stakeholder ask, compliance issue.>',
          '',
          '**How to apply:** <How should this shape future suggestions and decisions?>'
        ].join('\n')
      },
      reference: {
        label: 'Reference Memory',
        description: 'Pointers to external resources and where to find information',
        example: [
          '---',
          'name: reference_<resource>',
          'description: <what this resource contains and when to use it>',
          'type: reference',
          '---',
          '',
          '<Resource name and location (URL, project name, channel, etc.)>',
          '',
          'Use this when: <specific scenarios where this reference is relevant>.'
        ].join('\n')
      }
    };

    output.writeln();
    output.writeln(output.bold('Memory Entry Templates'));
    output.writeln(output.dim('Best-practice scaffolds for .claude/projects/.../memory/ entries'));
    output.writeln();

    const keys = filter ? [filter] : Object.keys(templates);
    for (const key of keys) {
      const t = templates[key];
      if (!t) {
        output.printError(`Unknown type: "${key}". Valid types: user, feedback, project, reference`);
        return { success: false, exitCode: 1 };
      }
      output.writeln(output.bold(`── ${t.label}  (--type ${key})`));
      output.writeln(output.dim(`   ${t.description}`));
      output.writeln();
      output.writeln(t.example);
      output.writeln();
    }

    output.writeln(output.dim('Save with: monomind memory store -k "<name>" --value "<content>" --namespace auto-memory'));
    return { success: true };
  }
};
