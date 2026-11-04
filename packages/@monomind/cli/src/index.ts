/**
 * CLI Main Entry Point
 * Modernized CLI for Monomind
 *
 * github.com/monoes/monomind
 */

import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printCommandHelp, printMainHelp, printVersionInfo } from './cli-help.js';
import {
  checkForUpdatesOnStartup,
  handleCliError,
  initCliSubsystems,
  loadCliConfig,
} from './cli-startup.js';
import { resolveDoctorMode } from './commands/doctor-mode.js';
import { getCommand, getCommandAsync, getCommandNames, hasCommand } from './commands/index.js';
import { type OutputFormatter, output } from './output.js';
import { type CommandParser, commandParser } from './parser.js';
import { recordUsage } from './services/usage-counters.js';
import { suggestCommand } from './suggest.js';
import type { Command, CommandContext } from './types.js';
import { refreshUpdateCacheInBackground } from './update/index.js';

// Read version from package.json at runtime
function getPackageVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    // Navigate from dist/src to package root
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    // Guard: skip if package.json is unexpectedly large (> 1 MB)
    if (statSync(pkgPath).size > 1024 * 1024) return '3.0.0';
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '3.0.0';
  } catch (e) {
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
      console.error('[index] getPackageVersion failed, using fallback:', e);
    return '3.0.0';
  }
}

export const VERSION = getPackageVersion();

export interface CLIOptions {
  name?: string;
  description?: string;
  version?: string;
  interactive?: boolean;
}

/**
 * CLI Application
 */
/**
 * Invocations that only read state and must not write any: `agent scan`
 * (runtime detection) and `org sign --check` (#558). Exported for tests.
 */
export function isReadOnlyProbe(words: string[], flags: Record<string, unknown> = {}): boolean {
  const w = words.filter((x) => !x.startsWith('-'));
  if (w[0] === 'org' && w[1] === 'sign') return flags.check === true;
  return w[0] === 'agent' && w[1] === 'scan';
}

export class CLI {
  private name: string;
  private description: string;
  private version: string;
  private parser: CommandParser;
  private output: OutputFormatter;
  private interactive: boolean;

  constructor(options: CLIOptions = {}) {
    this.name = options.name || 'monomind';
    this.description = options.description || 'Monomind - AI Agent Orchestration Platform';
    this.version = options.version || VERSION;
    this.parser = commandParser;
    this.output = output;
    this.interactive = options.interactive ?? process.stdin.isTTY ?? false;
  }

  /**
   * Run the CLI with given arguments
   */
  async run(args: string[] = process.argv.slice(2)): Promise<void> {
    try {
      // Two-phase parse: peek at the first non-flag token and, if it names a
      // real command, lazy-load and register ONLY that command's full tree
      // (subcommands/options included) before parsing. This keeps flag/alias
      // scoping correct for arbitrarily deep subcommands (parse() needs the
      // real Command object, not just its name) while never importing the
      // other 31 commands. `--version` and friends need no command at all,
      // so they skip this without importing anything.
      const firstPositional = args.find((a) => !a.startsWith('-'));
      if (
        firstPositional &&
        hasCommand(firstPositional) &&
        !this.parser.getCommand(firstPositional)
      ) {
        const cmd = await getCommandAsync(firstPositional);
        if (cmd) this.parser.registerCommand(cmd);
      }

      // Parse arguments
      const parseResult = this.parser.parse(args);
      const { command: commandPath, flags, positional } = parseResult;

      // Handle global flags
      if (flags.version || flags.V) {
        const json = Boolean(flags.json) || flags.format === 'json';
        printVersionInfo(this.name, this.version, this.output, json);
        // The startup update check below is never reached from here, so a
        // stale cache would keep the tagline silent forever. Refresh it in a
        // detached child — after the line is written, so output is unchanged.
        // Same opt-outs as the startup check (--no-update, and the env gates
        // inside reserveCheck); skipped for the JSON handshake, which has no
        // tagline.
        if (!json && flags.update !== false) refreshUpdateCacheInBackground();
        return;
      }

      if (flags.color === false || flags.noColor) {
        this.output.setColorEnabled(false);
      }

      // Set verbosity level based on flags
      if (flags.quiet) {
        this.output.setVerbosity('quiet');
      } else if (flags.verbose) {
        this.output.setVerbosity(process.env.DEBUG ? 'debug' : 'verbose');
      }

      // Verbose mode: show parsed arguments
      if (this.output.isVerbose()) {
        this.output.printDebug(`Command: ${commandPath.join(' ') || '(none)'}`);
        this.output.printDebug(`Positional: [${positional.join(', ')}]`);
        this.output.printDebug(
          `Flags: ${JSON.stringify(Object.fromEntries(Object.entries(flags).filter(([k]) => k !== '_')))}`,
        );
        this.output.printDebug(`CWD: ${process.cwd()}`);
      }

      // Run startup update check (non-blocking, silent on skip).
      // `update` is now a properly-declared global boolean option (default
      // true) — `--no-update` negates it via the parser's standard boolean
      // negation path rather than relying on the generic --no-X fallback
      // (which checked the flag name against the GLOBAL pool of every
      // command's boolean options, so an unrelated command declaring its
      // own `update` boolean flag could hijack `--no-update`'s meaning).
      // `doctor --read-only` / `--offline` (issue #335) must not write the
      // update-check state or touch the network, nor refresh the registry.
      const doctorMode = commandPath[0] === 'doctor' ? resolveDoctorMode(flags) : null;
      const quietDoctor = Boolean(doctorMode?.readOnly || doctorMode?.offline);
      // A read-only probe (`agent scan`) changes nothing: no update check
      // (it writes ~/.monomind/update-state.json after a network call) and,
      // below, no subsystem init (it writes .monomind/registry.json). Callers
      // such as mono-agent run it on a timer to show installed runtimes.
      const probe = isReadOnlyProbe([...commandPath, ...positional], flags);
      if (flags.update !== false && commandPath[0] !== 'update' && !quietDoctor && !probe) {
        checkForUpdatesOnStartup(this.name, this.output).catch(() => {
          /* silent */
        });
      }

      // Handle lazy-loaded commands that weren't recognized by the parser
      // If commandPath is empty but positional has a command name, check if it's lazy-loadable
      if (commandPath.length === 0 && positional.length > 0 && !positional[0].startsWith('-')) {
        const potentialCommand = positional[0];
        if (hasCommand(potentialCommand)) {
          // This is a lazy-loaded command, treat it as the command
          commandPath.push(potentialCommand);
          positional.shift();
        }
      }

      // No command - show help or suggest correction
      if (commandPath.length === 0 || flags.help || flags.h) {
        if (commandPath.length > 0) {
          // Show help for the fully-resolved (sub)command — walking the same
          // path the dispatcher below resolves — not just the top-level
          // parent's subcommand list. `monomind memory store --help` should
          // show `store`'s own options, not memory's list of subcommands.
          await printCommandHelp(this.name, this.output, commandPath);
        } else if (positional.length > 0 && !positional[0].startsWith('-')) {
          // First positional looks like an attempted command - suggest correction
          const attemptedCommand = positional[0];
          this.output.printError(`Unknown command: ${attemptedCommand}`);
          const availableCommands = getCommandNames();
          const { message } = suggestCommand(attemptedCommand, availableCommands);
          this.output.writeln(this.output.dim(`  ${message}`));
          process.exit(1);
        } else {
          await printMainHelp(this.name, this.version, this.description, this.parser, this.output);
        }
        return;
      }

      // Find and execute command
      const commandName = commandPath[0];
      // First check the parser's registry (for dynamically registered commands)
      // Then fall back to the static registry, then try lazy loading
      let command = this.parser.getCommand(commandName) || getCommand(commandName);

      // If not found in sync registry, try lazy loading
      if (!command && hasCommand(commandName)) {
        command = await getCommandAsync(commandName);
      }

      if (!command) {
        this.output.printError(`Unknown command: ${commandName}`);
        // Smart suggestions - include lazy-loadable commands in suggestions
        const availableCommands = getCommandNames();
        const { message } = suggestCommand(commandName, availableCommands);
        this.output.writeln(this.output.dim(`  ${message}`));
        process.exit(1);
      }

      // Initialize optional subsystems (non-blocking — never delay CLI
      // startup). Deliberately placed AFTER the --help/--version/unknown-
      // command short-circuits above: those paths don't touch project state,
      // so running this here means `monomind --help` (or any invocation in a
      // directory that's never been a monomind project) no longer creates
      // .monomind/registry.json as a side effect of just asking for help.
      if (!doctorMode?.readOnly && !probe) {
        initCliSubsystems().catch(() => {
          /* silent */
        });
      }

      // Handle subcommand (supports nested subcommands)
      let targetCommand = command;
      let subcommandArgs = positional;
      // Canonical names of the resolved command chain, for the opt-in usage
      // counters: declared names only, never the user's arguments.
      const resolvedPath = [command.name];

      // Process command path (e.g., ['hooks', 'worker', 'list'])
      // Note: When parser includes subcommand in commandPath, positional already excludes it
      //
      // Resolution walks as deep as the tree goes. It previously unrolled
      // exactly two levels of nesting, so a four-segment invocation silently
      // resolved to its grandparent and ran that command's action — which for
      // a group command means printing help instead of doing anything. No
      // error, no hint. `hooks transfer store list` failed exactly this way,
      // making the whole pattern-store subtree unreachable without anyone
      // noticing. This mirrors the loop showHelp() already used (see below),
      // so `--help` and dispatch now agree on the target at any depth.
      const findChild = (parent: Command, segment: string): Command | undefined =>
        parent.subcommands?.find((sc) => sc.name === segment || sc.aliases?.includes(segment));

      if (commandPath.length > 1 && command.subcommands) {
        // Parser already lifted the subcommand names out of positional, so
        // descend using commandPath and leave the remaining args untouched.
        for (const segment of commandPath.slice(1)) {
          const next = findChild(targetCommand, segment);
          if (!next) break;
          targetCommand = next;
          resolvedPath.push(next.name);
        }
        subcommandArgs = positional;
      } else if (positional.length > 0 && command.subcommands) {
        // Subcommand names are still in positional — consume each one we match.
        let consumed = 0;
        while (consumed < subcommandArgs.length) {
          const next = findChild(targetCommand, subcommandArgs[consumed]);
          if (!next) break;
          targetCommand = next;
          resolvedPath.push(next.name);
          consumed++;
        }
        subcommandArgs = subcommandArgs.slice(consumed);
      }

      // Validate flags
      const validationErrors = this.parser.validateFlags(flags, targetCommand);
      if (validationErrors.length > 0) {
        for (const error of validationErrors) {
          this.output.printError(error);
        }
        process.exit(1);
      }

      // Build context
      const ctx: CommandContext = {
        args: subcommandArgs,
        flags,
        config: await loadCliConfig(flags.config as string, this.output),
        cwd: process.cwd(),
        interactive: this.interactive && !flags.quiet,
      };

      // Execute command
      if (targetCommand.action) {
        // Opt-in, local-only usage counter (off by default). Fire-and-forget:
        // it never throws and is not awaited. Read-only runs write nothing.
        if (!doctorMode?.readOnly && !probe) {
          void recordUsage('cli', resolvedPath.join(' '), { config: ctx.config ?? null });
        }
        if (this.output.isVerbose()) {
          this.output.printDebug(`Executing: ${targetCommand.name}`);
        }

        const startTime = Date.now();
        const result = await targetCommand.action(ctx);

        if (this.output.isVerbose()) {
          this.output.printDebug(`Completed in ${Date.now() - startTime}ms`);
        }

        if (result && !result.success) {
          // Always surface the failure reason: many actions return
          // { success: false, message } without logging, and exiting 1 with
          // zero output left users guessing (swarm finding #12). Actions that
          // already printed a rich error produce one extra terse summary line
          // — acceptable; silence is not.
          if (result.message) this.output.printError(result.message);
          process.exit(result.exitCode || 1);
        }
      } else {
        // No action - show help for the resolved (sub)command path
        await printCommandHelp(
          this.name,
          this.output,
          commandPath.length > 0 ? commandPath : [commandName],
        );
      }
    } catch (error) {
      // Don't re-handle if this is a process.exit error (from mocked tests)
      const errorMessage = (error as Error).message;
      if (errorMessage?.startsWith('process.exit:')) {
        throw error; // Re-throw so tests can capture the exit code
      }
      handleCliError(error as Error, this.output);
    }
  }
}

// =============================================================================
// Module Exports
// =============================================================================
export * from './index-exports.js';

// Default export
export default CLI;
