import * as path from 'node:path';
import { output } from '../output.js';
import { confirm } from '../prompt.js';
import { configManager } from '../services/config-file-manager.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

// Reset configuration
export const resetCommand: Command = {
  name: 'reset',
  description: 'Reset configuration to defaults',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Skip confirmation',
      type: 'boolean',
      default: false,
    },
    {
      name: 'section',
      description: 'Reset specific section only',
      type: 'string',
      choices: ['agents', 'coordination', 'monoswarm', 'memory', 'mcp', 'providers', 'all'],
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      if (!ctx.flags.force && ctx.interactive) {
        const confirmed = await confirm({
          message: 'This will reset all configuration to defaults. Continue?',
          default: false,
        });
        if (!confirmed) return { success: true, message: 'Reset cancelled' };
      }

      const requested = ctx.flags.section as string | undefined;
      const section = requested === 'monoswarm' ? 'coordination' : requested; // legacy spelling
      if (section && section !== 'all') {
        // Scoped reset: remove only the specified section key from the config.
        // Setting to undefined causes JSON serialization to omit the key, effectively removing it.
        const current = configManager.getConfig(ctx.cwd);
        if (section in current) {
          configManager.set(ctx.cwd, section, configManager.getDefaults()[section]);
          output.writeln(`Section "${section}" reset to defaults`);
        } else {
          output.printWarning(`Section "${section}" not found in configuration`);
        }
        return { success: true };
      }

      const configPath = configManager.reset(ctx.cwd);
      output.writeln(`Configuration reset to defaults: ${configPath}`);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      output.printError(message);
      return { success: false, exitCode: 1 };
    }
  },
};

// Export configuration
export const exportCommand: Command = {
  name: 'export',
  description: 'Export configuration',
  options: [
    {
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string',
    },
    {
      name: 'format',
      short: 'f',
      description: 'Export format (json, yaml)',
      type: 'string',
      default: 'json',
      choices: ['json', 'yaml'],
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const format = (ctx.flags.format as string) || 'json';

      if (format === 'yaml') {
        // configManager.exportTo does not support YAML serialization; export as JSON instead
        output.printWarning('YAML export is not supported. Exporting as JSON.');
      }

      const exportPath =
        (ctx.flags.output as string) || ctx.args[0] || 'monomind.config.export.json';
      configManager.exportTo(ctx.cwd, exportPath);
      const resolved = path.resolve(ctx.cwd, exportPath);
      output.writeln(`Configuration exported to: ${resolved}`);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      output.printError(message);
      return { success: false, exitCode: 1 };
    }
  },
};

// Import configuration
export const importCommand: Command = {
  name: 'import',
  description: 'Import configuration',
  options: [
    {
      name: 'file',
      short: 'f',
      description: 'Configuration file path',
      type: 'string',
      required: true,
    },
    {
      name: 'merge',
      description: 'Merge with existing configuration',
      type: 'boolean',
      default: false,
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const file = (ctx.flags.file as string) || ctx.args[0];

    if (!file) {
      output.printError('File path is required');
      return { success: false, exitCode: 1 };
    }

    try {
      configManager.importFrom(ctx.cwd, file);
      output.writeln(`Configuration imported from: ${path.resolve(ctx.cwd, file)}`);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      output.printError(message);
      return { success: false, exitCode: 1 };
    }
  },
};
