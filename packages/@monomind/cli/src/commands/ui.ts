/**
 * CLI UI / Dashboard Command
 * Starts the Monomind Neural Control Room (web dashboard server)
 */

import * as path from 'node:path';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

const LOGIN_CONFIRM_MS = 10_000;

async function dashboardReachable(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

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
    const auth = await import('../ui/human-auth.mjs');
    const deadline = Date.now() + LOGIN_CONFIRM_MS;
    while (!auth.loginNonceUsed(nonce) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (auth.loginNonceUsed(nonce)) {
      output.printSuccess(
        `Opened the dashboard on port ${port} (login link valid once, for 10 minutes). This browser stays logged in.`,
      );
      return { success: true, data: { port } };
    }
    // The link is issued and still valid, so this is not a failure of the command
    // (exit 0) unless nothing answers on the port at all (exit 1).
    const reachable = await dashboardReachable(port);
    output.printWarning(
      `The browser did not load the login link within ${LOGIN_CONFIRM_MS / 1000}s. It is still unused and valid for 10 minutes.`,
    );
    output.writeln('  - Close stale dashboard tabs and run `monomind ui open` again.');
    output.writeln(
      '  - Or run `monomind ui open --print` and paste the link into the browser address bar.',
    );
    output.writeln(
      reachable
        ? '  - The dashboard is answering on this port; the browser launch is what failed.'
        : `  - Nothing answers on port ${port}: start the dashboard with \`monomind ui\`.`,
    );
    return reachable
      ? { success: true, data: { port, confirmed: false } }
      : { success: false, exitCode: 1 };
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

      // #477: this project's dashboard is already served by another process —
      // nothing was started here, so report it and return instead of waiting.
      if (startResult.alreadyRunning) {
        output.printInfo(
          `Neural Control Room already running at ${startResult.url} (pid ${startResult.pid})`,
        );
        if (ctx.flags.format === 'json') {
          output.printJson({
            port: startResult.port,
            url: startResult.url,
            projectDir: path.resolve(projectDir),
            running: true,
            alreadyRunning: true,
          });
        }
        return { success: true, data: { port: startResult.port, url: startResult.url } };
      }

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
