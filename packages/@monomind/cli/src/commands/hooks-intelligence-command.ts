/**
 * Hooks Intelligence Command
 * JS pattern/trajectory logging + pattern store (train, status, patterns,
 * predict, optimize, export, import). Extracted from hooks-workers.ts to
 * reduce file size.
 */

import { readFileSync, statSync } from 'node:fs';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import { PATTERNS_DB_FILE, patternDbStats } from '../memory/intelligence-pattern-db.js';
import { output } from '../output.js';
import { confirm } from '../prompt.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { formatIntelligenceStatus } from './hooks-formatting.js';
import {
  statusCommand as patternStatusCommand,
  patternsCommand,
  predictCommand,
  trainCommand,
} from './neural-core.js';
import { exportCommand, optimizeCommand } from './neural-optimize.js';
import { importCommand } from './neural-registry.js';

// =============================================================================
// Intelligence subcommand (JS pattern/trajectory logging + pattern store)
// Pattern store subcommands (train, status, patterns, predict, optimize,
// export, import) were merged in from the former `neural` command.
// =============================================================================

export const intelligenceCommand: Command = {
  name: 'intelligence',
  description:
    'JS pattern/trajectory logging and pattern store (train, patterns, predict, optimize, export, import)',
  subcommands: [
    trainCommand,
    patternStatusCommand,
    patternsCommand,
    predictCommand,
    optimizeCommand,
    exportCommand,
    importCommand,
  ],
  options: [
    {
      name: 'enable-hnsw',
      description:
        'Enable HNSW vector search (dead fallback path; no-op unless SQLite bridge is down)',
      type: 'boolean',
      default: true,
    },
    {
      name: 'status',
      short: 's',
      description: 'Show current intelligence status',
      type: 'boolean',
      default: false,
    },
    {
      name: 'train',
      short: 't',
      description: 'Force training cycle',
      type: 'boolean',
      default: false,
    },
    {
      name: 'reset',
      short: 'r',
      description: 'Reset learning state',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    { command: 'monomind hooks intelligence --status', description: 'Show intelligence status' },
    { command: 'monomind hooks intelligence --train', description: 'Force training cycle' },
    {
      command: 'monomind hooks intelligence patterns --action list',
      description: 'List stored patterns',
    },
    {
      command: 'monomind hooks intelligence predict -i "implement auth"',
      description: 'Find similar patterns for a task',
    },
    {
      command: 'monomind hooks intelligence train',
      description: 'Ingest outcome/edit history into the pattern store',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const showStatus = ctx.flags.status as boolean;
    const forceTraining = ctx.flags.train as boolean;
    const reset = ctx.flags.reset as boolean;
    const enableHnsw = (ctx.flags['enable-hnsw'] as boolean) ?? true;

    output.writeln();
    output.writeln(output.bold('Intelligence System'));
    output.writeln();

    if (reset) {
      const confirmed = await confirm({
        message: 'Reset all learning state? This cannot be undone.',
        default: false,
      });

      if (!confirmed) {
        output.printInfo('Reset cancelled');
        return { success: true };
      }

      output.printInfo('Resetting learning state...');
      try {
        const result = await callMCPTool<{ reset: boolean; failedFiles: string[] }>(
          'hooks_intelligence-reset',
          {},
        );
        if (result.reset) {
          output.printSuccess('Learning state reset');
        } else {
          output.printWarning(
            `Learning state only partly reset — could not delete: ${result.failedFiles.join(', ')}`,
          );
        }
        return { success: true, data: result };
      } catch (error) {
        output.printError(`Reset failed: ${error}`);
        return { success: false, exitCode: 1 };
      }
    }

    const spinner = output.createSpinner({
      text: 'Initializing intelligence system...',
      spinner: 'dots',
    });

    try {
      spinner.start();

      // Read local intelligence data from disk first
      const { getIntelligenceStats, initializeIntelligence, getPersistenceStatus } = await import(
        '../memory/intelligence.js'
      );
      await initializeIntelligence();
      const localStats = getIntelligenceStats();
      const persistence = getPersistenceStatus();

      // Read patterns.json file size and entry count
      let patternsFileSize = 0;
      let patternsFileEntries = 0;
      const dbStats = persistence.patternsFile.endsWith(PATTERNS_DB_FILE)
        ? patternDbStats(persistence.dataDir)
        : null;
      if (dbStats) {
        patternsFileSize = dbStats.size;
        patternsFileEntries = dbStats.entries;
      } else if (persistence.patternsExist) {
        try {
          const pStat = statSync(persistence.patternsFile);
          patternsFileSize = pStat.size;
          if (patternsFileSize <= 4_194_304) {
            const pData = JSON.parse(readFileSync(persistence.patternsFile, 'utf-8'));
            if (Array.isArray(pData)) patternsFileEntries = pData.length;
          }
        } catch (e) {
          if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
            console.error('[hooks-intelligence] patterns.json read/parse failed:', e);
        }
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
        } catch (e) {
          if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
            console.error('[hooks-intelligence] stats.json read/parse failed:', e);
        }
      }

      // Merge local stats with any we can get from MCP
      let mcpResult: Record<string, unknown> | null = null;
      try {
        mcpResult = await callMCPTool<Record<string, unknown>>('hooks_intelligence', {
          enableHnsw,
          forceTraining,
          showStatus,
        });
      } catch {
        // MCP not available, use local data only
      }

      // Build merged result, preferring local real data over MCP zeros
      const hasLocalData =
        localStats.patternsLearned > 0 || trajectoriesFromDisk > 0 || patternsFileEntries > 0;

      // Use the higher of local vs MCP values for key stats
      const mcpComponents = (mcpResult as { components?: Record<string, unknown> } | null)
        ?.components as Record<string, Record<string, unknown>> | undefined;
      const mcpSona = mcpComponents?.sona;
      const mcpMoe = mcpComponents?.moe;
      const mcpHnsw = mcpComponents?.hnsw;
      const mcpEmb = mcpComponents?.embeddings;

      const patternsLearned = Math.max(
        localStats.patternsLearned,
        patternsFileEntries,
        Number(mcpSona?.patternsLearned ?? 0),
      );
      const trajectories = Math.max(
        localStats.trajectoriesRecorded,
        trajectoriesFromDisk,
        Number(mcpSona?.trajectoriesRecorded ?? 0),
      );
      const lastAdaptation = lastAdaptationFromDisk ?? localStats.lastAdaptation;
      const avgAdaptation =
        localStats.avgAdaptationTime > 0
          ? localStats.avgAdaptationTime
          : Number(mcpSona?.adaptationTimeMs ?? 0);

      const result = {
        status: hasLocalData || mcpResult ? ('active' as const) : ('idle' as const),
        components: {
          sona: {
            enabled: true,
            status: localStats.sonaEnabled ? 'active' : String(mcpSona?.status ?? 'idle'),
            learningTimeMs: avgAdaptation,
            adaptationTimeMs: avgAdaptation,
            trajectoriesRecorded: trajectories,
            patternsLearned,
            avgQuality: mcpSona?.avgQuality != null ? Number(mcpSona.avgQuality) : null,
          },
          moe: {
            enabled: false,
            status: 'not-loaded',
            expertsActive: Number(mcpMoe?.expertsActive ?? 0),
            routingAccuracy: Number(mcpMoe?.routingAccuracy ?? 0),
            loadBalance: Number(mcpMoe?.loadBalance ?? 0),
          },
          hnsw: {
            enabled: enableHnsw,
            status: String(
              mcpHnsw?.status ?? (localStats.reasoningBankSize > 0 ? 'active' : 'idle'),
            ),
            indexSize: Math.max(localStats.reasoningBankSize, Number(mcpHnsw?.indexSize ?? 0)),
            searchSpeedup: String(
              mcpHnsw?.searchSpeedup ?? (localStats.reasoningBankSize > 0 ? 'pure-JS HNSW' : 'N/A'),
            ),
            memoryUsage: String(
              mcpHnsw?.memoryUsage ??
                (patternsFileSize > 0 ? `${(patternsFileSize / 1024).toFixed(1)} KB` : 'N/A'),
            ),
          },
          embeddings: mcpEmb
            ? {
                provider: String(mcpEmb.provider ?? 'transformers'),
                model: String(mcpEmb.model ?? 'default'),
                dimension: Number(mcpEmb.dimension ?? 384),
              }
            : {
                provider: 'transformers',
                model: 'hash-128',
                dimension: 128,
              },
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
          compactPatterns,
          getIntelligenceStats: getStats,
        } = await import('../memory/intelligence.js');

        // Record a real trajectory step and then end it with a 'success' verdict
        const content =
          localStats.patternsLearned > 0
            ? `training cycle: ${localStats.patternsLearned} patterns, ${localStats.trajectoriesRecorded} trajectories`
            : 'bootstrap training: initializing intelligence system';

        await recordStep({ type: 'action', content });
        await recordTrajectory([{ type: 'action' as const, content }], 'success');

        // Run the real EWC-style consolidation pass (dedupes similar patterns
        // by cosine similarity) and flush the result to disk.
        const consolidation = await compactPatterns(0.95);

        const updatedStats = getStats();
        spinner.succeed(
          `Training cycle complete — ${updatedStats.patternsLearned} patterns, consolidation removed ${consolidation.removed} of ${consolidation.before} patterns`,
        );
        return {
          success: true,
          data: {
            patternsLearned: updatedStats.patternsLearned,
            trajectoriesRecorded: updatedStats.trajectoriesRecorded,
            consolidation,
          },
        };
      } else {
        spinner.succeed(
          hasLocalData
            ? 'Intelligence system active (local data loaded)'
            : 'Intelligence system active',
        );
      }

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      // Status display
      output.writeln();
      output.printBox(
        [
          `Status: ${formatIntelligenceStatus(result.status)}`,
          `Last Training: ${result.lastTrainingMs != null ? `${(result.lastTrainingMs / 1000).toFixed(0)}s ago` : 'Never'}`,
          `Data Dir: ${output.dim(persistence.dataDir)}`,
        ].join('\n'),
        'Intelligence Status',
      );

      // SONA Component
      output.writeln();
      output.writeln(output.bold('SONA (Sub-0.05ms Learning)'));
      const sona = result.components.sona;
      if (sona.enabled) {
        output.printTable({
          columns: [
            { key: 'metric', header: 'Metric', width: 25 },
            { key: 'value', header: 'Value', width: 20, align: 'right' },
          ],
          data: [
            { metric: 'Status', value: formatIntelligenceStatus(sona.status) },
            { metric: 'Learning Time', value: `${(sona.learningTimeMs ?? 0).toFixed(3)}ms` },
            { metric: 'Adaptation Time', value: `${(sona.adaptationTimeMs ?? 0).toFixed(3)}ms` },
            { metric: 'Trajectories', value: sona.trajectoriesRecorded ?? 0 },
            { metric: 'Patterns Learned', value: sona.patternsLearned ?? 0 },
            {
              metric: 'Avg Quality',
              value: sona.avgQuality != null ? `${(sona.avgQuality * 100).toFixed(1)}%` : 'N/A',
            },
          ],
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
            { key: 'value', header: 'Value', width: 20, align: 'right' },
          ],
          data: [
            { metric: 'Status', value: formatIntelligenceStatus(moe.status) },
            { metric: 'Active Experts', value: moe.expertsActive ?? 0 },
            {
              metric: 'Routing Accuracy',
              value: `${((moe.routingAccuracy ?? 0) * 100).toFixed(1)}%`,
            },
            { metric: 'Load Balance', value: `${((moe.loadBalance ?? 0) * 100).toFixed(1)}%` },
          ],
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
            { key: 'value', header: 'Value', width: 20, align: 'right' },
          ],
          data: [
            { metric: 'Status', value: formatIntelligenceStatus(hnsw.status) },
            { metric: 'Index Size', value: (hnsw.indexSize ?? 0).toLocaleString() },
            { metric: 'Search Speedup', value: output.success(hnsw.searchSpeedup ?? 'N/A') },
            { metric: 'Memory Usage', value: hnsw.memoryUsage ?? 'N/A' },
          ],
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
            { key: 'value', header: 'Value', width: 20, align: 'right' },
          ],
          data: [
            { metric: 'Provider', value: emb.provider ?? 'N/A' },
            { metric: 'Model', value: emb.model ?? 'N/A' },
            { metric: 'Dimension', value: emb.dimension ?? 384 },
          ],
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
  },
};
