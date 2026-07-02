/**
 * Analyze AST subcommand
 * AST-based code analysis using monovector tree-sitter with regex fallback
 */
import { output } from '../output.js';
import * as fs from 'fs/promises';
import { resolve } from 'path';
import { getASTAnalyzer, safeWriteOutputFile, scanSourceFiles, fallbackAnalyze } from './analyze.js';
/**
 * Helper: Truncate file path for display
 */
export function truncatePathAst(filePath, maxLen = 45) {
    if (filePath.length <= maxLen)
        return filePath;
    return '...' + filePath.slice(-(maxLen - 3));
}
/**
 * Helper: Format complexity value with color coding
 */
export function formatComplexityValueAst(value) {
    if (value <= 5)
        return output.success(String(value));
    if (value <= 10)
        return output.warning(String(value));
    return output.error(String(value));
}
/**
 * Helper: Get type marker for symbols
 */
export function getTypeMarkerAst(type) {
    switch (type) {
        case 'function': return output.success('fn');
        case 'class': return output.info('class');
        case 'variable': return output.dim('var');
        case 'type': return output.highlight('type');
        case 'interface': return output.highlight('iface');
        default: return output.dim(type.slice(0, 5));
    }
}
/**
 * Helper: Get complexity rating text
 */
export function getComplexityRatingAst(value) {
    if (value <= 5)
        return output.success('Simple');
    if (value <= 10)
        return output.warning('Moderate');
    if (value <= 20)
        return output.error('Complex');
    return output.error(output.bold('Very Complex'));
}
/**
 * AST analysis subcommand
 */
export const astCommand = {
    name: 'ast',
    description: 'Analyze code using AST parsing (tree-sitter via monovector)',
    options: [
        {
            name: 'complexity',
            short: 'c',
            description: 'Include complexity metrics',
            type: 'boolean',
            default: false,
        },
        {
            name: 'symbols',
            short: 's',
            description: 'Include symbol extraction',
            type: 'boolean',
            default: false,
        },
        {
            name: 'format',
            short: 'f',
            description: 'Output format (text, json, table)',
            type: 'string',
            default: 'text',
            choices: ['text', 'json', 'table'],
        },
        {
            name: 'output',
            short: 'o',
            description: 'Output file path',
            type: 'string',
        },
        {
            name: 'verbose',
            short: 'v',
            description: 'Show detailed analysis',
            type: 'boolean',
            default: false,
        },
    ],
    examples: [
        { command: 'monomind analyze ast src/', description: 'Analyze all files in src/' },
        { command: 'monomind analyze ast src/index.ts --complexity', description: 'Analyze with complexity' },
        { command: 'monomind analyze ast . --format json', description: 'JSON output' },
        { command: 'monomind analyze ast src/ --symbols', description: 'Extract symbols' },
    ],
    action: async (ctx) => {
        const targetPath = ctx.args[0] || ctx.cwd;
        const showComplexity = ctx.flags.complexity;
        const showSymbols = ctx.flags.symbols;
        const formatType = ctx.flags.format || 'text';
        const outputFile = ctx.flags.output;
        const verbose = ctx.flags.verbose;
        // If no specific flags, show summary
        const showAll = !showComplexity && !showSymbols;
        output.printInfo(`Analyzing: ${output.highlight(targetPath)}`);
        output.writeln();
        const spinner = output.createSpinner({ text: 'Parsing AST...', spinner: 'dots' });
        spinner.start();
        try {
            const astModule = await getASTAnalyzer();
            if (!astModule) {
                spinner.stop();
                output.printWarning('AST analyzer not available, using regex fallback');
            }
            // Resolve path and check if file or directory
            const resolvedPath = resolve(targetPath);
            const stat = await fs.stat(resolvedPath);
            const isDirectory = stat.isDirectory();
            let results = [];
            if (isDirectory) {
                // Scan directory for source files
                const files = await scanSourceFiles(resolvedPath);
                spinner.stop();
                output.printInfo(`Found ${files.length} source files`);
                spinner.start();
                for (const file of files.slice(0, 100)) {
                    try {
                        const content = await fs.readFile(file, 'utf-8');
                        if (astModule) {
                            const analyzer = astModule.createASTAnalyzer();
                            const analysis = analyzer.analyze(content, file);
                            results.push(analysis);
                        }
                        else {
                            // Fallback analysis
                            results.push(fallbackAnalyze(content, file));
                        }
                    }
                    catch {
                        // Skip files that can't be analyzed
                    }
                }
            }
            else {
                // Single file
                const content = await fs.readFile(resolvedPath, 'utf-8');
                if (astModule) {
                    const analyzer = astModule.createASTAnalyzer();
                    const analysis = analyzer.analyze(content, resolvedPath);
                    results.push(analysis);
                }
                else {
                    results.push(fallbackAnalyze(content, resolvedPath));
                }
            }
            spinner.stop();
            if (results.length === 0) {
                output.printWarning('No files analyzed');
                return { success: true };
            }
            // Calculate totals
            const totals = {
                files: results.length,
                functions: results.reduce((sum, r) => sum + r.functions.length, 0),
                classes: results.reduce((sum, r) => sum + r.classes.length, 0),
                imports: results.reduce((sum, r) => sum + r.imports.length, 0),
                avgComplexity: results.reduce((sum, r) => sum + r.complexity.cyclomatic, 0) / results.length,
                totalLoc: results.reduce((sum, r) => sum + r.complexity.loc, 0),
            };
            // JSON output
            if (formatType === 'json') {
                const jsonOutput = { files: results, totals };
                if (outputFile) {
                    await safeWriteOutputFile(outputFile, JSON.stringify(jsonOutput, null, 2));
                    output.printSuccess(`Results written to ${outputFile}`);
                }
                else {
                    output.printJson(jsonOutput);
                }
                return { success: true, data: jsonOutput };
            }
            // Summary box
            output.printBox([
                `Files analyzed: ${totals.files}`,
                `Functions: ${totals.functions}`,
                `Classes: ${totals.classes}`,
                `Total LOC: ${totals.totalLoc}`,
                `Avg Complexity: ${formatComplexityValueAst(Math.round(totals.avgComplexity))}`,
            ].join('\n'), 'AST Analysis Summary');
            // Complexity view
            if (showComplexity || showAll) {
                output.writeln();
                output.writeln(output.bold('Complexity by File'));
                output.writeln(output.dim('-'.repeat(60)));
                const complexityData = results
                    .map(r => ({
                    file: truncatePathAst(r.filePath),
                    cyclomatic: r.complexity.cyclomatic,
                    cognitive: r.complexity.cognitive,
                    loc: r.complexity.loc,
                    rating: getComplexityRatingAst(r.complexity.cyclomatic),
                }))
                    .sort((a, b) => b.cyclomatic - a.cyclomatic)
                    .slice(0, 15);
                output.printTable({
                    columns: [
                        { key: 'file', header: 'File', width: 40 },
                        { key: 'cyclomatic', header: 'Cyclo', width: 8, align: 'right', format: (v) => formatComplexityValueAst(v) },
                        { key: 'cognitive', header: 'Cogni', width: 8, align: 'right' },
                        { key: 'loc', header: 'LOC', width: 8, align: 'right' },
                        { key: 'rating', header: 'Rating', width: 15 },
                    ],
                    data: complexityData,
                });
                if (results.length > 15) {
                    output.writeln(output.dim(`  ... and ${results.length - 15} more files`));
                }
            }
            // Symbols view
            if (showSymbols || showAll) {
                output.writeln();
                output.writeln(output.bold('Extracted Symbols'));
                output.writeln(output.dim('-'.repeat(60)));
                const allSymbols = [];
                for (const r of results) {
                    for (const fn of r.functions) {
                        allSymbols.push({ name: fn.name, type: 'function', file: truncatePathAst(r.filePath, 30), line: fn.startLine });
                    }
                    for (const cls of r.classes) {
                        allSymbols.push({ name: cls.name, type: 'class', file: truncatePathAst(r.filePath, 30), line: cls.startLine });
                    }
                }
                const displaySymbols = allSymbols.slice(0, 20);
                output.printTable({
                    columns: [
                        { key: 'type', header: 'Type', width: 8, format: (v) => getTypeMarkerAst(v) },
                        { key: 'name', header: 'Symbol', width: 30 },
                        { key: 'file', header: 'File', width: 35 },
                        { key: 'line', header: 'Line', width: 8, align: 'right' },
                    ],
                    data: displaySymbols,
                });
                if (allSymbols.length > 20) {
                    output.writeln(output.dim(`  ... and ${allSymbols.length - 20} more symbols`));
                }
            }
            // Verbose output
            if (verbose) {
                output.writeln();
                output.writeln(output.bold('Import Analysis'));
                output.writeln(output.dim('-'.repeat(60)));
                const importCounts = new Map();
                for (const r of results) {
                    for (const imp of r.imports) {
                        importCounts.set(imp, (importCounts.get(imp) || 0) + 1);
                    }
                }
                const topImports = Array.from(importCounts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10);
                for (const [imp, count] of topImports) {
                    output.writeln(`  ${output.highlight(count.toString().padStart(3))} ${imp}`);
                }
            }
            if (outputFile) {
                await safeWriteOutputFile(outputFile, JSON.stringify({ files: results, totals }, null, 2));
                output.printSuccess(`Results written to ${outputFile}`);
            }
            return { success: true, data: { files: results, totals } };
        }
        catch (error) {
            spinner.stop();
            const message = error instanceof Error ? error.message : String(error);
            output.printError(`AST analysis failed: ${message}`);
            return { success: false, exitCode: 1 };
        }
    },
};
//# sourceMappingURL=analyze-ast.js.map