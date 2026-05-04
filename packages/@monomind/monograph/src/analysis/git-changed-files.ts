import { execSync } from 'node:child_process';
import * as path from 'node:path';

const GIT_REF_ALLOWLIST = /^[a-zA-Z0-9._/~^@{}[\]:-]+$/;
const DANGEROUS_PATTERNS = /\.\.|`|\$\(|;|&&|\|\|/;

export function validateGitRef(ref: string): void {
  if (!GIT_REF_ALLOWLIST.test(ref) || DANGEROUS_PATTERNS.test(ref)) {
    throw new Error(`Invalid git ref: ${JSON.stringify(ref)} — only alphanumeric, dots, slashes, hyphens, and common git ref characters are allowed`);
  }
}

export function resolveGitToplevel(cwd: string): string {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8' }).trim();
  } catch {
    return cwd;
  }
}

export function collectGitPaths(root: string, since?: string): string[] {
  try {
    let cmd: string;
    if (since) {
      validateGitRef(since);
      cmd = `git diff --name-only --diff-filter=ACM ${since}`;
    } else {
      cmd = 'git ls-files';
    }
    const output = execSync(cmd, { cwd: root, encoding: 'utf8' });
    return output
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .map(l => path.resolve(root, l));
  } catch {
    return [];
  }
}

export function tryGetChangedFiles(root: string, since?: string): string[] | null {
  if (!since) return null;
  try {
    validateGitRef(since);
    return collectGitPaths(root, since);
  } catch {
    return null;
  }
}

export function filterResultsByChangedFiles<T extends { filePath: string }>(
  results: T[],
  changedFiles: string[],
): T[] {
  const changedSet = new Set(changedFiles.map(f => path.normalize(f)));
  return results.filter(r => changedSet.has(path.normalize(r.filePath)));
}

export function getChangedFilesSince(root: string, since: string): string[] {
  validateGitRef(since);
  return collectGitPaths(root, since);
}
