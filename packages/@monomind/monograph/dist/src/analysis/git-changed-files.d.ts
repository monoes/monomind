export declare function validateGitRef(ref: string): void;
export declare function resolveGitToplevel(cwd: string): string;
export declare function collectGitPaths(root: string, since?: string): string[];
export declare function tryGetChangedFiles(root: string, since?: string): string[] | null;
export declare function filterResultsByChangedFiles<T extends {
    filePath: string;
}>(results: T[], changedFiles: string[]): T[];
export declare function getChangedFilesSince(root: string, since: string): string[];
//# sourceMappingURL=git-changed-files.d.ts.map