export interface WorkspaceInfo {
    name: string;
    rootPath: string;
    packageJson: Record<string, unknown>;
}
export interface WorkspaceDiagnostic {
    kind: 'undeclaredWorkspace' | 'missingPackageJson' | 'parseError';
    message: string;
    path: string;
}
export interface WorkspaceConfig {
    root: string;
    patterns: string[];
}
export declare function discoverWorkspaces(root: string): WorkspaceInfo[];
export declare function findUndeclaredWorkspaces(root: string, declared: WorkspaceInfo[], ignores?: string[]): WorkspaceDiagnostic[];
export declare function parseTsconfigRootDir(tsconfigPath: string): string | null;
export interface EnhancedWorkspaceDiagnostic extends WorkspaceDiagnostic {
    suggestion: string;
}
export declare function findUndeclaredWorkspacesEnhanced(root: string, declared: WorkspaceInfo[], ignores?: string[]): EnhancedWorkspaceDiagnostic[];
export declare function validateWorkspaceDeclarations(declared: WorkspaceInfo[], root: string): WorkspaceDiagnostic[];
//# sourceMappingURL=workspace.d.ts.map