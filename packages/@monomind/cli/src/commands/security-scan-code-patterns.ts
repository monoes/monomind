import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { output } from '../output.js';
import {
  CODE_PATTERN_SCAN_EXTENSIONS,
  createScanCoverage,
  type ScanCoverage,
  type SecretFinding,
} from './security-scan-secrets.js';

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
      while (pattern.exec(lines[i]) !== null) {
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
