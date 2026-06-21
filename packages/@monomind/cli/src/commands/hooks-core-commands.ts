/**
 * Hooks Core Commands
 * Pre/post edit and command hook subcommands extracted from hooks.ts (ARCH-1)
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';

// Pre-edit subcommand
export const preEditCommand: Command = {
  name: 'pre-edit',
  description: 'Get context and agent suggestions before editing a file',
  options: [
    {
      name: 'file',
      short: 'f',
      description: 'File path to edit',
      type: 'string',
      required: false
    },
    {
      name: 'operation',
      short: 'o',
      description: 'Type of edit operation (create, update, delete, refactor)',
      type: 'string',
      default: 'update'
    },
    {
      name: 'context',
      short: 'c',
      description: 'Additional context about the edit',
      type: 'string'
    }
  ],
  examples: [
    { command: 'monomind hooks pre-edit -f src/utils.ts', description: 'Get context before editing' },
    { command: 'monomind hooks pre-edit -f src/api.ts -o refactor', description: 'Pre-edit with operation type' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Default file to 'unknown' for backward compatibility (env var may be empty)
    const filePath = ctx.args[0] || ctx.flags.file as string || 'unknown';
    const operation = ctx.flags.operation as string || 'update';

    output.printInfo(`Analyzing context for: ${output.highlight(filePath)}`);

    try {
      // Call MCP tool for pre-edit hook
      const result = await callMCPTool<{
        filePath: string;
        operation: string;
        context: {
          fileExists: boolean;
          fileType: string;
          relatedFiles: string[];
          suggestedAgents: string[];
          patterns: Array<{ pattern: string; confidence: number }>;
          risks: string[];
        };
        recommendations: string[];
      }>('hooks_pre-edit', {
        filePath,
        operation,
        context: ctx.flags.context,
        includePatterns: true,
        includeRisks: true,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.printBox(
        [
          `File: ${result.filePath}`,
          `Operation: ${result.operation}`,
          `Type: ${result.context.fileType}`,
          `Exists: ${result.context.fileExists ? 'Yes' : 'No'}`
        ].join('\n'),
        'File Context'
      );

      if (result.context.suggestedAgents.length > 0) {
        output.writeln();
        output.writeln(output.bold('Suggested Agents'));
        output.printList(result.context.suggestedAgents.map(a => output.highlight(a)));
      }

      if (result.context.relatedFiles.length > 0) {
        output.writeln();
        output.writeln(output.bold('Related Files'));
        output.printList(result.context.relatedFiles.slice(0, 5).map(f => output.dim(f)));
      }

      if (result.context.patterns.length > 0) {
        output.writeln();
        output.writeln(output.bold('Learned Patterns'));
        output.printTable({
          columns: [
            { key: 'pattern', header: 'Pattern', width: 40 },
            { key: 'confidence', header: 'Confidence', width: 12, align: 'right', format: (v) => `${(Number(v) * 100).toFixed(1)}%` }
          ],
          data: result.context.patterns
        });
      }

      if (result.context.risks.length > 0) {
        output.writeln();
        output.writeln(output.bold(output.error('Potential Risks')));
        output.printList(result.context.risks.map(r => output.warning(r)));
      }

      if (result.recommendations.length > 0) {
        output.writeln();
        output.writeln(output.bold('Recommendations'));
        output.printList(result.recommendations.map(r => output.success(`• ${r}`)));
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Pre-edit hook failed: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Post-edit subcommand
export const postEditCommand: Command = {
  name: 'post-edit',
  description: 'Record editing outcome for learning',
  options: [
    {
      name: 'file',
      short: 'f',
      description: 'File path that was edited',
      type: 'string',
      required: false
    },
    {
      name: 'success',
      short: 's',
      description: 'Whether the edit was successful',
      type: 'boolean',
      required: false
    },
    {
      name: 'outcome',
      short: 'o',
      description: 'Outcome description',
      type: 'string'
    },
    {
      name: 'metrics',
      short: 'm',
      description: 'Performance metrics (e.g., "time:500ms,quality:0.95")',
      type: 'string'
    }
  ],
  examples: [
    { command: 'monomind hooks post-edit -f src/utils.ts --success true', description: 'Record successful edit' },
    { command: 'monomind hooks post-edit -f src/api.ts --success false -o "Type error"', description: 'Record failed edit' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Default file to 'unknown' for backward compatibility (env var may be empty)
    const filePath = ctx.args[0] || ctx.flags.file as string || 'unknown';
    // Default success to true for backward compatibility (PostToolUse = success, PostToolUseFailure = failure)
    const success = ctx.flags.success !== undefined ? (ctx.flags.success as boolean) : true;

    output.printInfo(`Recording outcome for: ${output.highlight(filePath)}`);

    try {
      // Parse metrics if provided
      const metrics: Record<string, number> = {};
      if (ctx.flags.metrics) {
        const metricsStr = ctx.flags.metrics as string;
        metricsStr.split(',').forEach(pair => {
          const [key, value] = pair.split(':');
          if (key && value) {
            metrics[key.trim()] = parseFloat(value);
          }
        });
      }

      // Call MCP tool for post-edit hook
      const result = await callMCPTool<{
        filePath: string;
        success: boolean;
        recorded: boolean;
        patternId?: string;
        learningUpdates: {
          patternsUpdated: number;
          confidenceAdjusted: number;
          newPatterns: number;
        };
      }>('hooks_post-edit', {
        filePath,
        success,
        outcome: ctx.flags.outcome,
        metrics,
        timestamp: Date.now(),
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.printSuccess(`Outcome recorded for ${filePath}`);

      if (result.learningUpdates) {
        output.writeln();
        output.writeln(output.bold('Learning Updates'));
        output.printTable({
          columns: [
            { key: 'metric', header: 'Metric', width: 25 },
            { key: 'value', header: 'Value', width: 15, align: 'right' }
          ],
          data: [
            { metric: 'Patterns Updated', value: result.learningUpdates.patternsUpdated },
            { metric: 'Confidence Adjusted', value: result.learningUpdates.confidenceAdjusted },
            { metric: 'New Patterns', value: result.learningUpdates.newPatterns }
          ]
        });
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Post-edit hook failed: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Pre-command subcommand
export const preCommandCommand: Command = {
  name: 'pre-command',
  description: 'Assess risk before executing a command',
  options: [
    {
      name: 'command',
      short: 'c',
      description: 'Command to execute',
      type: 'string',
      required: true
    },
    {
      name: 'dry-run',
      short: 'd',
      description: 'Only analyze, do not execute',
      type: 'boolean',
      default: true
    }
  ],
  examples: [
    { command: 'monomind hooks pre-command -c "rm -rf dist"', description: 'Assess command risk' },
    { command: 'monomind hooks pre-command -c "npm install lodash"', description: 'Check package install' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const command = ctx.args[0] || ctx.flags.command as string;

    if (!command) {
      output.printError('Command is required. Use --command or -c flag.');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Analyzing command: ${output.highlight(command)}`);

    try {
      // Call MCP tool for pre-command hook
      const result = await callMCPTool<{
        command: string;
        riskLevel: 'low' | 'medium' | 'high' | 'critical';
        risks: Array<{ type: string; severity: string; description: string }>;
        recommendations: string[];
        safeAlternatives?: string[];
        shouldProceed: boolean;
      }>('hooks_pre-command', {
        command,
        includeAlternatives: true,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();

      // Risk level indicator
      let riskIndicator: string;
      switch (result.riskLevel) {
        case 'critical':
          riskIndicator = output.error('CRITICAL');
          break;
        case 'high':
          riskIndicator = output.error('HIGH');
          break;
        case 'medium':
          riskIndicator = output.warning('MEDIUM');
          break;
        default:
          riskIndicator = output.success('LOW');
      }

      output.printBox(
        [
          `Risk Level: ${riskIndicator}`,
          `Should Proceed: ${result.shouldProceed ? output.success('Yes') : output.error('No')}`
        ].join('\n'),
        'Risk Assessment'
      );

      if (result.risks.length > 0) {
        output.writeln();
        output.writeln(output.bold('Identified Risks'));
        output.printTable({
          columns: [
            { key: 'type', header: 'Type', width: 15 },
            { key: 'severity', header: 'Severity', width: 10 },
            { key: 'description', header: 'Description', width: 40 }
          ],
          data: result.risks
        });
      }

      if (result.safeAlternatives && result.safeAlternatives.length > 0) {
        output.writeln();
        output.writeln(output.bold('Safe Alternatives'));
        output.printList(result.safeAlternatives.map(a => output.success(a)));
      }

      if (result.recommendations.length > 0) {
        output.writeln();
        output.writeln(output.bold('Recommendations'));
        output.printList(result.recommendations);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Pre-command hook failed: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Post-command subcommand
export const postCommandCommand: Command = {
  name: 'post-command',
  description: 'Record command execution outcome',
  options: [
    {
      name: 'command',
      short: 'c',
      description: 'Command that was executed',
      type: 'string',
      required: true
    },
    {
      name: 'success',
      short: 's',
      description: 'Whether the command succeeded',
      type: 'boolean',
      required: false
    },
    {
      name: 'exit-code',
      short: 'e',
      description: 'Command exit code',
      type: 'number',
      default: 0
    },
    {
      name: 'duration',
      short: 'd',
      description: 'Execution duration in milliseconds',
      type: 'number'
    }
  ],
  examples: [
    { command: 'monomind hooks post-command -c "npm test" --success true', description: 'Record successful test run' },
    { command: 'monomind hooks post-command -c "npm build" --success false -e 1', description: 'Record failed build' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const command = ctx.args[0] || ctx.flags.command as string;
    // Default success to true for backward compatibility
    const success = ctx.flags.success !== undefined ? (ctx.flags.success as boolean) : true;

    if (!command) {
      output.printError('Command is required. Use --command or -c flag.');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Recording command outcome: ${output.highlight(command)}`);

    try {
      // Call MCP tool for post-command hook
      const result = await callMCPTool<{
        command: string;
        success: boolean;
        recorded: boolean;
        learningUpdates: {
          commandPatternsUpdated: number;
          riskAssessmentUpdated: boolean;
        };
      }>('hooks_post-command', {
        command,
        success,
        exitCode: ctx.flags['exit-code'] || 0,
        duration: ctx.flags.duration,
        timestamp: Date.now(),
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.printSuccess('Command outcome recorded');

      if (result.learningUpdates) {
        output.writeln();
        output.writeln(output.dim(`Patterns updated: ${result.learningUpdates.commandPatternsUpdated}`));
        output.writeln(output.dim(`Risk assessment: ${result.learningUpdates.riskAssessmentUpdated ? 'Updated' : 'No change'}`));
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Post-command hook failed: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};
