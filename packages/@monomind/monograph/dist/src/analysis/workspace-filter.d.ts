export interface SubsetFilter {
    roots: string[];
    test(filePath: string): boolean;
}
export declare function createSubsetFilter(roots: string[]): SubsetFilter;
export declare function filterToWorkspaces<T extends {
    filePath?: string | null;
}>(items: T[], workspaceRoots: string[]): T[];
export declare function filterGroupsByWorkspace<T extends {
    instances: Array<{
        filePath: string;
    }>;
}>(groups: T[], workspaceRoots: string[]): T[];
export interface WorkspaceFilterPattern {
    pattern: string;
    negated: boolean;
    isGlob: boolean;
}
/** Parse a workspace filter string into a structured pattern. */
export declare function parseWorkspaceFilterPattern(raw: string): WorkspaceFilterPattern;
/** Match a workspace name against a gitignore-style pattern (supports ! negation and globs). */
export declare function matchWorkspacePattern(name: string, pattern: WorkspaceFilterPattern): boolean;
/** Resolve a list of workspace names against a list of filter patterns with negation. */
export declare function resolveWorkspaceFilters(names: string[], patterns: string[]): string[];
/** Format available workspace names for display, capping at 10 with overflow count. */
export declare function formatAvailableWorkspaces(names: string[]): string;
/** Map a set of changed file paths to workspace indices that contain at least one changed file. */
export declare function workspacesContainingAny(changedFiles: string[], workspaceRoots: string[]): number[];
//# sourceMappingURL=workspace-filter.d.ts.map