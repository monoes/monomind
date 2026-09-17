/**
 * Security scan commands — code/dep/container scanning and secret detection
 */

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import * as monograph from '@monoes/monograph';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

// ─── Shared secret scanning ─────────────────────────────────────────────────

export const SECRET_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  {
    // Covers plain `sk-<random>` as well as the hyphen-segmented variants
    // vendors actually issue (`sk-live-...`, `sk-proj-...`, `sk-test-...`),
    // plus Stripe's underscore-segmented `sk_live_...`/`sk_test_...`. The
    // previous version required 20+ *contiguous* alphanumerics right after
    // `sk-`, which never matched `sk-live-...` because the `-` after `live`
    // broke the run — so real Stripe/OpenAI keys of that shape went undetected.
    pattern:
      /['"]sk-(?:live-|proj-|test-)?[a-zA-Z0-9]{10,}['"]|['"]sk_(?:live|test)_[a-zA-Z0-9]{10,}['"]/g,
    type: 'API Key (Stripe/OpenAI)',
  },
  { pattern: /['"]AKIA[A-Z0-9]{16}['"]/g, type: 'AWS Access Key' },
  { pattern: /['"]ghp_[a-zA-Z0-9]{36}['"]/g, type: 'GitHub Token' },
  { pattern: /['"]xox[baprs]-[a-zA-Z0-9-]+['"]/g, type: 'Slack Token' },
  { pattern: /password\s*[:=]\s*['"][^'"]{8,}['"]/gi, type: 'Hardcoded Password' },
];

/**
 * File extensions the secret scanner reads. Previously limited to
 * ts/js/json/yml/yaml(+.env*), which meant any other language — Python, Go,
 * Ruby, shell, etc. — was silently invisible to `security scan`/`secrets`
 * regardless of what it contained. Broadened to cover common source/config
 * file types actually likely to hold hardcoded credentials.
 */
export const SECRET_SCAN_EXTENSIONS =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml|py|rb|go|java|php|c|cc|cpp|h|hpp|cs|kt|kts|swift|rs|sh|bash|zsh|pl|lua|sql|toml|ini|cfg|conf|properties|xml|html)$/;

/**
 * File extensions the code-pattern scanner (eval(), innerHTML, command
 * injection, SQL injection, ...) reads. Previously ts/js/tsx/jsx only, so a
 * dangerous `eval()` call in a Python, shell, or Ruby file was never seen.
 */
export const CODE_PATTERN_SCAN_EXTENSIONS =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|java|php|c|cc|cpp|h|hpp|cs|kt|kts|swift|rs|sh|bash|zsh|pl|lua)$/;

export type SecretFinding = {
  severity: string;
  type: string;
  location: string;
  description: string;
  rawSeverity?: 'critical' | 'high' | 'medium' | 'low';
};

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
    lines.push(
      `${c.unreadableDirs.length} directory(ies) could not be read (e.g. ${c.unreadableDirs[0]})`,
    );
  }
  if (c.unreadableFiles.length > 0) {
    lines.push(
      `${c.unreadableFiles.length} file(s) could not be read (e.g. ${c.unreadableFiles[0]})`,
    );
  }
  if (c.depthTruncatedDirs.length > 0) {
    lines.push(
      `${c.depthTruncatedDirs.length} directory(ies) not scanned — depth limit reached (use --depth deep)`,
    );
  }
  if (c.oversizedFiles.length > 0) {
    lines.push(`${c.oversizedFiles.length} file(s) skipped — larger than 1MB`);
  }
  return lines;
}

/** Reads one file and records any SECRET_PATTERNS matches as findings. */
function scanFileForSecrets(
  fullPath: string,
  baseDir: string,
  findings: SecretFinding[],
  coverage: ScanCoverage,
): void {
  let content: string;
  try {
    if (statSync(fullPath).size > 1024 * 1024) {
      coverage.oversizedFiles.push(relative(baseDir, fullPath) || fullPath);
      return;
    }
    content = readFileSync(fullPath, 'utf-8');
  } catch {
    coverage.unreadableFiles.push(relative(baseDir, fullPath) || fullPath);
    return;
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
          location: `${relative(baseDir, fullPath) || fullPath}:${i + 1}`,
          description: type,
          rawSeverity: 'high',
        });
      }
    }
  }
}

export function findSecretsInDir(
  dir: string,
  depthLimit: number,
  baseDir: string,
  findings: SecretFinding[],
  coverage: ScanCoverage = createScanCoverage(),
): void {
  // A caller can point --target/-p directly at a *file* rather than a
  // directory. readdirSync() on a file throws ENOTDIR, which the old code
  // swallowed into unreadableDirs and returned — so the file itself was
  // never opened, even when it plainly contained a secret. Detect that case
  // up front and scan the file directly, ignoring the extension allowlist
  // since the caller explicitly named this exact file.
  let dirStat: ReturnType<typeof statSync>;
  try {
    dirStat = statSync(dir);
  } catch {
    coverage.unreadableDirs.push(relative(baseDir, dir) || dir);
    return;
  }
  if (dirStat.isFile()) {
    scanFileForSecrets(dir, baseDir, findings, coverage);
    return;
  }
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
    if (
      (entry.name.startsWith('.') && !isDotEnv) ||
      entry.name === 'node_modules' ||
      entry.name === 'dist'
    )
      continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      findSecretsInDir(fullPath, depthLimit - 1, baseDir, findings, coverage);
    } else if (
      entry.isFile() &&
      (SECRET_SCAN_EXTENSIONS.test(entry.name) || isDotEnv) &&
      !entry.name.endsWith('.d.ts')
    ) {
      scanFileForSecrets(fullPath, baseDir, findings, coverage);
    }
  }
}

// ─── Shared code-pattern scanning ───────────────────────────────────────────

export const CODE_PATTERNS: Array<{
  pattern: RegExp;
  type: string;
  severity: 'high' | 'medium';
  desc: string;
}> = [
  {
    pattern: /eval\s*\(/g,
    type: 'Eval Usage',
    severity: 'medium',
    desc: 'eval() can execute arbitrary code',
  },
  {
    pattern: /innerHTML\s*=/g,
    type: 'innerHTML',
    severity: 'medium',
    desc: 'XSS risk with innerHTML',
  },
  {
    pattern: /dangerouslySetInnerHTML/g,
    type: 'React XSS',
    severity: 'medium',
    desc: 'React XSS risk',
  },
  {
    pattern: /child_process.*exec[^S]/g,
    type: 'Command Injection',
    severity: 'high',
    desc: 'Possible command injection',
  },
  {
    pattern: /\$\{.*\}.*sql|sql.*\$\{/gi,
    type: 'SQL Injection',
    severity: 'high',
    desc: 'Possible SQL injection',
  },
];

/** Reads one file and records any CODE_PATTERNS matches as findings. */
function scanFileForCodePatterns(
  fullPath: string,
  baseDir: string,
  findings: SecretFinding[],
  coverage: ScanCoverage,
): void {
  let content: string;
  try {
    if (statSync(fullPath).size > 1024 * 1024) {
      coverage.oversizedFiles.push(relative(baseDir, fullPath) || fullPath);
      return;
    }
    content = readFileSync(fullPath, 'utf-8');
  } catch {
    coverage.unreadableFiles.push(relative(baseDir, fullPath) || fullPath);
    return;
  }
  coverage.filesScanned++;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const { pattern, type, severity, desc } of CODE_PATTERNS) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(lines[i])) !== null) {
        findings.push({
          severity: severity === 'high' ? output.warning('HIGH') : output.warning('MEDIUM'),
          type,
          location: `${relative(baseDir, fullPath) || fullPath}:${i + 1}`,
          description: desc,
          rawSeverity: severity,
        });
      }
    }
  }
}

/**
 * Same coverage accounting as findSecretsInDir: gaps are recorded, never
 * swallowed, so an unreadable tree cannot masquerade as a clean one. Also
 * shares findSecretsInDir's fix for a `dir` that is actually a file: it is
 * scanned directly instead of throwing ENOTDIR into unreadableDirs.
 */
export function findCodePatternsInDir(
  dir: string,
  depthLimit: number,
  baseDir: string,
  findings: SecretFinding[],
  coverage: ScanCoverage = createScanCoverage(),
): void {
  let dirStat: ReturnType<typeof statSync>;
  try {
    dirStat = statSync(dir);
  } catch {
    coverage.unreadableDirs.push(relative(baseDir, dir) || dir);
    return;
  }
  if (dirStat.isFile()) {
    scanFileForCodePatterns(dir, baseDir, findings, coverage);
    return;
  }
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
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist')
      continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      findCodePatternsInDir(fullPath, depthLimit - 1, baseDir, findings, coverage);
    } else if (
      entry.isFile() &&
      CODE_PATTERN_SCAN_EXTENSIONS.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    ) {
      scanFileForCodePatterns(fullPath, baseDir, findings, coverage);
    }
  }
}

// ─── SARIF adapter ───────────────────────────────────────────────────────────

export interface SarifHealthFinding {
  filePath: string;
  functionName: string;
  startLine: number;
  endLine: number;
  ruleId: string;
  message: string;
  severity: 'error' | 'warning' | 'note';
}

export interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  helpUri?: string;
}

export interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note';
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region?: { startLine: number; endLine?: number };
    };
  }>;
}

export interface SarifDocument {
  $schema: string;
  version: '2.1.0';
  runs: [
    {
      tool: { driver: { name: string; version: string; rules: SarifRule[] } };
      results: SarifResult[];
    },
  ];
}

const SARIF_HEALTH_RULES: SarifRule[] = [
  {
    id: 'complexity/cyclomatic',
    name: 'High Cyclomatic Complexity',
    shortDescription: { text: 'Function exceeds cyclomatic complexity threshold' },
    fullDescription: {
      text: 'Cyclomatic complexity indicates the number of linearly independent paths through a function.',
    },
  },
  {
    id: 'complexity/cognitive',
    name: 'High Cognitive Complexity',
    shortDescription: { text: 'Function exceeds cognitive complexity threshold' },
    fullDescription: {
      text: 'Cognitive complexity measures how difficult a function is to understand.',
    },
  },
  {
    id: 'complexity/crap',
    name: 'High CRAP Score',
    shortDescription: {
      text: 'Function has a high CRAP score due to complexity and low coverage',
    },
    fullDescription: { text: 'CRAP = cyclomatic^2 * (1 - coverage/100)^3 + cyclomatic' },
  },
];

/**
 * Fallback SARIF generator when @monoes/monograph does not export exportHealthSarif
 * (e.g. published @monoes/monograph@1.5.8 packaging bug).
 */
export function exportHealthSarifFallback(
  findings: SarifHealthFinding[],
  root?: string,
): SarifDocument {
  const results: SarifResult[] = findings.map((f) => ({
    ruleId: f.ruleId,
    message: { text: f.message },
    level: f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'note',
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: root ? f.filePath.replace(root, '').replace(/^\//, '') : f.filePath,
          },
          region: { startLine: f.startLine, endLine: f.endLine },
        },
      },
    ],
  }));

  return {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'monograph-health',
            version: '1.5.8',
            rules: SARIF_HEALTH_RULES,
          },
        },
        results,
      },
    ],
  };
}

/**
 * Formats findings into a SARIF 2.1.0 document. Delegates to @monoes/monograph's
 * real exporter when available, otherwise safely falls back to built-in exporter.
 */
export function exportHealthSarif(findings: SarifHealthFinding[], root?: string): SarifDocument {
  const maybeExporter = (monograph as Record<string, unknown>).exportHealthSarif;
  if (typeof maybeExporter === 'function') {
    return (maybeExporter as (f: SarifHealthFinding[], r?: string) => SarifDocument)(
      findings,
      root,
    );
  }
  return exportHealthSarifFallback(findings, root);
}

/**
 * Adapts security-scan findings (file:line-ish locations, flat rawSeverity) into
 * the shape monograph's SARIF exporter expects. Reused rather than reimplemented —
 * see doc/commands/security.md.
 */
export function findingsToSarif(
  findings: Array<{
    type: string;
    location: string;
    description: string;
    rawSeverity: 'critical' | 'high' | 'medium' | 'low';
  }>,
): SarifHealthFinding[] {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  return findings.map((f) => {
    const lastColon = f.location.lastIndexOf(':');
    const maybeLine = lastColon >= 0 ? Number(f.location.slice(lastColon + 1)) : NaN;
    const hasLine = Number.isFinite(maybeLine) && maybeLine > 0;
    const filePath = hasLine ? f.location.slice(0, lastColon) : f.location;
    const line = hasLine ? maybeLine : 0;
    return {
      filePath,
      functionName: f.type,
      startLine: line,
      endLine: line,
      ruleId: `security-scan/${slug(f.type)}`,
      message: f.description,
      severity:
        f.rawSeverity === 'critical' || f.rawSeverity === 'high'
          ? 'error'
          : f.rawSeverity === 'medium'
            ? 'warning'
            : 'note',
    };
  });
}

// ─── scan subcommand ─────────────────────────────────────────────────────────

export const scanCommand: Command = {
  name: 'scan',
  description: 'Run security scan on target (code, dependencies)',
  options: [
    {
      name: 'target',
      short: 't',
      type: 'string',
      description: 'Target path to scan',
      default: '.',
    },
    {
      name: 'depth',
      short: 'd',
      type: 'string',
      description: 'Scan depth: quick, standard, deep',
      default: 'standard',
    },
    { name: 'type', type: 'string', description: 'Scan type: code, deps, all', default: 'all' },
    {
      name: 'output',
      short: 'o',
      type: 'string',
      description: 'Output format: text, json, sarif',
      default: 'text',
    },
    {
      name: 'fix',
      short: 'f',
      type: 'boolean',
      description: 'Auto-fix vulnerabilities where possible',
    },
  ],
  examples: [
    { command: 'monomind security scan -t ./src', description: 'Scan source directory' },
    {
      command: 'monomind security scan --depth deep --fix',
      description: 'Deep scan with auto-fix',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const target = (ctx.flags.target as string) || '.';
    const depth = (ctx.flags.depth as string) || 'standard';
    const scanType = (ctx.flags.type as string) || 'all';
    const fix = ctx.flags.fix as boolean;
    const rawOutputFormat = (ctx.flags.output as string) || 'text';
    const outputFormat =
      rawOutputFormat === 'json' || rawOutputFormat === 'sarif' ? rawOutputFormat : 'text';

    if (scanType === 'container') {
      output.printError('container scanning is not implemented — no container engine exists');
      return { success: false };
    }

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

    const findings: Array<{
      severity: string;
      type: string;
      location: string;
      description: string;
      rawSeverity: 'critical' | 'high' | 'medium' | 'low';
    }> = [];
    const coverage = createScanCoverage();
    let criticalCount = 0,
      highCount = 0,
      mediumCount = 0,
      lowCount = 0;

    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { execSync } = await import('node:child_process');

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
                for (const [pkg, vuln] of Object.entries(
                  audit.vulnerabilities as Record<
                    string,
                    { severity: string; via: Array<string | { title?: string; url?: string }> }
                  >,
                )) {
                  const sev = vuln.severity || 'low';
                  const firstVia = Array.isArray(vuln.via) ? vuln.via[0] : undefined;
                  const title =
                    firstVia && typeof firstVia === 'object' && firstVia.title
                      ? firstVia.title
                      : 'Vulnerability';
                  if (sev === 'critical') criticalCount++;
                  else if (sev === 'high') highCount++;
                  else if (sev === 'moderate' || sev === 'medium') mediumCount++;
                  else lowCount++;

                  findings.push({
                    severity:
                      sev === 'critical'
                        ? output.error('CRITICAL')
                        : sev === 'high'
                          ? output.warning('HIGH')
                          : sev === 'moderate' || sev === 'medium'
                            ? output.warning('MEDIUM')
                            : output.info('LOW'),
                    type: 'Dependency CVE',
                    location: `package.json:${pkg}`,
                    description: title.substring(0, 35),
                    rawSeverity:
                      sev === 'critical'
                        ? 'critical'
                        : sev === 'high'
                          ? 'high'
                          : sev === 'moderate' || sev === 'medium'
                            ? 'medium'
                            : 'low',
                  });
                }
              }
            } catch (e) {
              /* JSON parse failed */ if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
                console.error('[security-scan] failed to parse npm audit output:', e);
            }
          }
        } catch (e) {
          /* npm audit failed */ if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
            console.error('[security-scan] dependency check failed:', e);
        }
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
        const codeScanDepth = depth === 'deep' ? 10 : 5;
        const prevFindingsLength = findings.length;
        findCodePatternsInDir(
          path.resolve(target),
          codeScanDepth,
          path.resolve(target),
          findings,
          coverage,
        );
        for (const f of findings.slice(prevFindingsLength)) {
          if (f.rawSeverity === 'high') highCount++;
          else if (f.rawSeverity === 'medium') mediumCount++;
        }
      }

      const gaps = describeScanGaps(coverage);
      if (gaps.length > 0) {
        spinner.stop(output.warning('Scan finished with INCOMPLETE coverage'));
      } else {
        spinner.succeed('Scan complete');
      }

      output.writeln();
      if (outputFormat === 'json') {
        const jsonPayload = {
          target,
          depth,
          type: scanType,
          findings: findings.map((f) => ({
            severity: f.rawSeverity,
            type: f.type,
            location: f.location,
            description: f.description,
          })),
          summary: {
            critical: criticalCount,
            high: highCount,
            medium: mediumCount,
            low: lowCount,
            total: findings.length,
          },
          coverage: {
            filesScanned: coverage.filesScanned,
            dirsScanned: coverage.dirsScanned,
            complete: gaps.length === 0,
            gaps,
          },
        };
        output.writeln(JSON.stringify(jsonPayload, null, 2));
      } else if (outputFormat === 'sarif') {
        const sarifDoc = exportHealthSarif(findingsToSarif(findings), resolve(target));
        output.writeln(JSON.stringify(sarifDoc, null, 2));
      } else if (findings.length > 0) {
        output.printTable({
          columns: [
            { key: 'severity', header: 'Severity', width: 12 },
            { key: 'type', header: 'Type', width: 18 },
            { key: 'location', header: 'Location', width: 25 },
            { key: 'description', header: 'Description', width: 35 },
          ],
          data: findings.slice(0, 20),
        });
        if (findings.length > 20)
          output.writeln(output.dim(`... and ${findings.length - 20} more issues`));
      } else if (gaps.length > 0) {
        // Never present an incomplete scan as a clean bill of health.
        output.writeln(
          output.warning(
            'No security issues found in the parts that could be scanned — coverage was INCOMPLETE (see below).',
          ),
        );
      } else {
        output.writeln(output.success('No security issues found!'));
      }

      if (outputFormat === 'text') {
        if (gaps.length > 0) {
          output.writeln();
          output.writeln(output.warning('Incomplete coverage:'));
          for (const g of gaps) output.writeln(output.warning(`  - ${g}`));
        }

        output.writeln();
        output.printBox(
          [
            `Target: ${target}`,
            `Depth: ${depth}`,
            `Type: ${scanType}`,
            ``,
            `Critical: ${criticalCount}  High: ${highCount}  Medium: ${mediumCount}  Low: ${lowCount}`,
            `Total Issues: ${findings.length}`,
            ``,
            `Coverage: ${coverage.filesScanned} file(s) in ${coverage.dirsScanned} dir(s) scanned`,
            `Coverage status: ${gaps.length === 0 ? 'complete' : `INCOMPLETE (${gaps.length} gap type(s))`}`,
          ].join('\n'),
          'Scan Summary',
        );
      }

      if (fix && criticalCount + highCount > 0) {
        const resolvedTarget = realpathSync(path.resolve(target));
        const cwd = realpathSync(process.cwd());
        if (!resolvedTarget.startsWith(cwd + path.sep) && resolvedTarget !== cwd) {
          output.writeln();
          output.printError(
            '--fix is only allowed when --target is within the current working directory',
          );
          return { success: false };
        }
        output.writeln();
        const fixSpinner = output.createSpinner({
          text: 'Attempting to fix vulnerabilities...',
          spinner: 'dots',
        });
        fixSpinner.start();
        try {
          execSync('npm audit fix', {
            cwd: resolvedTarget,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          fixSpinner.succeed('completed (verify with a re-scan)');
        } catch (fixErr) {
          // npm audit fix exits non-zero when it can't resolve everything
          // automatically — surface that instead of reporting success.
          const status = (fixErr as { status?: number })?.status;
          fixSpinner.fail(
            `npm audit fix exited with ${status ?? 'an error'} — some fixes could not be applied automatically (verify with a re-scan)`,
          );
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
    {
      name: 'depth',
      short: 'd',
      type: 'string',
      description: 'Scan depth: quick, standard, deep',
      default: 'standard',
    },
  ],
  examples: [
    { command: 'monomind security secrets', description: 'Scan current directory for secrets' },
    {
      command: 'monomind security secrets -p ./src --depth deep',
      description: 'Deep scan of src directory',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const targetPath = (ctx.flags.path as string) || '.';
    const depth = (ctx.flags.depth as string) || 'standard';

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
      output.writeln(
        output.warning(
          'No secrets found in the parts that could be scanned — coverage was INCOMPLETE.',
        ),
      );
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
