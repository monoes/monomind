/**
 * Coverage-aware routing commands: coverage-route, coverage-suggest
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { callMCPTool } from '../mcp-client.js';
import {
  readCoverageFromDisk,
  classifyCoverageGap,
  suggestAgentsForFile,
} from './hooks-coverage-utils.js';

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

    const diskCoverage = readCoverageFromDisk();

    if (diskCoverage.found) {
      spinner.succeed(`Coverage data loaded from ${diskCoverage.source}`);

      const taskLower = task.toLowerCase();
      const taskWords = taskLower.split(/\s+/).filter(w => w.length > 2);

      const scoredFiles = diskCoverage.entries
        .filter(e => e.lines < threshold)
        .map(e => {
          const fileNameLower = e.filePath.toLowerCase();
          let relevance = 0;
          for (const word of taskWords) {
            if (fileNameLower.includes(word)) relevance += 2;
          }
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

    try {
      const result = await callMCPTool<{
        success: boolean;
        task: string;
        coverageAware: boolean;
        gaps: Array<{ filePath: string; coveragePercent: number; gapType: string; priority: number; suggestedAgents: string[]; reason: string }>;
        routing: { primaryAgent: string; confidence: number; reason: string; coverageImpact: string };
        suggestions: string[];
        metrics: { filesAnalyzed: number; totalGaps: number; criticalGaps: number; avgCoverage: number };
      }>('hooks_coverage-route', { task, threshold, useMonovector });

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
    } catch {
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

    const diskCoverage = readCoverageFromDisk();

    if (diskCoverage.found) {
      spinner.succeed(`Coverage data loaded from ${diskCoverage.source}`);

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

    try {
      const result = await callMCPTool<{
        success: boolean;
        path: string;
        suggestions: Array<{ filePath: string; coveragePercent: number; gapType: string; priority: number; suggestedAgents: string[]; reason: string }>;
        summary: { totalFiles: number; overallLineCoverage: number; overallBranchCoverage: number; filesBelowThreshold: number };
        prioritizedFiles: string[];
        monovectorAvailable: boolean;
      }>('hooks_coverage-suggest', { path: targetPath, threshold, limit });

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
    } catch {
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
