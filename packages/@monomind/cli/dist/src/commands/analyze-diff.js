/**
 * Analyze diff and code subcommands
 * Handles git diff risk assessment and static code quality analysis
 */
import { output } from '../output.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { resolve } from 'path';
import { scanSourceFiles } from './analyze.js';
function getRiskDisplay(risk) {
    switch (risk) {
        case 'critical':
            return output.color(output.bold('CRITICAL'), 'bgRed', 'white');
        case 'high-risk':
            return output.error('HIGH');
        case 'medium-risk':
            return output.warning('MEDIUM');
        case 'low-risk':
            return output.success('LOW');
        default:
            return risk;
    }
}
function getStatusDisplay(status) {
    switch (status) {
        case 'added':
            return output.success('A');
        case 'modified':
            return output.warning('M');
        case 'deleted':
            return output.error('D');
        case 'renamed':
            return output.info('R');
        default:
            return status;
    }
}
// Diff subcommand
export const diffCommand = {
    name: 'diff',
    description: 'Analyze git diff for change risk assessment and classification',
    options: [
        {
            name: 'risk',
            short: 'r',
            description: 'Show risk assessment',
            type: 'boolean',
            default: false,
        },
        {
            name: 'classify',
            short: 'c',
            description: 'Classify change type',
            type: 'boolean',
            default: false,
        },
        {
            name: 'reviewers',
            description: 'Show recommended reviewers',
            type: 'boolean',
            default: false,
        },
        {
            name: 'format',
            short: 'f',
            description: 'Output format: text, json, table',
            type: 'string',
            default: 'text',
            choices: ['text', 'json', 'table'],
        },
        {
            name: 'verbose',
            short: 'v',
            description: 'Show detailed file-level analysis',
            type: 'boolean',
            default: false,
        },
    ],
    examples: [
        { command: 'monomind analyze diff --risk', description: 'Analyze current diff with risk assessment' },
        { command: 'monomind analyze diff HEAD~1 --classify', description: 'Classify changes from last commit' },
        { command: 'monomind analyze diff main..feature --format json', description: 'Compare branches with JSON output' },
        { command: 'monomind analyze diff --reviewers', description: 'Get recommended reviewers for changes' },
    ],
    action: async (ctx) => {
        const ref = ctx.args[0] || 'HEAD';
        const showRisk = ctx.flags.risk;
        const showClassify = ctx.flags.classify;
        const showReviewers = ctx.flags.reviewers;
        const formatType = ctx.flags.format || 'text';
        const verbose = ctx.flags.verbose;
        // If no specific flag, show all
        const showAll = !showRisk && !showClassify && !showReviewers;
        output.printInfo(`Analyzing diff: ${output.highlight(ref)}`);
        try {
            // Call MCP tool for diff analysis
            const result = await callMCPTool('analyze_diff', {
                ref,
                includeFileRisks: verbose,
                includeReviewers: showReviewers || showAll,
            });
            // JSON output
            if (formatType === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            output.writeln();
            // Summary box
            const files = result.files || [];
            const risk = result.risk || { overall: 'unknown', score: 0, breakdown: { fileCount: 0, totalChanges: 0, highRiskFiles: [], securityConcerns: [], breakingChanges: [], testCoverage: 'unknown' } };
            const classification = result.classification || { category: 'unknown', confidence: 0, reasoning: '' };
            output.printBox([
                `Ref: ${result.ref || 'HEAD'}`,
                `Files: ${files.length}`,
                `Risk: ${getRiskDisplay(risk.overall)} (${risk.score}/100)`,
                `Type: ${classification.category}${classification.subcategory ? ` (${classification.subcategory})` : ''}`,
                ``,
                result.summary || 'No summary available',
            ].join('\n'), 'Diff Analysis');
            // Risk assessment
            if (showRisk || showAll) {
                output.writeln();
                output.writeln(output.bold('Risk Assessment'));
                output.writeln(output.dim('-'.repeat(50)));
                output.printTable({
                    columns: [
                        { key: 'metric', header: 'Metric', width: 25 },
                        { key: 'value', header: 'Value', width: 30 },
                    ],
                    data: [
                        { metric: 'Overall Risk', value: getRiskDisplay(risk.overall) },
                        { metric: 'Risk Score', value: `${risk.score}/100` },
                        { metric: 'Files Changed', value: risk.breakdown.fileCount },
                        { metric: 'Total Lines Changed', value: risk.breakdown.totalChanges },
                        { metric: 'Test Coverage', value: risk.breakdown.testCoverage },
                    ],
                });
                // Security concerns
                if (risk.breakdown.securityConcerns.length > 0) {
                    output.writeln();
                    output.writeln(output.bold(output.warning('Security Concerns')));
                    output.printList(risk.breakdown.securityConcerns.map(c => output.warning(c)));
                }
                // Breaking changes
                if (risk.breakdown.breakingChanges.length > 0) {
                    output.writeln();
                    output.writeln(output.bold(output.error('Potential Breaking Changes')));
                    output.printList(risk.breakdown.breakingChanges.map(c => output.error(c)));
                }
                // High risk files
                if (risk.breakdown.highRiskFiles.length > 0) {
                    output.writeln();
                    output.writeln(output.bold('High Risk Files'));
                    output.printList(risk.breakdown.highRiskFiles.map(f => output.warning(f)));
                }
            }
            // Classification
            if (showClassify || showAll) {
                output.writeln();
                output.writeln(output.bold('Classification'));
                output.writeln(output.dim('-'.repeat(50)));
                output.printTable({
                    columns: [
                        { key: 'field', header: 'Field', width: 15 },
                        { key: 'value', header: 'Value', width: 40 },
                    ],
                    data: [
                        { field: 'Category', value: classification.category },
                        { field: 'Subcategory', value: classification.subcategory || '-' },
                        { field: 'Confidence', value: `${(classification.confidence * 100).toFixed(0)}%` },
                    ],
                });
                output.writeln();
                output.writeln(output.dim(`Reasoning: ${classification.reasoning}`));
            }
            // Reviewers
            if (showReviewers || showAll) {
                output.writeln();
                output.writeln(output.bold('Recommended Reviewers'));
                output.writeln(output.dim('-'.repeat(50)));
                const reviewers = result.recommendedReviewers || [];
                if (reviewers.length > 0) {
                    output.printNumberedList(reviewers.map(r => output.highlight(r)));
                }
                else {
                    output.writeln(output.dim('No specific reviewers recommended'));
                }
            }
            // Verbose file-level details
            if (verbose && result.fileRisks) {
                output.writeln();
                output.writeln(output.bold('File-Level Analysis'));
                output.writeln(output.dim('-'.repeat(50)));
                output.printTable({
                    columns: [
                        { key: 'path', header: 'File', width: 40 },
                        { key: 'risk', header: 'Risk', width: 12, format: (v) => getRiskDisplay(String(v)) },
                        { key: 'score', header: 'Score', width: 8, align: 'right' },
                        { key: 'reasons', header: 'Reasons', width: 30, format: (v) => {
                                const reasons = v;
                                return reasons.slice(0, 2).join('; ');
                            } },
                    ],
                    data: result.fileRisks,
                });
            }
            // Files changed table
            if (formatType === 'table' || showAll) {
                output.writeln();
                output.writeln(output.bold('Files Changed'));
                output.writeln(output.dim('-'.repeat(50)));
                output.printTable({
                    columns: [
                        { key: 'status', header: 'Status', width: 10, format: (v) => getStatusDisplay(String(v)) },
                        { key: 'path', header: 'File', width: 45 },
                        { key: 'additions', header: '+', width: 8, align: 'right', format: (v) => output.success(`+${v}`) },
                        { key: 'deletions', header: '-', width: 8, align: 'right', format: (v) => output.error(`-${v}`) },
                    ],
                    data: files.slice(0, 20),
                });
                if (files.length > 20) {
                    output.writeln(output.dim(`  ... and ${files.length - 20} more files`));
                }
            }
            return { success: true, data: result };
        }
        catch (error) {
            if (error instanceof MCPClientError) {
                output.printError(`Diff analysis failed: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    },
};
// Code subcommand (placeholder for future code analysis)
export const codeCommand = {
    name: 'code',
    description: 'Static code analysis and quality assessment',
    options: [
        { name: 'path', short: 'p', type: 'string', description: 'Path to analyze', default: '.' },
        { name: 'type', short: 't', type: 'string', description: 'Analysis type: quality, complexity, security', default: 'quality' },
        { name: 'format', short: 'f', type: 'string', description: 'Output format: text, json', default: 'text' },
    ],
    examples: [
        { command: 'monomind analyze code -p ./src', description: 'Analyze source directory' },
        { command: 'monomind analyze code --type complexity', description: 'Run complexity analysis' },
    ],
    action: async (ctx) => {
        const targetPath = resolve(ctx.flags.path || '.');
        const analysisType = ctx.flags.type || 'quality';
        const formatJson = ctx.flags.format === 'json';
        output.writeln();
        output.writeln(output.bold('Code Analysis'));
        output.writeln(output.dim('-'.repeat(50)));
        const spinner = output.createSpinner({ text: `Analyzing ${targetPath}...`, spinner: 'dots' });
        spinner.start();
        try {
            const files = await scanSourceFiles(targetPath);
            if (files.length === 0) {
                spinner.stop();
                output.printWarning('No source files found');
                return { success: true };
            }
            const fileStats = [];
            for (const filePath of files) {
                const content = await fs.readFile(filePath, 'utf-8');
                const lines = content.split('\n');
                const nonEmpty = lines.filter(l => l.trim().length > 0 && !/^\s*(\/\/|\/\*|\*\s|#)/.test(l)).length;
                const todos = (content.match(/\b(TODO|FIXME|HACK|XXX)\b/gi) || []).length;
                const fns = (content.match(/(?:export\s+)?(?:async\s+)?function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g) || []).length;
                const imps = (content.match(/^import\s+/gm) || []).length + (content.match(/require\s*\(/g) || []).length;
                let maxNesting = 0;
                let nesting = 0;
                for (const line of lines) {
                    nesting += (line.match(/\{/g) || []).length;
                    nesting -= (line.match(/\}/g) || []).length;
                    if (nesting > maxNesting)
                        maxNesting = nesting;
                }
                const securityIssues = [];
                if (/\beval\s*\(/.test(content))
                    securityIssues.push('eval()');
                if (/\bexec\s*\(/.test(content))
                    securityIssues.push('exec()');
                if (/\.innerHTML\s*=/.test(content))
                    securityIssues.push('innerHTML');
                if (/dangerouslySetInnerHTML/.test(content))
                    securityIssues.push('dangerouslySetInnerHTML');
                if (/['"](?:password|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"]{3,}['"]/i.test(content))
                    securityIssues.push('hardcoded secret');
                if (/new\s+Function\s*\(/.test(content))
                    securityIssues.push('new Function()');
                fileStats.push({
                    file: filePath,
                    loc: nonEmpty,
                    todos,
                    functions: fns,
                    imports: imps,
                    maxNesting,
                    securityIssues,
                });
            }
            spinner.stop();
            const totalLoc = fileStats.reduce((s, f) => s + f.loc, 0);
            const totalTodos = fileStats.reduce((s, f) => s + f.todos, 0);
            const totalFunctions = fileStats.reduce((s, f) => s + f.functions, 0);
            const totalImports = fileStats.reduce((s, f) => s + f.imports, 0);
            const avgFileSize = Math.round(totalLoc / files.length);
            const longestFile = fileStats.reduce((a, b) => a.loc > b.loc ? a : b);
            const avgFnPerFile = (totalFunctions / files.length).toFixed(1);
            const deepestNesting = fileStats.reduce((a, b) => a.maxNesting > b.maxNesting ? a : b);
            const allSecurityIssues = fileStats.filter(f => f.securityIssues.length > 0);
            if (formatJson) {
                const jsonData = { type: analysisType, path: targetPath, files: files.length, totalLoc, totalTodos, totalFunctions, totalImports, avgFileSize, fileStats: fileStats.map(f => ({ relativePath: path.relative(targetPath, f.file), loc: f.loc, todos: f.todos, functions: f.functions, imports: f.imports, maxNesting: f.maxNesting, securityIssues: f.securityIssues })) };
                output.printJson(jsonData);
                return { success: true, data: jsonData };
            }
            if (analysisType === 'quality') {
                output.printBox([`Files: ${files.length}`, `Lines of Code: ${totalLoc.toLocaleString()}`, `Avg File Size: ${avgFileSize} LOC`, `TODO/FIXME: ${totalTodos}`, `Functions: ${totalFunctions}`, `Imports: ${totalImports}`].join('\n'), 'Quality Summary');
                output.writeln();
                output.writeln(output.bold('Largest Files'));
                output.writeln(output.dim('-'.repeat(60)));
                const top10 = [...fileStats].sort((a, b) => b.loc - a.loc).slice(0, 10);
                output.printTable({
                    columns: [
                        { key: 'file', header: 'File', width: 45 },
                        { key: 'loc', header: 'LOC', width: 8, align: 'right' },
                        { key: 'fns', header: 'Fns', width: 6, align: 'right' },
                        { key: 'todos', header: 'TODOs', width: 7, align: 'right' },
                    ],
                    data: top10.map(f => ({ file: path.relative(targetPath, f.file), loc: f.loc, fns: f.functions, todos: f.todos })),
                });
                if (totalTodos > 0) {
                    output.writeln();
                    output.printWarning(`${totalTodos} TODO/FIXME comments found across ${fileStats.filter(f => f.todos > 0).length} files`);
                }
            }
            else if (analysisType === 'complexity') {
                output.printBox([`Files: ${files.length}`, `Total Functions: ${totalFunctions}`, `Avg Functions/File: ${avgFnPerFile}`, `Deepest Nesting: ${deepestNesting.maxNesting} levels (${path.relative(targetPath, deepestNesting.file)})`, `Longest File: ${longestFile.loc} LOC (${path.relative(targetPath, longestFile.file)})`].join('\n'), 'Complexity Summary');
                output.writeln();
                output.writeln(output.bold('High Complexity Files (nesting > 5)'));
                output.writeln(output.dim('-'.repeat(60)));
                const complex = fileStats.filter(f => f.maxNesting > 5).sort((a, b) => b.maxNesting - a.maxNesting);
                if (complex.length === 0) {
                    output.printSuccess('No files with excessive nesting detected');
                }
                else {
                    output.printTable({
                        columns: [
                            { key: 'file', header: 'File', width: 45 },
                            { key: 'nesting', header: 'Max Nest', width: 10, align: 'right' },
                            { key: 'fns', header: 'Fns', width: 6, align: 'right' },
                            { key: 'loc', header: 'LOC', width: 8, align: 'right' },
                        ],
                        data: complex.slice(0, 15).map(f => ({ file: path.relative(targetPath, f.file), nesting: f.maxNesting, fns: f.functions, loc: f.loc })),
                    });
                }
            }
            else if (analysisType === 'security') {
                output.printBox([`Files Scanned: ${files.length}`, `Files with Issues: ${allSecurityIssues.length}`, `Total Issues: ${allSecurityIssues.reduce((s, f) => s + f.securityIssues.length, 0)}`].join('\n'), 'Security Summary');
                if (allSecurityIssues.length === 0) {
                    output.writeln();
                    output.printSuccess('No common security patterns detected');
                }
                else {
                    output.writeln();
                    output.writeln(output.bold('Security Concerns'));
                    output.writeln(output.dim('-'.repeat(60)));
                    output.printTable({
                        columns: [
                            { key: 'file', header: 'File', width: 40 },
                            { key: 'issues', header: 'Issues', width: 35 },
                        ],
                        data: allSecurityIssues.map(f => ({ file: path.relative(targetPath, f.file), issues: f.securityIssues.join(', ') })),
                    });
                }
            }
            else {
                output.printWarning(`Unknown analysis type: ${analysisType}. Use quality, complexity, or security.`);
            }
            return { success: true };
        }
        catch (error) {
            spinner.stop();
            const message = error instanceof Error ? error.message : String(error);
            output.printError(`Code analysis failed: ${message}`);
            return { success: false, exitCode: 1 };
        }
    },
};
//# sourceMappingURL=analyze-diff.js.map