/**
 * Monobrain Tokens Command
 * Token usage tracking and visualization — powered by token-tracker.cjs
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

function getTrackerPath(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // From dist/src/commands/ -> back to project root -> .claude/helpers/
  return join(__dirname, '..', '..', '..', '..', '..', '..', '.claude', 'helpers', 'token-tracker.cjs');
}

function loadTracker() {
  const require = createRequire(import.meta.url);
  return require(getTrackerPath());
}

const dashboardSubcommand: Command = {
  name: 'dashboard',
  description: 'Launch interactive token usage dashboard',
  options: [
    { name: 'period', short: 'p', type: 'string', description: 'Time period: today|week|30days|month', default: 'today' },
    { name: 'no-interactive', type: 'boolean', description: 'Render once and exit', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const period = (ctx.flags['period'] as string) || 'today';
    const noInteractive = ctx.flags['no-interactive'] as boolean;
    try {
      const tracker = loadTracker();
      if (noInteractive) {
        tracker.renderDashboard(period);
      } else {
        tracker.runInteractive();
      }
      return { success: true };
    } catch (err) {
      output.error('Token tracker not available: ' + (err instanceof Error ? err.message : String(err)));
      return { success: false, message: 'Token tracker unavailable' };
    }
  },
};

const summarySubcommand: Command = {
  name: 'summary',
  description: 'Show token usage summary for a period',
  options: [
    { name: 'period', short: 'p', type: 'string', description: 'Time period: today|week|30days|month', default: 'today' },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const period = (ctx.flags['period'] as string) || 'today';
    const asJson = ctx.flags['json'] as boolean;
    try {
      const tracker = loadTracker();
      const range = tracker.getDateRange(period);
      const projects = tracker.parseAllSessions(range.start, range.end);

      if (asJson) {
        output.log(JSON.stringify(projects, null, 2));
        return { success: true, data: projects };
      }

      const totalCost = projects.reduce((s: number, p: { totalCost: number }) => s + p.totalCost, 0);
      const totalCalls = projects.reduce((s: number, p: { totalApiCalls: number }) => s + p.totalApiCalls, 0);

      output.log('');
      output.log(`Token Usage — ${period}`);
      output.log('─'.repeat(50));
      output.log(`Total Cost:  ${tracker.fmt$(totalCost)}`);
      output.log(`API Calls:   ${totalCalls}`);
      output.log(`Projects:    ${projects.length}`);
      output.log('');

      for (const p of projects.slice(0, 10) as Array<{ projectPath: string; totalCost: number; totalApiCalls: number }>) {
        const name = p.projectPath.split('/').pop() || p.projectPath;
        output.log(`  ${name.padEnd(30)} ${tracker.fmt$(p.totalCost).padStart(10)}  ${p.totalApiCalls} calls`);
      }
      output.log('');

      return { success: true, data: { totalCost, totalCalls, projects } };
    } catch (err) {
      output.error('Token tracker not available: ' + (err instanceof Error ? err.message : String(err)));
      return { success: false, message: 'Token tracker unavailable' };
    }
  },
};

const todaySubcommand: Command = {
  name: 'today',
  description: 'Quick today/month token usage summary',
  options: [],
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    try {
      const tracker = loadTracker();
      const summary = tracker.quickSummary();
      output.log(summary || 'No token data available for today.');
      return { success: true };
    } catch (err) {
      output.error('Token tracker not available: ' + (err instanceof Error ? err.message : String(err)));
      return { success: false };
    }
  },
};

export const tokensCommand: Command = {
  name: 'tokens',
  description: 'Token usage tracking and cost visualization',
  subcommands: [dashboardSubcommand, summarySubcommand, todaySubcommand],
};

export default tokensCommand;
