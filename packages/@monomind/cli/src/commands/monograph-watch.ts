import { resolve } from 'node:path';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { formatErrorWithCause } from '../utils/native-error.js';

// ── watch subcommand ──────────────────────────────────────────────────────────

export const watchCommand: Command = {
  name: 'watch',
  description: 'Watch for file changes and incrementally rebuild the knowledge graph',
  options: [
    { name: 'path', short: 'p', type: 'string', description: 'Root path (default: cwd)' },
    {
      name: 'llm',
      type: 'boolean',
      description: 'Enable LLM enrichment on rebuild (uses Claude Code CLI)',
    },
    {
      name: 'timeout',
      type: 'number',
      description:
        'Stop watching after N seconds (for scripted checks that must not leave a process behind)',
    },
  ],
  examples: [
    { command: 'monomind monograph watch', description: 'Watch and rebuild on changes' },
    {
      command: 'monomind monograph watch --timeout 5',
      description: 'Verify the watcher starts, then exit',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const root = resolve((ctx.flags.path as string | undefined) ?? process.cwd());
    const llmFlag = ctx.flags.llm === true;
    const { isClaudeCodeAvailable } = await import('../routing/llm-caller.js');
    const llmMaxSections = llmFlag && isClaudeCodeAvailable() ? 50 : 0;

    output.writeln();
    output.writeln(output.bold('Monograph — Watch Mode'));
    output.writeln(output.dim(`  Watching: ${root}`));
    output.writeln(output.dim('  Press Ctrl+C to stop'));
    output.writeln();

    try {
      // watchAsync is not exported in @monoes/monograph@1.1.0.
      // Use MonographWatcher directly, mirroring the monograph_watch MCP tool.
      const { MonographWatcher, buildAsync, createRebuildQueue, describeRebuildEvent } =
        await import('@monoes/monograph');

      const watcher = new MonographWatcher(root);
      let onSigint: (() => void) | undefined;
      // The queue serializes rebuilds and retries a batch whose build found the
      // lock held, instead of dropping it while still printing "Rebuild
      // complete." (#338). Each event line says what happened to the graph.
      const queue = createRebuildQueue({
        // onProgress keeps phase chatter (and the non-git HEAD warning) off
        // the watch log; the queue's events report the outcome.
        //
        // A build blocks the event loop until it ends, so a Ctrl+C listener
        // would only run afterwards: the process kept building, holding the
        // build lock, and the next watch deferred to it (#340). Without a
        // listener Ctrl+C kills at once, as it does for `monograph build`, and
        // the next build takes over the dead process's lock.
        build: async () => {
          if (onSigint) process.off('SIGINT', onSigint);
          try {
            return await buildAsync(root, {
              codeOnly: false,
              llmMaxSections,
              onProgress: () => {},
            });
          } finally {
            if (onSigint) process.on('SIGINT', onSigint);
          }
        },
        onEvent: (e) => {
          const line =
            e.kind === 'failed'
              ? `Rebuild error: ${formatErrorWithCause(e.error)}`
              : describeRebuildEvent(e, root);
          output.writeln(output.dim(`  [watch] ${line}`));
        },
      });
      watcher.on('monograph:updated', (files: string[]) => queue.enqueue(files));
      // chokidar reports a watch it cannot set up as an error. Inside a macOS
      // Seatbelt sandbox FSEvents is unreachable: every fs.watch fails with
      // EMFILE, no handle is left, and the process used to exit right after
      // "Watching for changes…" without saying why (#798).
      watcher.on('monograph:error', (err: unknown) =>
        output.printError(`Watch error: ${formatErrorWithCause(err)}`),
      );
      await watcher.start();

      output.printSuccess('Watching for changes…');
      output.writeln();

      // --timeout exists so a scripted check can confirm the watcher starts
      // without leaving a permanent process behind. Without it the only exit is
      // SIGINT, so every unattended invocation ran forever — which is how ten
      // orphaned watchers accumulated on one machine over 12 hours (#50).
      const timeoutSec = Number(ctx.flags.timeout);
      const hasTimeout = Number.isFinite(timeoutSec) && timeoutSec > 0;
      if (hasTimeout) {
        output.writeln(output.dim(`  Stopping automatically after ${timeoutSec}s`));
      }

      await new Promise<void>((resolve) => {
        let finished = false;
        const finish = (reason: string): void => {
          if (finished) return;
          finished = true;
          queue.stop();
          watcher.stop();
          output.writeln();
          output.writeln(output.dim(reason));
          resolve();
        };
        onSigint = () => finish('Watch stopped.');
        process.on('SIGINT', onSigint);
        if (hasTimeout) {
          setTimeout(
            () => finish(`Watch stopped after ${timeoutSec}s (--timeout).`),
            timeoutSec * 1000,
          );
        }
      });

      return { success: true };
    } catch (err) {
      output.printError(formatErrorWithCause(err));
      return { success: false, exitCode: 1 };
    }
  },
};
