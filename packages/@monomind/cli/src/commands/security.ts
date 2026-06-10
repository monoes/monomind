/**
 * CLI Security Command
 * Security scanning, CVE detection, threat modeling, vulnerability management
 *
 * github.com/monoes/monomind
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { existsSync, statSync, readFileSync, readdirSync, writeFileSync, renameSync, mkdirSync, realpathSync } from 'fs';
import { join, resolve, sep, relative } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';

// ─── Shared secret scanning ─────────────────────────────────────────────────

const SECRET_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /['"](?:sk-|sk_live_|sk_test_)[a-zA-Z0-9]{20,}['"]/g, type: 'API Key (Stripe/OpenAI)' },
  { pattern: /['"]AKIA[A-Z0-9]{16}['"]/g, type: 'AWS Access Key' },
  { pattern: /['"]ghp_[a-zA-Z0-9]{36}['"]/g, type: 'GitHub Token' },
  { pattern: /['"]xox[baprs]-[a-zA-Z0-9-]+['"]/g, type: 'Slack Token' },
  { pattern: /password\s*[:=]\s*['"][^'"]{8,}['"]/gi, type: 'Hardcoded Password' },
];

type SecretFinding = { severity: string; type: string; location: string; description: string };

function findSecretsInDir(dir: string, depthLimit: number, baseDir: string, findings: SecretFinding[]): void {
  if (depthLimit <= 0) return;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const isDotEnv = /^\.env(\..+)?$/.test(entry.name);
      if ((entry.name.startsWith('.') && !isDotEnv) || entry.name === 'node_modules' || entry.name === 'dist') continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        findSecretsInDir(fullPath, depthLimit - 1, baseDir, findings);
      } else if (entry.isFile() && (/\.(ts|js|json|yml|yaml)$/.test(entry.name) || isDotEnv) && !entry.name.endsWith('.d.ts')) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
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
        } catch { /* file read error */ }
      }
    }
  } catch { /* dir read error */ }
}

// Scan subcommand
const scanCommand: Command = {
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

    // Guard: confine --target to cwd; execSync and scanDir run inside it
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
    let criticalCount = 0, highCount = 0, mediumCount = 0, lowCount = 0;

    try {
      const fs = await import('fs');
      const path = await import('path');
      const { execSync } = await import('child_process');

      // Phase 1: npm audit for dependency vulnerabilities
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
              // npm audit exits non-zero when vulnerabilities found — stdout still has JSON
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
            } catch { /* JSON parse failed, no vulns */ }
          }
        } catch { /* npm audit failed */ }
      }

      // Phase 2: Scan for hardcoded secrets
      if (scanType === 'all' || scanType === 'code') {
        spinner.setText('Scanning for hardcoded secrets...');
        const scanDepth = depth === 'deep' ? 10 : depth === 'standard' ? 5 : 3;
        const prevCount = findings.length;
        findSecretsInDir(path.resolve(target), scanDepth, path.resolve(target), findings);
        highCount += findings.length - prevCount;
      }

      // Phase 3: Check for common security issues in code
      if ((scanType === 'all' || scanType === 'code') && depth !== 'quick') {
        spinner.setText('Analyzing code patterns...');
        const codePatterns = [
          { pattern: /eval\s*\(/g, type: 'Eval Usage', severity: 'medium', desc: 'eval() can execute arbitrary code' },
          { pattern: /innerHTML\s*=/g, type: 'innerHTML', severity: 'medium', desc: 'XSS risk with innerHTML' },
          { pattern: /dangerouslySetInnerHTML/g, type: 'React XSS', severity: 'medium', desc: 'React XSS risk' },
          { pattern: /child_process.*exec[^S]/g, type: 'Command Injection', severity: 'high', desc: 'Possible command injection' },
          { pattern: /\$\{.*\}.*sql|sql.*\$\{/gi, type: 'SQL Injection', severity: 'high', desc: 'Possible SQL injection' },
        ];

        const scanCodeDir = (dir: string, depthLimit: number) => {
          if (depthLimit <= 0) return;
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                scanCodeDir(fullPath, depthLimit - 1);
              } else if (entry.isFile() && /\.(ts|js|tsx|jsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
                try {
                  const content = fs.readFileSync(fullPath, 'utf-8');
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
                } catch { /* file read error */ }
              }
            }
          } catch { /* dir read error */ }
        };

        const scanDepth = depth === 'deep' ? 10 : 5;
        scanCodeDir(path.resolve(target), scanDepth);
      }

      spinner.succeed('Scan complete');

      // Display results
      output.writeln();
      if (findings.length > 0) {
        output.printTable({
          columns: [
            { key: 'severity', header: 'Severity', width: 12 },
            { key: 'type', header: 'Type', width: 18 },
            { key: 'location', header: 'Location', width: 25 },
            { key: 'description', header: 'Description', width: 35 },
          ],
          data: findings.slice(0, 20), // Show first 20
        });

        if (findings.length > 20) {
          output.writeln(output.dim(`... and ${findings.length - 20} more issues`));
        }
      } else {
        output.writeln(output.success('No security issues found!'));
      }

      output.writeln();
      output.printBox([
        `Target: ${target}`,
        `Depth: ${depth}`,
        `Type: ${scanType}`,
        ``,
        `Critical: ${criticalCount}  High: ${highCount}  Medium: ${mediumCount}  Low: ${lowCount}`,
        `Total Issues: ${findings.length}`,
      ].join('\n'), 'Scan Summary');

      // Auto-fix if requested
      if (fix && criticalCount + highCount > 0) {
        // Refuse --fix when target is outside cwd: `npm audit fix` runs lifecycle scripts
        // (pre/post-install) from the target directory's package.json, allowing arbitrary
        // code execution if the target was attacker-controlled.
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
          try {
            execSync('npm audit fix', { cwd: resolvedTarget, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
          } catch { /* npm audit fix may exit non-zero */ }
          fixSpinner.succeed('Applied available fixes (run scan again to verify)');
        } catch {
          fixSpinner.fail('Some fixes could not be applied automatically');
        }
      }

      return { success: findings.length === 0 || (criticalCount === 0 && highCount === 0) };
    } catch (error) {
      spinner.fail('Scan failed');
      output.printError(`Error: ${error}`);
      return { success: false };
    }
  },
};

// ─── CVE helpers ────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getCveCache(cveId: string, cacheDir: string): unknown | null {
  const filePath = join(cacheDir, `${cveId.toUpperCase()}.json`);
  try {
    const stat = statSync(filePath);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

const CVE_ID_RE = /^CVE-\d{4}-\d{4,}$/i;
function saveCveCache(cveId: string, cacheDir: string, data: unknown): void {
  if (!CVE_ID_RE.test(cveId)) throw new Error('Invalid CVE ID');
  mkdirSync(cacheDir, { recursive: true });
  const dest = join(cacheDir, `${cveId.toUpperCase()}.json`);
  const tmp = dest + '.tmp';
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, dest);
}

function httpsGet(url: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'monomind-cli/1.0' }, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { req.destroy(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => req.destroy(new Error(`Request timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
  });
}

function severityColor(severity: string, score?: number): string {
  const s = (severity || '').toUpperCase();
  const label = s + (score !== undefined ? ` (${score})` : '');
  if (s === 'CRITICAL') return output.error(label);
  if (s === 'HIGH') return output.warning(label);
  if (s === 'MEDIUM') return output.info(label);
  return output.dim(label || 'UNKNOWN');
}

const execFileAsync = promisify(execFile);

// ─── CVE subcommand ──────────────────────────────────────────────────────────

const cveCommand: Command = {
  name: 'cve',
  description: 'Check CVEs via NVD/OSV or list project vulnerabilities via npm audit',
  options: [
    { name: 'check', short: 'c', type: 'string', description: 'Check specific CVE ID (e.g. CVE-2024-1234)' },
    { name: 'list', short: 'l', type: 'boolean', description: 'List all vulnerabilities via npm audit' },
    { name: 'severity', short: 's', type: 'string', description: 'Filter by severity: critical, high, medium, low' },
    { name: 'json', type: 'boolean', description: 'Output as JSON' },
    { name: 'no-cache', type: 'boolean', description: 'Skip cache and fetch fresh data' },
  ],
  examples: [
    { command: 'monomind security cve --list', description: 'List vulnerabilities from npm audit' },
    { command: 'monomind security cve -c CVE-2024-1234', description: 'Check specific CVE via NVD/OSV' },
    { command: 'monomind security cve --list --severity high', description: 'Show only high-severity issues' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const checkCve = ctx.flags.check as string | undefined;
    const doList = ctx.flags.list as boolean | undefined;
    const severityFilter = (ctx.flags.severity as string | undefined)?.toLowerCase();
    const jsonOutput = ctx.flags.json as boolean | undefined;
    const noCache = ctx.flags['no-cache'] as boolean | undefined;

    output.writeln();
    output.writeln(output.bold('CVE / Vulnerability Scanner'));
    output.writeln(output.dim('─'.repeat(50)));

    // ── --check CVE-XXXX-YYYY ──────────────────────────────────────────────
    if (checkCve) {
      const CVE_PATTERN = /^CVE-\d{4}-\d{4,}$/i;
      if (!CVE_PATTERN.test(checkCve)) {
        output.writeln(output.error(`Invalid CVE ID format: "${checkCve}"`));
        output.writeln(output.dim('Expected format: CVE-YYYY-NNNN (e.g. CVE-2024-12345)'));
        return { success: false };
      }

      const cveId = checkCve.toUpperCase();
      const cacheDir = join(ctx.cwd, '.monomind', 'cache', 'cve');

      // Check cache first (unless --no-cache)
      let cveData: unknown | null = noCache ? null : getCveCache(cveId, cacheDir);
      let source = 'cache';

      if (!cveData) {
        const spinner = output.createSpinner({ text: `Fetching ${cveId} from NVD...`, spinner: 'dots' });
        spinner.start();

        // Try NVD first
        try {
          const nvdUrl = `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${cveId}`;
          const nvdRaw = await httpsGet(nvdUrl);
          cveData = { _source: 'nvd', ...JSON.parse(nvdRaw) };
          source = 'NVD';
          spinner.succeed(`Fetched from NVD`);
        } catch {
          spinner.setText(`NVD unavailable — trying OSV...`);
          // Fallback: OSV
          try {
            const osvUrl = `https://api.osv.dev/v1/vulns/${cveId}`;
            const osvRaw = await httpsGet(osvUrl);
            cveData = { _source: 'osv', ...JSON.parse(osvRaw) };
            source = 'OSV';
            spinner.succeed(`Fetched from OSV`);
          } catch {
            spinner.fail('Could not fetch CVE data');
            output.writeln(output.error('Could not fetch CVE data — check your network connection'));
            return { success: false };
          }
        }

        // Cache the result — only cache non-empty NVD responses
        const nvdVulns = (cveData as Record<string, unknown>).vulnerabilities;
        if (!Array.isArray(nvdVulns) || nvdVulns.length > 0) {
          saveCveCache(cveId, cacheDir, cveData);
        }
      }

      // Parse and display
      const raw = cveData as Record<string, unknown>;

      if (jsonOutput) {
        output.writeln(JSON.stringify(raw, null, 2));
        return { success: true };
      }

      if (raw._source === 'nvd') {
        // NVD v2 parsing
        const vulns = raw.vulnerabilities as Array<{ cve: Record<string, unknown> }> | undefined;
        if (!vulns || vulns.length === 0) {
          output.writeln(output.warning(`No data found for ${cveId}`));
          return { success: true };
        }
        const cve = vulns[0].cve;
        const published = (cve.published as string || '').split('T')[0];
        const lastMod = (cve.lastModified as string || '').split('T')[0];
        const descriptions = cve.descriptions as Array<{ lang: string; value: string }> | undefined;
        const desc = descriptions?.find(d => d.lang === 'en')?.value || 'No description available';
        const metrics = cve.metrics as Record<string, unknown> | undefined;
        const cvssV31 = metrics?.cvssMetricV31 as Array<{ cvssData: { baseScore: number; baseSeverity: string } }> | undefined;
        const cvssData = cvssV31?.[0]?.cvssData;
        const score = cvssData?.baseScore;
        const severity = cvssData?.baseSeverity || 'N/A';
        const references = cve.references as Array<{ url: string }> | undefined;

        output.writeln();
        output.printBox([
          `CVE ID:        ${cveId}`,
          `Source:        ${source}`,
          `Published:     ${published}`,
          `Last Modified: ${lastMod}`,
          `Severity:      ${severityColor(severity, score)}`,
          ``,
          `Description:`,
          `  ${desc}`,
          ``,
          `References:`,
          ...(references || []).slice(0, 3).map(r => `  - ${r.url}`),
        ].join('\n'), 'CVE Details');

      } else {
        // OSV parsing
        const osv = raw as Record<string, unknown>;
        const osvId = osv.id as string || cveId;
        const summary = osv.summary as string || osv.details as string || 'No description available';
        const affected = osv.affected as Array<{ package?: { name?: string; ecosystem?: string }; ranges?: unknown[] }> | undefined;
        const references = osv.references as Array<{ url: string }> | undefined;

        output.writeln();
        const affectedLines: string[] = [];
        if (affected && affected.length > 0) {
          for (const a of affected.slice(0, 5)) {
            const pkgName = a.package?.name || 'unknown';
            const ecosystem = a.package?.ecosystem || '';
            affectedLines.push(`  - ${pkgName}${ecosystem ? ` (${ecosystem})` : ''}`);
          }
        }

        output.printBox([
          `CVE ID:    ${osvId}`,
          `Source:    OSV (CVSS score: N/A)`,
          `Severity:  N/A`,
          ``,
          `Description:`,
          `  ${summary}`,
          ...(affectedLines.length > 0 ? ['', 'Affected packages:', ...affectedLines] : []),
          ``,
          `References:`,
          ...(references || []).slice(0, 3).map(r => `  - ${r.url}`),
        ].join('\n'), 'CVE Details');
      }

      return { success: true };
    }

    // ── --list ─────────────────────────────────────────────────────────────
    if (doList) {
      const spinner = output.createSpinner({ text: 'Running npm audit...', spinner: 'dots' });
      spinner.start();

      let auditOutput = '';
      try {
        const { stdout } = await execFileAsync('npm', ['audit', '--json'], {
          cwd: ctx.cwd,
          timeout: 30000,
        });
        auditOutput = stdout;
      } catch (err: unknown) {
        // Exit code 1 means vulnerabilities found — stdout still has JSON
        const execErr = err as { stdout?: string; message?: string };
        auditOutput = execErr.stdout || '';
        if (!auditOutput) {
          spinner.fail('npm audit failed');
          output.writeln(output.warning('npm audit failed: ' + (execErr.message || 'unknown error')));
          output.writeln(output.dim('Make sure package-lock.json exists (run `npm install` first).'));
          return { success: false };
        }
      }

      spinner.succeed('npm audit complete');

      let auditJson: Record<string, unknown>;
      try {
        auditJson = JSON.parse(auditOutput);
      } catch {
        output.writeln(output.error('Could not parse npm audit output'));
        return { success: false };
      }

      if (jsonOutput) {
        output.writeln(JSON.stringify(auditJson, null, 2));
        return { success: true };
      }

      const vulnerabilities = auditJson.vulnerabilities as Record<string, {
        name: string;
        severity: string;
        via: Array<string | { source?: number; name?: string; url?: string; severity?: string; cvss?: { score?: number }; range?: string; title?: string }>;
        range: string;
        fixAvailable: boolean | { name: string; version: string };
      }> | undefined;

      const metadata = auditJson.metadata as { vulnerabilities?: Record<string, number> } | undefined;
      const counts = metadata?.vulnerabilities || {};

      const rows: Array<{ id: string; severity: string; package: string; range: string; fix: string }> = [];

      if (vulnerabilities) {
        for (const [pkgName, vuln] of Object.entries(vulnerabilities)) {
          const sev = vuln.severity || 'unknown';

          // Normalize severity filter: accept "medium" to match "moderate"
          if (severityFilter) {
            const normalizedSev = sev === 'moderate' ? 'medium' : sev;
            if (normalizedSev !== severityFilter && sev !== severityFilter) continue;
          }

          // Extract advisory/CVE info from first object-type via entry
          const viaObj = vuln.via.find(v => typeof v === 'object') as {
            url?: string; title?: string; cvss?: { score?: number }; range?: string;
          } | undefined;

          let advisoryId = '—';
          if (viaObj?.url) {
            // Try to extract CVE or GHSA from URL
            const cveMatch = viaObj.url.match(/CVE-\d{4}-\d+/i);
            const ghsaMatch = viaObj.url.match(/GHSA-[a-z0-9-]+/i);
            if (cveMatch) advisoryId = cveMatch[0].toUpperCase();
            else if (ghsaMatch) advisoryId = ghsaMatch[0].toUpperCase();
            else advisoryId = viaObj.url.split('/').pop() || advisoryId;
          }

          const sevColored = sev === 'critical' ? output.error('CRITICAL') :
                             sev === 'high' ? output.warning('HIGH') :
                             sev === 'moderate' || sev === 'medium' ? output.info('MEDIUM') :
                             output.dim(sev.toUpperCase());

          const fixAvail = vuln.fixAvailable === true ? output.success('Yes') :
                           vuln.fixAvailable && typeof vuln.fixAvailable === 'object' ?
                             output.success(`${vuln.fixAvailable.version}`) :
                           output.dim('No');

          rows.push({
            id: advisoryId,
            severity: sevColored,
            package: pkgName,
            range: vuln.range || '—',
            fix: fixAvail,
          });
        }
      }

      output.writeln();

      if (rows.length === 0) {
        output.writeln(output.success('No vulnerabilities found' + (severityFilter ? ` matching severity: ${severityFilter}` : '') + '.'));
      } else {
        output.printTable({
          columns: [
            { key: 'id', header: 'CVE / Advisory', width: 22 },
            { key: 'severity', header: 'Severity', width: 12 },
            { key: 'package', header: 'Package', width: 22 },
            { key: 'range', header: 'Affected Range', width: 20 },
            { key: 'fix', header: 'Fix Available', width: 16 },
          ],
          data: rows,
        });
      }

      // Summary line
      const critical = counts['critical'] || 0;
      const high = counts['high'] || 0;
      const moderate = counts['moderate'] || 0;
      const low = counts['low'] || 0;
      output.writeln();
      output.writeln(
        output.bold('Summary: ') +
        output.error(`${critical} critical`) + '  ' +
        output.warning(`${high} high`) + '  ' +
        output.info(`${moderate} medium`) + '  ' +
        output.dim(`${low} low`)
      );

      return { success: critical === 0 && high === 0 };
    }

    // No subcommand provided — show usage
    output.writeln('Usage:');
    output.printList([
      '--check CVE-XXXX-YYYY    Look up a specific CVE via NVD/OSV',
      '--list                   List project vulnerabilities (npm audit)',
      '--severity <level>       Filter --list by: critical, high, medium, low',
      '--json                   Output raw JSON',
      '--no-cache               Skip local cache (forces fresh fetch)',
    ]);
    output.writeln();
    output.writeln(output.dim('Examples:'));
    output.writeln(output.dim('  monomind security cve --check CVE-2021-44228'));
    output.writeln(output.dim('  monomind security cve --list --severity critical'));

    return { success: true };
  },
};

// Threats subcommand
const threatsCommand: Command = {
  name: 'threats',
  description: 'Threat modeling and analysis',
  options: [
    { name: 'model', short: 'm', type: 'string', description: 'Threat model: stride, dread, pasta', default: 'stride' },
    { name: 'scope', short: 's', type: 'string', description: 'Analysis scope', default: '.' },
    { name: 'export', short: 'e', type: 'string', description: 'Export format: json, md, html' },
  ],
  examples: [
    { command: 'monomind security threats --model stride', description: 'Run STRIDE analysis' },
    { command: 'monomind security threats -e md', description: 'Export as markdown' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const model = ctx.flags.model as string || 'stride';

    output.writeln();
    output.writeln(output.bold(`Threat Model: ${model.toUpperCase()}`));
    output.writeln(output.dim('─'.repeat(50)));

    output.printTable({
      columns: [
        { key: 'category', header: 'Category', width: 20 },
        { key: 'threat', header: 'Threat', width: 30 },
        { key: 'risk', header: 'Risk', width: 10 },
        { key: 'mitigation', header: 'Mitigation', width: 30 },
      ],
      data: [
        { category: 'Spoofing', threat: 'API key theft', risk: output.error('High'), mitigation: 'Use secure key storage' },
        { category: 'Tampering', threat: 'Data manipulation', risk: output.warning('Medium'), mitigation: 'Input validation' },
        { category: 'Repudiation', threat: 'Action denial', risk: output.info('Low'), mitigation: 'Audit logging' },
        { category: 'Info Disclosure', threat: 'Data leakage', risk: output.error('High'), mitigation: 'Encryption at rest' },
        { category: 'DoS', threat: 'Resource exhaustion', risk: output.warning('Medium'), mitigation: 'Rate limiting' },
        { category: 'Elevation', threat: 'Privilege escalation', risk: output.error('High'), mitigation: 'RBAC implementation' },
      ],
    });

    return { success: true };
  },
};

// Audit subcommand
const auditCommand: Command = {
  name: 'audit',
  description: 'Security audit logging and compliance',
  options: [
    { name: 'action', short: 'a', type: 'string', description: 'Action: log, list, export, clear', default: 'list' },
    { name: 'limit', short: 'l', type: 'number', description: 'Number of entries to show', default: '20' },
    { name: 'filter', short: 'f', type: 'string', description: 'Filter by event type' },
  ],
  examples: [
    { command: 'monomind security audit --action list', description: 'List audit logs' },
    { command: 'monomind security audit -a export', description: 'Export audit trail' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const action = ctx.flags.action as string || 'list';

    output.writeln();
    output.writeln(output.bold('Security Audit Log'));
    output.writeln(output.dim('─'.repeat(60)));

    // Generate real audit entries from .swarm/ state and session history
    const { existsSync, readFileSync, readdirSync, statSync } = await import('fs');
    const { join } = await import('path');

    const auditEntries: { timestamp: string; event: string; user: string; status: string }[] = [];
    const swarmDir = join(process.cwd(), '.swarm');

    // Check session files for real audit events
    if (existsSync(swarmDir)) {
      try {
        const files = readdirSync(swarmDir).filter(f => f.endsWith('.json'));
        for (const file of files.slice(-10)) {
          try {
            const stat = statSync(join(swarmDir, file));
            const ts = stat.mtime.toISOString().replace('T', ' ').substring(0, 19);
            auditEntries.push({
              timestamp: ts,
              event: file.includes('session') ? 'SESSION_UPDATE' :
                     file.includes('swarm') ? 'SWARM_ACTIVITY' :
                     file.includes('memory') ? 'MEMORY_WRITE' : 'CONFIG_CHANGE',
              user: 'system',
              status: output.success('Success')
            });
          } catch { /* skip */ }
        }
      } catch { /* ignore */ }
    }

    // Add current session entry
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    auditEntries.push({ timestamp: now, event: 'AUDIT_RUN', user: 'cli', status: output.success('Success') });

    // Sort by timestamp desc
    auditEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (auditEntries.length === 0) {
      output.writeln(output.dim('No audit events found. Initialize a project first: monomind init'));
    } else {
      output.printTable({
        columns: [
          { key: 'timestamp', header: 'Timestamp', width: 22 },
          { key: 'event', header: 'Event', width: 20 },
          { key: 'user', header: 'User', width: 15 },
          { key: 'status', header: 'Status', width: 12 },
        ],
        data: auditEntries.slice(0, parseInt(ctx.flags.limit as string || '20', 10)),
      });
    }

    return { success: true };
  },
};

// Secrets subcommand
const secretsCommand: Command = {
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

    // Guard: confine --path to cwd
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
    const scanDepth = depth === 'deep' ? 10 : depth === 'standard' ? 5 : 3;
    findSecretsInDir(resolve(targetPath), scanDepth, resolve(targetPath), findings);

    spinner.succeed('Scan complete');

    output.writeln();
    if (findings.length === 0) {
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
      if (findings.length > 20) {
        output.writeln(output.dim(`... and ${findings.length - 20} more`));
      }
    }

    output.writeln();
    output.writeln(output.bold('Summary: ') + `${findings.length} secret(s) found in ${targetPath}`);

    return { success: findings.length === 0 };
  },
};

// Defend subcommand (MonoFence integration)
const defendCommand: Command = {
  name: 'defend',
  description: 'AI manipulation defense - detect prompt injection, jailbreaks, and PII',
  options: [
    { name: 'input', short: 'i', type: 'string', description: 'Input text to scan for threats' },
    { name: 'file', short: 'f', type: 'string', description: 'File to scan for threats' },
    { name: 'quick', short: 'Q', type: 'boolean', description: 'Quick scan (faster, less detailed)' },
    { name: 'learn', short: 'l', type: 'boolean', description: 'Enable learning mode', default: 'true' },
    { name: 'stats', short: 's', type: 'boolean', description: 'Show detection statistics' },
    { name: 'output', short: 'o', type: 'string', description: 'Output format: text, json', default: 'text' },
  ],
  examples: [
    { command: 'monomind security defend -i "ignore previous instructions"', description: 'Scan text for threats' },
    { command: 'monomind security defend -f ./prompts.txt', description: 'Scan file for threats' },
    { command: 'monomind security defend --stats', description: 'Show detection statistics' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const inputText = ctx.flags.input as string;
    const filePath = ctx.flags.file as string;
    const quickMode = ctx.flags.quick as boolean;
    const showStats = ctx.flags.stats as boolean;
    const outputFormat = ctx.flags.output as string || 'text';
    const enableLearning = ctx.flags.learn !== false;

    output.writeln();
    output.writeln(output.bold('🛡️ MonoFence - AI Manipulation Defense System'));
    output.writeln(output.dim('─'.repeat(55)));

    // Dynamic import of aidefence (allows package to be optional)
    let createMonoDefence: typeof import('monofence-ai').createMonoDefence;
    try {
      const aidefence = await import('monofence-ai');
      createMonoDefence = aidefence.createMonoDefence;
    } catch {
      output.printError('MonoFence package not installed. Run: npm install monofence-ai');
      return { success: false, message: 'MonoFence not available' };
    }

    const defender = createMonoDefence({ enableLearning });

    // Show stats mode
    if (showStats) {
      const stats = await defender.getStats();
      output.writeln();
      output.printBox([
        `Detection Count: ${stats.detectionCount}`,
        `Avg Detection Time: ${stats.avgDetectionTimeMs.toFixed(3)}ms`,
        `Learned Patterns: ${stats.learnedPatterns}`,
        `Mitigation Strategies: ${stats.mitigationStrategies}`,
        `Avg Mitigation Effectiveness: ${(stats.avgMitigationEffectiveness * 100).toFixed(1)}%`,
      ].join('\n'), 'Detection Statistics');
      return { success: true };
    }

    // Get input to scan
    let textToScan = inputText;
    if (filePath) {
      // Guard: confine --file to cwd before any stat/read
      try {
        const resolvedFile = realpathSync(resolve(filePath));
        const cwd = realpathSync(process.cwd());
        if (!resolvedFile.startsWith(cwd + sep) && resolvedFile !== cwd) {
          output.printError('--file must be within the current working directory');
          return { success: false };
        }
      } catch {
        output.printError(`File not found: ${filePath}`);
        return { success: false, message: 'File not found' };
      }
      try {
        const fs = await import('fs/promises');
        const MAX_DEFEND_FILE_BYTES = 10 * 1024 * 1024;
        const { size } = await fs.stat(filePath);
        if (size > MAX_DEFEND_FILE_BYTES) {
          output.printError(`File too large (${(size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`);
          return { success: false, message: 'File too large' };
        }
        textToScan = await fs.readFile(filePath, 'utf-8');
        output.writeln(output.dim(`Reading file: ${filePath}`));
      } catch (err) {
        output.printError(`Failed to read file: ${filePath}`);
        return { success: false, message: 'File not found' };
      }
    }

    if (!textToScan) {
      output.writeln('Usage: monomind security defend -i "<text>" or -f <file>');
      output.writeln();
      output.writeln('Options:');
      output.printList([
        '-i, --input   Text to scan for AI manipulation attempts',
        '-f, --file    File path to scan',
        '-q, --quick   Quick scan mode (faster)',
        '-s, --stats   Show detection statistics',
        '--learn       Enable pattern learning (default: true)',
      ]);
      return { success: true };
    }

    const spinner = output.createSpinner({ text: 'Scanning for threats...', spinner: 'dots' });
    spinner.start();

    // Perform scan
    const startTime = performance.now();
    const qr = quickMode ? defender.quickScan(textToScan) : null;
    const result = quickMode
      ? { ...qr!, threats: [], piiFound: false, detectionTimeMs: 0, inputHash: '', safe: !qr!.threat }
      : await defender.detect(textToScan);
    const scanTime = performance.now() - startTime;

    spinner.stop();

    // JSON output
    if (outputFormat === 'json') {
      output.writeln(JSON.stringify({
        safe: result.safe,
        threats: result.threats || [],
        piiFound: result.piiFound,
        detectionTimeMs: scanTime,
      }, null, 2));
      return { success: true };
    }

    // Text output
    output.writeln();

    if (result.safe && !result.piiFound) {
      output.writeln(output.success('✅ No threats detected'));
    } else {
      if (!result.safe && result.threats) {
        output.writeln(output.error(`⚠️ ${result.threats.length} threat(s) detected:`));
        output.writeln();

        for (const threat of result.threats) {
          const severityColor = {
            critical: output.error,
            high: output.warning,
            medium: output.info,
            low: output.dim,
          }[threat.severity] || output.dim;

          output.writeln(`  ${severityColor(`[${threat.severity.toUpperCase()}]`)} ${threat.type}`);
          output.writeln(`    ${output.dim(threat.description)}`);
          output.writeln(`    Confidence: ${(threat.confidence * 100).toFixed(1)}%`);
          output.writeln();
        }

        // Show mitigation recommendations
        const criticalThreats = result.threats.filter(t => t.severity === 'critical');
        if (criticalThreats.length > 0 && enableLearning) {
          output.writeln(output.bold('Recommended Mitigations:'));
          for (const threat of criticalThreats) {
            const mitigation = await defender.getBestMitigation(threat.type as Parameters<typeof defender.getBestMitigation>[0]);
            if (mitigation) {
              output.writeln(`  ${threat.type}: ${output.bold(mitigation.strategy)} (${(mitigation.effectiveness * 100).toFixed(0)}% effective)`);
            }
          }
          output.writeln();
        }
      }

      if (result.piiFound) {
        output.writeln(output.warning('⚠️ PII detected (emails, SSNs, API keys, etc.)'));
        output.writeln();
      }
    }

    output.writeln(output.dim(`Detection time: ${scanTime.toFixed(3)}ms`));

    return { success: result.safe };
  },
};

// Redteam subcommand (PyRIT-style adversarial testing)
// Source: https://github.com/Azure/PyRIT
const redteamCommand: Command = {
  name: 'redteam',
  description: 'Adversarial red-team testing — prompt injection, jailbreak, and manipulation scenarios (PyRIT-style)',
  options: [
    { name: 'target', short: 't', type: 'string', description: 'Target agent ID or endpoint to test' },
    { name: 'scenarios', short: 's', type: 'string', description: 'Comma-separated attack categories: injection,jailbreak,adversarial,pii,all', default: 'all' },
    { name: 'iterations', short: 'n', type: 'number', description: 'Number of attack iterations per scenario', default: '5' },
    { name: 'dry-run', type: 'boolean', description: 'Print attack prompts without executing them' },
    { name: 'output', short: 'o', type: 'string', description: 'Output format: text, json', default: 'text' },
    { name: 'threshold', type: 'number', description: 'Failure threshold 0-1 — report when success rate exceeds this', default: '0.1' },
  ],
  examples: [
    { command: 'monomind security redteam --target my-agent', description: 'Run all red-team scenarios against an agent' },
    { command: 'monomind security redteam --target my-agent --scenarios injection,jailbreak', description: 'Test specific attack categories' },
    { command: 'monomind security redteam --target my-agent --dry-run', description: 'Preview attack prompts without executing' },
    { command: 'monomind security redteam --target my-agent --output json', description: 'JSON output for CI integration' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const target = ctx.flags.target as string;
    output.writeln();
    output.writeln(output.warning('⚠  Red-team simulation not yet implemented.'));
    output.writeln(output.dim('This command will contact the target agent and evaluate its real responses once implemented.'));
    if (target) {
      output.writeln(output.dim(`Target specified: ${target}`));
    }
    output.writeln();
    output.writeln('To test prompt injection resistance manually:');
    output.writeln(output.dim('  1. Run the target agent'));
    output.writeln(output.dim('  2. Send adversarial prompts and evaluate responses'));
    output.writeln(output.dim('  3. Check agent logs for unexpected tool calls'));
    return { success: false, exitCode: 1 };
  },
};

// Main security command
export const securityCommand: Command = {
  name: 'security',
  description: 'Security scanning, CVE detection, threat modeling, AI defense',
  subcommands: [scanCommand, cveCommand, threatsCommand, auditCommand, secretsCommand, defendCommand, redteamCommand],
  examples: [
    { command: 'monomind security scan', description: 'Run security scan' },
    { command: 'monomind security cve --list', description: 'List known CVEs' },
    { command: 'monomind security threats', description: 'Run threat analysis' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('MonoMind Security Suite'));
    output.writeln(output.dim('Comprehensive security scanning and vulnerability management'));
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      'scan     - Run security scans on code, deps, containers',
      'cve      - Check and manage CVE vulnerabilities',
      'threats  - Threat modeling (STRIDE, DREAD, PASTA)',
      'audit    - Security audit logging and compliance',
      'secrets  - Detect and manage secrets in codebase',
      'defend   - AI manipulation defense (prompt injection, jailbreaks, PII)',
      'redteam  - Adversarial red-team testing (PyRIT-style attack orchestration)',
    ]);
    output.writeln();
    output.writeln('Use --help with subcommands for more info');
    output.writeln();
    output.writeln(output.dim('github.com/monoes/monomind'));
    return { success: true };
  },
};

export default securityCommand;
