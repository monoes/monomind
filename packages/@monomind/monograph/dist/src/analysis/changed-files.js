import { execFileSync } from 'child_process';
import * as path from 'path';
export class ChangedFilesError extends Error {
    kind;
    constructor(message, kind) {
        super(message);
        this.kind = kind;
        this.name = 'ChangedFilesError';
    }
}
// Leading '-' is rejected explicitly (not just by the character class) so a
// value like "--output=/tmp/pwned" can't be passed through and interpreted
// by git as a command-line option instead of a ref (git option injection).
const VALID_REF_RE = /^[a-zA-Z0-9\-_./@~^]+$/;
export function validateGitRef(ref) {
    if (ref.startsWith('-')) {
        throw new ChangedFilesError(`Invalid git ref: "${ref}". Refs must not start with '-' (would be interpreted as a git option)`, 'invalid_ref');
    }
    if (VALID_REF_RE.test(ref)) {
        return ref;
    }
    throw new ChangedFilesError(`Invalid git ref: "${ref}". Must match ${VALID_REF_RE.source}`, 'invalid_ref');
}
export async function getChangedFiles(root, sinceRef) {
    validateGitRef(sinceRef);
    let output;
    try {
        // execFileSync with array argv — no shell involved, so a `root` (cwd)
        // containing '"' or '$(...)' cannot break out and execute arbitrary
        // commands.
        output = execFileSync('git', ['diff', '--name-only', '-z', sinceRef, 'HEAD'], {
            cwd: root,
            encoding: 'utf8',
        });
    }
    catch (err) {
        throw new ChangedFilesError(`git diff failed: ${err instanceof Error ? err.message : String(err)}`, 'git_failed');
    }
    try {
        // Use NUL delimiter (-z) to handle non-ASCII filenames and paths with spaces;
        // git's default core.quotePath=true wraps such names in quotes with octal escapes.
        const files = output
            .split('\0')
            .filter((line) => line.length > 0)
            .map((relative) => path.resolve(root, relative));
        return new Set(files);
    }
    catch (err) {
        throw new ChangedFilesError(`Failed to parse git diff output: ${err instanceof Error ? err.message : String(err)}`, 'parse_error');
    }
}
export function filterResultsByChangedFiles(results, changedPaths) {
    return results.filter((item) => item.filePath != null && changedPaths.has(item.filePath));
}
//# sourceMappingURL=changed-files.js.map