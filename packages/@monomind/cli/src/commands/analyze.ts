/**
 * CLI Analyze Command
 * Code analysis, diff classification, AST analysis, and change risk assessment
 *
 * Features:
 * - AST analysis using monovector (tree-sitter) with graceful fallback
 * - Symbol extraction (functions, classes, variables, types)
 * - Cyclomatic complexity scoring
 * - Diff classification and risk assessment
 * - Graph boundaries using MinCut algorithm
 * - Module communities using Louvain algorithm
 * - Circular dependency detection
 *
 * github.com/monoes/monomind
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { writeFile } from 'fs/promises';

import { diffCommand, codeCommand } from './analyze-diff.js';
import { astCommand } from './analyze-ast.js';
import { complexityAstCommand, symbolsCommand } from './analyze-symbols.js';
import { importsCommand, depsCommand } from './analyze-imports.js';
import { boundariesCommand, modulesCommand } from './analyze-boundaries.js';
import { dependenciesCommand, circularCommand } from './analyze-graph.js';

// The AST/graph analyzer modules were never shipped. These resolvers always
// return null, so every call site takes its regex / null-guarded fallback path.
// The return type stays loose (as the old dynamic-import did) so the unreachable
// "module loaded" branches at the call sites still type-check.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnalyzerModule = any;

// AST analyzer module was never shipped — always falls back to the regex path.
export async function getASTAnalyzer(): Promise<AnalyzerModule | null> {
  return null;
}

// Graph analyzer module was never shipped — callers handle the null path.
export async function getGraphAnalyzer(): Promise<AnalyzerModule | null> {
  return null;
}

/**
 * Write analysis output to a file, constraining the path to the current working
 * directory to prevent path traversal attacks via --output /etc/cron.d/x or
 * similar. Throws if the resolved path escapes cwd.
 */
export async function safeWriteOutputFile(outputFile: string, data: string): Promise<void> {
  const projectRoot = path.resolve(process.cwd());
  const fullPath = path.resolve(process.cwd(), outputFile);
  if (!fullPath.startsWith(projectRoot + path.sep) && fullPath !== projectRoot) {
    throw new Error(`Output path must resolve within the project directory: ${projectRoot}`);
  }
  await writeFile(fullPath, data);
}

/**
 * Helper: Scan directory for source files
 */
export async function scanSourceFiles(dir: string, maxDepth: number = 10): Promise<string[]> {
  const files: string[] = [];
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
  const excludeDirs = ['node_modules', 'dist', 'build', '.git', 'coverage', '__pycache__'];

  async function scan(currentDir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name)) {
            await scan(fullPath, depth + 1);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  await scan(dir, 0);
  return files;
}

/**
 * Fallback analysis when monovector is not available
 */
export function fallbackAnalyze(code: string, filePath: string) {
  const lines = code.split('\n');
  const functions: Array<{ name: string; startLine: number; endLine: number }> = [];
  const classes: Array<{ name: string; startLine: number; endLine: number }> = [];
  const imports: string[] = [];
  const exports: string[] = [];

  // Extract functions
  const funcPattern = /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>|^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/gm;
  let match;
  while ((match = funcPattern.exec(code)) !== null) {
    const name = match[1] || match[2] || match[3];
    if (name && !['if', 'while', 'for', 'switch'].includes(name)) {
      const lineNum = code.substring(0, match.index).split('\n').length;
      functions.push({ name, startLine: lineNum, endLine: lineNum + 10 });
    }
  }

  // Extract classes
  const classPattern = /(?:export\s+)?class\s+(\w+)/gm;
  while ((match = classPattern.exec(code)) !== null) {
    const lineNum = code.substring(0, match.index).split('\n').length;
    classes.push({ name: match[1], startLine: lineNum, endLine: lineNum + 20 });
  }

  // Extract imports
  const importPattern = /import\s+(?:.*\s+from\s+)?['"]([^'"]+)['"]/gm;
  while ((match = importPattern.exec(code)) !== null) {
    imports.push(match[1]);
  }
  const requirePattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;
  while ((match = requirePattern.exec(code)) !== null) {
    imports.push(match[1]);
  }

  // Extract exports
  const exportPattern = /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/gm;
  while ((match = exportPattern.exec(code)) !== null) {
    exports.push(match[1]);
  }

  // Calculate complexity
  const nonEmptyLines = lines.filter(l => l.trim().length > 0).length;
  const commentLines = lines.filter(l => /^\s*(\/\/|\/\*|\*|#)/.test(l)).length;
  const decisionPoints = (code.match(/\b(if|else|for|while|switch|case|catch|&&|\|\||\?)\b/g) || []).length;

  let cognitive = 0;
  let nestingLevel = 0;
  for (const line of lines) {
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    if (/\b(if|for|while|switch)\b/.test(line)) {
      cognitive += 1 + nestingLevel;
    }
    nestingLevel = Math.max(0, nestingLevel + opens - closes);
  }

  // Detect language
  const ext = path.extname(filePath).toLowerCase();
  const language = ext === '.ts' || ext === '.tsx' ? 'typescript' :
    ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs' ? 'javascript' :
    ext === '.py' ? 'python' : 'unknown';

  return {
    filePath,
    language,
    functions,
    classes,
    imports,
    exports,
    complexity: {
      cyclomatic: decisionPoints + 1,
      cognitive,
      loc: nonEmptyLines,
      commentDensity: lines.length > 0 ? commentLines / lines.length : 0,
    },
  };
}

// Main analyze command
export const analyzeCommand: Command = {
  name: 'analyze',
  description: 'Code analysis, diff classification, graph boundaries, and change risk assessment',
  aliases: ['an'],
  subcommands: [
    diffCommand,
    codeCommand,
    depsCommand,
    astCommand,
    complexityAstCommand,
    symbolsCommand,
    importsCommand,
    boundariesCommand,
    modulesCommand,
    dependenciesCommand,
    circularCommand,
  ],
  options: [
    {
      name: 'format',
      short: 'f',
      description: 'Output format: text, json, table',
      type: 'string',
      default: 'text',
    },
    {
      name: 'embedding-device',
      description: 'Embedding device: auto, cpu, cuda, dml, wasm (default: auto)',
      type: 'string' as const,
      default: 'auto',
      choices: ['auto', 'cpu', 'dml', 'cuda', 'wasm'],
    },
  ],
  examples: [
    { command: 'monomind analyze ast src/', description: 'Analyze code with AST parsing' },
    { command: 'monomind analyze complexity src/ --threshold 15', description: 'Find high-complexity files' },
    { command: 'monomind analyze symbols src/ --type function', description: 'Extract all functions' },
    { command: 'monomind analyze imports src/ --external', description: 'List npm dependencies' },
    { command: 'monomind analyze diff --risk', description: 'Analyze diff with risk assessment' },
    { command: 'monomind analyze boundaries src/', description: 'Find code boundaries using MinCut' },
    { command: 'monomind analyze modules src/', description: 'Detect module communities with Louvain' },
    { command: 'monomind analyze dependencies src/ --format dot', description: 'Export dependency graph as DOT' },
    { command: 'monomind analyze circular src/', description: 'Find circular dependencies' },
    { command: 'monomind analyze deps --security', description: 'Check dependency vulnerabilities' },
  ],
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    // If no subcommand, show help
    output.writeln();
    output.writeln(output.bold('Analyze Commands'));
    output.writeln(output.dim('-'.repeat(50)));
    output.writeln();

    output.writeln(output.bold('Available subcommands:'));
    output.writeln();
    output.writeln(`  ${output.highlight('diff')}         Analyze git diff for change risk and classification`);
    output.writeln(`  ${output.highlight('code')}         Static code analysis and quality assessment`);
    output.writeln(`  ${output.highlight('deps')}         Analyze project dependencies`);
    output.writeln(`  ${output.highlight('ast')}          AST analysis with symbol extraction and complexity`);
    output.writeln(`  ${output.highlight('complexity')}   Analyze cyclomatic and cognitive complexity`);
    output.writeln(`  ${output.highlight('symbols')}      Extract functions, classes, and types`);
    output.writeln(`  ${output.highlight('imports')}      Analyze import dependencies`);
    output.writeln(`  ${output.highlight('boundaries')}   Find code boundaries using MinCut algorithm`);
    output.writeln(`  ${output.highlight('modules')}      Detect module communities using Louvain algorithm`);
    output.writeln(`  ${output.highlight('dependencies')} Build and export full dependency graph`);
    output.writeln(`  ${output.highlight('circular')}     Detect circular dependencies in codebase`);
    output.writeln();

    output.writeln(output.bold('AST Analysis Examples:'));
    output.writeln();
    output.writeln(`  ${output.dim('monomind analyze ast src/')}                  # Full AST analysis`);
    output.writeln(`  ${output.dim('monomind analyze ast src/index.ts -c')}       # Include complexity`);
    output.writeln(`  ${output.dim('monomind analyze complexity src/ -t 15')}     # Flag high complexity`);
    output.writeln(`  ${output.dim('monomind analyze symbols src/ --type fn')}    # Extract functions`);
    output.writeln(`  ${output.dim('monomind analyze imports src/ --external')}   # Only npm imports`);
    output.writeln();

    output.writeln(output.bold('Graph Analysis Examples:'));
    output.writeln();
    output.writeln(`  ${output.dim('monomind analyze boundaries src/')}            # Find natural code boundaries`);
    output.writeln(`  ${output.dim('monomind analyze modules src/')}               # Detect module communities`);
    output.writeln(`  ${output.dim('monomind analyze dependencies -f dot src/')}   # Export to DOT format`);
    output.writeln(`  ${output.dim('monomind analyze circular src/')}              # Find circular deps`);
    output.writeln();

    output.writeln(output.bold('Diff Analysis Examples:'));
    output.writeln();
    output.writeln(`  ${output.dim('monomind analyze diff --risk')}              # Risk assessment`);
    output.writeln(`  ${output.dim('monomind analyze diff HEAD~1 --classify')}   # Classify changes`);
    output.writeln(`  ${output.dim('monomind analyze diff main..feature')}       # Compare branches`);
    output.writeln();

    return { success: true };
  },
};

export default analyzeCommand;
