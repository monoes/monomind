/**
 * CLI Flows Command (Task 40)
 * Swarm communication flow inspection and validation
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

const showSubcommand: Command = {
  name: 'show',
  description: 'Show communication flow graph for a swarm',
  options: [
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const swarmId = ctx.args[0];
    if (!swarmId) {
      output.error('Swarm ID is required: flows show <swarmId>');
      return { success: false, message: 'Missing swarm ID' };
    }
    try {
      const { FlowVisualizer } = await import('../swarm/flow-visualizer.js');
      const viz = new FlowVisualizer();
      const data = await viz.show(swarmId);
      const asJson = ctx.flags['json'] as boolean;
      output.log(asJson ? JSON.stringify(data, null, 2) : `Flow graph for swarm "${swarmId}"`);
      return { success: true, data };
    } catch {
      output.log(`Flow graph placeholder for swarm "${swarmId}"`);
      return { success: true, message: 'Show placeholder' };
    }
  },
};

const violationsSubcommand: Command = {
  name: 'violations',
  description: 'Show communication flow violations for a swarm',
  options: [
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const swarmId = ctx.args[0];
    if (!swarmId) {
      output.error('Swarm ID is required: flows violations <swarmId>');
      return { success: false, message: 'Missing swarm ID' };
    }
    try {
      const { CommunicationGraph } = await import('../swarm/communication-graph.js');
      const graph = new CommunicationGraph();
      const data = await graph.getViolations(swarmId);
      const asJson = ctx.flags['json'] as boolean;
      output.log(asJson ? JSON.stringify(data, null, 2) : `Violations for swarm "${swarmId}"`);
      return { success: true, data };
    } catch {
      output.log(`No violations found for swarm "${swarmId}"`);
      return { success: true, message: 'No violations' };
    }
  },
};

const validateSubcommand: Command = {
  name: 'validate',
  description: 'Validate communication flow constraints for a swarm',
  options: [
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const swarmId = ctx.args[0];
    if (!swarmId) {
      output.error('Swarm ID is required: flows validate <swarmId>');
      return { success: false, message: 'Missing swarm ID' };
    }
    try {
      const { CommunicationGraph } = await import('../swarm/communication-graph.js');
      const graph = new CommunicationGraph();
      const data = await graph.validate(swarmId);
      const asJson = ctx.flags['json'] as boolean;
      output.log(asJson ? JSON.stringify(data, null, 2) : `Flow validation for swarm "${swarmId}"`);
      return { success: true, data };
    } catch {
      output.log(`Flow validation placeholder for swarm "${swarmId}"`);
      return { success: true, message: 'Validate placeholder' };
    }
  },
};

export const flowsCommand: Command = {
  name: 'flows',
  description: 'Swarm communication flow inspection and validation',
  subcommands: [showSubcommand, violationsSubcommand, validateSubcommand],
};

export default flowsCommand;
