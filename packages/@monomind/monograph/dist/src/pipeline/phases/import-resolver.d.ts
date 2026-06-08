import type { PipelinePhase } from '../types.js';
export interface WorkspacePackage {
    name: string;
    path: string;
}
export interface ImportResolverOutput {
    workspacePackages: WorkspacePackage[];
    resolvedCount: number;
}
export declare function detectWorkspacePackages(repoPath: string): WorkspacePackage[];
export declare function resolveWorkspaceImport(importSpecifier: string, packages: WorkspacePackage[]): string | null;
export declare const importResolverPhase: PipelinePhase<ImportResolverOutput>;
//# sourceMappingURL=import-resolver.d.ts.map