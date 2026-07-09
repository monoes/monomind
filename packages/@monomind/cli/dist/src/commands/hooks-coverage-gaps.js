/**
 * Coverage gaps hook commands
 */
import { output } from '../output.js';
import { callMCPTool } from '../mcp-client.js';
import { readCoverageFromDisk, classifyCoverageGap, suggestAgentsForFile, } from './hooks-coverage-utils.js';
export const coverageGapsCommand = {
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
    action: async (ctx) => {
        const threshold = ctx.flags.threshold || 80;
        const groupByAgent = ctx.flags['group-by-agent'] !== false;
        const criticalOnly = ctx.flags['critical-only'] || false;
        const spinner = output.createSpinner({ text: 'Analyzing project coverage gaps...' });
        spinner.start();
        const diskCoverage = readCoverageFromDisk();
        if (diskCoverage.found) {
            spinner.succeed(`Coverage data loaded from ${diskCoverage.source}`);
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
            const agentAssignments = {};
            if (groupByAgent) {
                for (const gap of gaps) {
                    const agent = gap.suggestedAgents[0] || 'tester';
                    if (!agentAssignments[agent])
                        agentAssignments[agent] = [];
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
            output.printBox([
                `Total Files: ${result.summary.totalFiles}`,
                `Line Coverage: ${result.summary.overallLineCoverage.toFixed(1)}%`,
                `Branch Coverage: ${result.summary.overallBranchCoverage.toFixed(1)}%`,
                `Below ${threshold}%: ${result.summary.filesBelowThreshold} files`,
                `Source: ${output.highlight(diskCoverage.source)}`
            ].join('\n'), 'Coverage Gap Analysis');
            if (gaps.length > 0) {
                output.writeln();
                output.writeln(output.bold(`Coverage Gaps (${gaps.length} files)`));
                output.printTable({
                    columns: [
                        { key: 'filePath', header: 'File', width: 35, format: (v) => {
                                const s = String(v);
                                return s.length > 32 ? '...' + s.slice(-32) : s;
                            } },
                        { key: 'coveragePercent', header: 'Coverage', width: 10, align: 'right', format: (v) => `${Number(v).toFixed(1)}%` },
                        { key: 'gapType', header: 'Type', width: 10, format: (v) => {
                                const t = String(v);
                                if (t === 'critical')
                                    return output.error(t);
                                if (t === 'high')
                                    return output.warning(t);
                                return t;
                            } },
                        { key: 'priority', header: 'Priority', width: 8, align: 'right' },
                        { key: 'suggestedAgents', header: 'Agent', width: 12, format: (v) => Array.isArray(v) ? v[0] || '' : String(v) }
                    ],
                    data: gaps.slice(0, 20)
                });
            }
            else {
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
        try {
            const result = await callMCPTool('coverage_gaps', { threshold, groupByAgent });
            spinner.stop();
            const gaps = criticalOnly
                ? result.gaps.filter(g => g.gapType === 'critical')
                : result.gaps;
            if (ctx.flags.format === 'json') {
                output.printJson({ ...result, gaps });
                return { success: true, data: result };
            }
            output.writeln();
            output.printBox([
                `Total Files: ${result.summary.totalFiles}`,
                `Line Coverage: ${result.summary.overallLineCoverage.toFixed(1)}%`,
                `Branch Coverage: ${result.summary.overallBranchCoverage.toFixed(1)}%`,
                `Below ${result.summary.coverageThreshold}%: ${result.summary.filesBelowThreshold} files`,
                `Keyword routing: ${result.monovectorAvailable ? output.success('Available') : output.dim('Unavailable')}`
            ].join('\n'), 'Coverage Gap Analysis');
            if (gaps.length > 0) {
                output.writeln();
                output.writeln(output.bold(`Coverage Gaps (${gaps.length} files)`));
                output.printTable({
                    columns: [
                        { key: 'filePath', header: 'File', width: 35, format: (v) => {
                                const s = String(v);
                                return s.length > 32 ? '...' + s.slice(-32) : s;
                            } },
                        { key: 'coveragePercent', header: 'Coverage', width: 10, align: 'right', format: (v) => `${Number(v).toFixed(1)}%` },
                        { key: 'gapType', header: 'Type', width: 10, format: (v) => {
                                const t = String(v);
                                if (t === 'critical')
                                    return output.error(t);
                                if (t === 'high')
                                    return output.warning(t);
                                return t;
                            } },
                        { key: 'priority', header: 'Priority', width: 8, align: 'right' },
                        { key: 'suggestedAgents', header: 'Agent', width: 12, format: (v) => Array.isArray(v) ? v[0] || '' : String(v) }
                    ],
                    data: gaps.slice(0, 20)
                });
            }
            else {
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
        }
        catch {
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
//# sourceMappingURL=hooks-coverage-gaps.js.map