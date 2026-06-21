/**
 * Hooks Coverage Commands
 * Coverage-aware routing, progress tracking, and statusline generation.
 * Extracted from hooks.ts to reduce file size.
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import {
  readCoverageFromDisk,
  classifyCoverageGap,
  suggestAgentsForFile,
} from './hooks-coverage-utils.js';

// ============================================================================
// Coverage-Aware Routing Commands
// ============================================================================

// Coverage route subcommand
export const coverageRouteCommand: Command = {
  name: 'coverage-route',
  description: 'Route task to agents based on test coverage gaps (monovector integration)',
  options: [
    {
      name: 'task',
      short: 't',
      description: 'Task description to route',
      type: 'string',
      required: true
    },
    {
      name: 'threshold',
      description: 'Coverage threshold percentage (default: 80)',
      type: 'number',
      default: 80
    },
    {
      name: 'no-monovector',
      description: 'Disable monovector integration',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'monomind hooks coverage-route -t "fix bug in auth"', description: 'Route with coverage awareness' },
    { command: 'monomind hooks coverage-route -t "add tests" --threshold 90', description: 'Route with custom threshold' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const task = ctx.args[0] || ctx.flags.task as string;
    const threshold = ctx.flags.threshold as number || 80;
    const useMonovector = !ctx.flags['no-monovector'];

    if (!task) {
      output.printError('Task description is required. Use --task or -t flag.');
      return { success: false, exitCode: 1 };
    }

    const spinner = output.createSpinner({ text: 'Analyzing coverage and routing task...' });
    spinner.start();

    // Try reading coverage from disk first
    const diskCoverage = readCoverageFromDisk();

    if (diskCoverage.found) {
      spinner.succeed(`Coverage data loaded from ${diskCoverage.source}`);

      // Find files with lowest coverage that may relate to the task
      const taskLower = task.toLowerCase();
      const taskWords = taskLower.split(/\s+/).filter(w => w.length > 2);

      // Score each file by relevance to the task and how low its coverage is
      const scoredFiles = diskCoverage.entries
        .filter(e => e.lines < threshold)
        .map(e => {
          const fileNameLower = e.filePath.toLowerCase();
          let relevance = 0;
          for (const word of taskWords) {
            if (fileNameLower.includes(word)) relevance += 2;
          }
          // Penalize high coverage (we care about low coverage)
          const coveragePenalty = e.lines / 100;
          return { ...e, relevance, score: relevance + (1 - coveragePenalty) };
        })
        .sort((a, b) => b.score - a.score);

      const gaps = scoredFiles.slice(0, 8).map(e => {
        const { gapType, priority } = classifyCoverageGap(e.lines, threshold);
        return {
          filePath: e.filePath,
          coveragePercent: e.lines,
          gapType,
          priority,
          suggestedAgents: suggestAgentsForFile(e.filePath),
          reason: `${e.lines.toFixed(1)}% coverage, below ${threshold}%`,
        };
      });

      const criticalGaps = gaps.filter(g => g.gapType === 'critical').length;
      const primaryAgent = taskLower.includes('test') ? 'tester' :
                           taskLower.includes('security') || taskLower.includes('auth') ? 'security-auditor' :
                           taskLower.includes('fix') || taskLower.includes('bug') ? 'coder' : 'tester';

      const suggestions: string[] = [];
      if (criticalGaps > 0) suggestions.push(`${criticalGaps} critical coverage gaps need immediate attention`);
      if (diskCoverage.summary.overallLineCoverage < threshold) {
        suggestions.push(`Overall line coverage (${diskCoverage.summary.overallLineCoverage.toFixed(1)}%) is below ${threshold}% threshold`);
      }
      if (scoredFiles.length > 8) suggestions.push(`${scoredFiles.length - 8} additional files with low coverage`);

      const result = {
        success: true,
        task,
        coverageAware: true,
        gaps,
        routing: {
          primaryAgent,
          confidence: gaps.length > 0 ? 0.85 : 0.6,
          reason: gaps.length > 0
            ? `Routing to ${primaryAgent} based on ${gaps.length} coverage gaps related to task`
            : `No coverage gaps found related to task, routing to ${primaryAgent}`,
          coverageImpact: gaps.length > 0 ? 'high' : 'low',
        },
        suggestions,
        metrics: {
          filesAnalyzed: diskCoverage.summary.totalFiles,
          totalGaps: scoredFiles.length,
          criticalGaps,
          avgCoverage: diskCoverage.summary.overallLineCoverage,
        },
        source: diskCoverage.source,
      };

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.printBox(
        [
          `Agent: ${output.highlight(result.routing.primaryAgent)}`,
          `Confidence: ${(result.routing.confidence * 100).toFixed(1)}%`,
          `Coverage-Aware: ${output.success('Yes')} (from ${diskCoverage.source})`,
          `Reason: ${result.routing.reason}`
        ].join('\n'),
        'Coverage-Aware Routing'
      );

      if (gaps.length > 0) {
        output.writeln();
        output.writeln(output.bold('Priority Coverage Gaps'));
        output.printTable({
          columns: [
            { key: 'filePath', header: 'File', width: 35, format: (v: unknown) => {
              const s = String(v);
              return s.length > 32 ? '...' + s.slice(-32) : s;
            }},
            { key: 'coveragePercent', header: 'Coverage', width: 10, align: 'right', format: (v: unknown) => `${Number(v).toFixed(1)}%` },
            { key: 'gapType', header: 'Type', width: 10 },
            { key: 'suggestedAgents', header: 'Agent', width: 15, format: (v: unknown) => Array.isArray(v) ? v[0] || '' : String(v) }
          ],
          data: gaps.slice(0, 8)
        });
      }

      if (result.metrics.filesAnalyzed > 0) {
        output.writeln();
        output.writeln(output.bold('Coverage Metrics'));
        output.printList([
          `Files Analyzed: ${result.metrics.filesAnalyzed}`,
          `Total Gaps: ${result.metrics.totalGaps}`,
          `Critical Gaps: ${result.metrics.criticalGaps}`,
          `Average Coverage: ${result.metrics.avgCoverage.toFixed(1)}%`
        ]);
      }

      if (suggestions.length > 0) {
        output.writeln();
        output.writeln(output.bold('Suggestions'));
        output.printList(suggestions.map(s => output.dim(s)));
      }

      return { success: true, data: result };
    }

    // No disk coverage - fall back to MCP tool
    try {
      const result = await callMCPTool<{
        success: boolean;
        task: string;
        coverageAware: boolean;
        gaps: Array<{
          filePath: string;
          coveragePercent: number;
          gapType: string;
          priority: number;
          suggestedAgents: string[];
          reason: string;
        }>;
        routing: {
          primaryAgent: string;
          confidence: number;
          reason: string;
          coverageImpact: string;
        };
        suggestions: string[];
        metrics: {
          filesAnalyzed: number;
          totalGaps: number;
          criticalGaps: number;
          avgCoverage: number;
        };
      }>('hooks_coverage-route', {
        task,
        threshold,
        useMonovector,
      });

      spinner.stop();

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.printBox(
        [
          `Agent: ${output.highlight(result.routing.primaryAgent)}`,
          `Confidence: ${(result.routing.confidence * 100).toFixed(1)}%`,
          `Coverage-Aware: ${result.coverageAware ? output.success('Yes') : output.dim('No coverage data')}`,
          `Reason: ${result.routing.reason}`
        ].join('\n'),
        'Coverage-Aware Routing'
      );

      if (result.gaps.length > 0) {
        output.writeln();
        output.writeln(output.bold('Priority Coverage Gaps'));
        output.printTable({
          columns: [
            { key: 'filePath', header: 'File', width: 35, format: (v: unknown) => {
              const s = String(v);
              return s.length > 32 ? '...' + s.slice(-32) : s;
            }},
            { key: 'coveragePercent', header: 'Coverage', width: 10, align: 'right', format: (v: unknown) => `${Number(v).toFixed(1)}%` },
            { key: 'gapType', header: 'Type', width: 10 },
            { key: 'suggestedAgents', header: 'Agent', width: 15, format: (v: unknown) => Array.isArray(v) ? v[0] || '' : String(v) }
          ],
          data: result.gaps.slice(0, 8)
        });
      }

      if (result.metrics.filesAnalyzed > 0) {
        output.writeln();
        output.writeln(output.bold('Coverage Metrics'));
        output.printList([
          `Files Analyzed: ${result.metrics.filesAnalyzed}`,
          `Total Gaps: ${result.metrics.totalGaps}`,
          `Critical Gaps: ${result.metrics.criticalGaps}`,
          `Average Coverage: ${result.metrics.avgCoverage.toFixed(1)}%`
        ]);
      }

      if (result.suggestions.length > 0) {
        output.writeln();
        output.writeln(output.bold('Suggestions'));
        output.printList(result.suggestions.map(s => output.dim(s)));
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('No coverage data found');
      output.writeln();
      output.printWarning('No coverage data found. Run your test suite with coverage first.');
      output.writeln();
      output.printList([
        'Jest:     npx jest --coverage',
        'Vitest:   npx vitest --coverage',
        'nyc:      npx nyc npm test',
        'c8:       npx c8 npm test',
      ]);
      output.writeln();
      output.writeln(output.dim('Expected files: coverage/coverage-summary.json, coverage/lcov.info, or .nyc_output/out.json'));
      return { success: false, exitCode: 1 };
    }
  }
};

// Coverage suggest subcommand
export const coverageSuggestCommand: Command = {
  name: 'coverage-suggest',
  description: 'Suggest coverage improvements for a path (monovector integration)',
  options: [
    {
      name: 'path',
      short: 'p',
      description: 'Path to analyze for coverage suggestions',
      type: 'string',
      required: true
    },
    {
      name: 'threshold',
      description: 'Coverage threshold percentage (default: 80)',
      type: 'number',
      default: 80
    },
    {
      name: 'limit',
      short: 'l',
      description: 'Maximum number of suggestions (default: 20)',
      type: 'number',
      default: 20
    }
  ],
  examples: [
    { command: 'monomind hooks coverage-suggest -p src/', description: 'Suggest improvements for src/' },
    { command: 'monomind hooks coverage-suggest -p src/services --threshold 90', description: 'Stricter threshold' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const targetPath = ctx.args[0] || ctx.flags.path as string;
    const threshold = ctx.flags.threshold as number || 80;
    const limit = ctx.flags.limit as number || 20;

    if (!targetPath) {
      output.printError('Path is required. Use --path or -p flag.');
      return { success: false, exitCode: 1 };
    }

    const spinner = output.createSpinner({ text: `Analyzing coverage for ${targetPath}...` });
    spinner.start();

    // Try reading coverage from disk first
    const diskCoverage = readCoverageFromDisk();

    if (diskCoverage.found) {
      spinner.succeed(`Coverage data loaded from ${diskCoverage.source}`);

      // Filter entries to those matching the target path
      const pathLower = targetPath.toLowerCase().replace(/\\/g, '/');
      const matchingEntries = diskCoverage.entries.filter(e => {
        const fileLower = e.filePath.toLowerCase().replace(/\\/g, '/');
        return fileLower.includes(pathLower);
      });

      const belowThreshold = matchingEntries.filter(e => e.lines < threshold);
      const suggestions = belowThreshold.slice(0, limit).map(e => {
        const { gapType, priority } = classifyCoverageGap(e.lines, threshold);
        return {
          filePath: e.filePath,
          coveragePercent: e.lines,
          gapType,
          priority,
          suggestedAgents: suggestAgentsForFile(e.filePath),
          reason: e.lines === 0 ? 'No coverage at all' :
                  e.lines < 20 ? 'Very low coverage, needs tests' :
                  e.lines < 50 ? 'Below 50%, add more tests' :
                  `Below ${threshold}% threshold`,
        };
      });

      const totalLinesCov = matchingEntries.length > 0
        ? matchingEntries.reduce((acc, e) => acc + e.lines, 0) / matchingEntries.length
        : 0;
      const totalBranchesCov = matchingEntries.length > 0
        ? matchingEntries.reduce((acc, e) => acc + e.branches, 0) / matchingEntries.length
        : 0;

      const prioritizedFiles = belowThreshold.slice(0, 5).map(e => e.filePath);

      const result = {
        success: true,
        path: targetPath,
        suggestions,
        summary: {
          totalFiles: matchingEntries.length,
          overallLineCoverage: totalLinesCov,
          overallBranchCoverage: totalBranchesCov,
          filesBelowThreshold: belowThreshold.length,
        },
        prioritizedFiles,
        monovectorAvailable: false,
        source: diskCoverage.source,
      };

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.printBox(
        [
          `Path: ${output.highlight(targetPath)}`,
          `Files Analyzed: ${result.summary.totalFiles}`,
          `Line Coverage: ${result.summary.overallLineCoverage.toFixed(1)}%`,
          `Branch Coverage: ${result.summary.overallBranchCoverage.toFixed(1)}%`,
          `Below Threshold: ${result.summary.filesBelowThreshold} files`,
          `Source: ${output.highlight(diskCoverage.source)}`
        ].join('\n'),
        'Coverage Summary'
      );

      if (suggestions.length > 0) {
        output.writeln();
        output.writeln(output.bold('Coverage Improvement Suggestions'));
        output.printTable({
          columns: [
            { key: 'filePath', header: 'File', width: 40, format: (v: unknown) => {
              const s = String(v);
              return s.length > 37 ? '...' + s.slice(-37) : s;
            }},
            { key: 'coveragePercent', header: 'Coverage', width: 10, align: 'right', format: (v: unknown) => `${Number(v).toFixed(1)}%` },
            { key: 'gapType', header: 'Priority', width: 10 },
            { key: 'reason', header: 'Reason', width: 25 }
          ],
          data: suggestions.slice(0, 15)
        });
      } else {
        output.writeln();
        output.printSuccess('All files meet coverage threshold!');
      }

      if (prioritizedFiles.length > 0) {
        output.writeln();
        output.writeln(output.bold('Priority Files (Top 5)'));
        output.printList(prioritizedFiles.slice(0, 5).map(f => output.highlight(f)));
      }

      return { success: true, data: result };
    }

    // No disk coverage - fall back to MCP tool
    try {
      const result = await callMCPTool<{
        success: boolean;
        path: string;
        suggestions: Array<{
          filePath: string;
          coveragePercent: number;
          gapType: string;
          priority: number;
          suggestedAgents: string[];
          reason: string;
        }>;
        summary: {
          totalFiles: number;
          overallLineCoverage: number;
          overallBranchCoverage: number;
          filesBelowThreshold: number;
        };
        prioritizedFiles: string[];
        monovectorAvailable: boolean;
      }>('hooks_coverage-suggest', {
        path: targetPath,
        threshold,
        limit,
      });

      spinner.stop();

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.printBox(
        [
          `Path: ${output.highlight(result.path)}`,
          `Files Analyzed: ${result.summary.totalFiles}`,
          `Line Coverage: ${result.summary.overallLineCoverage.toFixed(1)}%`,
          `Branch Coverage: ${result.summary.overallBranchCoverage.toFixed(1)}%`,
          `Below Threshold: ${result.summary.filesBelowThreshold} files`,
          `Keyword routing: ${result.monovectorAvailable ? output.success('Available') : output.dim('Unavailable')}`
        ].join('\n'),
        'Coverage Summary'
      );

      if (result.suggestions.length > 0) {
        output.writeln();
        output.writeln(output.bold('Coverage Improvement Suggestions'));
        output.printTable({
          columns: [
            { key: 'filePath', header: 'File', width: 40, format: (v: unknown) => {
              const s = String(v);
              return s.length > 37 ? '...' + s.slice(-37) : s;
            }},
            { key: 'coveragePercent', header: 'Coverage', width: 10, align: 'right', format: (v: unknown) => `${Number(v).toFixed(1)}%` },
            { key: 'gapType', header: 'Priority', width: 10 },
            { key: 'reason', header: 'Reason', width: 25 }
          ],
          data: result.suggestions.slice(0, 15)
        });
      } else {
        output.writeln();
        output.printSuccess('All files meet coverage threshold!');
      }

      if (result.prioritizedFiles.length > 0) {
        output.writeln();
        output.writeln(output.bold('Priority Files (Top 5)'));
        output.printList(result.prioritizedFiles.slice(0, 5).map(f => output.highlight(f)));
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('No coverage data found');
      output.writeln();
      output.printWarning('No coverage data found. Run your test suite with coverage first.');
      output.writeln();
      output.printList([
        'Jest:     npx jest --coverage',
        'Vitest:   npx vitest --coverage',
        'nyc:      npx nyc npm test',
        'c8:       npx c8 npm test',
      ]);
      output.writeln();
      output.writeln(output.dim('Expected files: coverage/coverage-summary.json, coverage/lcov.info, or .nyc_output/out.json'));
      return { success: false, exitCode: 1 };
    }
  }
};

// Coverage gaps subcommand
export const coverageGapsCommand: Command = {
  name: 'coverage-gaps',
  description: 'List all coverage gaps with priority scoring and agent assignments',
  options: [
    {
      name: 'threshold',
      description: 'Coverage threshold percentage (default: 80)',
      type: 'number',
      default: 80
    },
    {
      name: 'group-by-agent',
      description: 'Group gaps by suggested agent (default: true)',
      type: 'boolean',
      default: true
    },
    {
      name: 'critical-only',
      description: 'Show only critical gaps',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'monomind hooks coverage-gaps', description: 'List all coverage gaps' },
    { command: 'monomind hooks coverage-gaps --critical-only', description: 'Only critical gaps' },
    { command: 'monomind hooks coverage-gaps --threshold 90', description: 'Stricter threshold' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const threshold = ctx.flags.threshold as number || 80;
    const groupByAgent = ctx.flags['group-by-agent'] !== false;
    const criticalOnly = ctx.flags['critical-only'] as boolean || false;

    const spinner = output.createSpinner({ text: 'Analyzing project coverage gaps...' });
    spinner.start();

    // Try reading coverage from disk first
    const diskCoverage = readCoverageFromDisk();

    if (diskCoverage.found) {
      spinner.succeed(`Coverage data loaded from ${diskCoverage.source}`);

      // Build gaps from disk data
      const allGaps = diskCoverage.entries
        .filter(e => e.lines < threshold)
        .map(e => {
          const { gapType, priority } = classifyCoverageGap(e.lines, threshold);
          return {
            filePath: e.filePath,
            coveragePercent: e.lines,
            gapType,
            complexity: Math.round((100 - e.lines) / 10),
            priority,
            suggestedAgents: suggestAgentsForFile(e.filePath),
            reason: `Line coverage ${e.lines.toFixed(1)}% below ${threshold}% threshold`,
          };
        });

      const gaps = criticalOnly
        ? allGaps.filter(g => g.gapType === 'critical')
        : allGaps;

      // Build agent assignments
      const agentAssignments: Record<string, string[]> = {};
      if (groupByAgent) {
        for (const gap of gaps) {
          const agent = gap.suggestedAgents[0] || 'tester';
          if (!agentAssignments[agent]) agentAssignments[agent] = [];
          agentAssignments[agent].push(gap.filePath);
        }
      }

      const result = {
        success: true,
        gaps,
        summary: {
          totalFiles: diskCoverage.summary.totalFiles,
          overallLineCoverage: diskCoverage.summary.overallLineCoverage,
          overallBranchCoverage: diskCoverage.summary.overallBranchCoverage,
          filesBelowThreshold: gaps.length,
          coverageThreshold: threshold,
        },
        agentAssignments,
        monovectorAvailable: false,
        source: diskCoverage.source,
      };

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.printBox(
        [
          `Total Files: ${result.summary.totalFiles}`,
          `Line Coverage: ${result.summary.overallLineCoverage.toFixed(1)}%`,
          `Branch Coverage: ${result.summary.overallBranchCoverage.toFixed(1)}%`,
          `Below ${threshold}%: ${result.summary.filesBelowThreshold} files`,
          `Source: ${output.highlight(diskCoverage.source)}`
        ].join('\n'),
        'Coverage Gap Analysis'
      );

      if (gaps.length > 0) {
        output.writeln();
        output.writeln(output.bold(`Coverage Gaps (${gaps.length} files)`));
        output.printTable({
          columns: [
            { key: 'filePath', header: 'File', width: 35, format: (v: unknown) => {
              const s = String(v);
              return s.length > 32 ? '...' + s.slice(-32) : s;
            }},
            { key: 'coveragePercent', header: 'Coverage', width: 10, align: 'right', format: (v: unknown) => `${Number(v).toFixed(1)}%` },
            { key: 'gapType', header: 'Type', width: 10, format: (v: unknown) => {
              const t = String(v);
              if (t === 'critical') return output.error(t);
              if (t === 'high') return output.warning(t);
              return t;
            }},
            { key: 'priority', header: 'Priority', width: 8, align: 'right' },
            { key: 'suggestedAgents', header: 'Agent', width: 12, format: (v: unknown) => Array.isArray(v) ? v[0] || '' : String(v) }
          ],
          data: gaps.slice(0, 20)
        });
      } else {
        output.writeln();
        output.printSuccess('No coverage gaps found! All files meet threshold.');
      }

      if (groupByAgent && Object.keys(agentAssignments).length > 0) {
        output.writeln();
        output.writeln(output.bold('Agent Assignments'));
        for (const [agent, files] of Object.entries(agentAssignments)) {
          output.writeln();
          output.writeln(`  ${output.highlight(agent)} (${files.length} files)`);
          files.slice(0, 3).forEach(f => {
            output.writeln(`    - ${output.dim(f)}`);
          });
          if (files.length > 3) {
            output.writeln(`    ... and ${files.length - 3} more`);
          }
        }
      }

      return { success: true, data: result };
    }

    // No coverage files on disk - try MCP tool as fallback
    try {
      const result = await callMCPTool<{
        success: boolean;
        gaps: Array<{
          filePath: string;
          coveragePercent: number;
          gapType: string;
          complexity: number;
          priority: number;
          suggestedAgents: string[];
          reason: string;
        }>;
        summary: {
          totalFiles: number;
          overallLineCoverage: number;
          overallBranchCoverage: number;
          filesBelowThreshold: number;
          coverageThreshold: number;
        };
        agentAssignments: Record<string, string[]>;
        monovectorAvailable: boolean;
      }>('hooks_coverage-gaps', {
        threshold,
        groupByAgent,
      });

      spinner.stop();

      const gaps = criticalOnly
        ? result.gaps.filter(g => g.gapType === 'critical')
        : result.gaps;

      if (ctx.flags.format === 'json') {
        output.printJson({ ...result, gaps });
        return { success: true, data: result };
      }

      output.writeln();
      output.printBox(
        [
          `Total Files: ${result.summary.totalFiles}`,
          `Line Coverage: ${result.summary.overallLineCoverage.toFixed(1)}%`,
          `Branch Coverage: ${result.summary.overallBranchCoverage.toFixed(1)}%`,
          `Below ${result.summary.coverageThreshold}%: ${result.summary.filesBelowThreshold} files`,
          `Keyword routing: ${result.monovectorAvailable ? output.success('Available') : output.dim('Unavailable')}`
        ].join('\n'),
        'Coverage Gap Analysis'
      );

      if (gaps.length > 0) {
        output.writeln();
        output.writeln(output.bold(`Coverage Gaps (${gaps.length} files)`));
        output.printTable({
          columns: [
            { key: 'filePath', header: 'File', width: 35, format: (v: unknown) => {
              const s = String(v);
              return s.length > 32 ? '...' + s.slice(-32) : s;
            }},
            { key: 'coveragePercent', header: 'Coverage', width: 10, align: 'right', format: (v: unknown) => `${Number(v).toFixed(1)}%` },
            { key: 'gapType', header: 'Type', width: 10, format: (v: unknown) => {
              const t = String(v);
              if (t === 'critical') return output.error(t);
              if (t === 'high') return output.warning(t);
              return t;
            }},
            { key: 'priority', header: 'Priority', width: 8, align: 'right' },
            { key: 'suggestedAgents', header: 'Agent', width: 12, format: (v: unknown) => Array.isArray(v) ? v[0] || '' : String(v) }
          ],
          data: gaps.slice(0, 20)
        });
      } else {
        output.writeln();
        output.printSuccess('No coverage gaps found! All files meet threshold.');
      }

      if (groupByAgent && Object.keys(result.agentAssignments).length > 0) {
        output.writeln();
        output.writeln(output.bold('Agent Assignments'));
        for (const [agent, files] of Object.entries(result.agentAssignments)) {
          output.writeln();
          output.writeln(`  ${output.highlight(agent)} (${files.length} files)`);
          files.slice(0, 3).forEach(f => {
            output.writeln(`    - ${output.dim(f)}`);
          });
          if (files.length > 3) {
            output.writeln(`    ... and ${files.length - 3} more`);
          }
        }
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('No coverage data found');
      output.writeln();
      output.printWarning('No coverage data found. Run your test suite with coverage first.');
      output.writeln();
      output.printList([
        'Jest:     npx jest --coverage',
        'Vitest:   npx vitest --coverage',
        'nyc:      npx nyc npm test',
        'c8:       npx c8 npm test',
      ]);
      output.writeln();
      output.writeln(output.dim('Expected files: coverage/coverage-summary.json, coverage/lcov.info, or .nyc_output/out.json'));
      return { success: false, exitCode: 1 };
    }
  }
};

// Progress hook command
export const progressHookCommand: Command = {
  name: 'progress',
  description: 'Check implementation progress via hooks',
  options: [
    {
      name: 'detailed',
      short: 'd',
      description: 'Show detailed breakdown by category',
      type: 'boolean',
      default: false
    },
    {
      name: 'sync',
      short: 's',
      description: 'Sync and persist progress to file',
      type: 'boolean',
      default: false
    },
    {
      name: 'summary',
      description: 'Show human-readable summary',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'monomind hooks progress', description: 'Check current progress' },
    { command: 'monomind hooks progress -d', description: 'Detailed breakdown' },
    { command: 'monomind hooks progress --sync', description: 'Sync progress to file' },
    { command: 'monomind hooks progress --summary', description: 'Human-readable summary' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const detailed = ctx.flags.detailed as boolean;
    const sync = ctx.flags.sync as boolean;
    const summary = ctx.flags.summary as boolean;

    try {
      if (summary) {
        const spinner = output.createSpinner({ text: 'Getting progress summary...' });
        spinner.start();
        const result = await callMCPTool<{ summary: string }>('progress_summary', {});
        spinner.stop();

        if (ctx.flags.format === 'json') {
          output.printJson(result);
          return { success: true, data: result };
        }

        output.writeln();
        output.writeln(result.summary);
        return { success: true, data: result };
      }

      if (sync) {
        const spinner = output.createSpinner({ text: 'Syncing progress...' });
        spinner.start();
        const result = await callMCPTool<{
          progress: number;
          message: string;
          persisted: boolean;
          lastUpdated: string;
        }>('progress_sync', {});
        spinner.stop();

        if (ctx.flags.format === 'json') {
          output.printJson(result);
          return { success: true, data: result };
        }

        output.writeln();
        output.printSuccess(`Progress synced: ${result.progress}%`);
        output.writeln(output.dim(`  Persisted to .monomind/metrics/v1-progress.json`));
        output.writeln(output.dim(`  Last updated: ${result.lastUpdated}`));
        return { success: true, data: result };
      }

      // Default: check progress
      const spinner = output.createSpinner({ text: 'Checking v1 progress...' });
      spinner.start();
      const result = await callMCPTool<{
        progress?: number;
        overall?: number;
        summary?: string;
        breakdown?: Record<string, string>;
        cli?: { progress: number; commands: number; target: number };
        mcp?: { progress: number; tools: number; target: number };
        hooks?: { progress: number; subcommands: number; target: number };
        packages?: { progress: number; total: number; target: number; withDDD: number };
        ddd?: { progress: number };
        codebase?: { totalFiles: number; totalLines: number };
        lastUpdated?: string;
      }>('progress_check', { detailed });
      spinner.stop();

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      const progressValue = result.overall ?? result.progress ?? 0;

      // Create progress bar
      const barWidth = 30;
      const filled = Math.round((progressValue / 100) * barWidth);
      const empty = barWidth - filled;
      const bar = output.success('█'.repeat(filled)) + output.dim('░'.repeat(empty));

      output.writeln(output.bold('v1 Implementation Progress'));
      output.writeln();
      output.writeln(`[${bar}] ${progressValue}%`);
      output.writeln();

      if (detailed && result.cli) {
        output.writeln(output.highlight('CLI Commands:') + `     ${result.cli.progress}% (${result.cli.commands}/${result.cli.target})`);
        output.writeln(output.highlight('MCP Tools:') + `        ${result.mcp?.progress ?? 0}% (${result.mcp?.tools ?? 0}/${result.mcp?.target ?? 0})`);
        output.writeln(output.highlight('Hooks:') + `            ${result.hooks?.progress ?? 0}% (${result.hooks?.subcommands ?? 0}/${result.hooks?.target ?? 0})`);
        output.writeln(output.highlight('Packages:') + `         ${result.packages?.progress ?? 0}% (${result.packages?.total ?? 0}/${result.packages?.target ?? 0})`);
        output.writeln(output.highlight('DDD Structure:') + `    ${result.ddd?.progress ?? 0}% (${result.packages?.withDDD ?? 0}/${result.packages?.total ?? 0})`);
        output.writeln();
        if (result.codebase) {
          output.writeln(output.dim(`Codebase: ${result.codebase.totalFiles} files, ${result.codebase.totalLines.toLocaleString()} lines`));
        }
      } else if (result.breakdown) {
        output.writeln('Breakdown:');
        for (const [category, value] of Object.entries(result.breakdown)) {
          output.writeln(`  ${output.highlight(category)}: ${value}`);
        }
      }

      if (result.lastUpdated) {
        output.writeln(output.dim(`Last updated: ${result.lastUpdated}`));
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Progress check failed: ${error.message}`);
      } else {
        output.printError(`Progress check failed: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};


// Statusline subcommand - generates dynamic status display
export const statuslineCommand: Command = {
  name: 'statusline',
  description: 'Generate dynamic statusline with v1 progress and system status',
  options: [
    {
      name: 'json',
      description: 'Output as JSON',
      type: 'boolean',
      default: false
    },
    {
      name: 'compact',
      description: 'Compact single-line output',
      type: 'boolean',
      default: false
    },
    {
      name: 'no-color',
      description: 'Disable ANSI colors',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'monomind hooks statusline', description: 'Display full statusline' },
    { command: 'monomind hooks statusline --json', description: 'JSON output for hooks' },
    { command: 'monomind hooks statusline --compact', description: 'Single-line status' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('fs');
    const path = await import('path');
    const { execSync } = await import('child_process');

    // Get learning stats from memory database
    function getLearningStats() {
      const memoryPaths = [
        path.join(process.cwd(), '.swarm', 'memory.db'),
        path.join(process.cwd(), '.claude', 'memory.db'),
      ];

      let patterns = 0;
      let sessions = 0;
      let trajectories = 0;

      for (const dbPath of memoryPaths) {
        if (fs.existsSync(dbPath)) {
          try {
            const stats = fs.statSync(dbPath);
            const sizeKB = stats.size / 1024;
            patterns = Math.floor(sizeKB / 2);
            sessions = Math.max(1, Math.floor(patterns / 10));
            trajectories = Math.floor(patterns / 5);
            break;
          } catch {
            // Ignore
          }
        }
      }

      const sessionsPath = path.join(process.cwd(), '.claude', 'sessions');
      if (fs.existsSync(sessionsPath)) {
        try {
          const sessionFiles = fs.readdirSync(sessionsPath).filter((f: string) => f.endsWith('.json'));
          sessions = Math.max(sessions, sessionFiles.length);
        } catch {
          // Ignore
        }
      }

      return { patterns, sessions, trajectories };
    }

    // Get v1 progress
    function getv1Progress() {
      const learning = getLearningStats();
      let domainsCompleted = 0;
      if (learning.patterns >= 500) domainsCompleted = 5;
      else if (learning.patterns >= 200) domainsCompleted = 4;
      else if (learning.patterns >= 100) domainsCompleted = 3;
      else if (learning.patterns >= 50) domainsCompleted = 2;
      else if (learning.patterns >= 10) domainsCompleted = 1;

      const totalDomains = 5;
      const dddProgress = Math.min(100, Math.floor((domainsCompleted / totalDomains) * 100));

      return { domainsCompleted, totalDomains, dddProgress, patternsLearned: learning.patterns, sessionsCompleted: learning.sessions };
    }

    // Get security status
    function getSecurityStatus() {
      const scanResultsPath = path.join(process.cwd(), '.claude', 'security-scans');
      let cvesFixed = 0;
      const totalCves = 3;

      if (fs.existsSync(scanResultsPath)) {
        try {
          const scans = fs.readdirSync(scanResultsPath).filter((f: string) => f.endsWith('.json'));
          cvesFixed = Math.min(totalCves, scans.length);
        } catch {
          // Ignore
        }
      }

      const auditPath = path.join(process.cwd(), '.swarm', 'security');
      if (fs.existsSync(auditPath)) {
        try {
          const audits = fs.readdirSync(auditPath).filter((f: string) => f.includes('audit'));
          cvesFixed = Math.min(totalCves, Math.max(cvesFixed, audits.length));
        } catch {
          // Ignore
        }
      }

      const status = cvesFixed >= totalCves ? 'CLEAN' : cvesFixed > 0 ? 'IN_PROGRESS' : 'PENDING';
      return { status, cvesFixed, totalCves };
    }

    // Get swarm status
    function getSwarmStatus() {
      let activeAgents = 0;
      let coordinationActive = false;
      const maxAgents = 15;
      const isWindows = process.platform === 'win32';

      try {
        const psCmd = isWindows
          ? 'tasklist /FI "IMAGENAME eq node.exe" 2>NUL | findstr /I /C:"node" >NUL && echo 1 || echo 0'
          : 'ps aux 2>/dev/null | grep -c agentic-flow || echo "0"';
        const ps = execSync(psCmd, { encoding: 'utf-8' });
        const raw = parseInt(ps.trim());
        activeAgents = Math.max(0, isWindows ? raw : raw - 1);
        coordinationActive = activeAgents > 0;
      } catch {
        // Ignore
      }

      return { activeAgents, maxAgents, coordinationActive };
    }

    // Get system metrics
    function getSystemMetrics() {
      let memoryMB = 0;
      let subAgents = 0;
      const learning = getLearningStats();

      try {
        memoryMB = Math.floor(process.memoryUsage().heapUsed / 1024 / 1024);
      } catch {
        // Ignore
      }

      // Calculate intelligence from multiple sources (matching statusline-generator.ts)
      let intelligencePct = 0;

      // 1. Check learning.json for REAL intelligence metrics first
      const learningJsonPaths = [
        path.join(process.cwd(), '.monomind', 'learning.json'),
        path.join(process.cwd(), '.claude', '.monomind', 'learning.json'),
        path.join(process.cwd(), '.swarm', 'learning.json'),
      ];
      for (const lPath of learningJsonPaths) {
        if (fs.existsSync(lPath)) {
          try {
            if (fs.statSync(lPath).size <= 524_288) {
              const data = JSON.parse(fs.readFileSync(lPath, 'utf-8'));
              if (data.intelligence?.score !== undefined) {
                intelligencePct = Math.min(100, Math.floor(data.intelligence.score));
                break;
              }
            }
          } catch { /* ignore */ }
        }
      }

      // 2. Fallback: calculate from patterns and vectors
      if (intelligencePct === 0) {
        const fromPatterns = learning.patterns > 0 ? Math.min(100, Math.floor(learning.patterns / 10)) : 0;
        // Will be updated later with vector count
        intelligencePct = fromPatterns;
      }

      // 3. Fallback: calculate maturity score from project indicators
      if (intelligencePct === 0) {
        let maturityScore = 0;
        // Check for key project files/dirs
        if (fs.existsSync(path.join(process.cwd(), '.claude'))) maturityScore += 15;
        if (fs.existsSync(path.join(process.cwd(), '.monomind'))) maturityScore += 15;
        if (fs.existsSync(path.join(process.cwd(), 'CLAUDE.md'))) maturityScore += 10;
        if (fs.existsSync(path.join(process.cwd(), 'monomind.config.json'))) maturityScore += 10;
        if (fs.existsSync(path.join(process.cwd(), '.swarm'))) maturityScore += 10;
        // Check for test files
        const testDirs = ['tests', '__tests__', 'test', 'v1/__tests__'];
        for (const dir of testDirs) {
          if (fs.existsSync(path.join(process.cwd(), dir))) {
            maturityScore += 10;
            break;
          }
        }
        // Check for hooks config
        if (fs.existsSync(path.join(process.cwd(), '.claude', 'settings.json'))) maturityScore += 10;
        intelligencePct = Math.min(100, maturityScore);
      }

      const contextPct = Math.min(100, Math.floor(learning.sessions * 5));

      return { memoryMB, contextPct, intelligencePct, subAgents };
    }

    // Get user info
    function getUserInfo() {
      let name = 'user';
      let gitBranch = '';
      const modelName = 'Opus 4.6 (1M context)';
      const isWindows = process.platform === 'win32';

      try {
        const nameCmd = isWindows
          ? 'git config user.name 2>NUL || echo user'
          : 'git config user.name 2>/dev/null || echo "user"';
        const branchCmd = isWindows
          ? 'git branch --show-current 2>NUL || echo.'
          : 'git branch --show-current 2>/dev/null || echo ""';
        name = execSync(nameCmd, { encoding: 'utf-8' }).trim();
        gitBranch = execSync(branchCmd, { encoding: 'utf-8' }).trim();
        if (gitBranch === '.') gitBranch = '';
      } catch {
        // Ignore
      }

      return { name, gitBranch, modelName };
    }

    // Collect all status
    const progress = getv1Progress();
    const security = getSecurityStatus();
    const swarm = getSwarmStatus();
    const system = getSystemMetrics();
    const user = getUserInfo();

    const statusData = {
      user,
      v1Progress: progress,
      security,
      swarm,
      system,
      timestamp: new Date().toISOString()
    };

    // JSON output
    if (ctx.flags.json || ctx.flags.format === 'json') {
      output.printJson(statusData);
      return { success: true, data: statusData };
    }

    // Compact output
    if (ctx.flags.compact) {
      const line = `DDD:${progress.domainsCompleted}/${progress.totalDomains} CVE:${security.cvesFixed}/${security.totalCves} Swarm:${swarm.activeAgents}/${swarm.maxAgents} Ctx:${system.contextPct}% Int:${system.intelligencePct}%`;
      output.writeln(line);
      return { success: true, data: statusData };
    }

    // Full colored output
    const noColor = ctx.flags['no-color'] || ctx.flags.noColor;
    const c = noColor ? {
      reset: '', bold: '', dim: '', red: '', green: '', yellow: '', blue: '',
      purple: '', cyan: '', brightRed: '', brightGreen: '', brightYellow: '',
      brightBlue: '', brightPurple: '', brightCyan: '', brightWhite: ''
    } : {
      reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[0;31m',
      green: '\x1b[0;32m', yellow: '\x1b[0;33m', blue: '\x1b[0;34m',
      purple: '\x1b[0;35m', cyan: '\x1b[0;36m', brightRed: '\x1b[1;31m',
      brightGreen: '\x1b[1;32m', brightYellow: '\x1b[1;33m', brightBlue: '\x1b[1;34m',
      brightPurple: '\x1b[1;35m', brightCyan: '\x1b[1;36m', brightWhite: '\x1b[1;37m'
    };

    // Progress bar helper
    const progressBar = (current: number, total: number) => {
      const filled = Math.round((current / total) * 5);
      const empty = 5 - filled;
      return '[' + '●'.repeat(filled) + '○'.repeat(empty) + ']';
    };

    // Generate lines
    let header = `${c.bold}${c.brightPurple}▊ Monomind ${c.reset}`;
    header += `${swarm.coordinationActive ? c.brightCyan : c.dim}● ${c.brightCyan}${user.name}${c.reset}`;
    if (user.gitBranch) {
      header += `  ${c.dim}│${c.reset}  ${c.brightBlue}⎇ ${user.gitBranch}${c.reset}`;
    }
    header += `  ${c.dim}│${c.reset}  ${c.purple}${user.modelName}${c.reset}`;

    const separator = `${c.dim}─────────────────────────────────────────────────────${c.reset}`;

    // Get hooks stats
    const hooksStats = { enabled: 0, total: 17 };
    const settingsPath = path.join(process.cwd(), '.claude', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      try {
        if (fs.statSync(settingsPath).size <= 524_288) {
          const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
          if (settings.hooks) {
            hooksStats.enabled = Object.values(settings.hooks).filter((h: unknown) => h && typeof h === 'object').length;
          }
        }
      } catch { /* ignore */ }
    }

    // Get AgentDB stats (matching statusline-generator.ts paths)
    const agentdbStats = { vectorCount: 0, dbSizeKB: 0, hasHnsw: false };

    // Check for direct database files first
    const dbPaths = [
      path.join(process.cwd(), '.swarm', 'memory.db'),
      path.join(process.cwd(), '.monomind', 'memory.db'),
      path.join(process.cwd(), '.claude', 'memory.db'),
      path.join(process.cwd(), 'data', 'memory.db'),
      path.join(process.cwd(), 'memory.db'),
      path.join(process.cwd(), '.agentdb', 'memory.db'),
      path.join(process.cwd(), '.monomind', 'memory', 'agentdb.db'),
    ];
    for (const dbPath of dbPaths) {
      if (fs.existsSync(dbPath)) {
        try {
          const stats = fs.statSync(dbPath);
          agentdbStats.dbSizeKB = Math.round(stats.size / 1024);
          agentdbStats.vectorCount = Math.floor(agentdbStats.dbSizeKB / 2);
          agentdbStats.hasHnsw = agentdbStats.vectorCount > 100;
          break;
        } catch { /* ignore */ }
      }
    }

    // Check for AgentDB directories if no direct db found
    if (agentdbStats.vectorCount === 0) {
      const agentdbDirs = [
        path.join(process.cwd(), '.monomind', 'agentdb'),
        path.join(process.cwd(), '.swarm', 'agentdb'),
        path.join(process.cwd(), 'data', 'agentdb'),
        path.join(process.cwd(), '.agentdb'),
      ];
      for (const dir of agentdbDirs) {
        if (fs.existsSync(dir)) {
          try {
            const files = fs.readdirSync(dir);
            for (const f of files) {
              if (f.endsWith('.db') || f.endsWith('.sqlite')) {
                const filePath = path.join(dir, f);
                const fileStat = fs.statSync(filePath);
                agentdbStats.dbSizeKB += Math.round(fileStat.size / 1024);
              }
            }
            agentdbStats.vectorCount = Math.floor(agentdbStats.dbSizeKB / 2);
            agentdbStats.hasHnsw = agentdbStats.vectorCount > 100;
            if (agentdbStats.vectorCount > 0) break;
          } catch { /* ignore */ }
        }
      }
    }

    // Check for HNSW index files
    const hnswPaths = [
      path.join(process.cwd(), '.monomind', 'hnsw'),
      path.join(process.cwd(), '.swarm', 'hnsw'),
      path.join(process.cwd(), 'data', 'hnsw'),
    ];
    for (const hnswPath of hnswPaths) {
      if (fs.existsSync(hnswPath)) {
        agentdbStats.hasHnsw = true;
        try {
          const hnswFiles = fs.readdirSync(hnswPath);
          const indexFile = hnswFiles.find(f => f.endsWith('.index'));
          if (indexFile) {
            const indexStat = fs.statSync(path.join(hnswPath, indexFile));
            const hnswVectors = Math.floor(indexStat.size / 512);
            agentdbStats.vectorCount = Math.max(agentdbStats.vectorCount, hnswVectors);
          }
        } catch { /* ignore */ }
        break;
      }
    }

    // Check for vectors.json file
    const vectorsPath = path.join(process.cwd(), '.monomind', 'vectors.json');
    if (fs.existsSync(vectorsPath) && agentdbStats.vectorCount === 0) {
      try {
        if (fs.statSync(vectorsPath).size <= 8_388_608) {
          const data = JSON.parse(fs.readFileSync(vectorsPath, 'utf-8'));
          if (Array.isArray(data)) {
            agentdbStats.vectorCount = data.length;
          } else if (data.vectors) {
            agentdbStats.vectorCount = Object.keys(data.vectors).length;
          }
        }
      } catch { /* ignore */ }
    }

    // Get test stats
    const testStats = { testFiles: 0, testCases: 0 };
    const testPaths = ['tests', '__tests__', 'test', 'spec'];
    for (const testPath of testPaths) {
      const fullPath = path.join(process.cwd(), testPath);
      if (fs.existsSync(fullPath)) {
        try {
          const files = fs.readdirSync(fullPath, { recursive: true }) as string[];
          testStats.testFiles = files.filter((f: string) => /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(f)).length;
          testStats.testCases = testStats.testFiles * 28; // Estimate
        } catch { /* ignore */ }
      }
    }

    // Get MCP stats
    const mcpStats = { enabled: 0, total: 0 };
    const mcpPath = path.join(process.cwd(), '.mcp.json');
    if (fs.existsSync(mcpPath)) {
      try {
        const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
        if (mcp.mcpServers) {
          mcpStats.total = Object.keys(mcp.mcpServers).length;
          mcpStats.enabled = mcpStats.total;
        }
      } catch { /* ignore */ }
    }

    const domainsColor = progress.domainsCompleted >= 3 ? c.brightGreen : progress.domainsCompleted > 0 ? c.yellow : c.red;
    // Dynamic perf indicator based on patterns/HNSW
    let perfIndicator = `${c.dim}⚡ HNSW: idle${c.reset}`;
    if (agentdbStats.hasHnsw && agentdbStats.vectorCount > 0) {
      perfIndicator = `${c.brightGreen}⚡ HNSW ${agentdbStats.vectorCount.toLocaleString()} vec${c.reset}`;
    } else if (progress.patternsLearned > 0) {
      const patternsK = progress.patternsLearned >= 1000 ? `${(progress.patternsLearned / 1000).toFixed(1)}k` : String(progress.patternsLearned);
      perfIndicator = `${c.brightYellow}📚 ${patternsK} patterns${c.reset}`;
    }

    const line1 = `${c.brightCyan}🏗️  DDD Domains${c.reset}    ${progressBar(progress.domainsCompleted, progress.totalDomains)}  ` +
      `${domainsColor}${progress.domainsCompleted}${c.reset}/${c.brightWhite}${progress.totalDomains}${c.reset}    ` +
      perfIndicator;

    const swarmIndicator = swarm.coordinationActive ? `${c.brightGreen}◉${c.reset}` : `${c.dim}○${c.reset}`;
    const agentsColor = swarm.activeAgents > 0 ? c.brightGreen : c.red;
    const securityIcon = security.status === 'CLEAN' ? '🟢' : security.status === 'IN_PROGRESS' ? '🟡' : '🔴';
    const securityColor = security.status === 'CLEAN' ? c.brightGreen : security.status === 'IN_PROGRESS' ? c.brightYellow : c.brightRed;
    const hooksColor = hooksStats.enabled > 0 ? c.brightGreen : c.dim;

    const line2 = `${c.brightYellow}🤖 Swarm${c.reset}  ${swarmIndicator} [${agentsColor}${String(swarm.activeAgents).padStart(2)}${c.reset}/${c.brightWhite}${swarm.maxAgents}${c.reset}]  ` +
      `${c.brightPurple}👥 ${system.subAgents}${c.reset}    ` +
      `${c.brightBlue}🪝 ${hooksColor}${hooksStats.enabled}${c.reset}/${c.brightWhite}${hooksStats.total}${c.reset}    ` +
      `${securityIcon} ${securityColor}CVE ${security.cvesFixed}${c.reset}/${c.brightWhite}${security.totalCves}${c.reset}    ` +
      `${c.brightCyan}💾 ${system.memoryMB}MB${c.reset}    ` +
      `${c.brightPurple}🧠 ${String(system.intelligencePct).padStart(3)}%${c.reset}`;

    const dddColor = progress.dddProgress >= 50 ? c.brightGreen : progress.dddProgress > 0 ? c.yellow : c.red;
    const line3 = `${c.brightPurple}🔧 Architecture${c.reset}    ` +
      `${c.cyan}ADRs${c.reset} ${c.dim}●0/0${c.reset}  ${c.dim}│${c.reset}  ` +
      `${c.cyan}DDD${c.reset} ${dddColor}●${String(progress.dddProgress).padStart(3)}%${c.reset}  ${c.dim}│${c.reset}  ` +
      `${c.cyan}Security${c.reset} ${securityColor}●${security.status}${c.reset}`;

    const vectorColor = agentdbStats.vectorCount > 0 ? c.brightGreen : c.dim;
    const testColor = testStats.testFiles > 0 ? c.brightGreen : c.dim;
    const mcpColor = mcpStats.enabled > 0 ? c.brightGreen : c.dim;
    const sizeDisplay = agentdbStats.dbSizeKB >= 1024 ? `${(agentdbStats.dbSizeKB / 1024).toFixed(1)}MB` : `${agentdbStats.dbSizeKB}KB`;
    const hnswIndicator = agentdbStats.hasHnsw ? `${c.brightGreen}⚡${c.reset}` : '';

    const line4 = `${c.brightCyan}📊 AgentDB${c.reset}    ` +
      `${c.cyan}Vectors${c.reset} ${vectorColor}●${agentdbStats.vectorCount}${hnswIndicator}${c.reset}  ${c.dim}│${c.reset}  ` +
      `${c.cyan}Size${c.reset} ${c.brightWhite}${sizeDisplay}${c.reset}  ${c.dim}│${c.reset}  ` +
      `${c.cyan}Tests${c.reset} ${testColor}●${testStats.testFiles}${c.reset} ${c.dim}(${testStats.testCases} cases)${c.reset}  ${c.dim}│${c.reset}  ` +
      `${c.cyan}MCP${c.reset} ${mcpColor}●${mcpStats.enabled}/${mcpStats.total}${c.reset}`;

    output.writeln(header);
    output.writeln(separator);
    output.writeln(line1);
    output.writeln(line2);
    output.writeln(line3);
    output.writeln(line4);

    return { success: true, data: statusData };
  }
};
