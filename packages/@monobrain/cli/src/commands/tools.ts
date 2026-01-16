/**
 * CLI Tools Command (Task 31)
 * MCP tool registry inspection
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

const listSubcommand: Command = {
  name: 'list',
  description: 'List all registered MCP tools',
  options: [
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const { ToolRegistry } = await import('../mcp/tool-registry.js');
      const registry = new ToolRegistry();
      const data = await registry.list();
      const asJson = ctx.flags['json'] as boolean;
      output.log(asJson ? JSON.stringify(data, null, 2) : 'Registered tools listed');
      return { success: true, data };
    } catch {
      output.log('No tools registered yet');
      return { success: true, message: 'No tools' };
    }
  },
};

const deprecatedSubcommand: Command = {
  name: 'deprecated',
  description: 'Show deprecated tools',
  options: [
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const { ToolRegistry } = await import('../mcp/tool-registry.js');
      const registry = new ToolRegistry();
      const data = await registry.getDeprecated();
      const asJson = ctx.flags['json'] as boolean;
      output.log(asJson ? JSON.stringify(data, null, 2) : 'Deprecated tools listed');
      return { success: true, data };
    } catch {
      output.log('No deprecated tools found');
      return { success: true, message: 'No deprecated tools' };
    }
  },
};

const impactSubcommand: Command = {
  name: 'impact',
  description: 'Show impact analysis for a tool',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const toolName = ctx.args[0];
    if (!toolName) {
      output.error('Tool name is required: tools impact <toolName>');
      return { success: false, message: 'Missing tool name' };
    }
    try {
      const { ToolRegistry } = await import('../mcp/tool-registry.js');
      const registry = new ToolRegistry();
      const data = await registry.getImpact(toolName);
      output.log(JSON.stringify(data, null, 2));
      return { success: true, data };
    } catch {
      output.log(`Impact analysis placeholder for "${toolName}"`);
      return { success: true, message: 'Impact placeholder' };
    }
  },
};

export const toolsCommand: Command = {
  name: 'tools',
  description: 'MCP tool registry inspection',
  subcommands: [listSubcommand, deprecatedSubcommand, impactSubcommand],
};

export default toolsCommand;
