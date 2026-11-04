/**
 * Security scan commands — code/dependency scanning and secret detection
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { output } from '../output.js';

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
      while (pattern.exec(lines[i]) !== null) {
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
