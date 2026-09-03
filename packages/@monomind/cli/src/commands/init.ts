/**
 * CLI Init Command
 * Comprehensive initialization for Monomind with Claude Code integration
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DEFAULT_INIT_OPTIONS,
  executeInit,
  FULL_INIT_OPTIONS,
  type InitOptions,
  MINIMAL_INIT_OPTIONS,
} from '../init/index.js';
import { ingestDirectory } from '../knowledge/document-pipeline.js';
import { initializeMemoryDatabase } from '../memory/memory-initializer.js';
import { output } from '../output.js';
import { resolvePlatformId } from '../platform-adapters/registry.js';
import type { PlatformId } from '../platform-adapters/types.js';
import { confirm } from '../prompt.js';
import {
  downloadEmbeddingModel,
  EMBEDDING_MODEL_SIZE_LABEL,
  embeddingDownloadDecision,
  isEmbeddingModelCached,
} from '../routing/model-download.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { checkCommand, hooksCommand, skillsCommand } from './init-subcommands.js';
import { upgradeCommand } from './init-upgrade.js';
import { wizardCommand } from './init-wizard.js';

function isInitialized(cwd: string): { claude: boolean; monomind: boolean } {
  const claudePath = path.join(cwd, '.claude', 'settings.json');
  const monomindPath = path.join(cwd, '.monomind', 'config.yaml');
  return {
    claude: fs.existsSync(claudePath),
    monomind: fs.existsSync(monomindPath),
  };
}

const initAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const force = ctx.flags.force as boolean;
  const minimal = ctx.flags.minimal as boolean;
  const full = ctx.flags.full as boolean;
  const skipClaude = ctx.flags['skip-claude'] as boolean;
  const onlyClaude = ctx.flags['only-claude'] as boolean;
  const requestedTarget = ctx.flags.target as string | undefined;
  const requestedPlatforms = ctx.flags.platform as string | undefined;
  const enablePlatformHooks = ctx.flags['enable-hooks'] === true;
  const noInstall = (ctx.flags['no-install'] || ctx.flags.noInstall) as boolean;
  const cwd = ctx.cwd;

  const initialized = isInitialized(cwd);
  const hasExisting = initialized.claude || initialized.monomind;

  if (hasExisting && !force) {
    output.printWarning('MonoMind appears to be already initialized');
    if (initialized.claude) output.printInfo('  Found: .claude/settings.json');
    if (initialized.monomind) output.printInfo('  Found: .monomind/config.yaml');
    output.printInfo('Use --force to reinitialize');

    const yes = (ctx.flags.yes as boolean) || process.env.CI === 'true';
    if (ctx.interactive && !yes) {
      const proceed = await confirm({
        message: 'Do you want to reinitialize? This will overwrite existing configuration.',
        default: false,
      });

      if (!proceed) {
        return { success: true, message: 'Initialization cancelled' };
      }
    } else if (!yes) {
      return {
        success: false,
        exitCode: 1,
        message: 'Already initialized. Use --force or --yes to reinitialize.',
      };
    }
  }

  output.writeln();
  output.writeln(output.bold('Initializing Monomind'));
  output.writeln();

  let options: InitOptions;

  if (minimal) {
    options = {
      ...MINIMAL_INIT_OPTIONS,
      targetDir: cwd,
      force,
      components: { ...MINIMAL_INIT_OPTIONS.components },
    };
  } else if (full) {
    options = {
      ...FULL_INIT_OPTIONS,
      targetDir: cwd,
      force,
      components: { ...FULL_INIT_OPTIONS.components },
    };
  } else {
    options = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir: cwd,
      force,
      components: { ...DEFAULT_INIT_OPTIONS.components },
    };
  }

  const legacyTargets = ['opencode', 'kimicode', 'codex'].filter(
    (name) => ctx.flags[name] === true,
  );
  const target =
    requestedTarget ||
    (onlyClaude ? 'claude' : legacyTargets.length === 1 ? legacyTargets[0] : 'all');
  const validTargets = new Set(['all', 'claude', 'antigravity', 'opencode', 'kimicode', 'codex']);
  if (!validTargets.has(target)) {
    return { success: false, exitCode: 1, message: `Unknown init target: ${target}` };
  }

  const selectedTargets = new Set(
    target === 'all' ? [...validTargets].filter((name) => name !== 'all') : [target],
  );
  let selectedPlatforms: PlatformId[];
  if (requestedPlatforms) {
    const requested = requestedPlatforms.split(',');
    const parsed = requested
      .map((value) => resolvePlatformId(value))
      .filter((value): value is PlatformId => value !== undefined);
    if (parsed.length === 0 || parsed.length !== requested.length) {
      return {
        success: false,
        exitCode: 1,
        message: `Unknown init platform: ${requestedPlatforms}`,
      };
    }
    selectedPlatforms = [...new Set(parsed)];
    selectedTargets.clear();
    if (selectedPlatforms.includes('claude')) selectedTargets.add('claude');
    if (selectedPlatforms.includes('antigravity')) selectedTargets.add('antigravity');
    if (selectedPlatforms.includes('opencode')) selectedTargets.add('opencode');
    if (selectedPlatforms.includes('kimi')) selectedTargets.add('kimicode');
    if (selectedPlatforms.includes('codex')) selectedTargets.add('codex');
  } else {
    const legacyToPlatform: Record<string, PlatformId> = {
      claude: 'claude',
      antigravity: 'antigravity',
      opencode: 'opencode',
      kimicode: 'kimi',
      codex: 'codex',
    };
    selectedPlatforms = [...selectedTargets]
      .map((legacy) => legacyToPlatform[legacy])
      .filter((value): value is PlatformId => value !== undefined);
  }

  // `--skip-claude` has always meant "leave Claude project artifacts out".
  // It must not erase an explicitly selected non-Claude adapter (the previous
  // component-only implementation silently did exactly that). Keep the
  // legacy target set and adapter selection in lockstep.
  if (skipClaude) {
    selectedTargets.delete('claude');
    selectedPlatforms = selectedPlatforms.filter((platform) => platform !== 'claude');
  }
  options.selectedPlatforms = selectedPlatforms;
  options.enablePlatformHooks = enablePlatformHooks;
  options.components.antigravity = selectedTargets.has('antigravity');
  options.components.opencode = selectedTargets.has('opencode');
  options.components.kimicode = selectedTargets.has('kimicode');
  options.components.codex = selectedTargets.has('codex');
  options.components.mcp = selectedTargets.has('claude') || selectedTargets.has('antigravity');
  if (!selectedTargets.has('claude')) {
    options.components.settings = false;
    options.components.commands = false;
    options.components.agents = false;
    options.components.helpers = false;
    options.components.statusline = false;
    options.components.claudeMd = false;
  }

  if (skipClaude) {
    options.components.settings = false;
    options.components.skills = false;
    options.components.commands = false;
    options.components.agents = false;
    options.components.helpers = false;
    options.components.statusline = false;
    options.components.mcp = false;
    options.components.claudeMd = false;
  }

  if (onlyClaude) {
    options.components.runtime = false;
  }

  if (noInstall) {
    options.installClaudeCode = false;
  }

  const spinner = output.createSpinner({ text: 'Initializing...' });
  spinner.start();

  try {
    const result = await executeInit(options);

    if (!result.success) {
      spinner.fail('Initialization failed');
      for (const error of result.errors) {
        output.printError(error);
      }
      return { success: false, exitCode: 1 };
    }

    spinner.succeed('Monomind initialized successfully!');

    // C5: ensure a runnable sample org exists so the README quickstart
    // (`monomind org run my-team`) works out of the box. Idempotent — never
    // overwrites a user's edits. Runs after a successful init (any mode).
    try {
      const { writeSampleOrg } = await import('../init/write-sample-org.js');
      writeSampleOrg(options.targetDir);
    } catch (e) {
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[init] sample org emit failed:', e);
    }

    // Start monograph watch for ongoing file-change rebuilds, unless --no-watch was passed.
    // Guard: skip if a watcher PID file already exists and the process is still alive,
    // preventing duplicate watchers from accumulating on repeated `init --force` runs.
    // `--no-watch` is the parser's negation of the declared boolean `watch`
    // option. It used to be declared as its own boolean named 'no-watch', which
    // the parser never populated: parseFlag strips the `--no-` prefix and looks
    // up `watch`, which IS a declared boolean (status/agent-ops declare it and
    // getBooleanFlags() is global across all registered commands). So
    // `--no-watch` set the unrelated `watch` flag to false and left `no-watch`
    // at its `false` default — the flag was a silent no-op and the watcher
    // started anyway. The legacy `no-watch`/`noWatch` keys are still honoured
    // for programmatic callers that set ctx.flags directly.
    const noWatch =
      ctx.flags.watch === false || ctx.flags['no-watch'] === true || ctx.flags.noWatch === true;

    // A background watcher is an INTERACTIVE convenience: it exists so a
    // developer's next `monograph query` sees fresh data. Started from a
    // non-interactive run it becomes a process nobody will ever stop.
    //
    // That is not hypothetical (#50): every throwaway `init` — CI, release
    // smoke tests, the /tmp sandboxes that verify a published package — spawned
    // a detached watcher with no exit condition and walked away. Ten orphans
    // accumulated on one machine over 12 hours, each holding an fs watch open.
    // The PID-file guard below cannot help there, because each sandbox is a
    // fresh directory in which no PID file has ever existed.
    //
    // So: auto-start only when someone is actually at a terminal. `--watch`
    // still forces it — checked against argv because the flag defaults to true,
    // so its value alone cannot distinguish "explicitly asked" from "default".
    // Tri-state, which is why `watch` no longer declares `default: true`:
    //   true      -> explicitly asked for; start it regardless of TTY
    //   false     -> --no-watch; never start
    //   undefined -> nobody said; start only when someone is at a terminal
    // Reading process.argv here instead would ignore programmatic callers that
    // set ctx.flags directly, which is how the CLI's own tests drive init.
    const explicitWatch = ctx.flags.watch === true;
    const interactive = process.stdout.isTTY === true && !process.env.CI;
    const skipNonInteractive = !interactive && !explicitWatch;

    if (!noWatch && skipNonInteractive) {
      output.printInfo(
        '◈ Knowledge graph watch not started (non-interactive run) — pass --watch to force it',
      );
    }

    if (!noWatch && !skipNonInteractive) {
      try {
        const { spawn } = await import('node:child_process');
        const pidFile = path.join(ctx.cwd, '.monomind', 'monograph.watch.pid');
        let alreadyRunning = false;
        if (fs.existsSync(pidFile) && fs.statSync(pidFile).size <= 32) {
          const existingPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
          if (!Number.isNaN(existingPid)) {
            try {
              process.kill(existingPid, 0);
              alreadyRunning = true;
            } catch {
              /* process gone */
            }
          }
        }
        if (!alreadyRunning) {
          const logPath = path.join(ctx.cwd, '.monomind', 'monograph.watch.log');
          const { openSync } = fs;
          const logFd = openSync(logPath, 'a');
          const proc = spawn(process.execPath, [process.argv[1], 'monograph', 'watch'], {
            detached: true,
            stdio: ['ignore', logFd, logFd],
            cwd: ctx.cwd,
            env: process.env,
          });
          fs.writeFileSync(pidFile, String(proc.pid));
          proc.unref();
          output.printInfo('◈ Knowledge graph watch started in background');
        } else {
          output.printInfo('◈ Knowledge graph watch already running — skipping');
        }
      } catch {
        // non-critical
      }
    }

    output.writeln();

    const summary: string[] = [];

    if (result.created.directories.length > 0) {
      summary.push(`Directories: ${result.created.directories.length} created`);
    }

    if (result.created.files.length > 0) {
      summary.push(`Files: ${result.created.files.length} created`);
    }

    if (result.skipped.length > 0) {
      summary.push(`Skipped: ${result.skipped.length} (already exist)`);
    }

    output.printBox(summary.join('\n'), 'Summary');
    output.writeln();

    if (
      options.components.claudeMd ||
      options.components.settings ||
      options.components.skills ||
      options.components.commands ||
      options.components.agents
    ) {
      output.printBox(
        [
          options.components.claudeMd ? `CLAUDE.md:   Swarm guidance & configuration` : '',
          options.components.settings ? `Settings:    .claude/settings.json` : '',
          options.components.skills
            ? `Skills:      .claude/skills/, .gemini/skills/, .agents/skills/ (${result.summary.skillsCount} skills)`
            : '',
          options.components.commands
            ? `Commands:    .claude/commands/ (${result.summary.commandsCount} commands)`
            : '',
          options.components.agents
            ? `Agents:      .claude/agents/ (${result.summary.agentsCount} agents)`
            : '',
          options.components.helpers ? `Helpers:     .claude/helpers/` : '',
          options.components.mcp ? `MCP:         .mcp.json` : '',
          options.components.antigravity ? `Antigravity: GEMINI.md + .gemini/` : '',
          options.components.opencode ? `OpenCode:    opencode.json + .opencode/` : '',
          options.components.kimicode ? `Kimi Code:   .kimi-code/` : '',
          options.components.codex ? `Codex:       .codex/config.toml + AGENTS.md` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        'Coding System Integrations',
      );
      output.writeln();
    }

    if (options.components.runtime) {
      output.printBox(
        [
          `Config:      .monomind/config.yaml`,
          `Data:        .monomind/data/`,
          `Logs:        .monomind/logs/`,
          `Sessions:    .monomind/sessions/`,
        ].join('\n'),
        'v1 Runtime',
      );
      output.writeln();
    }

    if (result.summary.hooksEnabled > 0) {
      output.printInfo(`Hooks: ${result.summary.hooksEnabled} hook types enabled in settings.json`);
      output.writeln();
    }

    const noStartAll = ctx.flags['no-start-all'] || ctx.flags.noStartAll;
    const startAll = noStartAll ? false : (ctx.flags['start-all'] ?? ctx.flags.startAll ?? true);

    if (startAll) {
      output.writeln();
      output.printInfo('Starting services...');

      const { execSync } = await import('node:child_process');

      if (startAll) {
        // In-process, not a subprocess: `npx @monomind/cli@latest memory init`
        // (the previous approach) shelled out to a package name that has
        // never been published — every fresh init silently 404'd here and
        // fell into the catch block's "already exists" message even when no
        // database existed at all. initializeMemoryDatabase() is the same
        // function `monomind memory init` itself calls, run directly.
        try {
          output.writeln(output.dim('  Initializing memory database...'));
          const memResult = await initializeMemoryDatabase({
            dbPath: path.join(ctx.cwd, '.swarm', 'memory.db'),
          });
          if (memResult.success) {
            output.writeln(output.success('  ✓ Memory initialized'));
          } else {
            output.writeln(
              output.dim(`  Memory database init skipped (${memResult.error || 'unknown reason'})`),
            );
          }
        } catch (e) {
          output.writeln(
            output.dim(
              `  Memory database init skipped (${e instanceof Error ? e.message : String(e)})`,
            ),
          );
        }
      }

      if (startAll) {
        try {
          output.writeln(output.dim('  Initializing swarm...'));
          execSync('npx monomind@latest swarm init --topology hierarchical', {
            stdio: 'pipe',
            cwd: ctx.cwd,
            timeout: 30000,
          });
          output.writeln(output.success('  ✓ Swarm initialized'));
        } catch {
          output.writeln(output.dim('  Swarm initialization skipped'));
        }
      }

      if (startAll) {
        // Seed .monomind/metrics/ immediately instead of waiting for the
        // first Claude Code session-restore hook to run these workers —
        // running `monomind doctor` right after `init` (before ever opening
        // Claude Code) otherwise always shows "Worker Metrics"/"Security
        // Audit" as unconfigured, even though nothing is actually broken.
        try {
          output.writeln(output.dim('  Seeding worker metrics...'));
          const hooksMod = await import('@monoes/hooks').catch(() => null);
          if (hooksMod?.createWorkerManager) {
            const manager = hooksMod.createWorkerManager(ctx.cwd);
            await manager.ensureMetricsDir();
            const seeded: string[] = [];
            for (const workerName of ['map', 'audit']) {
              try {
                const r = await manager.runWorker(workerName);
                if (r.success) seeded.push(workerName);
              } catch {
                /* best-effort — doctor will report if this stays missing */
              }
            }
            if (seeded.length > 0) {
              output.writeln(output.success(`  ✓ Worker metrics seeded (${seeded.join(', ')})`));
            } else {
              output.writeln(output.dim('  Worker metrics seeding skipped'));
            }
          } else {
            output.writeln(
              output.dim('  Worker metrics seeding skipped (@monoes/hooks unavailable)'),
            );
          }
        } catch (e) {
          output.writeln(
            output.dim(
              `  Worker metrics seeding skipped (${e instanceof Error ? e.message : String(e)})`,
            ),
          );
        }
      }

      output.writeln();
      output.printSuccess('All services started');
    }

    const withEmbeddings = ctx.flags['with-embeddings'] || ctx.flags.withEmbeddings;
    const embeddingModel = (ctx.flags['embedding-model'] ||
      ctx.flags.embeddingModel ||
      'Xenova/all-MiniLM-L6-v2') as string;

    if (withEmbeddings) {
      output.writeln();
      output.printInfo('Initializing ONNX embedding subsystem...');

      const ALLOWED_MODELS = /^[\w\-./]+$/;
      if (!ALLOWED_MODELS.test(embeddingModel)) {
        output.writeln(
          output.error(
            'Invalid model identifier. Only alphanumeric characters, hyphens, dots, and slashes are allowed.',
          ),
        );
        return { success: false, exitCode: 1 };
      }

      const { execFileSync } = await import('node:child_process');

      try {
        output.writeln(output.dim(`  Model: ${embeddingModel}`));
        output.writeln(output.dim('  Hyperbolic: Enabled (Poincaré ball)'));
        execFileSync(
          process.platform === 'win32' ? 'npx.cmd' : 'npx',
          [
            'monomind@latest',
            'embeddings',
            'init',
            '--model',
            embeddingModel,
            '--no-download',
            '--force',
          ],
          {
            stdio: 'pipe',
            cwd: ctx.cwd,
            timeout: 30000,
          },
        );
        output.writeln(output.success('  ✓ Embeddings initialized'));
        output.writeln(output.dim('    Run "embeddings init --download" to download model'));
      } catch {
        output.writeln(output.warning('  Embedding initialization skipped (run manually)'));
      }
    }

    // Semantic routing needs the arctic-embed weights (~88 MB) cached on disk;
    // on a fresh install they are absent and routing silently falls back to
    // keyword mode. Downloading must be OPT-IN: ask interactively, default No,
    // and never download from a non-TTY/CI run.
    const embeddingDecision = embeddingDownloadDecision({
      cached: isEmbeddingModelCached(),
      stdinTTY: process.stdin.isTTY === true,
      stdoutTTY: process.stdout.isTTY === true,
      ci: !!process.env.CI,
    });

    if (embeddingDecision === 'non-interactive') {
      output.printInfo(
        '◈ Semantic-routing embedding model not downloaded (non-interactive run) — ' +
          'run `monomind download-embeddings` later to enable semantic routing',
      );
    } else if (embeddingDecision === 'prompt') {
      output.writeln();
      const wantsModel = await confirm({
        message: `Download semantic-routing embedding model (${EMBEDDING_MODEL_SIZE_LABEL})?`,
        default: false,
      });
      if (wantsModel) {
        try {
          await downloadEmbeddingModel((line) => output.writeln(output.dim(`  ${line}`)));
          output.printSuccess('  ✓ Embedding model cached — semantic routing enabled');
        } catch (e) {
          output.printWarning(
            `  Embedding model download failed (${e instanceof Error ? e.message : String(e)}) — ` +
              'semantic routing will use keyword fallback. Retry with `monomind download-embeddings`.',
          );
        }
      } else {
        output.printInfo(
          '  Skipped — semantic routing falls back to keyword mode. ' +
            'Download later with `monomind download-embeddings`.',
        );
      }
    }

    if (ctx.interactive && !ctx.flags.yes && process.env.CI !== 'true') {
      const ingestDocs = await confirm({
        message: 'Ingest documents in this folder into the knowledge graph? (Second Brain)',
        default: true,
      });

      if (ingestDocs) {
        output.writeln();
        const docSpinner = output.createSpinner({ text: 'Scanning for documents...' });
        docSpinner.start();
        try {
          const batchResult = await ingestDirectory(cwd, 'shared', {
            rootDir: cwd,
            onProgress: (_file, done, total) => {
              docSpinner.setText(`Ingesting documents... (${done}/${total})`);
            },
          });
          if (batchResult.filesProcessed > 0) {
            docSpinner.succeed(
              `${batchResult.filesProcessed} document${batchResult.filesProcessed === 1 ? '' : 's'} ingested (${batchResult.totalChunks} chunks)`,
            );
          } else {
            docSpinner.succeed('No supported documents found');
          }
          if (batchResult.errors.length > 0) {
            output.writeln(
              output.dim(`  ${batchResult.errors.length} file(s) skipped due to errors`),
            );
          }
        } catch (e) {
          docSpinner.fail(
            `Document ingestion failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        output.writeln();
      }
    }

    if (!startAll) {
      output.writeln(output.bold('Next steps:'));
      output.printList(
        [
          `Run ${output.highlight('monomind memory init')} to initialize memory database`,
          `Run ${output.highlight('monomind swarm init')} to initialize a swarm`,
          `Services auto-start by default; use ${output.highlight('--no-start-all')} to skip`,
          options.components.settings
            ? `Review ${output.highlight('.claude/settings.json')} for hook configurations`
            : '',
        ].filter(Boolean),
      );
    }

    output.writeln('');
    output.writeln(output.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    output.writeln(output.bold('  Next steps'));
    output.writeln('');
    output.writeln('  1. Register the MCP server with Claude Code:');
    output.writeln(
      `     ${output.highlight('claude mcp add monomind -- npx -y monomind@latest mcp start')}`,
    );
    output.writeln('');
    output.writeln(`  2. Verify the install worked:`);
    output.writeln(`     ${output.highlight('monomind mcp verify')}`);
    output.writeln('');
    output.printInfo(
      'Optional spreadsheet extraction (.xlsx, .xls, .ods): install SheetJS only when needed with ' +
        '`pnpm add xlsx` in this project, or `npm install -g xlsx` for a global install.',
    );
    output.writeln('');
    output.writeln('  3. Open Claude Code and type:');
    output.writeln(
      `     ${output.highlight('/mastermind:help')}   ${output.dim('# see all available slash commands')}`,
    );
    output.writeln(
      `     ${output.highlight('/mastermind:understand')}   ${output.dim('# analyze your project with an LLM')}`,
    );
    output.writeln('');
    output.writeln(output.dim('  The /mastermind:* slash commands are the primary way to use'));
    output.writeln(output.dim('  the MCP server is registered (step 1) and Claude Code is open.'));
    output.writeln(output.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

    output.writeln('');
    output.printBox(
      [
        'Support Monomind development:',
        `  ⭐ Star on GitHub:       ${output.highlight('https://github.com/monoes/monomind')}`,
        `  💬 Join the community:   ${output.highlight('https://monoes.me')}`,
      ].join('\n'),
      'Support Monomind',
    );

    if (ctx.flags.format === 'json') {
      output.printJson(result);
    }

    return { success: true, data: result };
  } catch (error) {
    spinner.fail('Initialization failed');
    output.printError(
      `Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { success: false, exitCode: 1 };
  }
};

// Quickstart subcommand (P1-15) — one-command setup: init + claude mcp add + verify
const quickstartCommand: Command = {
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
    const { execSync } = await import('node:child_process');
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
      execSync(`node "${process.argv[1]}" ${initArgs.join(' ')}`, {
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
      execSync('claude mcp add monomind -- npx -y monomind@latest mcp start', {
        cwd: ctx.cwd,
        stdio: 'pipe',
        timeout: 10000,
      });
      output.printSuccess('MCP server registered with Claude Code');
    } catch {
      output.printWarning('Could not auto-register with Claude Code. Run manually:');
      output.writeln(output.dim('  claude mcp add monomind -- npx -y monomind@latest mcp start'));
    }
    output.writeln();

    // Step 3: Verify
    output.writeln(output.bold('Step 3/3: Verify install'));
    try {
      execSync(`node "${process.argv[1]}" mcp verify`, {
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

export const initCommand: Command = {
  name: 'init',
  description: 'Initialize MonoMind in the current directory',
  subcommands: [
    wizardCommand,
    checkCommand,
    skillsCommand,
    hooksCommand,
    upgradeCommand,
    quickstartCommand,
  ],
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Overwrite existing configuration',
      type: 'boolean',
      default: false,
    },
    {
      name: 'yes',
      short: 'y',
      description: 'Skip confirmation prompts (also honoured via CI=true env var)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'minimal',
      short: 'm',
      description: 'Create minimal configuration',
      type: 'boolean',
      default: false,
    },
    {
      name: 'full',
      description: 'Create full configuration with all components',
      type: 'boolean',
      default: false,
    },
    {
      name: 'skip-claude',
      description: 'Skip .claude/ directory creation (runtime only)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'only-claude',
      description: 'Only create .claude/ directory (skip runtime)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'no-install',
      description:
        'Skip the post-init `doctor --install` pass, which may otherwise run a global `npm install -g @anthropic-ai/claude-code`',
      type: 'boolean',
      default: false,
    },
    {
      name: 'target',
      short: 't',
      description: 'Coding system to initialize (default: all)',
      type: 'string',
      choices: ['all', 'claude', 'antigravity', 'opencode', 'kimicode', 'codex'],
    },
    {
      name: 'platform',
      description: 'Adapter platform id(s), comma-separated; preserves --target compatibility',
      type: 'string',
    },
    {
      name: 'enable-hooks',
      description: 'Opt in to deterministic native platform hooks',
      type: 'boolean',
      default: false,
    },
    {
      name: 'opencode',
      description: 'Initialize only OpenCode (alias for --target opencode)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'kimicode',
      description: 'Initialize only Kimi Code (alias for --target kimicode)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'codex',
      description: 'Initialize only Codex (alias for --target codex)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'start-all',
      description: 'Auto-start memory and swarm after init (default: true)',
      type: 'boolean',
      default: true,
    },
    {
      // Declared as the positive `watch` so the parser's `--no-X` negation
      // actually reaches it. Declaring it as `no-watch` made `--no-watch` a
      // no-op — see the noWatch resolution in initAction.
      name: 'watch',
      description:
        'Start the monograph knowledge graph watcher after init ' +
        '(default: only when running interactively; --watch forces, --no-watch skips)',
      type: 'boolean',
      // Deliberately no `default`. The value must stay undefined when nobody
      // passed the flag, so init can tell "not asked" from "asked for true"
      // and only auto-start for an interactive user (#50).
    },
    {
      name: 'with-embeddings',
      description: 'Initialize ONNX embedding subsystem with hyperbolic support',
      type: 'boolean',
      default: false,
    },
    {
      name: 'embedding-model',
      description: 'ONNX embedding model to use',
      type: 'string',
      default: 'Xenova/all-MiniLM-L6-v2',
      choices: ['Xenova/all-MiniLM-L6-v2', 'Xenova/all-mpnet-base-v2'],
    },
  ],
  examples: [
    { command: 'monomind init', description: 'Initialize with default configuration' },
    {
      command: 'monomind init --no-start-all',
      description: 'Initialize without auto-starting services',
    },
    { command: 'monomind init --minimal', description: 'Initialize with minimal configuration' },
    { command: 'monomind init --full', description: 'Initialize with all components' },
    { command: 'monomind init --force', description: 'Reinitialize and overwrite existing config' },
    { command: 'monomind init --only-claude', description: 'Only create Claude Code integration' },
    { command: 'monomind init --skip-claude', description: 'Only create v1 runtime' },
    { command: 'monomind init --opencode', description: 'Initialize only OpenCode' },
    { command: 'monomind init --kimicode', description: 'Initialize only Kimi Code' },
    { command: 'monomind init --codex', description: 'Initialize only Codex' },
    {
      command: 'monomind init --target all',
      description: 'Initialize the five legacy coding-system targets',
    },
    { command: 'monomind init --target codex', description: 'Initialize only Codex' },
    { command: 'monomind init wizard', description: 'Interactive setup wizard' },
    {
      command: 'monomind init --no-watch',
      description: 'Initialize without starting the background graph watcher',
    },
    { command: 'monomind init --with-embeddings', description: 'Initialize with ONNX embeddings' },
    {
      command: 'monomind init --with-embeddings --embedding-model Xenova/all-mpnet-base-v2',
      description: 'Use larger embedding model',
    },
    { command: 'monomind init skills --all', description: 'Install all available skills' },
    { command: 'monomind init hooks --minimal', description: 'Create minimal hooks configuration' },
    { command: 'monomind init upgrade', description: 'Update helpers while preserving data' },
    {
      command: 'monomind init upgrade --settings',
      description: 'Update helpers and merge new settings (Agent Teams)',
    },
    { command: 'monomind init upgrade --verbose', description: 'Show detailed upgrade info' },
  ],
  action: initAction,
};

export default initCommand;
