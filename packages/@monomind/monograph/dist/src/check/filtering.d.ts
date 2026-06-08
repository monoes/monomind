export interface WorkspaceFilterOptions {
    root: string;
    patterns: string[];
}
export declare function filterToWorkspaces<T extends {
    filePath: string;
}>(results: T[], wsRoots: string[]): T[];
export declare function resolveWorkspaceFilters(root: string, patterns: string[], allWorkspaceRoots: string[]): string[];
export declare function resolveWorkspaceScope(root: string, workspacePatterns: string[] | undefined, changedWorkspaces: string | undefined, allWorkspaceRoots: string[]): string[];
export declare function getChangedFiles(root: string, since?: string, workspaces?: string[]): string[];
//# sourceMappingURL=filtering.d.ts.map