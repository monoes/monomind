/**
 * Analyze dependencies and circular subcommands
 * Full dependency graph building and circular dependency detection
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { resolve } from 'path';
import { getGraphAnalyzer, safeWriteOutputFile } from './analyze.js';

/**
 * Build and export dependency graph
 */
export const dependenciesCommand: Command = {
  name: 'dependencies',
  aliases: ['graph'],
  description: 'Build and export full dependency graph',
  options: [
    {
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string',
    },
    {
      name: 'format',
      short: 'f',
      description: 'Output format (text, json, dot)',
      type: 'string',
      default: 'text',
      choices: ['text', 'json', 'dot'],
    },
    {
      name: 'include',
      short: 'i',
      description: 'File extensions to include (comma-separated)',
      type: 'string',
      default: '.ts,.tsx,.js,.jsx,.mjs,.cjs',
    },
    {
      name: 'exclude',
      short: 'e',
      description: 'Patterns to exclude (comma-separated)',
      type: 'string',
      default: 'node_modules,dist,build,.git',
    },
    {
      name: 'depth',
      short: 'd',
      description: 'Maximum directory depth',
      type: 'number',
      default: 10,
    },
  ],
  examples: [
    { command: 'monomind analyze dependencies src/', description: 'Build dependency graph' },
    { command: 'monomind analyze dependencies -f dot -o deps.dot src/', description: 'Export to DOT' },
    { command: 'monomind analyze dependencies -i .ts,.tsx src/', description: 'Only TypeScript files' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const targetDir = ctx.args[0] || ctx.cwd;
    const outputFile = ctx.flags.output as string | undefined;
    const format = (ctx.flags.format as string) || 'text';
    const include = ((ctx.flags.include as string) || '.ts,.tsx,.js,.jsx,.mjs,.cjs').split(',');
    const exclude = ((ctx.flags.exclude as string) || 'node_modules,dist,build,.git').split(',');
    const rawDepth = (ctx.flags.depth as number) || 10;
    const maxDepth = Number.isFinite(rawDepth) ? Math.max(1, Math.min(rawDepth, 50)) : 10;

    output.printInfo(`Building dependency graph for: ${output.highlight(targetDir)}`);
    output.writeln();

    const spinner = output.createSpinner({ text: 'Scanning files...', spinner: 'dots' });
    spinner.start();

    try {
      const analyzer = await getGraphAnalyzer();
      if (!analyzer) {
        spinner.stop();
        output.printError('Graph analyzer module not available');
        return { success: false, exitCode: 1 };
      }

      const graph = await analyzer.buildDependencyGraph(resolve(targetDir), {
        include,
        exclude,
        maxDepth,
      });

      spinner.stop();

      // Detect circular dependencies
      const circularDeps = analyzer.detectCircularDependencies(graph);

      // Handle different output formats
      if (format === 'json') {
        const jsonOutput = {
          nodes: Array.from(graph.nodes.values()),
          edges: graph.edges,
          metadata: graph.metadata,
          circularDependencies: circularDeps,
        };

        if (outputFile) {
          await safeWriteOutputFile(outputFile, JSON.stringify(jsonOutput, null, 2));
          output.printSuccess(`Graph written to ${outputFile}`);
        } else {
          output.printJson(jsonOutput);
        }

        return { success: true, data: jsonOutput };
      }

      if (format === 'dot') {
        const result = { graph, circularDependencies: circularDeps, statistics: {
          nodeCount: graph.nodes.size,
          edgeCount: graph.edges.length,
          avgDegree: 0,
          maxDegree: 0,
          density: 0,
          componentCount: 0,
        }};

        const dotOutput = analyzer.exportToDot(result, {
          includeLabels: true,
          highlightCycles: true,
        });

        if (outputFile) {
          await safeWriteOutputFile(outputFile, dotOutput);
          output.printSuccess(`DOT graph written to ${outputFile}`);
          output.writeln(output.dim('Visualize with: dot -Tpng -o deps.png ' + outputFile));
        } else {
          output.writeln(dotOutput);
        }

        return { success: true };
      }

      // Text format (default)
      output.printBox(
        [
          `Files: ${graph.metadata.totalFiles}`,
          `Dependencies: ${graph.metadata.totalEdges}`,
          `Build time: ${graph.metadata.buildTime}ms`,
          `Root: ${graph.metadata.rootDir}`,
        ].join('\n'),
        'Dependency Graph'
      );

      // Show top files by imports
      output.writeln();
      output.writeln(output.bold('Most Connected Files'));
      output.writeln();

      const nodesByDegree = Array.from(graph.nodes.values())
        .map((n: any) => ({
          ...n,
          degree: graph.edges.filter((e: any) => e.source === n.id || e.target === n.id).length,
        }))
        .sort((a, b) => b.degree - a.degree)
        .slice(0, 10);

      output.printTable({
        columns: [
          { key: 'path', header: 'File', width: 50 },
          { key: 'degree', header: 'Connections', width: 12, align: 'right' },
          { key: 'complexity', header: 'Complexity', width: 12, align: 'right' },
        ],
        data: nodesByDegree.map(n => ({
          path: n.path.length > 48 ? '...' + n.path.slice(-45) : n.path,
          degree: n.degree,
          complexity: n.complexity || 0,
        })),
      });

      // Show circular dependencies
      if (circularDeps.length > 0) {
        output.writeln();
        output.writeln(output.bold(output.warning(`Circular Dependencies: ${circularDeps.length}`)));
        output.writeln();

        for (const cycle of circularDeps.slice(0, 3)) {
          output.writeln(`  ${cycle.cycle.join(' -> ')}`);
        }
        if (circularDeps.length > 3) {
          output.writeln(output.dim(`  ... and ${circularDeps.length - 3} more`));
        }
      }

      if (outputFile) {
        const fullOutput = {
          nodes: Array.from(graph.nodes.values()),
          edges: graph.edges,
          metadata: graph.metadata,
          circularDependencies: circularDeps,
        };
        await safeWriteOutputFile(outputFile, JSON.stringify(fullOutput, null, 2));
        output.printSuccess(`Full results written to ${outputFile}`);
      }

      return { success: true };
    } catch (error) {
      spinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      output.printError(`Analysis failed: ${message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

/**
 * Detect circular dependencies
 */
export const circularCommand: Command = {
  name: 'circular',
  aliases: ['cycles'],
  description: 'Detect circular dependencies in codebase',
  options: [
    {
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string',
    },
    {
      name: 'format',
      short: 'f',
      description: 'Output format (text, json)',
      type: 'string',
      default: 'text',
      choices: ['text', 'json'],
    },
    {
      name: 'severity',
      short: 's',
      description: 'Minimum severity to show (low, medium, high)',
      type: 'string',
      default: 'low',
      choices: ['low', 'medium', 'high'],
    },
  ],
  examples: [
    { command: 'monomind analyze circular src/', description: 'Find circular dependencies' },
    { command: 'monomind analyze circular -s high src/', description: 'Only high severity cycles' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const targetDir = ctx.args[0] || ctx.cwd;
    const outputFile = ctx.flags.output as string | undefined;
    const format = (ctx.flags.format as string) || 'text';
    const minSeverity = (ctx.flags.severity as string) || 'low';

    output.printInfo(`Detecting circular dependencies in: ${output.highlight(targetDir)}`);
    output.writeln();

    const spinner = output.createSpinner({ text: 'Analyzing dependencies...', spinner: 'dots' });
    spinner.start();

    try {
      const analyzer = await getGraphAnalyzer();
      if (!analyzer) {
        spinner.stop();
        output.printError('Graph analyzer module not available');
        return { success: false, exitCode: 1 };
      }

      const graph = await analyzer.buildDependencyGraph(resolve(targetDir));
      const cycles = analyzer.detectCircularDependencies(graph);

      spinner.stop();

      // Filter by severity
      const severityOrder = { low: 0, medium: 1, high: 2 };
      const minLevel = severityOrder[minSeverity as keyof typeof severityOrder] || 0;
      const filtered = cycles.filter(c => severityOrder[c.severity] >= minLevel);

      if (format === 'json') {
        const jsonOutput = { cycles: filtered, total: cycles.length, filtered: filtered.length };

        if (outputFile) {
          await safeWriteOutputFile(outputFile, JSON.stringify(jsonOutput, null, 2));
          output.printSuccess(`Results written to ${outputFile}`);
        } else {
          output.printJson(jsonOutput);
        }

        return { success: true, data: jsonOutput };
      }

      // Text format
      if (filtered.length === 0) {
        output.printSuccess('No circular dependencies found!');
        return { success: true };
      }

      output.printBox(
        [
          `Total cycles: ${cycles.length}`,
          `Shown (${minSeverity}+): ${filtered.length}`,
          `High severity: ${cycles.filter(c => c.severity === 'high').length}`,
          `Medium severity: ${cycles.filter(c => c.severity === 'medium').length}`,
          `Low severity: ${cycles.filter(c => c.severity === 'low').length}`,
        ].join('\n'),
        'Circular Dependencies'
      );

      output.writeln();

      // Group by severity
      const grouped = {
        high: filtered.filter(c => c.severity === 'high'),
        medium: filtered.filter(c => c.severity === 'medium'),
        low: filtered.filter(c => c.severity === 'low'),
      };

      for (const [severity, items] of Object.entries(grouped)) {
        if (items.length === 0) continue;

        const color = severity === 'high' ? output.error : severity === 'medium' ? output.warning : output.dim;
        output.writeln(color(output.bold(`${severity.toUpperCase()} SEVERITY (${items.length})`)));
        output.writeln();

        for (const cycle of items.slice(0, 5)) {
          output.writeln(`  ${cycle.cycle.join(' -> ')}`);
          output.writeln(output.dim(`  Fix: ${cycle.suggestion}`));
          output.writeln();
        }

        if (items.length > 5) {
          output.writeln(output.dim(`  ... and ${items.length - 5} more ${severity} cycles`));
          output.writeln();
        }
      }

      if (outputFile) {
        await safeWriteOutputFile(outputFile, JSON.stringify({ cycles: filtered }, null, 2));
        output.printSuccess(`Results written to ${outputFile}`);
      }

      return { success: true, data: { cycles: filtered } };
    } catch (error) {
      spinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      output.printError(`Analysis failed: ${message}`);
      return { success: false, exitCode: 1 };
    }
  },
};
