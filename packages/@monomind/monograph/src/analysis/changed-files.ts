import { execSync } from 'child_process';
import * as path from 'path';

export class ChangedFilesError extends Error {
  constructor(message: string, public readonly kind: 'invalid_ref' | 'git_failed' | 'parse_error') {
    super(message);
    this.name = 'ChangedFilesError';
  }
}

const VALID_REF_RE = /^[a-zA-Z0-9\-_./@~^]+$/;

export function validateGitRef(ref: string): string {
  if (VALID_REF_RE.test(ref)) {
    return ref;
  }
  throw new ChangedFilesError(
    `Invalid git ref: "${ref}". Must match ${VALID_REF_RE.source}`,
    'invalid_ref',
  );
}

export async function getChangedFiles(root: string, sinceRef: string): Promise<Set<string>> {
  validateGitRef(sinceRef);

  let output: string;
  try {
    output = execSync(`git diff --name-only ${sinceRef} HEAD`, {
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
    const files = output
      .split('\n')
      .map((line) => line.trim())
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

export function filterDuplicationByChangedFiles<
  T extends { instances: Array<{ filePath: string }> },
>(groups: T[], changedPaths: Set<string>): T[] {
  return groups.filter((group) =>
    group.instances.some((instance) => changedPaths.has(instance.filePath)),
  );
}
