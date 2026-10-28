/**
 * Action for `monomind init`: resolves targets/components, runs executeInit, and reports the result.
 * Split from init.ts.
 *
 * @module @monomind/cli/commands/init-action
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describePlatformChoice } from '../init/detect-platforms.js';
import { formatKeptFiles, rehashGuard } from '../init/file-guard.js';
import { DEFAULT_INIT_OPTIONS, executeInit } from '../init/index.js';
import { reportProjectMemory } from '../init/init-memory.js';
import { runDoctorFix } from '../init/init-post-steps.js';
import { listingBudgetWarning } from '../init/listing-size.js';
import { wantsAgentsDirs, wantsGeminiDirs } from '../init/platform-dirs.js';
import { formatIndexSummary } from '../init/project-indexes.js';
import { resolveInitOptions } from '../init/resolve-options.js';
import { countInitFiles, formatInitFileCounts, snapshotInitFiles } from '../init/written-files.js';
import { ingestDirectory } from '../knowledge/document-pipeline.js';
import { output } from '../output.js';
import { mcpAddHint } from '../platform-adapters/renderers/mcp.js';
import { confirm } from '../prompt.js';
import {
  downloadEmbeddingModel,
  EMBEDDING_MODEL_SIZE_LABEL,
  embeddingDownloadDecision,
  isEmbeddingModelCached,
} from '../routing/model-download.js';
import type { CommandContext, CommandResult } from '../types.js';

export function isInitialized(cwd: string): { claude: boolean; monomind: boolean } {
  const claudePath = path.join(cwd, '.claude', 'settings.json');
  const monomindPath = path.join(cwd, '.monomind', 'config.yaml');
  return {
    claude: fs.existsSync(claudePath),
    monomind: fs.existsSync(monomindPath),
  };
}

export const initAction = async (ctx: CommandContext): Promise<CommandResult> => {
  // `--project <dir>` (#358): initialize <dir> instead of the process cwd,
  // equivalent to `cd <dir> && monomind init`. Validated up front so both the
  // human and `--json` paths below fail the same way on a bad path.
  const projectFlag = ctx.flags.project as string | undefined;
  const json = ctx.flags.json === true || ctx.flags.format === 'json';
  let cwd = ctx.cwd;
  if (projectFlag) {
    const resolvedProject = path.resolve(ctx.cwd, projectFlag);
    if (!fs.existsSync(resolvedProject) || !fs.statSync(resolvedProject).isDirectory()) {
      const message = `Directory does not exist: ${resolvedProject}`;
      if (json) {
        process.stdout.write(`${JSON.stringify({ success: false, error: message })}\n`);
        return { success: false, exitCode: 1 };
      }
      return { success: false, exitCode: 1, message };
    }
    cwd = resolvedProject;
  }

  // `--json` (#358): a machine-readable, headless workspace-init path —
  // no spinner/box ceremony, stdout reserved for exactly one JSON document.
  if (json) {
    const { runInitWorkspace } = await import('./init-workspace.js');
    return runInitWorkspace(ctx, cwd);
  }

  const force = ctx.flags.force as boolean;
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

  const resolved = resolveInitOptions(ctx, cwd);
  if (!resolved.ok) {
    return { success: false, exitCode: 1, message: resolved.message };
  }
  const options = resolved.options;
  if (!options.components.agentsOnly) {
    for (const line of describePlatformChoice(resolved.platforms)) output.printInfo(line);
    output.writeln();
  }
  // The doctor pass runs once, below, after every write this action makes (#425).
  options.deferDoctor = true;

  const spinner = output.createSpinner({ text: 'Initializing...' });
  spinner.start();

  try {
    const filesBefore = snapshotInitFiles(cwd);
    const result = await executeInit(options);

    if (!result.success) {
      spinner.fail('Initialization failed');
      for (const error of result.errors) {
        output.printError(error);
      }
      return { success: false, exitCode: 1 };
    }

    // `--target agents` wrote AGENTS.md alone: no sample org, services or
    // summary of files it did not create.
    if (options.components.agentsOnly) {
      spinner.succeed(
        result.created.files.length > 0 ? 'Wrote AGENTS.md' : 'AGENTS.md already exists (kept)',
      );
      return { success: true, data: result };
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

    // #423: the SessionStart hook starts the dashboard only when opted in.
    if (ctx.flags.dashboard === true) {
      const monomindDir = path.join(options.targetDir, '.monomind');
      fs.mkdirSync(monomindDir, { recursive: true });
      fs.writeFileSync(
        path.join(monomindDir, 'dashboard.json'),
        `${JSON.stringify({ autostart: true }, null, 2)}\n`,
      );
      output.printInfo('Dashboard auto-start enabled (.monomind/dashboard.json)');
    }

    reportProjectMemory(result.memory);

    const indexLine = formatIndexSummary(result.indexes);
    if (indexLine) output.printInfo(indexLine);

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

    // #420: counted on disk — result.created/skipped list items, not files.
    const summary = formatInitFileCounts(countInitFiles(cwd, filesBefore));

    // o-38: a retirement is a destructive action and must never be folded
    // into "Files: N created" — that is exactly how the original data-loss
    // bug went unreported. Named on a default run, no --verbose gate, with
    // every entry printed (a count alone repeats the same sin at lower
    // volume).
    if (result.removed.length > 0) {
      summary.push(`Retired: ${result.removed.length} (moved to .monomind/backups/…)`);
    }

    output.printBox(summary.join('\n'), 'Summary');
    output.writeln();

    if (result.removed.length > 0) {
      output.printBox(
        result.removed.join('\n'),
        'Retired (your files were preserved, not deleted)',
      );
      output.writeln();
    }

    const keptFiles = formatKeptFiles(result.kept);
    if (keptFiles) output.printWarning(keptFiles);
    const listingWarning = listingBudgetWarning(path.join(cwd, '.claude'));
    if (listingWarning) output.printWarning(listingWarning);
    // Non-fatal problems (a skill with no source, an entry that could not be
    // retired) land in result.errors; a successful run must still show them.
    const warnings = [...(result.warnings ?? []), ...result.errors];
    for (const warning of warnings) output.printWarning(warning);
    if (keptFiles || warnings.length) output.writeln();

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
            ? `Skills:      ${[
                '.claude/skills/',
                wantsGeminiDirs(options) ? '.gemini/skills/' : '',
                wantsAgentsDirs(options) ? '.agents/skills/' : '',
              ]
                .filter(Boolean)
                .join(', ')} (${result.summary.skillsCount} skills)`
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

      // No swarm step: it shelled out to `npx monomind@latest swarm init`,
      // which fetched the published package (and Chrome, via puppeteer's
      // postinstall) into $HOME only to fail — `swarm` became `monoswarm`
      // long ago. npm defers SIGTERM, so the 30s timeout never bounded it,
      // and a killed init left npm writing into $HOME. monoswarm itself was
      // removed in 2.22.0 (#418).

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
      DEFAULT_INIT_OPTIONS.embeddings.model) as string;

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

      output.writeln(output.dim(`  Model: ${embeddingModel}`));
      output.writeln(output.dim('  Hyperbolic: Enabled (Poincaré ball)'));
      const { runEmbeddingsStep } = await import('../init/embeddings-step.js');
      await runEmbeddingsStep(embeddingModel);
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

    await runDoctorFix(
      options.targetDir,
      result,
      options.installClaudeCode !== false,
      options.selectedPlatforms?.includes('claude') ?? true,
    );
    rehashGuard(result); // doctor --fix may have created the .gitignore

    if (!startAll) {
      output.writeln(output.bold('Next steps:'));
      output.printList(
        [
          result.memory && result.memory.status !== 'failed'
            ? ''
            : `Run ${output.highlight('monomind memory init')} to initialize memory database`,
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
    output.writeln(`     ${output.highlight(mcpAddHint(options.mcp.pin))}`);
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
      `     ${output.highlight('/mastermind:plan')}   ${output.dim('# plan a change before touching code')}`,
    );
    output.writeln('');
    output.writeln(
      output.dim('  The /mastermind:* slash commands are the primary way to use Monomind once'),
    );
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

    return { success: true, data: result };
  } catch (error) {
    spinner.fail('Initialization failed');
    output.printError(
      `Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { success: false, exitCode: 1 };
  }
};
