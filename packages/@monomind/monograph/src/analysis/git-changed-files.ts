import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { validateGitRef as sharedValidateGitRef } from './git-ref.js';

/** @deprecated use git-ref.js's validateGitRef directly for new code. Kept
 *  as a void-returning wrapper so existing call sites in this file don't
 *  need to change shape. */
export function validateGitRef(ref: string): void {
  sharedValidateGitRef(ref);
}

export function resolveGitToplevel(cwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return cwd;
  }
}

export function collectGitPaths(root: string, since?: string): string[] {
  try {
    // execFileSync with an array argv — no shell involved, so `since` and
    // `root` cannot break out via `;`/`&&`/`$(...)` even without the
    // DANGEROUS_PATTERNS deny-list this file used to rely on instead
    // (the deny-list was also the only implementation among the four
    // duplicated validators that rejected the common `main..HEAD` range).
    let args: string[];
    if (since) {
      sharedValidateGitRef(since);
      args = ['diff', '--name-only', '--diff-filter=ACM', since];
    } else {
      args = ['ls-files'];
    }
    const output = execFileSync('git', args, { cwd: root, encoding: 'utf8' });
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
