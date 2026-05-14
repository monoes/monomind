/**
 * monomind ui — Live dashboard command
 * Starts a local HTTP server serving the Neural Control Room dashboard.
 */
import * as path from 'path';
import * as os from 'os';

export const uiCommand = {
  name: 'ui',
  description: 'Start the live Monomind dashboard (Neural Control Room)',
  category: 'core',
  async action(ctx) {
    return this.execute(ctx.args || [], ctx.flags || {});
  },
  async execute(args = [], options = {}) {
    const port = parseInt(options.port || options.p || '4242', 10);
    const noOpen = options['no-open'] || options['no-browser'] || false;
    const projectDir = options.dir || process.env.CLAUDE_PROJECT_DIR || process.cwd();

    console.log('\x1b[36m◆ Monomind Neural Control Room\x1b[0m');
    console.log('\x1b[2mStarting dashboard server...\x1b[0m\n');

    try {
      const { fileURLToPath } = await import('url');
      const { dirname } = await import('path');
      const { createRequire } = await import('module');
      const serverPath = new URL('../ui/server.mjs', import.meta.url);
      const { startServer } = await import(serverPath.href);

      const result = await startServer({
        port,
        projectDir,
        openBrowser: !noOpen,
      });

      console.log(`\x1b[32m✓ Dashboard running at \x1b[1m${result.url}\x1b[0m`);
      console.log(`\x1b[2m  Project: ${projectDir}\x1b[0m`);
      console.log(`\x1b[2m  Press Ctrl+C to stop\x1b[0m\n`);

      // Keep alive
      await new Promise((resolve) => {
        process.on('SIGINT', resolve);
        process.on('SIGTERM', resolve);
      });
    } catch (err) {
      console.error(`\x1b[31m✗ Failed to start dashboard: ${err.message}\x1b[0m`);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  },
  help() {
    return `
\x1b[1mUsage:\x1b[0m  monomind ui [options]

\x1b[1mOptions:\x1b[0m
  --port, -p <number>   Port to listen on (default: 4242)
  --no-open             Don't open browser automatically
  --dir <path>          Project directory to monitor (default: cwd)

\x1b[1mExamples:\x1b[0m
  monomind ui
  monomind ui --port 8080
  monomind ui --no-open --dir /path/to/project
    `.trim();
  },
};

export default uiCommand;
