import { execSync } from 'child_process';
import * as path from 'path';
export class ChangedFilesError extends Error {
    kind;
    constructor(message, kind) {
        super(message);
        this.kind = kind;
        this.name = 'ChangedFilesError';
    }
}
const VALID_REF_RE = /^[a-zA-Z0-9\-_./@~^]+$/;
export function validateGitRef(ref) {
    if (VALID_REF_RE.test(ref)) {
        return ref;
    }
    throw new ChangedFilesError(`Invalid git ref: "${ref}". Must match ${VALID_REF_RE.source}`, 'invalid_ref');
}
export async function getChangedFiles(root, sinceRef) {
    validateGitRef(sinceRef);
    let output;
    try {
        output = execSync(`git diff --name-only -z ${sinceRef} HEAD`, {
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
export function filterDuplicationByChangedFiles(groups, changedPaths) {
    return groups.filter((group) => group.instances.some((instance) => changedPaths.has(instance.filePath)));
}
//# sourceMappingURL=changed-files.js.map