import { resolve } from 'node:path';
import { output, type Spinner } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import {
  diagnoseMonographNativeError,
  formatNativeDiagnosis,
  planAutoRebuild,
  runNativeRebuild,
} from '../utils/native-binding.js';
import { formatErrorWithCause } from '../utils/native-error.js';
import { walkDocs } from './monograph-shared.js';
import { printStats } from './monograph-stats.js';

// ── build subcommand ──────────────────────────────────────────────────────────

export const buildCommand: Command = {
  name: 'build',
  description: 'Build the knowledge graph from code, docs (md/txt/rst), and PDFs',
  options: [
    { name: 'path', short: 'p', type: 'string', description: 'Root path to index (default: cwd)' },
    { name: 'code-only', type: 'boolean', description: 'Index only code files, skip documents' },
    {
      name: 'llm',
      type: 'boolean',
      description: 'Enable Claude-powered semantic extraction (uses Claude Code CLI)',
    },
    {
      name: 'llm-sections',
      type: 'number',
      description: 'Max sections to enrich with LLM (default 50)',
      default: '50',
    },
    {
      name: 'force',
      short: 'f',
      type: 'boolean',
      description: 'Force full rebuild even if index is fresh',
    },
    {
      name: 'tool-assets',
      type: 'boolean',
      description:
        'Also index tool-managed assets (.pi/ and the Agent/Skill definitions under .claude/). Off by default; the choice is remembered for this project (--no-tool-assets turns it off)',
    },
    {
      name: 'report-path',
      type: 'string',
      description:
        'Where to write GRAPH_REPORT.md, relative to the indexed path (default: .monomind/GRAPH_REPORT.md; env MONOGRAPH_REPORT_PATH)',
    },
  ],
  examples: [
    { command: 'monomind monograph build', description: 'Index code + all documents' },
    {
      command: 'monomind monograph build --llm',
      description: 'Also extract semantic relationships with Claude',
    },
    { command: 'monomind monograph build --code-only', description: 'Code only, skip docs' },
    { command: 'monomind monograph build -p ./docs', description: 'Index a specific path' },
    {
      command: 'monomind monograph build --report-path GRAPH_REPORT.md',
      description: 'Write the report to the repo root (the old location)',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const root = resolve((ctx.flags.path as string | undefined) ?? process.cwd());
    const codeOnly = ctx.flags['code-only'] === true;
    const force = ctx.flags.force === true;
    const reportPath = (ctx.flags['report-path'] as string | undefined) || undefined;
    const toolAssets =
      typeof ctx.flags['tool-assets'] === 'boolean' ? ctx.flags['tool-assets'] : undefined;
    const llmFlag = ctx.flags.llm === true;
    const llmSections = parseInt((ctx.flags['llm-sections'] as string) || '50', 10);
    const { isClaudeCodeAvailable } = await import('../routing/llm-caller.js');
    const claudeAvailable = isClaudeCodeAvailable();
    const llmMaxSections = llmFlag && claudeAvailable ? llmSections : 0;

    if (llmFlag && !claudeAvailable) {
      output.printWarning('--llm passed but Claude Code CLI not found — LLM extraction disabled');
    }

    output.writeln();
    output.writeln(output.bold('Monograph — Knowledge Graph Build'));
    output.writeln(output.dim('─'.repeat(60)));
    output.writeln(`  Path    : ${root}`);
    output.writeln(`  Mode    : ${codeOnly ? 'Code only' : 'Code + Documents + PDFs'}`);
    if (llmMaxSections > 0) {
      output.writeln(`  Claude  : Enriching up to ${llmMaxSections} sections`);
    }
    output.writeln();

    // Pre-scan to show what will be indexed
    if (!codeOnly) {
      const docs = walkDocs(root, []);
      const byExt = new Map<string, number>();
      for (const { ext } of docs) byExt.set(ext, (byExt.get(ext) ?? 0) + 1);
      if (docs.length > 0) {
        output.writeln(output.dim(`  Found ${docs.length} document files:`));
        for (const [ext, count] of [...byExt.entries()].sort()) {
          output.writeln(output.dim(`    ${ext.padEnd(6)} ${count} files`));
        }
        output.writeln();
      }
    }

    const spinner = output.createSpinner({ text: 'Building knowledge graph…', spinner: 'dots' });
    spinner.start();

    const startTime = Date.now();
    const progressLines: string[] = [];

    const runBuild = async (): Promise<void> => {
      const { buildAsync } = await import('@monoes/monograph');
      await buildAsync(root, {
        codeOnly,
        force,
        includeToolAssets: toolAssets,
        llmMaxSections,
        reportPath,
        onProgress: (p: { phase: string; message?: string }) => {
          const msg = `[${p.phase}] ${p.message ?? ''}`;
          progressLines.push(msg);
          spinner.setText(msg.slice(0, 60));
        },
      });
    };

    // Set once the native diagnosis has already been printed, so the outer
    // handler reports the failure without repeating the whole block.
    let nativeAlreadyReported = false;

    try {
      try {
        await runBuild();
      } catch (err) {
        // A native-addon load failure is not a build error — it means the
        // better-sqlite3 binary on disk doesn't match this Node. Report it
        // precisely and repair it where it lives, instead of dumping a raw ABI
        // error the user can't act on (issue #231).
        const recovered = await recoverFromNativeFailure(err, spinner);
        if (recovered !== 'not-native') nativeAlreadyReported = true;
        throw err;
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      spinner.succeed(`Build complete in ${elapsed}s`);

      // Show per-phase summary
      output.writeln();
      output.writeln(output.bold('  Build phases:'));
      for (const line of progressLines) {
        output.writeln(output.dim(`    ${line}`));
      }

      // Show graph stats
      output.writeln();
      await printStats(root);

      return { success: true };
    } catch (err) {
      spinner.fail('Build failed');
      if (!nativeAlreadyReported) output.printError(formatErrorWithCause(err));
      return { success: false, exitCode: 1 };
    }
  },
};

/**
 * On a native-binding failure, report exactly what is wrong and — when it is safe
 * (the install tree is writable, the user hasn't opted out) — rebuild the module
 * once in the directory that actually owns it. Never degrades silently: every
 * branch prints what happened and what to do next.
 */
type NativeRecovery = 'not-native' | 'unfixed' | 'rebuilt';

async function recoverFromNativeFailure(err: unknown, spinner: Spinner): Promise<NativeRecovery> {
  const diag = diagnoseMonographNativeError(err);
  if (diag.status !== 'abi-mismatch' && diag.status !== 'missing-binary') return 'not-native';

  spinner.stop();
  output.writeln();
  output.printWarning(formatNativeDiagnosis(diag));

  const decision = planAutoRebuild(diag, {
    disabled: process.env.MONOMIND_NO_NATIVE_REBUILD === '1',
  });
  if (!decision.attempt) {
    output.writeln(output.dim(`  Not rebuilding automatically: ${decision.reason}.`));
    return 'unfixed';
  }

  output.writeln(
    output.dim(`  Rebuilding ${diag.module} in ${decision.reason.replace(/^rebuilding in /, '')}…`),
  );
  const result = runNativeRebuild(diag);
  if (!result.ok) {
    output.printWarning(`Automatic rebuild failed — run it yourself:\n  ${result.command}`);
    if (result.output) output.writeln(output.dim(result.output.split('\n').slice(-10).join('\n')));
    return 'unfixed';
  }
  output.writeln(output.dim(`  Rebuilt via: ${result.command}`));
  // Deliberately not retrying in this process: once Node has tried and failed to
  // dlopen an addon, loading the replacement in the same process is unsafe — it
  // reports "Module did not self-register" at best and segfaults at worst. The
  // binary is fixed; a fresh process picks it up.
  output.printWarning(`${diag.module} has been rebuilt. Re-run this command to use it.`);
  return 'rebuilt';
}
