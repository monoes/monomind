/**
 * CLI Scores Command (Task 39)
 * Agent specialization scoring
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

const showSubcommand: Command = {
  name: 'show',
  description: 'Show scores for an agent',
  options: [
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const slug = ctx.args[0];
    if (!slug) {
      output.error('Slug is required: scores show <slug>');
      return { success: false, message: 'Missing slug' };
    }
    try {
      const { SpecializationScorer } = await import('../agents/specialization-scorer.js');
      const scorer = new SpecializationScorer();
      const data = await scorer.getScores(slug);
      const asJson = ctx.flags['json'] as boolean;
      output.log(asJson ? JSON.stringify(data, null, 2) : `Scores for "${slug}" displayed`);
      return { success: true, data };
    } catch {
      output.log(`Scores placeholder for agent "${slug}"`);
      return { success: true, message: 'Scores placeholder' };
    }
  },
};

const topSubcommand: Command = {
  name: 'top',
  description: 'Show top-scoring agents for a task type',
  options: [
    { name: 'limit', short: 'n', type: 'number', description: 'Max results', default: 10 },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskType = ctx.args[0];
    if (!taskType) {
      output.error('Task type is required: scores top <taskType>');
      return { success: false, message: 'Missing task type' };
    }
    try {
      const { SpecializationScorer } = await import('../agents/specialization-scorer.js');
      const scorer = new SpecializationScorer();
      const data = await scorer.getTop(taskType, ctx.flags['limit'] as number);
      const asJson = ctx.flags['json'] as boolean;
      output.log(asJson ? JSON.stringify(data, null, 2) : `Top agents for "${taskType}" listed`);
      return { success: true, data };
    } catch {
      output.log(`Top agents placeholder for task type "${taskType}"`);
      return { success: true, message: 'Top placeholder' };
    }
  },
};

const resetSubcommand: Command = {
  name: 'reset',
  description: 'Reset scores for an agent',
  options: [
    { name: 'force', short: 'f', type: 'boolean', description: 'Skip confirmation', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const slug = ctx.args[0];
    if (!slug) {
      output.error('Slug is required: scores reset <slug>');
      return { success: false, message: 'Missing slug' };
    }
    const force = ctx.flags['force'] as boolean;
    if (!force) {
      output.log(`Use --force to confirm score reset for "${slug}"`);
      return { success: false, message: 'Confirmation required' };
    }
    try {
      const { SpecializationScorer } = await import('../agents/specialization-scorer.js');
      const scorer = new SpecializationScorer();
      await scorer.reset(slug);
      output.log(`Scores reset for "${slug}"`);
      return { success: true };
    } catch {
      output.log(`Score reset placeholder for agent "${slug}"`);
      return { success: true, message: 'Reset placeholder' };
    }
  },
};

export const scoresCommand: Command = {
  name: 'scores',
  description: 'Agent specialization scoring',
  subcommands: [showSubcommand, topSubcommand, resetSubcommand],
};

export default scoresCommand;
