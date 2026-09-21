/**
 * CLI UI / Dashboard Command
 * Starts the Monomind Neural Control Room (web dashboard server)
 */

import * as path from 'node:path';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

/** `monomind dashboard open` — a one-time login link to the running dashboard
 *  (ui/human-auth.mjs). The dashboard only acts for a browser opened this
 *  way; a link is valid once, for ten minutes. */
const openSubcommand: Command = {
  name: 'open',
  description: 'Open the running dashboard in your browser with a one-time login link',
  options: [
    {
      name: 'port',
      short: 'p',
      description: 'Dashboard port (default: from control.json, else 4242)',
      type: 'number',
    },
    {
      name: 'print',
      description: 'Print the login link instead of opening a browser (e.g. over SSH)',
      type: 'boolean',
      default: false,
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { existsSync, readFileSync } = await import('node:fs');
    let port = Number(ctx.flags.port) || 0;
    if (!port) {
      const control = path.join(ctx.cwd, '.monomind', 'control.json');
      try {
        if (existsSync(control)) port = Number(JSON.parse(readFileSync(control, 'utf8')).port) || 0;
      } catch {
        /* fall back to the default port */
      }
    }
    port ||= 4242;
    let nonce: string;
    try {
      const auth = await import('../ui/human-auth.mjs');
      nonce = auth.issueLoginNonce();
    } catch (error) {
      output.printError(
        `Cannot issue a login link: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { success: false, exitCode: 1 };
    }
    const url = `http://localhost:${port}/?login=${nonce}`;
    if (ctx.flags.print) {
      output.writeln(url);
      output.printInfo('Valid once, for 10 minutes.');
      return { success: true, data: { url } };
    }
    const serverMod = await import('../ui/server.mjs');
    await serverMod.openUrl(url);
    output.printSuccess(
      `Opened the dashboard on port ${port} (login link valid once, for 10 minutes).`,
    );
    return { success: true, data: { port } };
  },
};

export const uiCommand: Command = {
  name: 'ui',
  aliases: ['dashboard'],
  description: 'Start the Monomind Neural Control Room (web UI dashboard)',
  subcommands: [openSubcommand],
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
    {
      command: 'monomind dashboard open',
      description: 'Log a browser in to the running dashboard',
    },
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
        // #308: only a dir the user actually named sets the monomind home —
        // the cwd default above must not, or a dashboard started from a
        // subdirectory silently relocates its project's state there.
        projectDirExplicit: Boolean(ctx.flags['project-dir']),
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
