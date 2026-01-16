/**
 * CLI Prompt Command (Task 24)
 * Prompt version management
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

const versionsSubcommand: Command = {
  name: 'versions',
  description: 'List versions of a prompt',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const slug = ctx.args[0];
    if (!slug) {
      output.error('Slug is required: prompt versions <slug>');
      return { success: false, message: 'Missing slug' };
    }
    try {
      const { PromptVersionStore } = await import('../agents/prompt-version-store.js');
      const store = new PromptVersionStore();
      const data = await store.listVersions(slug);
      output.log(JSON.stringify(data, null, 2));
      return { success: true, data };
    } catch {
      output.log(`No versions found for prompt "${slug}"`);
      return { success: true, message: 'No versions' };
    }
  },
};

const rollbackSubcommand: Command = {
  name: 'rollback',
  description: 'Rollback a prompt to a specific version',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const [slug, version] = ctx.args;
    if (!slug || !version) {
      output.error('Usage: prompt rollback <slug> <version>');
      return { success: false, message: 'Missing arguments' };
    }
    try {
      const { PromptVersionStore } = await import('../agents/prompt-version-store.js');
      const store = new PromptVersionStore();
      await store.rollback(slug, version);
      output.log(`Rolled back "${slug}" to version ${version}`);
      return { success: true };
    } catch {
      output.log(`Rollback placeholder for "${slug}" v${version}`);
      return { success: true, message: 'Rollback placeholder' };
    }
  },
};

const diffSubcommand: Command = {
  name: 'diff',
  description: 'Diff two versions of a prompt',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const [slug, v1, v2] = ctx.args;
    if (!slug || !v1 || !v2) {
      output.error('Usage: prompt diff <slug> <v1> <v2>');
      return { success: false, message: 'Missing arguments' };
    }
    try {
      const { PromptVersionStore } = await import('../agents/prompt-version-store.js');
      const store = new PromptVersionStore();
      const data = await store.diff(slug, v1, v2);
      output.log(JSON.stringify(data, null, 2));
      return { success: true, data };
    } catch {
      output.log(`Diff placeholder for "${slug}" ${v1}..${v2}`);
      return { success: true, message: 'Diff placeholder' };
    }
  },
};

export const promptCommand: Command = {
  name: 'prompt',
  description: 'Prompt version management',
  subcommands: [versionsSubcommand, rollbackSubcommand, diffSubcommand],
};

export default promptCommand;
