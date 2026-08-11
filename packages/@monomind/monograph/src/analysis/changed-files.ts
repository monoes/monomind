import { execFileSync } from 'child_process';
import * as path from 'path';
import { validateGitRef as sharedValidateGitRef, InvalidGitRefError } from './git-ref.js';

export class ChangedFilesError extends Error {
  constructor(message: string, public readonly kind: 'invalid_ref' | 'git_failed' | 'parse_error') {
    super(message);
    this.name = 'ChangedFilesError';
  }
}

/** @deprecated use git-ref.js's validateGitRef directly for new code — kept
 *  here so existing importers of this module's validateGitRef keep getting
 *  a typed ChangedFilesError('invalid_ref') instead of InvalidGitRefError. */
export function validateGitRef(ref: string): string {
  try {
    return sharedValidateGitRef(ref);
  } catch (err) {
    if (err instanceof InvalidGitRefError) {
      throw new ChangedFilesError(err.message, 'invalid_ref');
    }
    throw err;
  }
}

export async function getChangedFiles(root: string, sinceRef: string): Promise<Set<string>> {
  validateGitRef(sinceRef);

  let output: string;
  try {
    // execFileSync with array argv — no shell involved, so a `root` (cwd)
    // containing '"' or '$(...)' cannot break out and execute arbitrary
    // commands.
    output = execFileSync('git', ['diff', '--name-only', '-z', sinceRef, 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    });
  } catch (err) {
    throw new ChangedFilesError(
      `git diff failed: ${err instanceof Error ? err.message : String(err)}`,
      'git_failed',
    );
  }

  try {
    // Use NUL delimiter (-z) to handle non-ASCII filenames and paths with spaces;
    // git's default core.quotePath=true wraps such names in quotes with octal escapes.
    const files = output
      .split('\0')
      .filter((line) => line.length > 0)
      .map((relative) => path.resolve(root, relative));
    return new Set(files);
  } catch (err) {
    throw new ChangedFilesError(
      `Failed to parse git diff output: ${err instanceof Error ? err.message : String(err)}`,
      'parse_error',
    );
  }
}

export function filterResultsByChangedFiles<T extends { filePath?: string | null }>(
  results: T[],
  changedPaths: Set<string>,
): T[] {
  return results.filter((item) => item.filePath != null && changedPaths.has(item.filePath));
}

