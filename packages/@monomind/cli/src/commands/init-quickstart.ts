/**
 * `monomind init quickstart` subcommand.
 * Split from init.ts.
 *
 * @module @monomind/cli/commands/init-quickstart
 */

import { output } from '../output.js';
import { mcpAddHint } from '../platform-adapters/renderers/mcp.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

// Quickstart subcommand (P1-15) — one-command setup: init + claude mcp add + verify
export const quickstartCommand: Command = {
  name: 'quickstart',
  description:
    'One-command setup: init with defaults + register MCP + verify. Fastest path to first payoff.',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Overwrite existing configuration',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    {
      command: 'monomind init quickstart',
      description: 'Set up everything with sensible defaults',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { execFileSync, execSync } = await import('node:child_process');
    output.writeln();
    output.writeln(output.bold('Monomind Quickstart'));
    output.writeln(output.dim('  Running init with defaults, registering MCP, and verifying.'));
    output.writeln();

    // Step 1: Init with defaults
    output.writeln(output.bold('Step 1/3: Initialize project'));
    try {
      const initArgs = ['init'];
      if (ctx.flags.force) initArgs.push('--force');
      initArgs.push('--yes');
      execFileSync(process.execPath, [process.argv[1], ...initArgs], {
        cwd: ctx.cwd,
        stdio: 'inherit',
        timeout: 120000,
      });
    } catch {
      output.printWarning('Init step completed with warnings — continuing.');
    }
    output.writeln();

    // Step 2: Register MCP with Claude Code
    output.writeln(output.bold('Step 2/3: Register MCP server'));
    try {
      execSync(mcpAddHint(), {
        cwd: ctx.cwd,
        stdio: 'pipe',
        timeout: 10000,
      });
      output.printSuccess('MCP server registered with Claude Code');
    } catch {
      output.printWarning('Could not auto-register with Claude Code. Run manually:');
      output.writeln(output.dim(`  ${mcpAddHint()}`));
    }
    output.writeln();

    // Step 3: Verify
    output.writeln(output.bold('Step 3/3: Verify install'));
    try {
      execFileSync(process.execPath, [process.argv[1], 'mcp', 'verify'], {
        cwd: ctx.cwd,
        stdio: 'inherit',
        timeout: 15000,
      });
    } catch {
      output.printWarning('Verify step found issues — see above.');
    }
    output.writeln();

    output.writeln(output.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    output.writeln(output.bold('  Next step'));
    output.writeln();
    output.writeln('  Open Claude Code in this project and type:');
    output.writeln(`    ${output.highlight('/mastermind:help')}`);
    output.writeln();
    output.writeln(output.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    output.writeln('');
    output.printBox(
      [
        'Support Monomind:',
        `  ⭐ Star on GitHub:       ${output.highlight('https://github.com/monoes/monomind')}`,
        `  💬 Join the community:   ${output.highlight('https://monoes.me')}`,
      ].join('\n'),
      'Support Monomind',
    );

    return { success: true, message: 'quickstart complete' };
  },
};
