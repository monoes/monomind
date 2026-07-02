/**
 * CLI Neural Command
 * Pattern learning, search, and prediction backed by the pure-JS intelligence layer
 *
 * github.com/monoes/monomind
 */

import type { Command, CommandResult } from '../types.js';
import { output } from '../output.js';
import { statusCommand, patternsCommand, predictCommand } from './neural-core.js';
import { optimizeCommand, exportCommand } from './neural-optimize.js';
import { listCommand, importCommand } from './neural-registry.js';

export const neuralCommand: Command = {
  name: 'neural',
  description: 'Pattern learning, search, and prediction (pure-JS intelligence layer)',
  subcommands: [statusCommand, patternsCommand, predictCommand, optimizeCommand, listCommand, exportCommand, importCommand],
  examples: [
    { command: 'monomind neural status', description: 'Check pattern-learning system status' },
    { command: 'monomind neural patterns --action list', description: 'List learned patterns' },
    { command: 'monomind neural predict -i "implement authentication"', description: 'Predict routing for a task' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('MonoMind Pattern Learning'));
    output.writeln(output.dim('Pattern learning, search, and prediction (pure-JS)'));
    output.writeln();
    output.writeln('Use --help with subcommands for more info');
    output.writeln();
    output.writeln(output.dim('github.com/monoes/monomind'));
    return { success: true };
  },
};

export default neuralCommand;
