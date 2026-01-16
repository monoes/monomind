/**
 * CLI Metrics Command (Task 13)
 * Observability metrics and latency reporting
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

const latencySubcommand: Command = {
  name: 'latency',
  description: 'Show latency metrics',
  options: [
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    { name: 'limit', short: 'n', type: 'number', description: 'Max entries', default: 20 },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const asJson = ctx.flags['json'] as boolean;
    try {
      const { LatencyReporter } = await import('../observability/latency-reporter.js');
      const reporter = new LatencyReporter();
      const data = await reporter.getLatencyMetrics(ctx.flags['limit'] as number);
      output.log(asJson ? JSON.stringify(data, null, 2) : 'Latency metrics retrieved');
      return { success: true, data };
    } catch {
      output.log('No latency data available yet');
      return { success: true, message: 'No latency data' };
    }
  },
};

const summarySubcommand: Command = {
  name: 'summary',
  description: 'Show metrics summary',
  options: [
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const asJson = ctx.flags['json'] as boolean;
    try {
      const { LatencyReporter } = await import('../observability/latency-reporter.js');
      const reporter = new LatencyReporter();
      const data = await reporter.getSummary();
      output.log(asJson ? JSON.stringify(data, null, 2) : 'Metrics summary retrieved');
      return { success: true, data };
    } catch {
      output.log('No metrics data available yet');
      return { success: true, message: 'No metrics data' };
    }
  },
};

export const metricsCommand: Command = {
  name: 'metrics',
  description: 'Observability metrics and latency reporting',
  subcommands: [latencySubcommand, summarySubcommand],
};

export default metricsCommand;
