/**
 * Analyze boundaries and modules subcommands
 * MinCut boundary detection and Louvain community detection
 */
import { output } from '../output.js';
import { resolve } from 'path';
import { getGraphAnalyzer, safeWriteOutputFile } from './analyze.js';
/**
 * Analyze code boundaries using MinCut algorithm
 */
export const boundariesCommand = {
    name: 'boundaries',
    aliases: ['boundary', 'mincut'],
    description: 'Find natural code boundaries using MinCut algorithm',
    options: [
        {
            name: 'partitions',
            short: 'p',
            description: 'Number of partitions to find',
            type: 'number',
            default: 2,
        },
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
    ],
    examples: [
        { command: 'monomind analyze boundaries src/', description: 'Find code boundaries in src/' },
        { command: 'monomind analyze boundaries -p 3 src/', description: 'Find 3 partitions' },
        { command: 'monomind analyze boundaries -f dot -o graph.dot src/', description: 'Export to DOT format' },
    ],
    action: async (ctx) => {
        const targetDir = ctx.args[0] || ctx.cwd;
        const rawPartitions = ctx.flags.partitions || 2;
        const numPartitions = Number.isFinite(rawPartitions) ? Math.max(1, Math.min(rawPartitions, 100)) : 2;
        const outputFile = ctx.flags.output;
        const format = ctx.flags.format || 'text';
        output.printInfo(`Analyzing code boundaries in: ${output.highlight(targetDir)}`);
        output.writeln();
        const spinner = output.createSpinner({ text: 'Building dependency graph...', spinner: 'dots' });
        spinner.start();
        try {
            const analyzer = await getGraphAnalyzer();
            if (!analyzer) {
                spinner.stop();
                output.printError('Graph analyzer module not available');
                return { success: false, exitCode: 1 };
            }
            const result = await analyzer.analyzeGraph(resolve(targetDir), {
                includeBoundaries: true,
                includeModules: false,
                numPartitions,
            });
            spinner.stop();
            // Handle different output formats
            if (format === 'json') {
                const jsonOutput = {
                    boundaries: result.boundaries,
                    statistics: result.statistics,
                    circularDependencies: result.circularDependencies,
                };
                if (outputFile) {
                    await safeWriteOutputFile(outputFile, JSON.stringify(jsonOutput, null, 2));
                    output.printSuccess(`Results written to ${outputFile}`);
                }
                else {
                    output.printJson(jsonOutput);
                }
                return { success: true, data: jsonOutput };
            }
            if (format === 'dot') {
                const dotOutput = analyzer.exportToDot(result, {
                    includeLabels: true,
                    highlightCycles: true,
                });
                if (outputFile) {
                    await safeWriteOutputFile(outputFile, dotOutput);
                    output.printSuccess(`DOT graph written to ${outputFile}`);
                    output.writeln(output.dim('Visualize with: dot -Tpng -o graph.png ' + outputFile));
                }
                else {
                    output.writeln(dotOutput);
                }
                return { success: true };
            }
            // Text format (default)
            output.printBox([
                `Files analyzed: ${result.statistics.nodeCount}`,
                `Dependencies: ${result.statistics.edgeCount}`,
                `Avg degree: ${result.statistics.avgDegree.toFixed(2)}`,
                `Density: ${(result.statistics.density * 100).toFixed(2)}%`,
                `Components: ${result.statistics.componentCount}`,
            ].join('\n'), 'Graph Statistics');
            if (result.boundaries && result.boundaries.length > 0) {
                output.writeln();
                output.writeln(output.bold('MinCut Boundaries'));
                output.writeln();
                for (let i = 0; i < result.boundaries.length; i++) {
                    const boundary = result.boundaries[i];
                    output.writeln(output.bold(`Boundary ${i + 1} (cut value: ${boundary.cutValue})`));
                    output.writeln();
                    output.writeln(output.dim('Partition 1:'));
                    const p1Display = boundary.partition1.slice(0, 10);
                    output.printList(p1Display);
                    if (boundary.partition1.length > 10) {
                        output.writeln(output.dim(`  ... and ${boundary.partition1.length - 10} more files`));
                    }
                    output.writeln();
                    output.writeln(output.dim('Partition 2:'));
                    const p2Display = boundary.partition2.slice(0, 10);
                    output.printList(p2Display);
                    if (boundary.partition2.length > 10) {
                        output.writeln(output.dim(`  ... and ${boundary.partition2.length - 10} more files`));
                    }
                    output.writeln();
                    output.writeln(output.success('Suggestion:'));
                    output.writeln(`  ${boundary.suggestion}`);
                    output.writeln();
                }
            }
            // Show circular dependencies
            if (result.circularDependencies.length > 0) {
                output.writeln();
                output.writeln(output.bold(output.warning('Circular Dependencies Detected')));
                output.writeln();
                for (const cycle of result.circularDependencies.slice(0, 5)) {
                    const severityColor = cycle.severity === 'high' ? output.error : cycle.severity === 'medium' ? output.warning : output.dim;
                    output.writeln(`${severityColor(`[${cycle.severity.toUpperCase()}]`)} ${cycle.cycle.join(' -> ')}`);
                    output.writeln(output.dim(`  ${cycle.suggestion}`));
                    output.writeln();
                }
                if (result.circularDependencies.length > 5) {
                    output.writeln(output.dim(`... and ${result.circularDependencies.length - 5} more cycles`));
                }
            }
            if (outputFile) {
                await safeWriteOutputFile(outputFile, JSON.stringify(result, null, 2));
                output.printSuccess(`Full results written to ${outputFile}`);
            }
            return { success: true, data: result };
        }
        catch (error) {
            spinner.stop();
            const message = error instanceof Error ? error.message : String(error);
            output.printError(`Analysis failed: ${message}`);
            return { success: false, exitCode: 1 };
        }
    },
};
/**
 * Analyze modules/communities using Louvain algorithm
 */
export const modulesCommand = {
    name: 'modules',
    aliases: ['communities', 'louvain'],
    description: 'Detect module communities using Louvain algorithm',
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
            name: 'min-size',
            short: 'm',
            description: 'Minimum community size to display',
            type: 'number',
            default: 2,
        },
    ],
    examples: [
        { command: 'monomind analyze modules src/', description: 'Detect module communities' },
        { command: 'monomind analyze modules -f dot -o modules.dot src/', description: 'Export colored DOT graph' },
        { command: 'monomind analyze modules -m 3 src/', description: 'Only show communities with 3+ files' },
    ],
    action: async (ctx) => {
        const targetDir = ctx.args[0] || ctx.cwd;
        const outputFile = ctx.flags.output;
        const format = ctx.flags.format || 'text';
        const minSize = ctx.flags['min-size'] || 2;
        output.printInfo(`Detecting module communities in: ${output.highlight(targetDir)}`);
        output.writeln();
        const spinner = output.createSpinner({ text: 'Building dependency graph...', spinner: 'dots' });
        spinner.start();
        try {
            const analyzer = await getGraphAnalyzer();
            if (!analyzer) {
                spinner.stop();
                output.printError('Graph analyzer module not available');
                return { success: false, exitCode: 1 };
            }
            const result = await analyzer.analyzeGraph(resolve(targetDir), {
                includeBoundaries: false,
                includeModules: true,
            });
            spinner.stop();
            // Filter communities by size
            const communities = result.communities?.filter(c => c.members.length >= minSize) || [];
            // Handle different output formats
            if (format === 'json') {
                const jsonOutput = {
                    communities,
                    statistics: result.statistics,
                };
                if (outputFile) {
                    await safeWriteOutputFile(outputFile, JSON.stringify(jsonOutput, null, 2));
                    output.printSuccess(`Results written to ${outputFile}`);
                }
                else {
                    output.printJson(jsonOutput);
                }
                return { success: true, data: jsonOutput };
            }
            if (format === 'dot') {
                const dotOutput = analyzer.exportToDot(result, {
                    includeLabels: true,
                    colorByCommunity: true,
                    highlightCycles: true,
                });
                if (outputFile) {
                    await safeWriteOutputFile(outputFile, dotOutput);
                    output.printSuccess(`DOT graph written to ${outputFile}`);
                    output.writeln(output.dim('Visualize with: dot -Tpng -o modules.png ' + outputFile));
                }
                else {
                    output.writeln(dotOutput);
                }
                return { success: true };
            }
            // Text format (default)
            output.printBox([
                `Files analyzed: ${result.statistics.nodeCount}`,
                `Dependencies: ${result.statistics.edgeCount}`,
                `Communities found: ${result.communities?.length || 0}`,
                `Showing: ${communities.length} (min size: ${minSize})`,
            ].join('\n'), 'Module Detection Results');
            if (communities.length > 0) {
                output.writeln();
                output.writeln(output.bold('Detected Communities'));
                output.writeln();
                for (const community of communities.slice(0, 10)) {
                    const cohesionIndicator = community.cohesion > 0.5 ? output.success('High') :
                        community.cohesion > 0.2 ? output.warning('Medium') : output.dim('Low');
                    output.writeln(output.bold(`Community ${community.id}: ${community.suggestedName || 'unnamed'}`));
                    output.writeln(`  ${output.dim('Cohesion:')} ${cohesionIndicator} (${(community.cohesion * 100).toFixed(1)}%)`);
                    output.writeln(`  ${output.dim('Central node:')} ${community.centralNode || 'none'}`);
                    output.writeln(`  ${output.dim('Members:')} ${community.members.length} files`);
                    const displayMembers = community.members.slice(0, 5);
                    for (const member of displayMembers) {
                        output.writeln(`    - ${member}`);
                    }
                    if (community.members.length > 5) {
                        output.writeln(output.dim(`    ... and ${community.members.length - 5} more`));
                    }
                    output.writeln();
                }
                if (communities.length > 10) {
                    output.writeln(output.dim(`... and ${communities.length - 10} more communities`));
                }
            }
            if (outputFile) {
                await safeWriteOutputFile(outputFile, JSON.stringify(result, null, 2));
                output.printSuccess(`Full results written to ${outputFile}`);
            }
            return { success: true, data: result };
        }
        catch (error) {
            spinner.stop();
            const message = error instanceof Error ? error.message : String(error);
            output.printError(`Analysis failed: ${message}`);
            return { success: false, exitCode: 1 };
        }
    },
};
//# sourceMappingURL=analyze-boundaries.js.map