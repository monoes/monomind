/**
 * CLI Main Entry Point
 * Modernized CLI for Monomind
 *
 * github.com/monoes/monomind
 */

import { readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { Command, CommandContext, CommandResult, MonomindConfig, CLIError } from './types.js';
import { CommandParser, commandParser } from './parser.js';
import { OutputFormatter, output } from './output.js';
import { commands, commandsByCategory, commandRegistry, getCommand, getCommandAsync, getCommandNames, hasCommand } from './commands/index.js';
import { suggestCommand } from './suggest.js';
import { runStartupUpdateCheck, getUpdateTagline } from './update/index.js';

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
  } catch {
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

    // Register all commands
    for (const cmd of commands) {
      this.parser.registerCommand(cmd);
    }
  }

  /**
   * Run the CLI with given arguments
   */
  async run(args: string[] = process.argv.slice(2)): Promise<void> {
    try {
      // Parse arguments
      const parseResult = this.parser.parse(args);
      const { command: commandPath, flags, positional } = parseResult;

      // Handle global flags
      if (flags.version || flags.V) {
        this.showVersion();
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
        this.output.printDebug(`Flags: ${JSON.stringify(Object.fromEntries(Object.entries(flags).filter(([k]) => k !== '_')))}`);
        this.output.printDebug(`CWD: ${process.cwd()}`);
      }

      // Run startup update check (non-blocking, silent on skip).
      // `update` is now a properly-declared global boolean option (default
      // true) — `--no-update` negates it via the parser's standard boolean
      // negation path rather than relying on the generic --no-X fallback
      // (which checked the flag name against the GLOBAL pool of every
      // command's boolean options, so an unrelated command declaring its
      // own `update` boolean flag could hijack `--no-update`'s meaning).
      if (flags.update !== false && commandPath[0] !== 'update') {
        this.checkForUpdatesOnStartup().catch(() => {/* silent */});
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
          await this.showCommandHelp(commandPath);
        } else if (positional.length > 0 && !positional[0].startsWith('-')) {
          // First positional looks like an attempted command - suggest correction
          const attemptedCommand = positional[0];
          this.output.printError(`Unknown command: ${attemptedCommand}`);
          const availableCommands = Array.from(new Set([...commands.map(c => c.name), ...getCommandNames()]));
          const { message } = suggestCommand(attemptedCommand, availableCommands);
          this.output.writeln(this.output.dim(`  ${message}`));
          process.exit(1);
        } else {
          this.showHelp();
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
        const availableCommands = Array.from(new Set([...commands.map(c => c.name), ...getCommandNames()]));
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
      this.initSubsystems().catch(() => {/* silent */});

      // Handle subcommand (supports nested subcommands)
      let targetCommand = command;
      let subcommandArgs = positional;

      // Process command path (e.g., ['hooks', 'worker', 'list'])
      // Note: When parser includes subcommand in commandPath, positional already excludes it
      if (commandPath.length > 1 && command.subcommands) {
        const subcommandName = commandPath[1];
        const subcommand = command.subcommands.find(
          sc => sc.name === subcommandName || sc.aliases?.includes(subcommandName)
        );

        if (subcommand) {
          targetCommand = subcommand;
          // Parser already extracted subcommand from positional, so use as-is
          subcommandArgs = positional;

          // Check for nested subcommand (level 2)
          if (commandPath.length > 2 && subcommand.subcommands) {
            const nestedName = commandPath[2];
            const nestedSubcommand = subcommand.subcommands.find(
              sc => sc.name === nestedName || sc.aliases?.includes(nestedName)
            );
            if (nestedSubcommand) {
              targetCommand = nestedSubcommand;
              // Parser already extracted nested subcommand too
              subcommandArgs = positional;
            }
          }
        }
      } else if (positional.length > 0 && command.subcommands) {
        // Check if first positional is a subcommand
        const subcommandName = positional[0];
        const subcommand = command.subcommands.find(
          sc => sc.name === subcommandName || sc.aliases?.includes(subcommandName)
        );

        if (subcommand) {
          targetCommand = subcommand;
          subcommandArgs = positional.slice(1);

          // Check for nested subcommand (level 2 from positional)
          if (subcommandArgs.length > 0 && subcommand.subcommands) {
            const nestedName = subcommandArgs[0];
            const nestedSubcommand = subcommand.subcommands.find(
              sc => sc.name === nestedName || sc.aliases?.includes(nestedName)
            );
            if (nestedSubcommand) {
              targetCommand = nestedSubcommand;
              subcommandArgs = subcommandArgs.slice(1);
            }
          }
        }
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
        config: await this.loadConfig(flags.config as string),
        cwd: process.cwd(),
        interactive: this.interactive && !flags.quiet
      };

      // Execute command
      if (targetCommand.action) {
        if (this.output.isVerbose()) {
          this.output.printDebug(`Executing: ${targetCommand.name}`);
        }

        const startTime = Date.now();
        const result = await targetCommand.action(ctx);

        if (this.output.isVerbose()) {
          this.output.printDebug(`Completed in ${Date.now() - startTime}ms`);
        }

        if (result && !result.success) {
          process.exit(result.exitCode || 1);
        }
      } else {
        // No action - show help for the resolved (sub)command path
        await this.showCommandHelp(commandPath.length > 0 ? commandPath : [commandName]);
      }
    } catch (error) {
      // Don't re-handle if this is a process.exit error (from mocked tests)
      const errorMessage = (error as Error).message;
      if (errorMessage && errorMessage.startsWith('process.exit:')) {
        throw error; // Re-throw so tests can capture the exit code
      }
      this.handleError(error as Error);
    }
  }

  /**
   * Show main help
   */
  private showHelp(): void {
    this.output.writeln();
    const tagline = getUpdateTagline(this.version);
    this.output.writeln(this.output.bold(`${this.name} v${this.version}`) + this.output.dim(tagline));
    this.output.writeln(this.output.dim(this.description));
    this.output.writeln();

    this.output.writeln(this.output.bold('USAGE:'));
    this.output.writeln(`  ${this.name} <command> [subcommand] [options]`);
    this.output.writeln();

    // Primary Commands
    this.output.writeln(this.output.bold('PRIMARY COMMANDS:'));
    for (const cmd of commandsByCategory.primary) {
      if (cmd.hidden) continue;
      const name = cmd.name.padEnd(12);
      this.output.writeln(`  ${this.output.highlight(name)} ${cmd.description}`);
    }
    this.output.writeln();

    // Advanced Commands
    this.output.writeln(this.output.bold('ADVANCED COMMANDS:'));
    for (const cmd of commandsByCategory.advanced) {
      if (cmd.hidden) continue;
      const name = cmd.name.padEnd(12);
      this.output.writeln(`  ${this.output.highlight(name)} ${cmd.description}`);
    }
    this.output.writeln();

    // Utility Commands
    this.output.writeln(this.output.bold('UTILITY COMMANDS:'));
    for (const cmd of commandsByCategory.utility) {
      if (cmd.hidden) continue;
      const name = cmd.name.padEnd(12);
      this.output.writeln(`  ${this.output.highlight(name)} ${cmd.description}`);
    }
    this.output.writeln();

    // Analysis Commands
    this.output.writeln(this.output.bold('ANALYSIS COMMANDS:'));
    for (const cmd of commandsByCategory.analysis) {
      if (cmd.hidden) continue;
      const name = cmd.name.padEnd(12);
      this.output.writeln(`  ${this.output.highlight(name)} ${cmd.description}`);
    }
    this.output.writeln();

    // Management Commands
    this.output.writeln(this.output.bold('MANAGEMENT COMMANDS:'));
    for (const cmd of commandsByCategory.management) {
      if (cmd.hidden) continue;
      const name = cmd.name.padEnd(12);
      this.output.writeln(`  ${this.output.highlight(name)} ${cmd.description}`);
    }
    this.output.writeln();

    this.output.writeln(this.output.bold('GLOBAL OPTIONS:'));
    for (const opt of this.parser.getGlobalOptions()) {
      const flags = opt.short ? `-${opt.short}, --${opt.name}` : `    --${opt.name}`;
      this.output.writeln(`  ${flags.padEnd(25)} ${opt.description}`);
    }
    this.output.writeln();

    this.output.writeln(this.output.bold('V1 FEATURES:'));
    this.output.printList([
      '15-agent hierarchical mesh coordination',
      'LanceDB with ANN vector indexing',
      'Keyword routing + route-outcome measurement',
      'Unified SwarmCoordinator engine',
      'Event-sourced state management',
      'Domain-Driven Design architecture'
    ]);
    this.output.writeln();

    this.output.writeln(this.output.bold('EXAMPLES:'));
    this.output.writeln(`  ${this.name} agent spawn -t coder              # Spawn a coder agent`);
    this.output.writeln(`  ${this.name} swarm init --v1-mode              # Initialize swarm`);
    this.output.writeln(`  ${this.name} memory search -q "auth patterns"  # Semantic search`);
    this.output.writeln(`  ${this.name} mcp start                         # Start MCP server`);
    this.output.writeln();

    this.output.writeln(this.output.dim(`Run "${this.name} <command> --help" for command help`));
    this.output.writeln();
    this.output.writeln(this.output.dim('github.com/monoes/monomind'));
    this.output.writeln();
  }

  /**
   * Show command-specific help
   */
  private async showCommandHelp(commandPath: string | string[]): Promise<void> {
    const path = Array.isArray(commandPath) ? commandPath : [commandPath];
    const topName = path[0];

    // Try sync first, then lazy load
    let command = getCommand(topName);
    if (!command && hasCommand(topName)) {
      command = await getCommandAsync(topName);
    }

    if (!command) {
      this.output.printError(`Unknown command: ${topName}`);
      return;
    }

    // Walk the remaining path segments through subcommands/nested
    // subcommands — mirrors the resolution the dispatcher uses in run() —
    // so `monomind <command> <subcommand> --help` shows the actual target
    // (sub)command's own options and examples, not just the parent's list
    // of subcommands.
    let target: Command = command;
    const resolvedNames = [command.name];
    for (const segment of path.slice(1)) {
      const next = target.subcommands?.find(sc => sc.name === segment || sc.aliases?.includes(segment));
      if (!next) break;
      target = next;
      resolvedNames.push(next.name);
    }

    this.output.writeln();
    this.output.writeln(this.output.bold(`${this.name} ${resolvedNames.join(' ')}`));
    this.output.writeln(target.description);
    this.output.writeln();

    // Subcommands
    if (target.subcommands && target.subcommands.length > 0) {
      this.output.writeln(this.output.bold('SUBCOMMANDS:'));
      for (const sub of target.subcommands) {
        if (sub.hidden) continue;
        const name = sub.name.padEnd(15);
        const aliases = sub.aliases ? this.output.dim(` (${sub.aliases.join(', ')})`) : '';
        this.output.writeln(`  ${this.output.highlight(name)} ${sub.description}${aliases}`);
      }
      this.output.writeln();
    }

    // Options
    if (target.options && target.options.length > 0) {
      this.output.writeln(this.output.bold('OPTIONS:'));
      for (const opt of target.options) {
        const flags = opt.short ? `-${opt.short}, --${opt.name}` : `    --${opt.name}`;
        const required = opt.required ? this.output.error(' (required)') : '';
        const defaultVal = opt.default !== undefined ? this.output.dim(` [default: ${opt.default}]`) : '';
        this.output.writeln(`  ${flags.padEnd(25)} ${opt.description}${required}${defaultVal}`);
      }
      this.output.writeln();
    }

    // Examples
    if (target.examples && target.examples.length > 0) {
      this.output.writeln(this.output.bold('EXAMPLES:'));
      for (const example of target.examples) {
        this.output.writeln(`  ${this.output.dim('$')} ${example.command}`);
        this.output.writeln(`    ${this.output.dim(example.description)}`);
      }
      this.output.writeln();
    }
  }

  /**
   * Show version
   */
  private showVersion(): void {
    const tagline = getUpdateTagline(this.version);
    this.output.writeln(`${this.name} v${this.version}${tagline}`);
  }

  /**
   * Check for updates on startup (non-blocking)
   * Shows notification if updates are available
   */
  private async checkForUpdatesOnStartup(): Promise<void> {
    try {
      const result = await runStartupUpdateCheck({
        autoUpdate: true,
        onInstalling: (pkgs) => {
          this.output.writeln(
            this.output.dim(`  ↑ installing ${pkgs.join(', ')}...`)
          );
        },
      });

      if (!result.checked) return;

      if (result.updatesApplied.length > 0) {
        this.output.writeln(
          this.output.dim(`  ✓ updated ${result.updatesApplied.join(', ')}`)
        );
      }

      const manual = result.updatesAvailable.filter(u => !u.shouldAutoUpdate);
      if (manual.length > 0) {
        this.output.writeln(
          this.output.dim(`  ↑ ${manual.map(u => `${u.package} v${u.latestVersion}`).join(', ')} available  →  run: ${this.name} update all`)
        );
      }
    } catch {
      // Silently fail - don't interrupt CLI usage
    }
  }

  /**
   * Load configuration file
   */
  private async loadConfig(configPath?: string): Promise<MonomindConfig | undefined> {
    const { configManager } = await import('./services/config-file-manager.js');

    // An explicit --config/-c path names an EXACT file — load it directly
    // instead of directory-searching from its dirname (which previously
    // discarded the filename the user gave and either loaded an unrelated
    // monomind.config.json from that directory or found nothing). Failure
    // to find/parse an explicitly-named config file is a loud error, not a
    // silent fallback to defaults.
    if (configPath) {
      const raw = configManager.loadExact(configPath);
      return raw as unknown as MonomindConfig;
    }

    try {
      const raw = configManager.load(process.cwd());
      if (!raw) return undefined;
      return raw as unknown as MonomindConfig;
    } catch (error) {
      // Config loading is optional - don't fail if it doesn't exist
      if (process.env.DEBUG) {
        this.output.writeln(
          this.output.dim(`Config loading failed: ${(error as Error).message}`)
        );
      }
      return undefined;
    }
  }

  /**
   * Initialize optional subsystems at startup (non-blocking, all failures are silent).
   * Starts the @monomind/hooks WorkerManager, wires SwarmCheckpointer, and builds
   * the unified agent registry so that packages/@monomind/* actually contribute
   * to the live runtime.
   */
  private async initSubsystems(): Promise<void> {
    // NOTE: the @monomind/hooks WorkerManager is intentionally NOT started
    // here. Workers run from the session-restore hook (6h staleness gate) and
    // on demand via `monomind hooks worker run <name>`. Starting it on every
    // CLI invocation scheduled staggered 1-10s timers that usually died with
    // the process — but long-lived commands (browse: Chrome launch + CDP work)
    // outlived the stagger, so the consolidate worker fired mid-command,
    // loaded the onnxruntime embedding model, and its thread pool crashed the
    // process at exit ("mutex lock failed: Invalid argument" from libc++).

    // GAP-007: SwarmCheckpointer — write checkpoint files so crashed swarms can resume
    try {
      const { SwarmCheckpointer } = await import('@monoes/memory' as string);
      const _swarmCheckpointer = new SwarmCheckpointer({
        dbPath: '.monomind/checkpoints/swarm.jsonl',
        swarmId: 'default',
        sessionId: `session-${Date.now()}`,
      });
      void _swarmCheckpointer;
    } catch { /* optional — monomind/memory may not be installed */ }

    // Task 30: Build unified agent registry — extras (canonical) first, dev copies second.
    // Deduplication is slug-based; agency-agents wins on conflict.
    // Extra paths are read from MONOMIND_EXTRA_AGENT_PATHS env var (colon-separated)
    // or fall back to the known local path when available.
    try {
      const { buildUnifiedRegistry, computeAgentRoots } = await import('./agents/registry-builder.js');
      const { mkdirSync } = await import('fs');
      const { join } = await import('path');

      const roots = computeAgentRoots(process.cwd());
      const outDir = join(process.cwd(), '.monomind');
      mkdirSync(outDir, { recursive: true });
      buildUnifiedRegistry(roots, join(outDir, 'registry.json'));
    } catch { /* optional — registry build failures must never block startup */ }

    // Task 04: CapabilityMetadata validation moved to `monomind doctor -c registry`
    // (see doctor-project-checks.ts:checkAgentRegistry). Printing this from a
    // fire-and-forget startup task raced process exit — short-lived commands
    // could skip the warning even when the underlying issue was present. Doctor
    // runs it synchronously within its own check pass instead, so it's always
    // visible and itemized when you actually look for it.

    // NOTE: Semantic routing (@monomind/routing) is constructed on-demand by
    // its consumers — `monomind route semantic` (commands/route.ts) and the
    // `hooks_route_semantic` MCP tool (mcp-tools/hooks-routing.ts), both via
    // routing/route-layer-factory.ts. `monomind agent` has no --task flag —
    // that routing point does not exist yet. It is intentionally NOT eagerly
    // initialized here: building all route centroids and probing for the
    // `claude` CLI on every CLI startup would regress the <500ms startup
    // budget for zero benefit (nothing reads a process-global route layer).
  }

  /**
   * Handle errors
   */
  private handleError(error: Error): void {
    if ('code' in error) {
      // CLIError
      const cliError = error as CLIError;
      this.output.printError(cliError.message);

      if (cliError.details) {
        this.output.writeln(this.output.dim(JSON.stringify(cliError.details, null, 2)));
      }

      process.exit(cliError.exitCode);
    } else {
      // Generic error
      this.output.printError(error.message);

      if (process.env.DEBUG) {
        this.output.writeln();
        this.output.writeln(this.output.dim(error.stack || ''));
      }

      process.exit(1);
    }
  }
}

// =============================================================================
// Module Exports
// =============================================================================

// Types
export * from './types.js';

// Parser
export { CommandParser, commandParser } from './parser.js';

// Output
export { OutputFormatter, output, Progress, Spinner, type VerbosityLevel } from './output.js';

// Prompt
export * from './prompt.js';

// Commands (internal use)
export * from './commands/index.js';

// MCP Server management
export {
  MCPServerManager,
  createMCPServerManager,
  getServerManager,
  startMCPServer,
  stopMCPServer,
  getMCPServerStatus,
  type MCPServerOptions,
  type MCPServerStatus,
} from './mcp-server.js';

// Memory & Intelligence (V1 Performance Features)
export {
  initializeMemoryDatabase,
  generateEmbedding,
  generateBatchEmbeddings,
  storeEntry,
  searchEntries,
  getHNSWIndex,
  addToHNSWIndex,
  searchHNSWIndex,
  getHNSWStatus,
  clearHNSWIndex,
  quantizeInt8,
  dequantizeInt8,
  quantizedCosineSim,
  getQuantizationStats,
  // Flash Attention-style batch operations
  batchCosineSim,
  softmaxAttention,
  topKIndices,
  flashAttentionSearch,
  type MemoryInitResult,
} from './memory/memory-initializer.js';

export {
  initializeIntelligence,
  recordStep,
  recordTrajectory,
  findSimilarPatterns,
  getIntelligenceStats,
  getSonaCoordinator,
  getReasoningBank,
  clearIntelligence,
  benchmarkAdaptation,
  // RL loop API
  endTrajectoryWithVerdict,
  distillLearning,
  // Pattern persistence API
  getAllPatterns,
  getPatternsByType,
  flushPatterns,
  deletePattern,
  clearAllPatterns,
  getNeuralDataDir,
  getPersistenceStatus,
  type SonaConfig,
  type TrajectoryStep,
  type Pattern,
  type IntelligenceStats,
} from './memory/intelligence.js';

// Production Hardening
export {
  ErrorHandler,
  withErrorHandling,
} from './production/error-handler.js';
export type {
  ErrorContext,
  ErrorHandlerConfig,
} from './production/error-handler.js';

export {
  RateLimiter,
  createRateLimiter,
} from './production/rate-limiter.js';
export type {
  RateLimiterConfig,
  RateLimitResult,
} from './production/rate-limiter.js';

export {
  withRetry,
  makeRetryable,
} from './production/retry.js';
export type {
  RetryConfig,
  RetryResult,
  RetryStrategy,
} from './production/retry.js';

export {
  CircuitBreaker,
  getCircuitBreaker,
  getAllCircuitStats,
  resetAllCircuits,
} from './production/circuit-breaker.js';
export type {
  CircuitBreakerConfig,
  CircuitState,
} from './production/circuit-breaker.js';

export {
  MonitoringHooks,
  createMonitor,
  getMonitor,
} from './production/monitoring.js';
export type {
  MonitorConfig,
  MetricEvent,
  HealthStatus,
  PerformanceMetrics,
} from './production/monitoring.js';

// Default export
export default CLI;
