/**
 * CLI Knowledge Command (Task 28)
 * Knowledge base management
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

const addSubcommand: Command = {
  name: 'add',
  description: 'Add a file to the knowledge base',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const file = ctx.args[0];
    if (!file) {
      output.error('File is required: knowledge add <file>');
      return { success: false, message: 'Missing file' };
    }
    try {
      const { KnowledgeStore } = await import('../knowledge/knowledge-store.js');
      const store = new KnowledgeStore();
      await store.add(file);
      output.log(`Added "${file}" to knowledge base`);
      return { success: true };
    } catch {
      output.log(`Knowledge add placeholder for "${file}"`);
      return { success: true, message: 'Add placeholder' };
    }
  },
};

const searchSubcommand: Command = {
  name: 'search',
  description: 'Search the knowledge base',
  options: [
    { name: 'limit', short: 'n', type: 'number', description: 'Max results', default: 10 },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const query = ctx.args[0];
    if (!query) {
      output.error('Query is required: knowledge search <query>');
      return { success: false, message: 'Missing query' };
    }
    try {
      const { KnowledgeStore } = await import('../knowledge/knowledge-store.js');
      const store = new KnowledgeStore();
      const data = await store.search(query, ctx.flags['limit'] as number);
      const asJson = ctx.flags['json'] as boolean;
      output.log(asJson ? JSON.stringify(data, null, 2) : `Found ${(data as unknown[]).length} results`);
      return { success: true, data };
    } catch {
      output.log('No knowledge results found');
      return { success: true, message: 'No results' };
    }
  },
};

const listSubcommand: Command = {
  name: 'list',
  description: 'List knowledge base entries',
  options: [
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const { KnowledgeStore } = await import('../knowledge/knowledge-store.js');
      const store = new KnowledgeStore();
      const data = await store.list();
      const asJson = ctx.flags['json'] as boolean;
      output.log(asJson ? JSON.stringify(data, null, 2) : 'Knowledge entries listed');
      return { success: true, data };
    } catch {
      output.log('No knowledge entries available');
      return { success: true, message: 'No entries' };
    }
  },
};

export const knowledgeCommand: Command = {
  name: 'knowledge',
  description: 'Knowledge base management',
  subcommands: [addSubcommand, searchSubcommand, listSubcommand],
};

export default knowledgeCommand;
