/**
 * Analyze complexity and symbols subcommands
 * Complexity analysis and symbol extraction from code files
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import * as fs from 'fs/promises';
import { resolve } from 'path';
import { getASTAnalyzer, safeWriteOutputFile, scanSourceFiles, fallbackAnalyze } from './analyze.js';
import { truncatePathAst, formatComplexityValueAst, getTypeMarkerAst } from './analyze-ast.js';

/**
 * Complexity analysis subcommand
 */
export const complexityAstCommand: Command = {
  name: 'complexity',
  aliases: ['cx'],
  description: 'Analyze code complexity metrics',
  options: [
    {
      name: 'threshold',
      short: 't',
      description: 'Complexity threshold to flag (default: 10)',
      type: 'number',
      default: 10,
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
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string',
    },
  ],
  examples: [
    { command: 'monomind analyze complexity src/', description: 'Analyze complexity' },
    { command: 'monomind analyze complexity src/ --threshold 15', description: 'Flag high complexity' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const targetPath = ctx.args[0] || ctx.cwd;
    const threshold = (ctx.flags.threshold as number) || 10;
    const formatType = (ctx.flags.format as string) || 'text';
    const outputFile = ctx.flags.output as string | undefined;

    output.printInfo(`Analyzing complexity: ${output.highlight(targetPath)}`);
    output.writeln();

    const spinner = output.createSpinner({ text: 'Calculating complexity...', spinner: 'dots' });
    spinner.start();

    try {
      const astModule = await getASTAnalyzer();
      const resolvedPath = resolve(targetPath);
      const stat = await fs.stat(resolvedPath);
      const files = stat.isDirectory() ? await scanSourceFiles(resolvedPath) : [resolvedPath];

      const results: Array<{
        file: string;
        cyclomatic: number;
        cognitive: number;
        loc: number;
        commentDensity: number;
        rating: string;
        flagged: boolean;
      }> = [];

      for (const file of files.slice(0, 100)) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          let analysis;

          if (astModule) {
            const analyzer = astModule.createASTAnalyzer();
            analysis = analyzer.analyze(content, file);
          } else {
            analysis = fallbackAnalyze(content, file);
          }

          const flagged = analysis.complexity.cyclomatic > threshold;
          const rating = analysis.complexity.cyclomatic <= 5 ? 'Simple' :
            analysis.complexity.cyclomatic <= 10 ? 'Moderate' :
            analysis.complexity.cyclomatic <= 20 ? 'Complex' : 'Very Complex';

          results.push({
            file: file,
            cyclomatic: analysis.complexity.cyclomatic,
            cognitive: analysis.complexity.cognitive,
            loc: analysis.complexity.loc,
            commentDensity: analysis.complexity.commentDensity,
            rating,
            flagged,
          });
        } catch {
          // Skip files that can't be analyzed
        }
      }

      spinner.stop();

      // Sort by complexity descending
      results.sort((a, b) => b.cyclomatic - a.cyclomatic);

      const flaggedCount = results.filter(r => r.flagged).length;
      const avgComplexity = results.length > 0
        ? results.reduce((sum, r) => sum + r.cyclomatic, 0) / results.length
        : 0;

      if (formatType === 'json') {
        const jsonOutput = { files: results, summary: { total: results.length, flagged: flaggedCount, avgComplexity, threshold } };
        if (outputFile) {
          await safeWriteOutputFile(outputFile, JSON.stringify(jsonOutput, null, 2));
          output.printSuccess(`Results written to ${outputFile}`);
        } else {
          output.printJson(jsonOutput);
        }
        return { success: true, data: jsonOutput };
      }

      // Summary
      output.printBox(
        [
          `Files analyzed: ${results.length}`,
          `Threshold: ${threshold}`,
          `Flagged files: ${flaggedCount > 0 ? output.error(String(flaggedCount)) : output.success('0')}`,
          `Average complexity: ${formatComplexityValueAst(Math.round(avgComplexity))}`,
        ].join('\n'),
        'Complexity Analysis'
      );

      // Show flagged files first
      if (flaggedCount > 0) {
        output.writeln();
        output.writeln(output.bold(output.warning(`High Complexity Files (>${threshold})`)));
        output.writeln(output.dim('-'.repeat(60)));

        const flaggedFiles = results.filter(r => r.flagged).slice(0, 10);
        output.printTable({
          columns: [
            { key: 'file', header: 'File', width: 40, format: (v) => truncatePathAst(v as string) },
            { key: 'cyclomatic', header: 'Cyclo', width: 8, align: 'right', format: (v) => output.error(String(v)) },
            { key: 'cognitive', header: 'Cogni', width: 8, align: 'right' },
            { key: 'loc', header: 'LOC', width: 8, align: 'right' },
            { key: 'rating', header: 'Rating', width: 15 },
          ],
          data: flaggedFiles,
        });
      }

      // Show all files in table format
      output.writeln();
      output.writeln(output.bold('All Files'));
      output.writeln(output.dim('-'.repeat(60)));

      const displayFiles = results.slice(0, 15);
      output.printTable({
        columns: [
          { key: 'file', header: 'File', width: 40, format: (v) => truncatePathAst(v as string) },
          { key: 'cyclomatic', header: 'Cyclo', width: 8, align: 'right', format: (v) => formatComplexityValueAst(v as number) },
          { key: 'cognitive', header: 'Cogni', width: 8, align: 'right' },
          { key: 'loc', header: 'LOC', width: 8, align: 'right' },
        ],
        data: displayFiles,
      });

      if (results.length > 15) {
        output.writeln(output.dim(`  ... and ${results.length - 15} more files`));
      }

      if (outputFile) {
        await safeWriteOutputFile(outputFile, JSON.stringify({ files: results, summary: { total: results.length, flagged: flaggedCount, avgComplexity, threshold } }, null, 2));
        output.printSuccess(`Results written to ${outputFile}`);
      }

      return { success: true, data: { files: results, flaggedCount } };
    } catch (error) {
      spinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      output.printError(`Complexity analysis failed: ${message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

/**
 * Symbol extraction subcommand
 */
export const symbolsCommand: Command = {
  name: 'symbols',
  aliases: ['sym'],
  description: 'Extract and list code symbols (functions, classes, types)',
  options: [
    {
      name: 'type',
      short: 't',
      description: 'Filter by symbol type (function, class, all)',
      type: 'string',
      default: 'all',
      choices: ['function', 'class', 'all'],
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
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string',
    },
  ],
  examples: [
    { command: 'monomind analyze symbols src/', description: 'Extract all symbols' },
    { command: 'monomind analyze symbols src/ --type function', description: 'Only functions' },
    { command: 'monomind analyze symbols src/ --format json', description: 'JSON output' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const targetPath = ctx.args[0] || ctx.cwd;
    const symbolType = (ctx.flags.type as string) || 'all';
    const formatType = (ctx.flags.format as string) || 'text';
    const outputFile = ctx.flags.output as string | undefined;

    output.printInfo(`Extracting symbols: ${output.highlight(targetPath)}`);
    output.writeln();

    const spinner = output.createSpinner({ text: 'Parsing code...', spinner: 'dots' });
    spinner.start();

    try {
      const astModule = await getASTAnalyzer();
      const resolvedPath = resolve(targetPath);
      const stat = await fs.stat(resolvedPath);
      const files = stat.isDirectory() ? await scanSourceFiles(resolvedPath) : [resolvedPath];

      const symbols: Array<{
        name: string;
        type: string;
        file: string;
        startLine: number;
        endLine: number;
      }> = [];

      for (const file of files.slice(0, 100)) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          let analysis;

          if (astModule) {
            const analyzer = astModule.createASTAnalyzer();
            analysis = analyzer.analyze(content, file);
          } else {
            analysis = fallbackAnalyze(content, file);
          }

          if (symbolType === 'all' || symbolType === 'function') {
            for (const fn of analysis.functions) {
              symbols.push({
                name: fn.name,
                type: 'function',
                file,
                startLine: fn.startLine,
                endLine: fn.endLine,
              });
            }
          }

          if (symbolType === 'all' || symbolType === 'class') {
            for (const cls of analysis.classes) {
              symbols.push({
                name: cls.name,
                type: 'class',
                file,
                startLine: cls.startLine,
                endLine: cls.endLine,
              });
            }
          }
        } catch {
          // Skip files that can't be parsed
        }
      }

      spinner.stop();

      // Sort by file then name
      symbols.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));

      if (formatType === 'json') {
        if (outputFile) {
          await safeWriteOutputFile(outputFile, JSON.stringify(symbols, null, 2));
          output.printSuccess(`Results written to ${outputFile}`);
        } else {
          output.printJson(symbols);
        }
        return { success: true, data: symbols };
      }

      // Summary
      const functionCount = symbols.filter(s => s.type === 'function').length;
      const classCount = symbols.filter(s => s.type === 'class').length;

      output.printBox(
        [
          `Total symbols: ${symbols.length}`,
          `Functions: ${functionCount}`,
          `Classes: ${classCount}`,
          `Files: ${files.length}`,
        ].join('\n'),
        'Symbol Extraction'
      );

      output.writeln();
      output.writeln(output.bold('Symbols'));
      output.writeln(output.dim('-'.repeat(60)));

      const displaySymbols = symbols.slice(0, 30);
      output.printTable({
        columns: [
          { key: 'type', header: 'Type', width: 10, format: (v) => getTypeMarkerAst(v as string) },
          { key: 'name', header: 'Name', width: 30 },
          { key: 'file', header: 'File', width: 35, format: (v) => truncatePathAst(v as string, 33) },
          { key: 'startLine', header: 'Line', width: 8, align: 'right' },
        ],
        data: displaySymbols,
      });

      if (symbols.length > 30) {
        output.writeln(output.dim(`  ... and ${symbols.length - 30} more symbols`));
      }

      if (outputFile) {
        await safeWriteOutputFile(outputFile, JSON.stringify(symbols, null, 2));
        output.printSuccess(`Results written to ${outputFile}`);
      }

      return { success: true, data: symbols };
    } catch (error) {
      spinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      output.printError(`Symbol extraction failed: ${message}`);
      return { success: false, exitCode: 1 };
    }
  },
};
