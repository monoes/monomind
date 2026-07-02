/**
 * Analyze imports and deps subcommands
 * Import dependency analysis and project dependency checking
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import * as fs from 'fs/promises';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { getASTAnalyzer, safeWriteOutputFile, scanSourceFiles, fallbackAnalyze } from './analyze.js';

/**
 * Imports analysis subcommand
 */
export const importsCommand: Command = {
  name: 'imports',
  aliases: ['imp'],
  description: 'Analyze import dependencies across files',
  options: [
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
    {
      name: 'external',
      short: 'e',
      description: 'Show only external (npm) imports',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    { command: 'monomind analyze imports src/', description: 'Analyze all imports' },
    { command: 'monomind analyze imports src/ --external', description: 'Only npm packages' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const targetPath = ctx.args[0] || ctx.cwd;
    const formatType = (ctx.flags.format as string) || 'text';
    const outputFile = ctx.flags.output as string | undefined;
    const externalOnly = ctx.flags.external as boolean;

    output.printInfo(`Analyzing imports: ${output.highlight(targetPath)}`);
    output.writeln();

    const spinner = output.createSpinner({ text: 'Scanning imports...', spinner: 'dots' });
    spinner.start();

    try {
      const astModule = await getASTAnalyzer();
      const resolvedPath = resolve(targetPath);
      const stat = await fs.stat(resolvedPath);
      const files = stat.isDirectory() ? await scanSourceFiles(resolvedPath) : [resolvedPath];

      const importCounts: Map<string, { count: number; files: string[] }> = new Map();
      const fileImports: Map<string, string[]> = new Map();

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

          const imports = analysis.imports.filter(imp => {
            if (externalOnly) {
              return !imp.startsWith('.') && !imp.startsWith('/');
            }
            return true;
          });

          fileImports.set(file, imports);

          for (const imp of imports) {
            const existing = importCounts.get(imp) || { count: 0, files: [] };
            existing.count++;
            existing.files.push(file);
            importCounts.set(imp, existing);
          }
        } catch {
          // Skip files that can't be parsed
        }
      }

      spinner.stop();

      // Sort by count
      const sortedImports = Array.from(importCounts.entries())
        .sort((a, b) => b[1].count - a[1].count);

      if (formatType === 'json') {
        const jsonOutput = {
          imports: Object.fromEntries(sortedImports),
          fileImports: Object.fromEntries(fileImports),
        };
        if (outputFile) {
          await safeWriteOutputFile(outputFile, JSON.stringify(jsonOutput, null, 2));
          output.printSuccess(`Results written to ${outputFile}`);
        } else {
          output.printJson(jsonOutput);
        }
        return { success: true, data: jsonOutput };
      }

      // Summary
      const externalImports = sortedImports.filter(([imp]) => !imp.startsWith('.') && !imp.startsWith('/'));
      const localImports = sortedImports.filter(([imp]) => imp.startsWith('.') || imp.startsWith('/'));

      output.printBox(
        [
          `Total unique imports: ${sortedImports.length}`,
          `External (npm): ${externalImports.length}`,
          `Local (relative): ${localImports.length}`,
          `Files scanned: ${files.length}`,
        ].join('\n'),
        'Import Analysis'
      );

      // Most used imports
      output.writeln();
      output.writeln(output.bold('Most Used Imports'));
      output.writeln(output.dim('-'.repeat(60)));

      const topImports = sortedImports.slice(0, 20);
      output.printTable({
        columns: [
          { key: 'count', header: 'Uses', width: 8, align: 'right' },
          { key: 'import', header: 'Import', width: 50 },
          { key: 'type', header: 'Type', width: 10 },
        ],
        data: topImports.map(([imp, data]) => ({
          count: data.count,
          import: imp,
          type: imp.startsWith('.') || imp.startsWith('/') ? output.dim('local') : output.highlight('npm'),
        })),
      });

      if (sortedImports.length > 20) {
        output.writeln(output.dim(`  ... and ${sortedImports.length - 20} more imports`));
      }

      if (outputFile) {
        await safeWriteOutputFile(outputFile, JSON.stringify({
          imports: Object.fromEntries(sortedImports),
          fileImports: Object.fromEntries(fileImports),
        }, null, 2));
        output.printSuccess(`Results written to ${outputFile}`);
      }

      return { success: true, data: { imports: sortedImports } };
    } catch (error) {
      spinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      output.printError(`Import analysis failed: ${message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Dependencies subcommand
export const depsCommand: Command = {
  name: 'deps',
  description: 'Analyze project dependencies',
  options: [
    { name: 'outdated', short: 'o', type: 'boolean', description: 'Show only outdated dependencies' },
    { name: 'security', short: 's', type: 'boolean', description: 'Check for security vulnerabilities' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: text, json', default: 'text' },
  ],
  examples: [
    { command: 'monomind analyze deps --outdated', description: 'Show outdated dependencies' },
    { command: 'monomind analyze deps --security', description: 'Check for vulnerabilities' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const showOutdated = ctx.flags.outdated as boolean;
    const checkSecurity = ctx.flags.security as boolean;
    const formatJson = (ctx.flags.format as string) === 'json';

    output.writeln();
    output.writeln(output.bold('Dependency Analysis'));
    output.writeln(output.dim('-'.repeat(50)));

    try {
      const pkgPath = resolve('package.json');
      let pkgContent: string;
      try {
        pkgContent = await fs.readFile(pkgPath, 'utf-8');
      } catch {
        output.printError('No package.json found in current directory');
        return { success: false, exitCode: 1 };
      }

      const pkg = JSON.parse(pkgContent);
      const deps = Object.entries(pkg.dependencies || {}) as [string, string][];
      const devDeps = Object.entries(pkg.devDependencies || {}) as [string, string][];
      const optDeps = Object.entries(pkg.optionalDependencies || {}) as [string, string][];
      const peerDeps = Object.entries(pkg.peerDependencies || {}) as [string, string][];
      const total = deps.length + devDeps.length + optDeps.length + peerDeps.length;

      if (formatJson && !showOutdated && !checkSecurity) {
        const jsonData = { name: pkg.name, version: pkg.version, dependencies: deps.length, devDependencies: devDeps.length, optionalDependencies: optDeps.length, peerDependencies: peerDeps.length, total };
        output.printJson(jsonData);
        return { success: true, data: jsonData };
      }

      output.printBox(
        [`Package: ${pkg.name || 'unknown'} @ ${pkg.version || '0.0.0'}`, `Dependencies: ${deps.length}`, `Dev Dependencies: ${devDeps.length}`, `Optional: ${optDeps.length}`, `Peer: ${peerDeps.length}`, `Total: ${total}`].join('\n'),
        'Dependency Summary'
      );

      if (showOutdated) {
        output.writeln();
        output.writeln(output.bold('Outdated Check'));
        output.writeln(output.dim('-'.repeat(60)));
        const outdated: Array<{ name: string; declared: string; installed: string; category: string }> = [];

        const checkDeps = async (entries: [string, string][], category: string) => {
          for (const [name, declared] of entries) {
            try {
              const installedPkg = resolve('node_modules', name, 'package.json');
              const raw = await fs.readFile(installedPkg, 'utf-8');
              const installedContent = JSON.parse(raw) as { version?: string };
              const installed = installedContent.version || 'unknown';
              const cleanDeclared = (declared as string).replace(/^[\^~>=<]+/, '');
              if (installed !== cleanDeclared) {
                outdated.push({ name, declared: declared as string, installed, category });
              }
            } catch {
              outdated.push({ name, declared: declared as string, installed: 'not installed', category });
            }
          }
        };

        await checkDeps(deps, 'prod');
        await checkDeps(devDeps, 'dev');

        if (outdated.length === 0) {
          output.printSuccess('All dependencies match declared versions');
        } else {
          output.printTable({
            columns: [
              { key: 'name', header: 'Package', width: 30 },
              { key: 'declared', header: 'Declared', width: 14 },
              { key: 'installed', header: 'Installed', width: 14 },
              { key: 'category', header: 'Type', width: 6 },
            ],
            data: outdated.slice(0, 30),
          });
          if (outdated.length > 30) {
            output.writeln(output.dim(`  ... and ${outdated.length - 30} more`));
          }
        }
      }

      if (checkSecurity) {
        output.writeln();
        output.writeln(output.bold('Security Audit'));
        output.writeln(output.dim('-'.repeat(60)));

        try {
          const auditRaw = execSync('npm audit --json 2>/dev/null', { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
          const audit = JSON.parse(auditRaw);
          const vulns = audit.metadata?.vulnerabilities || audit.vulnerabilities || {};
          const info = vulns.info || 0;
          const low = vulns.low || 0;
          const moderate = vulns.moderate || 0;
          const high = vulns.high || 0;
          const critical = vulns.critical || 0;
          const totalVulns = info + low + moderate + high + critical;

          if (totalVulns === 0) {
            output.printSuccess('No known vulnerabilities found');
          } else {
            output.printTable({
              columns: [
                { key: 'severity', header: 'Severity', width: 12 },
                { key: 'count', header: 'Count', width: 8, align: 'right' as const },
              ],
              data: [
                ...(critical > 0 ? [{ severity: 'Critical', count: critical }] : []),
                ...(high > 0 ? [{ severity: 'High', count: high }] : []),
                ...(moderate > 0 ? [{ severity: 'Moderate', count: moderate }] : []),
                ...(low > 0 ? [{ severity: 'Low', count: low }] : []),
                ...(info > 0 ? [{ severity: 'Info', count: info }] : []),
                { severity: 'Total', count: totalVulns },
              ],
            });
            if (critical > 0 || high > 0) {
              output.printWarning(`${critical + high} high/critical vulnerabilities found. Run 'npm audit' for details.`);
            }
          }
        } catch {
          output.printWarning('npm audit failed. Ensure npm is available and node_modules is installed.');
        }
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.printError(`Dependency analysis failed: ${message}`);
      return { success: false, exitCode: 1 };
    }
  },
};
