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
/**
 * Build a Map<packageName, packagePath> index from a WorkspacePackage array.
 * Use this when resolveWorkspaceImport will be called many times (e.g. per import
 * statement across a whole repo) to reduce resolution cost from O(N*I) to O(N+I).
 */
export declare function buildPackageIndex(packages: WorkspacePackage[]): Map<string, string>;
/**
 * O(1) workspace import resolution using a pre-built package index.
 * Falls back to prefix scan only for sub-path imports (e.g. `pkg/subpath`).
 */
export declare function resolveWorkspaceImportFromIndex(importSpecifier: string, index: Map<string, string>): string | null;
export declare const importResolverPhase: PipelinePhase<ImportResolverOutput>;
//# sourceMappingURL=import-resolver.d.ts.map