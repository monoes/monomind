/**
 * CLI UI / Dashboard Command
 * Starts the Monomind Neural Control Room (web dashboard server)
 */

import * as path from 'node:path';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

export const uiCommand: Command = {
  name: 'ui',
  aliases: ['dashboard'],
  description: 'Start the Monomind Neural Control Room (web UI dashboard)',
  options: [
    {
      name: 'port',
      short: 'p',
      description: 'Port to bind the dashboard server to (default: 4242)',
      type: 'number',
      default: 4242,
    },
    {
      name: 'open',
      description: 'Open browser automatically',
      type: 'boolean',
      default: true,
    },
    {
      name: 'no-open',
      description: 'Do not open browser automatically',
      type: 'boolean',
      default: false,
    },
    {
      name: 'project-dir',
      short: 'd',
      description: 'Project root directory (defaults to current working directory)',
      type: 'string',
    },
  ],
  examples: [
    { command: 'monomind ui', description: 'Start the Neural Control Room on port 4242' },
    { command: 'monomind ui --no-open', description: 'Start server without opening browser' },
    { command: 'monomind ui --port 4300', description: 'Start on a custom port' },
    { command: 'monomind dashboard', description: 'Alias for monomind ui' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const rawPort = ctx.flags.port as number | undefined;
    const port = Number.isInteger(rawPort) && (rawPort as number) > 0 ? (rawPort as number) : 4242;
    const openBrowser = ctx.flags.open !== false && !ctx.flags['no-open'];
    const projectDir = (ctx.flags['project-dir'] as string) || ctx.cwd;

    try {
      // Dynamic import of the UI server module
      const serverMod = await import('../ui/server.mjs');
      const startResult = await serverMod.startServer({
        port,
        openBrowser,
        projectDir: path.resolve(projectDir),
      });

      output.writeln();
      output.printSuccess(
        `Monomind Neural Control Room running at ${startResult.url} (port ${startResult.port})`,
      );
      output.printInfo('Press Ctrl+C to stop the dashboard server.');
      output.writeln();

      if (ctx.flags.format === 'json') {
        output.printJson({
          port: startResult.port,
          url: startResult.url,
          projectDir: path.resolve(projectDir),
          running: true,
        });
      }

      // Keep process running in foreground
      await new Promise<void>((resolve) => {
        const handleSignal = () => {
          process.removeListener('SIGINT', handleSignal);
          process.removeListener('SIGTERM', handleSignal);
          resolve();
        };
        process.once('SIGINT', handleSignal);
        process.once('SIGTERM', handleSignal);
      });

      return {
        success: true,
        data: {
          port: startResult.port,
          url: startResult.url,
        },
      };
    } catch (error) {
      output.printError(
        `Failed to start Neural Control Room: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { success: false, exitCode: 1 };
    }
  },
};

export default uiCommand;
