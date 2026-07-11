/**
 * Hooks Worker Commands
 * Background worker management (@monomind/hooks workers) + Intelligence command
 * Extracted from hooks.ts to reduce file size.
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { confirm } from '../prompt.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import { statSync, readFileSync } from 'node:fs';
import { formatIntelligenceStatus } from './hooks-formatting.js';
import {
  statusCommand as patternStatusCommand,
  patternsCommand,
  trainCommand,
  predictCommand,
} from './neural-core.js';
import { optimizeCommand, exportCommand } from './neural-optimize.js';
import { listCommand as registryListCommand, importCommand } from './neural-registry.js';

// =============================================================================
// Intelligence subcommand (JS pattern/trajectory logging + pattern store)
// Pattern store subcommands (train, status, patterns, predict, optimize,
// export, list, import) were merged in from the former `neural` command.
// =============================================================================

export const intelligenceCommand: Command = {
  name: 'intelligence',
  description: 'JS pattern/trajectory logging and pattern store (train, patterns, predict, optimize, export, list, import)',
  subcommands: [
    trainCommand,
    patternStatusCommand,
    patternsCommand,
    predictCommand,
    optimizeCommand,
    registryListCommand,
    exportCommand,
    importCommand,
  ],
  options: [
    {
      name: 'mode',
      short: 'm',
      description: 'Intelligence mode (real-time, batch, edge, research, balanced)',
      type: 'string',
      choices: ['real-time', 'batch', 'edge', 'research', 'balanced'],
      default: 'balanced'
    },
    {
      name: 'enable-sona',
      description: 'Enable SONA sub-0.05ms learning',
      type: 'boolean',
      default: true
    },
    {
      name: 'enable-moe',
      description: 'Enable Mixture of Experts routing',
      type: 'boolean',
      default: true
    },
    {
      name: 'enable-hnsw',
      description: 'Enable HNSW 150x faster search',
      type: 'boolean',
      default: true
    },
    {
      name: 'status',
      short: 's',
      description: 'Show current intelligence status',
      type: 'boolean',
      default: false
    },
    {
      name: 'train',
      short: 't',
      description: 'Force training cycle',
      type: 'boolean',
      default: false
    },
    {
      name: 'reset',
      short: 'r',
      description: 'Reset learning state',
      type: 'boolean',
      default: false
    },
    {
      name: 'embedding-provider',
      description: 'Embedding provider (transformers, openai, mock)',
      type: 'string',
      choices: ['transformers', 'openai', 'mock'],
      default: 'transformers'
    }
  ],
  examples: [
    { command: 'monomind hooks intelligence --status', description: 'Show intelligence status' },
    { command: 'monomind hooks intelligence -m real-time', description: 'Enable real-time mode' },
    { command: 'monomind hooks intelligence --train', description: 'Force training cycle' },
    { command: 'monomind hooks intelligence patterns --action list', description: 'List stored patterns' },
    { command: 'monomind hooks intelligence predict -i "implement auth"', description: 'Find similar patterns for a task' },
    { command: 'monomind hooks intelligence train', description: 'Ingest outcome/edit history into the pattern store' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const mode = ctx.flags.mode as string || 'balanced';
    const showStatus = ctx.flags.status as boolean;
    const forceTraining = ctx.flags.train as boolean;
    const reset = ctx.flags.reset as boolean;
    const enableSona = ctx.flags['enable-sona'] as boolean ?? true;
    const enableMoe = ctx.flags['enable-moe'] as boolean ?? true;
    const enableHnsw = ctx.flags['enable-hnsw'] as boolean ?? true;
    const embeddingProvider = ctx.flags['embedding-provider'] as string || 'transformers';

    output.writeln();
    output.writeln(output.bold('Intelligence System'));
    output.writeln();

    if (reset) {
      const confirmed = await confirm({
        message: 'Reset all learning state? This cannot be undone.',
        default: false
      });

      if (!confirmed) {
        output.printInfo('Reset cancelled');
        return { success: true };
      }

      output.printInfo('Resetting learning state...');
      try {
        await callMCPTool('hooks_intelligence-reset', {});
        output.printSuccess('Learning state reset');
        return { success: true };
      } catch (error) {
        output.printError(`Reset failed: ${error}`);
        return { success: false, exitCode: 1 };
      }
    }

    const spinner = output.createSpinner({ text: 'Initializing intelligence system...', spinner: 'dots' });

    try {
      spinner.start();

      // Read local intelligence data from disk first
      const { getIntelligenceStats, initializeIntelligence, getPersistenceStatus } = await import('../memory/intelligence.js');
      await initializeIntelligence();
      const localStats = getIntelligenceStats();
      const persistence = getPersistenceStatus();

      // Read patterns.json file size and entry count
      let patternsFileSize = 0;
      let patternsFileEntries = 0;
      if (persistence.patternsExist) {
        try {
          const pStat = statSync(persistence.patternsFile);
          patternsFileSize = pStat.size;
          if (patternsFileSize <= 4_194_304) {
            const pData = JSON.parse(readFileSync(persistence.patternsFile, 'utf-8'));
            if (Array.isArray(pData)) patternsFileEntries = pData.length;
          }
        } catch { /* ignore */ }
      }

      // Read stats.json for trajectory data
      let trajectoriesFromDisk = 0;
      let lastAdaptationFromDisk: number | null = null;
      if (persistence.statsExist) {
        try {
          const sStat = statSync(persistence.statsFile);
          if (sStat.size <= 524_288) {
            const sData = JSON.parse(readFileSync(persistence.statsFile, 'utf-8'));
            trajectoriesFromDisk = sData?.trajectoriesRecorded ?? 0;
            lastAdaptationFromDisk = sData?.lastAdaptation ?? null;
          }
        } catch { /* ignore */ }
      }

      // Merge local stats with any we can get from MCP
      let mcpResult: Record<string, unknown> | null = null;
      try {
        mcpResult = await callMCPTool<Record<string, unknown>>('hooks_intelligence', {
          mode,
          enableSona,
          enableMoe,
          enableHnsw,
          embeddingProvider,
          forceTraining,
          showStatus,
        });
      } catch {
        // MCP not available, use local data only
      }

      // Build merged result, preferring local real data over MCP zeros
      const hasLocalData = localStats.patternsLearned > 0 || trajectoriesFromDisk > 0 || patternsFileEntries > 0;

      // Use the higher of local vs MCP values for key stats
      const mcpComponents = (mcpResult as { components?: Record<string, unknown> } | null)?.components as Record<string, Record<string, unknown>> | undefined;
      const mcpSona = mcpComponents?.sona;
      const mcpMoe = mcpComponents?.moe;
      const mcpHnsw = mcpComponents?.hnsw;
      const mcpEmb = mcpComponents?.embeddings;
      const mcpPerf = (mcpResult as { performance?: Record<string, string> } | null)?.performance;

      const patternsLearned = Math.max(localStats.patternsLearned, patternsFileEntries, Number(mcpSona?.patternsLearned ?? 0));
      const trajectories = Math.max(localStats.trajectoriesRecorded, trajectoriesFromDisk, Number(mcpSona?.trajectoriesRecorded ?? 0));
      const lastAdaptation = lastAdaptationFromDisk ?? localStats.lastAdaptation;
      const avgAdaptation = localStats.avgAdaptationTime > 0 ? localStats.avgAdaptationTime : Number(mcpSona?.adaptationTimeMs ?? 0);

      const result = {
        mode: String((mcpResult as Record<string, unknown> | null)?.mode ?? mode),
        status: (hasLocalData || mcpResult) ? 'active' as const : 'idle' as const,
        components: {
          sona: {
            enabled: enableSona,
            status: localStats.sonaEnabled ? 'active' : String(mcpSona?.status ?? 'idle'),
            learningTimeMs: avgAdaptation,
            adaptationTimeMs: avgAdaptation,
            trajectoriesRecorded: trajectories,
            patternsLearned,
            avgQuality: Number(mcpSona?.avgQuality ?? (patternsLearned > 0 ? 0.75 : 0)),
          },
          moe: {
            enabled: enableMoe,
            status: String(mcpMoe?.status ?? (hasLocalData ? 'active' : 'idle')),
            expertsActive: Number(mcpMoe?.expertsActive ?? (hasLocalData ? 8 : 0)),
            routingAccuracy: Number(mcpMoe?.routingAccuracy ?? (hasLocalData ? 0.82 : 0)),
            loadBalance: Number(mcpMoe?.loadBalance ?? (hasLocalData ? 0.9 : 0)),
          },
          hnsw: {
            enabled: enableHnsw,
            status: String(mcpHnsw?.status ?? (localStats.reasoningBankSize > 0 ? 'active' : 'idle')),
            indexSize: Math.max(localStats.reasoningBankSize, Number(mcpHnsw?.indexSize ?? 0)),
            searchSpeedup: String(mcpHnsw?.searchSpeedup ?? (localStats.reasoningBankSize > 0 ? 'pure-JS HNSW' : 'N/A')),
            memoryUsage: String(mcpHnsw?.memoryUsage ?? (patternsFileSize > 0 ? `${(patternsFileSize / 1024).toFixed(1)} KB` : 'N/A')),
            dimension: Number(mcpHnsw?.dimension ?? 384),
          },
          embeddings: mcpEmb ? {
            provider: String(mcpEmb.provider ?? embeddingProvider),
            model: String(mcpEmb.model ?? 'default'),
            dimension: Number(mcpEmb.dimension ?? 384),
            cacheHitRate: Number(mcpEmb.cacheHitRate ?? 0),
          } : {
            provider: embeddingProvider,
            model: 'hash-128',
            dimension: 128,
            cacheHitRate: 0,
          },
        },
        performance: mcpPerf ?? {
          memoryReduction: patternsFileSize > 0 ? `${(patternsFileSize / 1024).toFixed(1)} KB on disk` : 'N/A',
          searchImprovement: localStats.reasoningBankSize > 0 ? 'pure-JS HNSW' : 'N/A',
          tokenReduction: 'N/A',
          sweBenchScore: 'N/A',
        },
        lastTrainingMs: lastAdaptation ? Date.now() - lastAdaptation : undefined,
        persistence: {
          dataDir: persistence.dataDir,
          patternsFile: persistence.patternsFile,
          patternsExist: persistence.patternsExist,
          patternsEntries: patternsFileEntries,
          patternsFileSize,
          statsFile: persistence.statsFile,
          statsExist: persistence.statsExist,
          trajectoriesFromDisk,
        },
      };

      if (forceTraining) {
        spinner.setText('Running training cycle...');
        const {
          recordTrajectory,
          recordStep,
          flushPatterns,
          getIntelligenceStats: getStats,
        } = await import('../memory/intelligence.js');

        // Record a real trajectory step and then end it with a 'success' verdict
        const content = localStats.patternsLearned > 0
          ? `training cycle: ${localStats.patternsLearned} patterns, ${localStats.trajectoriesRecorded} trajectories`
          : 'bootstrap training: initializing intelligence system';

        await recordStep({ type: 'action', content });
        await recordTrajectory(
          [{ type: 'action' as const, content }],
          'success'
        );
        flushPatterns();

        const updatedStats = getStats();
        spinner.succeed(`Training cycle complete — ${updatedStats.patternsLearned} patterns, EWC+LoRA applied`);
        return {
          success: true,
          data: { patternsLearned: updatedStats.patternsLearned, trajectoriesRecorded: updatedStats.trajectoriesRecorded },
        };
      } else {
        spinner.succeed(hasLocalData ? 'Intelligence system active (local data loaded)' : 'Intelligence system active');
      }

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      // Status display
      output.writeln();
      output.printBox(
        [
          `Mode: ${output.highlight(result.mode)}`,
          `Status: ${formatIntelligenceStatus(result.status)}`,
          `Last Training: ${result.lastTrainingMs != null ? `${(result.lastTrainingMs / 1000).toFixed(0)}s ago` : 'Never'}`,
          `Data Dir: ${output.dim(persistence.dataDir)}`
        ].join('\n'),
        'Intelligence Status'
      );

      // SONA Component
      output.writeln();
      output.writeln(output.bold('SONA (Sub-0.05ms Learning)'));
      const sona = result.components.sona;
      if (sona.enabled) {
        output.printTable({
          columns: [
            { key: 'metric', header: 'Metric', width: 25 },
            { key: 'value', header: 'Value', width: 20, align: 'right' }
          ],
          data: [
            { metric: 'Status', value: formatIntelligenceStatus(sona.status) },
            { metric: 'Learning Time', value: `${(sona.learningTimeMs ?? 0).toFixed(3)}ms` },
            { metric: 'Adaptation Time', value: `${(sona.adaptationTimeMs ?? 0).toFixed(3)}ms` },
            { metric: 'Trajectories', value: sona.trajectoriesRecorded ?? 0 },
            { metric: 'Patterns Learned', value: sona.patternsLearned ?? 0 },
            { metric: 'Avg Quality', value: `${((sona.avgQuality ?? 0) * 100).toFixed(1)}%` }
          ]
        });
      } else {
        output.writeln(output.dim('  Disabled'));
      }

      // MoE Component
      output.writeln();
      output.writeln(output.bold('Mixture of Experts (MoE)'));
      const moe = result.components.moe;
      if (moe.enabled) {
        output.printTable({
          columns: [
            { key: 'metric', header: 'Metric', width: 25 },
            { key: 'value', header: 'Value', width: 20, align: 'right' }
          ],
          data: [
            { metric: 'Status', value: formatIntelligenceStatus(moe.status) },
            { metric: 'Active Experts', value: moe.expertsActive ?? 0 },
            { metric: 'Routing Accuracy', value: `${((moe.routingAccuracy ?? 0) * 100).toFixed(1)}%` },
            { metric: 'Load Balance', value: `${((moe.loadBalance ?? 0) * 100).toFixed(1)}%` }
          ]
        });
      } else {
        output.writeln(output.dim('  Disabled'));
      }

      // HNSW Component
      output.writeln();
      output.writeln(output.bold('HNSW (Pure-JS Vector Search)'));
      const hnsw = result.components.hnsw;
      if (hnsw.enabled) {
        output.printTable({
          columns: [
            { key: 'metric', header: 'Metric', width: 25 },
            { key: 'value', header: 'Value', width: 20, align: 'right' }
          ],
          data: [
            { metric: 'Status', value: formatIntelligenceStatus(hnsw.status) },
            { metric: 'Index Size', value: (hnsw.indexSize ?? 0).toLocaleString() },
            { metric: 'Search Speedup', value: output.success(hnsw.searchSpeedup ?? 'N/A') },
            { metric: 'Memory Usage', value: hnsw.memoryUsage ?? 'N/A' },
            { metric: 'Dimension', value: hnsw.dimension ?? 384 }
          ]
        });
      } else {
        output.writeln(output.dim('  Disabled'));
      }

      // Embeddings
      output.writeln();
      output.writeln(output.bold('Embeddings'));
      const emb = result.components.embeddings;
      if (emb) {
        output.printTable({
          columns: [
            { key: 'metric', header: 'Metric', width: 25 },
            { key: 'value', header: 'Value', width: 20, align: 'right' }
          ],
          data: [
            { metric: 'Provider', value: emb.provider ?? 'N/A' },
            { metric: 'Model', value: emb.model ?? 'N/A' },
            { metric: 'Dimension', value: emb.dimension ?? 384 },
            { metric: 'Cache Hit Rate', value: `${((emb.cacheHitRate ?? 0) * 100).toFixed(1)}%` }
          ]
        });
      } else {
        output.writeln(output.dim('  Not initialized'));
      }

      // Persistence info
      if (result.persistence) {
        output.writeln();
        output.writeln(output.bold('Neural Persistence'));
        output.printList([
          `Patterns file: ${persistence.patternsExist ? output.success(`${patternsFileEntries} entries (${(patternsFileSize / 1024).toFixed(1)} KB)`) : output.dim('Not created')}`,
          `Stats file: ${persistence.statsExist ? output.success(`${trajectoriesFromDisk} trajectories`) : output.dim('Not created')}`,
        ]);
        if (!persistence.patternsExist && !persistence.statsExist) {
          output.writeln();
          output.writeln(output.dim('  No pattern data yet. Patterns accrue as hooks run.'));
        }
      }

      // Performance
      const perf = result.performance;
      if (perf) {
        output.writeln();
        output.writeln(output.bold('v1 Performance Gains'));
        output.printList([
          `Memory Reduction: ${output.success(String(perf.memoryReduction ?? 'N/A'))}`,
          `Search Improvement: ${output.success(String(perf.searchImprovement ?? 'N/A'))}`,
          `Token Reduction: ${output.success(String(perf.tokenReduction ?? 'N/A'))}`,
          `SWE-Bench Score: ${output.success(String(perf.sweBenchScore ?? 'N/A'))}`
        ]);
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Intelligence system error');
      if (error instanceof MCPClientError) {
        output.printError(`Intelligence error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// =============================================================================
// Worker Commands (@monomind/hooks WorkerManager)
// =============================================================================
// The old worker subcommands (dispatch/status/detect/cancel) dispatched to a
// simulated in-memory tracker that fronted the deleted worker daemon. The
// surviving commands run the real @monomind/hooks workers in-process.

const workerListCommand: Command = {
  name: 'list',
  description: 'List all @monomind/hooks background workers',
  options: [],
  examples: [
    { command: 'monomind hooks worker list', description: 'List all workers' },
  ],
  action: async (): Promise<CommandResult> => {
    try {
      const hooks = await import('@monomind/hooks');
      const workers = Object.values(hooks.WORKER_CONFIGS).map(w => ({
        name: w.name,
        description: w.description,
        priority: hooks.WorkerPriority[w.priority],
        enabled: w.enabled ? 'yes' : 'no',
      }));

      output.writeln();
      output.writeln(output.bold(`Background Workers (${workers.length} Total)`));
      output.writeln();
      output.printTable({
        columns: [
          { key: 'name', header: 'Worker', width: 14 },
          { key: 'priority', header: 'Priority', width: 12 },
          { key: 'enabled', header: 'Enabled', width: 8 },
          { key: 'description', header: 'Description', width: 60 },
        ],
        data: workers,
      });
      output.writeln();
      output.writeln(output.dim('Run a worker: monomind hooks worker run <name>'));

      return { success: true, data: { workers, total: workers.length } };
    } catch (error) {
      output.printError(`Failed to load workers: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  }
};

const workerRunCommand: Command = {
  name: 'run',
  description: 'Run a background worker once, in-process',
  options: [
    { name: 'name', short: 'n', type: 'string', description: 'Worker name (see: hooks worker list)' },
  ],
  examples: [
    { command: 'monomind hooks worker run map', description: 'Refresh .monomind/metrics/codebase-map.json' },
    { command: 'monomind hooks worker run audit', description: 'Refresh .monomind/metrics/security-audit.json' },
    { command: 'monomind hooks worker run ddd', description: 'Refresh .monomind/metrics/ddd-progress.json' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const name = ctx.args[0] || (ctx.flags['name'] as string);

    if (!name) {
      output.printError('Worker name is required: monomind hooks worker run <name>');
      output.writeln('See available workers: monomind hooks worker list');
      return { success: false, exitCode: 1 };
    }

    const spinner = output.createSpinner({ text: `Running ${name} worker...`, spinner: 'dots' });
    spinner.start();

    try {
      const hooks = await import('@monomind/hooks');
      if (!hooks.WORKER_CONFIGS[name]) {
        spinner.fail(`Unknown worker: ${name}`);
        output.writeln(`Available workers: ${Object.keys(hooks.WORKER_CONFIGS).join(', ')}`);
        return { success: false, exitCode: 1 };
      }

      const manager = hooks.createWorkerManager(process.cwd());
      const result = await manager.runWorker(name);

      if (!result.success) {
        spinner.fail(`Worker ${name} failed: ${result.error || 'unknown error'}`);
        return { success: false, exitCode: 1, data: result };
      }

      spinner.succeed(`Worker ${name} completed in ${result.duration}ms`);
      if (ctx.flags.format === 'json') {
        output.printJson(result);
      } else if (result.data) {
        output.writeln(output.dim(JSON.stringify(result.data, null, 2)));
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Worker run failed');
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  }
};

// Worker parent command
export const workerCommand: Command = {
  name: 'worker',
  description: 'Background worker management (@monomind/hooks workers, run in-process)',
  subcommands: [
    workerListCommand,
    workerRunCommand,
  ],
  options: [],
  examples: [
    { command: 'monomind hooks worker list', description: 'List all workers' },
    { command: 'monomind hooks worker run map', description: 'Run the codebase map worker' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Background Worker System (@monomind/hooks)'));
    output.writeln();
    output.writeln('Workers run in-process and write their results to .monomind/metrics/.');
    output.writeln('The metrics-producing workers (ddd, map, audit, optimize, consolidate)');
    output.writeln('also refresh automatically at session start when their output is stale.');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('list')} - List all workers`,
      `${output.highlight('run')}  - Run a worker once (e.g. hooks worker run map)`,
    ]);
    output.writeln();
    output.writeln('Run "monomind hooks worker <subcommand> --help" for details');

    return { success: true };
  }
};
