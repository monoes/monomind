export interface WorkspacePackage {
    name: string;
    root: string;
    hasChanges: boolean;
}
export declare function getChangedWorkspaces(projectRoot: string, sinceRef: string, workspaceRoots?: string[]): WorkspacePackage[];
export declare function resolveChangedWorkspaceRoots(projectRoot: string, sinceRef: string, workspaceRoots?: string[]): string[];
//# sourceMappingURL=changed-workspaces.d.ts.map