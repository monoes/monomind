export declare class ChangedFilesError extends Error {
    readonly kind: 'invalid_ref' | 'git_failed' | 'parse_error';
    constructor(message: string, kind: 'invalid_ref' | 'git_failed' | 'parse_error');
}
export declare function validateGitRef(ref: string): string;
export declare function getChangedFiles(root: string, sinceRef: string): Promise<Set<string>>;
export declare function filterResultsByChangedFiles<T extends {
    filePath?: string | null;
}>(results: T[], changedPaths: Set<string>): T[];
export declare function filterDuplicationByChangedFiles<T extends {
    instances: Array<{
        filePath: string;
    }>;
}>(groups: T[], changedPaths: Set<string>): T[];
//# sourceMappingURL=changed-files.d.ts.map