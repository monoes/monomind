/**
 * Security scan commands — code/dep/container scanning and secret detection
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { existsSync, statSync, readFileSync, readdirSync, realpathSync } from 'fs';
import { join, resolve, sep, relative } from 'path';

// ─── Shared secret scanning ─────────────────────────────────────────────────

export const SECRET_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /['"](?:sk-|sk_live_|sk_test_)[a-zA-Z0-9]{20,}['"]/g, type: 'API Key (Stripe/OpenAI)' },
  { pattern: /['"]AKIA[A-Z0-9]{16}['"]/g, type: 'AWS Access Key' },
  { pattern: /['"]ghp_[a-zA-Z0-9]{36}['"]/g, type: 'GitHub Token' },
  { pattern: /['"]xox[baprs]-[a-zA-Z0-9-]+['"]/g, type: 'Slack Token' },
  { pattern: /password\s*[:=]\s*['"][^'"]{8,}['"]/gi, type: 'Hardcoded Password' },
];

export type SecretFinding = { severity: string; type: string; location: string; description: string };

/**
 * Records what the scanner could NOT look at.
 *
 * Without this the scanner swallowed unreadable directories and stopped at its
 * depth limit, then printed "No secrets found." — an error presented as a clean
 * result. Callers must consult `scanWasIncomplete()` before reporting a clean
 * bill of health.
 */
export interface ScanCoverage {
  /** Directories that could not be listed (permissions, I/O). Real failures. */
  unreadableDirs: string[];
  /** Files that could not be read or stat'd. Real failures. */
  unreadableFiles: string[];
  /** Directories not descended into because the depth limit was reached. */
  depthTruncatedDirs: string[];
  /** Files skipped because they exceed the 1MB per-file cap. */
  oversizedFiles: string[];
  /** Files actually opened and pattern-matched. */
  filesScanned: number;
  /** Directories actually listed. */
  dirsScanned: number;
}

export function createScanCoverage(): ScanCoverage {
  return {
    unreadableDirs: [],
    unreadableFiles: [],
    depthTruncatedDirs: [],
    oversizedFiles: [],
    filesScanned: 0,
    dirsScanned: 0,
  };
}

/** True when some part of the tree was not examined, for any reason. */
export function scanWasIncomplete(c: ScanCoverage): boolean {
  return (
    c.unreadableDirs.length > 0 ||
    c.unreadableFiles.length > 0 ||
    c.depthTruncatedDirs.length > 0 ||
    c.oversizedFiles.length > 0
  );
}

/** True when the scanner hit a hard failure (not merely a configured limit). */
export function scanHadErrors(c: ScanCoverage): boolean {
  return c.unreadableDirs.length > 0 || c.unreadableFiles.length > 0;
}

/** Human-readable lines describing every gap in coverage. Empty when complete. */
export function describeScanGaps(c: ScanCoverage): string[] {
  const lines: string[] = [];
  if (c.unreadableDirs.length > 0) {
    lines.push(`${c.unreadableDirs.length} directory(ies) could not be read (e.g. ${c.unreadableDirs[0]})`);
  }
  if (c.unreadableFiles.length > 0) {
    lines.push(`${c.unreadableFiles.length} file(s) could not be read (e.g. ${c.unreadableFiles[0]})`);
  }
  if (c.depthTruncatedDirs.length > 0) {
    lines.push(`${c.depthTruncatedDirs.length} directory(ies) not scanned — depth limit reached (use --depth deep)`);
  }
  if (c.oversizedFiles.length > 0) {
    lines.push(`${c.oversizedFiles.length} file(s) skipped — larger than 1MB`);
  }
  return lines;
}

export function findSecretsInDir(
  dir: string,
  depthLimit: number,
  baseDir: string,
  findings: SecretFinding[],
  coverage: ScanCoverage = createScanCoverage(),
): void {
  if (depthLimit <= 0) {
    coverage.depthTruncatedDirs.push(relative(baseDir, dir) || dir);
    return;
  }
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    coverage.unreadableDirs.push(relative(baseDir, dir) || dir);
    return;
  }
  coverage.dirsScanned++;
  for (const entry of entries) {
    const isDotEnv = /^\.env(\..+)?$/.test(entry.name);
    if ((entry.name.startsWith('.') && !isDotEnv) || entry.name === 'node_modules' || entry.name === 'dist') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      findSecretsInDir(fullPath, depthLimit - 1, baseDir, findings, coverage);
    } else if (entry.isFile() && (/\.(ts|js|json|yml|yaml)$/.test(entry.name) || isDotEnv) && !entry.name.endsWith('.d.ts')) {
      let content: string;
      try {
        if (statSync(fullPath).size > 1024 * 1024) {
          coverage.oversizedFiles.push(relative(baseDir, fullPath));
          continue;
        }
        content = readFileSync(fullPath, 'utf-8');
      } catch {
        coverage.unreadableFiles.push(relative(baseDir, fullPath));
        continue;
      }
      coverage.filesScanned++;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const { pattern, type } of SECRET_PATTERNS) {
          pattern.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = pattern.exec(lines[i])) !== null) {
            findings.push({
              severity: output.warning('HIGH'),
              type: 'Hardcoded Secret',
              location: `${relative(baseDir, fullPath)}:${i + 1}`,
              description: type,
            });
          }
        }
      }
    }
  }
}

// ─── scan subcommand ─────────────────────────────────────────────────────────

export const scanCommand: Command = {
  name: 'scan',
  description: 'Run security scan on target (code, dependencies, containers)',
  options: [
    { name: 'target', short: 't', type: 'string', description: 'Target path or URL to scan', default: '.' },
    { name: 'depth', short: 'd', type: 'string', description: 'Scan depth: quick, standard, deep', default: 'standard' },
    { name: 'type', type: 'string', description: 'Scan type: code, deps, container, all', default: 'all' },
    { name: 'output', short: 'o', type: 'string', description: 'Output format: text, json, sarif', default: 'text' },
    { name: 'fix', short: 'f', type: 'boolean', description: 'Auto-fix vulnerabilities where possible' },
  ],
  examples: [
    { command: 'monomind security scan -t ./src', description: 'Scan source directory' },
    { command: 'monomind security scan --depth deep --fix', description: 'Deep scan with auto-fix' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const target = ctx.flags.target as string || '.';
    const depth = ctx.flags.depth as string || 'standard';
    const scanType = ctx.flags.type as string || 'all';
    const fix = ctx.flags.fix as boolean;

    if (target !== '.') {
      try {
        const resolvedTgt = realpathSync(resolve(target));
        const cwd = realpathSync(process.cwd());
        if (!resolvedTgt.startsWith(cwd + sep) && resolvedTgt !== cwd) {
          output.printError('--target must be within the current working directory');
          return { success: false };
        }
      } catch {
        output.printError(`--target path does not exist or is not accessible: ${target}`);
        return { success: false };
      }
    }

    output.writeln();
    output.writeln(output.bold('Security Scan'));
    output.writeln(output.dim('─'.repeat(50)));

    const spinner = output.createSpinner({ text: `Scanning ${target}...`, spinner: 'dots' });
    spinner.start();

    const findings: Array<{ severity: string; type: string; location: string; description: string }> = [];
    const coverage = createScanCoverage();
    let criticalCount = 0, highCount = 0, mediumCount = 0, lowCount = 0;

    try {
      const fs = await import('fs');
      const path = await import('path');
      const { execSync } = await import('child_process');

      if (scanType === 'all' || scanType === 'deps') {
        spinner.setText('Checking dependencies with npm audit...');
        try {
          const packageJsonPath = path.resolve(target, 'package.json');
          if (fs.existsSync(packageJsonPath)) {
            let auditResult: string;
            try {
              auditResult = execSync('npm audit --json', {
                cwd: path.resolve(target),
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 30_000,
              });
            } catch (auditErr: any) {
              auditResult = auditErr.stdout || '{}';
            }

            try {
              const audit = JSON.parse(auditResult);
              if (audit.vulnerabilities) {
                for (const [pkg, vuln] of Object.entries(audit.vulnerabilities as Record<string, { severity: string; via: Array<string | { title?: string; url?: string }> }>)) {
                  const sev = vuln.severity || 'low';
                  const firstVia = Array.isArray(vuln.via) ? vuln.via[0] : undefined;
                  const title = firstVia && typeof firstVia === 'object' && firstVia.title ? firstVia.title : 'Vulnerability';
                  if (sev === 'critical') criticalCount++;
                  else if (sev === 'high') highCount++;
                  else if (sev === 'moderate' || sev === 'medium') mediumCount++;
                  else lowCount++;

                  findings.push({
                    severity: sev === 'critical' ? output.error('CRITICAL') :
                              sev === 'high' ? output.warning('HIGH') :
                              sev === 'moderate' || sev === 'medium' ? output.warning('MEDIUM') : output.info('LOW'),
                    type: 'Dependency CVE',
                    location: `package.json:${pkg}`,
                    description: title.substring(0, 35),
                  });
                }
              }
            } catch (e) { /* JSON parse failed */ if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[security-scan] failed to parse npm audit output:', e); }
          }
        } catch (e) { /* npm audit failed */ if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[security-scan] dependency check failed:', e); }
      }

      if (scanType === 'all' || scanType === 'code') {
        spinner.setText('Scanning for hardcoded secrets...');
        const scanDepth = depth === 'deep' ? 10 : depth === 'standard' ? 5 : 3;
        const prevCount = findings.length;
        findSecretsInDir(path.resolve(target), scanDepth, path.resolve(target), findings, coverage);
        highCount += findings.length - prevCount;
      }

      if ((scanType === 'all' || scanType === 'code') && depth !== 'quick') {
        spinner.setText('Analyzing code patterns...');
        const codePatterns = [
          { pattern: /eval\s*\(/g, type: 'Eval Usage', severity: 'medium', desc: 'eval() can execute arbitrary code' },
          { pattern: /innerHTML\s*=/g, type: 'innerHTML', severity: 'medium', desc: 'XSS risk with innerHTML' },
          { pattern: /dangerouslySetInnerHTML/g, type: 'React XSS', severity: 'medium', desc: 'React XSS risk' },
          { pattern: /child_process.*exec[^S]/g, type: 'Command Injection', severity: 'high', desc: 'Possible command injection' },
          { pattern: /\$\{.*\}.*sql|sql.*\$\{/gi, type: 'SQL Injection', severity: 'high', desc: 'Possible SQL injection' },
        ];

        // Same coverage accounting as findSecretsInDir: gaps are recorded, never
        // swallowed, so an unreadable tree cannot masquerade as a clean one.
        const codeBase = path.resolve(target);
        const scanCodeDir = (dir: string, depthLimit: number) => {
          if (depthLimit <= 0) {
            coverage.depthTruncatedDirs.push(path.relative(codeBase, dir) || dir);
            return;
          }
          let entries;
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            coverage.unreadableDirs.push(path.relative(codeBase, dir) || dir);
            return;
          }
          for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              scanCodeDir(fullPath, depthLimit - 1);
            } else if (entry.isFile() && /\.(ts|js|tsx|jsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
              let content: string;
              try {
                if (fs.statSync(fullPath).size > 1024 * 1024) {
                  coverage.oversizedFiles.push(path.relative(codeBase, fullPath));
                  continue;
                }
                content = fs.readFileSync(fullPath, 'utf-8');
              } catch {
                coverage.unreadableFiles.push(path.relative(codeBase, fullPath));
                continue;
              }
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                for (const { pattern, type, severity, desc } of codePatterns) {
                  pattern.lastIndex = 0;
                  let m: RegExpExecArray | null;
                  while ((m = pattern.exec(lines[i])) !== null) {
                    if (severity === 'high') highCount++;
                    else mediumCount++;
                    findings.push({
                      severity: severity === 'high' ? output.warning('HIGH') : output.warning('MEDIUM'),
                      type,
                      location: `${path.relative(target, fullPath)}:${i + 1}`,
                      description: desc,
                    });
                  }
                }
              }
            }
          }
        };

        const scanDepth = depth === 'deep' ? 10 : 5;
        scanCodeDir(path.resolve(target), scanDepth);
      }

      const gaps = describeScanGaps(coverage);
      if (gaps.length > 0) {
        spinner.stop(output.warning('Scan finished with INCOMPLETE coverage'));
      } else {
        spinner.succeed('Scan complete');
      }

      output.writeln();
      if (findings.length > 0) {
        output.printTable({
          columns: [
            { key: 'severity', header: 'Severity', width: 12 },
            { key: 'type', header: 'Type', width: 18 },
            { key: 'location', header: 'Location', width: 25 },
            { key: 'description', header: 'Description', width: 35 },
          ],
          data: findings.slice(0, 20),
        });
        if (findings.length > 20) output.writeln(output.dim(`... and ${findings.length - 20} more issues`));
      } else if (gaps.length > 0) {
        // Never present an incomplete scan as a clean bill of health.
        output.writeln(output.warning('No security issues found in the parts that could be scanned — coverage was INCOMPLETE (see below).'));
      } else {
        output.writeln(output.success('No security issues found!'));
      }

      if (gaps.length > 0) {
        output.writeln();
        output.writeln(output.warning('Incomplete coverage:'));
        for (const g of gaps) output.writeln(output.warning(`  - ${g}`));
      }

      output.writeln();
      output.printBox([
        `Target: ${target}`,
        `Depth: ${depth}`,
        `Type: ${scanType}`,
        ``,
        `Critical: ${criticalCount}  High: ${highCount}  Medium: ${mediumCount}  Low: ${lowCount}`,
        `Total Issues: ${findings.length}`,
        ``,
        `Coverage: ${coverage.filesScanned} file(s) in ${coverage.dirsScanned} dir(s) scanned`,
        `Coverage status: ${gaps.length === 0 ? 'complete' : `INCOMPLETE (${gaps.length} gap type(s))`}`,
      ].join('\n'), 'Scan Summary');

      if (fix && criticalCount + highCount > 0) {
        const resolvedTarget = realpathSync(path.resolve(target));
        const cwd = realpathSync(process.cwd());
        if (!resolvedTarget.startsWith(cwd + path.sep) && resolvedTarget !== cwd) {
          output.writeln();
          output.printError('--fix is only allowed when --target is within the current working directory');
          return { success: false };
        }
        output.writeln();
        const fixSpinner = output.createSpinner({ text: 'Attempting to fix vulnerabilities...', spinner: 'dots' });
        fixSpinner.start();
        try {
          execSync('npm audit fix', { cwd: resolvedTarget, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
          fixSpinner.succeed('completed (verify with a re-scan)');
        } catch (fixErr) {
          // npm audit fix exits non-zero when it can't resolve everything
          // automatically — surface that instead of reporting success.
          const status = (fixErr as { status?: number })?.status;
          fixSpinner.fail(`npm audit fix exited with ${status ?? 'an error'} — some fixes could not be applied automatically (verify with a re-scan)`);
        }
      }

      // A scan that hit real read errors cannot certify anything — fail loudly.
      // Depth truncation is a configured limit, not an error, so it is reported
      // above but does not by itself flip the exit status.
      if (scanHadErrors(coverage)) return { success: false };
      return { success: findings.length === 0 || (criticalCount === 0 && highCount === 0) };
    } catch (error) {
      spinner.fail('Scan failed');
      output.printError(`Error: ${error}`);
      return { success: false };
    }
  },
};

// ─── secrets subcommand ──────────────────────────────────────────────────────

export const secretsCommand: Command = {
  name: 'secrets',
  description: 'Detect hardcoded secrets in codebase',
  options: [
    { name: 'path', short: 'p', type: 'string', description: 'Path to scan', default: '.' },
    { name: 'depth', short: 'd', type: 'string', description: 'Scan depth: quick, standard, deep', default: 'standard' },
  ],
  examples: [
    { command: 'monomind security secrets', description: 'Scan current directory for secrets' },
    { command: 'monomind security secrets -p ./src --depth deep', description: 'Deep scan of src directory' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const targetPath = ctx.flags.path as string || '.';
    const depth = ctx.flags.depth as string || 'standard';

    if (targetPath !== '.') {
      try {
        const resolvedTgt = realpathSync(resolve(targetPath));
        const cwd = realpathSync(process.cwd());
        if (!resolvedTgt.startsWith(cwd + sep) && resolvedTgt !== cwd) {
          output.printError('--path must be within the current working directory');
          return { success: false };
        }
      } catch {
        output.printError(`--path does not exist or is not accessible: ${targetPath}`);
        return { success: false };
      }
    }

    output.writeln();
    output.writeln(output.bold('Secret Detection'));
    output.writeln(output.dim('─'.repeat(50)));

    const spinner = output.createSpinner({ text: `Scanning ${targetPath}...`, spinner: 'dots' });
    spinner.start();

    const findings: SecretFinding[] = [];
    const coverage = createScanCoverage();
    const scanDepth = depth === 'deep' ? 10 : depth === 'standard' ? 5 : 3;
    findSecretsInDir(resolve(targetPath), scanDepth, resolve(targetPath), findings, coverage);

    const gaps = describeScanGaps(coverage);
    if (gaps.length > 0) {
      spinner.stop(output.warning('Scan finished with INCOMPLETE coverage'));
    } else {
      spinner.succeed('Scan complete');
    }

    output.writeln();
    if (findings.length === 0 && gaps.length > 0) {
      output.writeln(output.warning('No secrets found in the parts that could be scanned — coverage was INCOMPLETE.'));
    } else if (findings.length === 0) {
      output.writeln(output.success('No secrets found.'));
    } else {
      output.printTable({
        columns: [
          { key: 'severity', header: 'Severity', width: 12 },
          { key: 'description', header: 'Description', width: 25 },
          { key: 'location', header: 'Location', width: 40 },
        ],
        data: findings.slice(0, 20),
      });
      if (findings.length > 20) output.writeln(output.dim(`... and ${findings.length - 20} more`));
    }

    if (gaps.length > 0) {
      output.writeln();
      output.writeln(output.warning('Incomplete coverage:'));
      for (const g of gaps) output.writeln(output.warning(`  - ${g}`));
    }

    output.writeln();
    output.writeln(
      output.bold('Summary: ') +
      `${findings.length} secret(s) found in ${targetPath} ` +
      `(${coverage.filesScanned} file(s) in ${coverage.dirsScanned} dir(s) scanned, ` +
      `coverage ${gaps.length === 0 ? 'complete' : 'INCOMPLETE'})`,
    );

    // Read errors mean the tree was not fully examined — "no secrets" is not
    // a result we can stand behind, so do not exit 0 on it.
    return { success: findings.length === 0 && !scanHadErrors(coverage) };
  },
};
