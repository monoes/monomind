/**
 * CLI Config Command
 * Configuration management
 */

import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { getCommand, initCommand, setCommand } from './config-basic.js';
import { exportCommand, importCommand, resetCommand } from './config-io.js';
import { providersCommand } from './config-providers.js';

export { getCommand, initCommand, setCommand } from './config-basic.js';
export { exportCommand, importCommand, resetCommand } from './config-io.js';
export { providersCommand } from './config-providers.js';

// Main config command
export const configCommand: Command = {
  name: 'config',
  description: 'Configuration management',
  subcommands: [
    initCommand,
    getCommand,
    setCommand,
    providersCommand,
    resetCommand,
    exportCommand,
    importCommand,
  ],
  options: [],
  examples: [
    { command: 'monomind config init --v1', description: 'Initialize v1 config' },
    { command: 'monomind config get coordination.topology', description: 'Get config value' },
    { command: 'monomind config set coordination.maxAgents 20', description: 'Set config value' },
  ],
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Configuration Management'));
    output.writeln();
    output.writeln('Usage: monomind config <subcommand> [options]');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('init')}       - Initialize configuration`,
      `${output.highlight('get')}        - Get configuration value`,
      `${output.highlight('set')}        - Set configuration value`,
      `${output.highlight('providers')}  - Manage AI providers`,
      `${output.highlight('reset')}      - Reset to defaults`,
      `${output.highlight('export')}     - Export configuration`,
      `${output.highlight('import')}     - Import configuration`,
    ]);

    return { success: true };
  },
};

export default configCommand;
