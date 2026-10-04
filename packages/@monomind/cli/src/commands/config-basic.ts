import { operatorClaudePath, setOperatorClaudePath } from '../orgrt/claude-selection.js';
import { output } from '../output.js';
import { configManager, parseConfigValue } from '../services/config-file-manager.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

// Init configuration
export const initCommand: Command = {
  name: 'init',
  description: 'Initialize configuration',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Overwrite existing configuration',
      type: 'boolean',
      default: false,
    },
    {
      name: 'v1',
      description: 'Initialize v1 configuration',
      type: 'boolean',
      default: true,
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const configPath = configManager.create(ctx.cwd, undefined, ctx.flags.force as boolean);
      output.writeln();
      output.writeln(output.success(`Configuration created: ${configPath}`));
      output.writeln();
      const defaults = configManager.getDefaults();
      output.writeln(output.bold('Key defaults:'));
      output.writeln(
        `  monoswarm.topology     = ${(defaults.monoswarm as Record<string, unknown>).topology}`,
      );
      output.writeln(
        `  monoswarm.maxAgents    = ${(defaults.monoswarm as Record<string, unknown>).maxAgents}`,
      );
      output.writeln(
        `  memory.backend     = ${(defaults.memory as Record<string, unknown>).backend}`,
      );
      output.writeln(
        `  mcp.transportType  = ${(defaults.mcp as Record<string, unknown>).transportType}`,
      );
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      output.printError(message);
      return { success: false, exitCode: 1 };
    }
  },
};

// Get configuration
export const getCommand: Command = {
  name: 'get',
  description: 'Get configuration value',
  options: [
    {
      name: 'key',
      short: 'k',
      description: 'Configuration key (dot notation)',
      type: 'string',
    },
  ],
  examples: [
    { command: 'monomind config get monoswarm.topology', description: 'Get monoswarm topology' },
    { command: 'monomind config get -k memory.backend', description: 'Get memory backend' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const key = ((ctx.flags.key as string) || ctx.args[0] || '').slice(0, 256);

    if (!key) {
      // Show all config from actual config file (fall back to defaults)
      const config = configManager.getConfig(ctx.cwd);
      const flatEntries: Record<string, unknown> = {};
      const flatten = (obj: Record<string, unknown>, prefix = '') => {
        for (const [k, v] of Object.entries(obj)) {
          const fullKey = prefix ? `${prefix}.${k}` : k;
          if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            flatten(v as Record<string, unknown>, fullKey);
          } else {
            flatEntries[fullKey] = v;
          }
        }
      };
      flatten(config);

      if (ctx.flags.format === 'json') {
        output.printJson(flatEntries);
        return { success: true, data: flatEntries };
      }

      output.writeln();
      output.writeln(output.bold('Current Configuration'));
      output.writeln();

      output.printTable({
        columns: [
          { key: 'key', header: 'Key', width: 25 },
          { key: 'value', header: 'Value', width: 30 },
        ],
        data: Object.entries(flatEntries).map(([k, v]) => ({
          key: k,
          value: Array.isArray(v) ? JSON.stringify(v) : String(v),
        })),
      });

      return { success: true, data: flatEntries };
    }

    // Prototype pollution guard — mirrors the same check in setCommand.
    const FORBIDDEN_KEY_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
    for (const seg of key.split('.')) {
      if (FORBIDDEN_KEY_SEGMENTS.has(seg)) {
        output.printError(`Forbidden config key segment: "${seg}"`);
        return { success: false, exitCode: 1 };
      }
    }

    const value = key === 'claude.path' ? operatorClaudePath() : configManager.get(ctx.cwd, key);

    if (value === undefined) {
      output.printError(`Configuration key not found: ${key}`);
      return { success: false, exitCode: 1 };
    }

    if (ctx.flags.format === 'json') {
      output.printJson({ key, value });
    } else {
      // Objects/arrays would interpolate as "[object Object]" (#478).
      const display = value !== null && typeof value === 'object' ? output.json(value) : value;
      output.writeln(`${key} = ${display}`);
    }

    return { success: true, data: { key, value } };
  },
};

// Set configuration
export const setCommand: Command = {
  name: 'set',
  description: 'Set configuration value',
  options: [
    {
      // Not `required: true`: the action below accepts key/value as either
      // `-k/-v` flags OR two positional args (ctx.args[0]/ctx.args[1]), and
      // itself errors with a clear message if both end up missing. Declaring
      // these required here made the parser's own flag validator reject the
      // positional form before the action ever ran — so this command's own
      // first documented example, `monomind config set monoswarm.maxAgents
      // 20`, failed with "Required option missing: --key/--value" even
      // though the action fully supports it.
      name: 'key',
      short: 'k',
      description: 'Configuration key (or pass as first positional arg)',
      type: 'string',
    },
    {
      name: 'value',
      short: 'v',
      description: 'Configuration value (or pass as second positional arg)',
      type: 'string',
    },
  ],
  examples: [
    { command: 'monomind config set monoswarm.maxAgents 20', description: 'Set max agents' },
    {
      command: 'monomind config set -k memory.backend -v sqlite',
      description: 'Set memory backend',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const key = ((ctx.flags.key as string) || ctx.args[0] || '').slice(0, 256);
    const value = (ctx.flags.value as string) ?? ctx.args[1] ?? '';

    if (!key || value === undefined) {
      output.printError('Both key and value are required');
      return { success: false, exitCode: 1 };
    }

    const FORBIDDEN_KEY_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
    for (const seg of key.split('.')) {
      if (FORBIDDEN_KEY_SEGMENTS.has(seg)) {
        output.printError(`Forbidden config key segment: "${seg}"`);
        return { success: false, exitCode: 1 };
      }
    }

    try {
      const parsedValue = parseConfigValue(value);
      if (key === 'claude.path') {
        if (typeof parsedValue !== 'string') throw new Error('claude.path must be a string');
        setOperatorClaudePath(parsedValue);
      } else configManager.set(ctx.cwd, key, parsedValue);
      output.writeln(`Set ${key} = ${value}`);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      output.printError(message);
      return { success: false, exitCode: 1 };
    }
  },
};
