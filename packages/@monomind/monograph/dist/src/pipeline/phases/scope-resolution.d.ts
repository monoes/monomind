import type { PipelinePhase } from '../types.js';
export interface ScopeResolutionOutput {
    resolvedEdges: number;
    skippedDynamic: number;
    ambiguous: number;
    reexportEdges: number;
    orphanImportsRemoved: number;
    importsReconstructed: number;
}
interface CallSite {
    callerFileNodeId: string;
    callerFilePath: string;
    calleeRaw: string;
    form: 'method' | 'direct' | 'dynamic';
    receiverName?: string;
    methodName?: string;
}
export declare function extractGoCallSites(source: string, filePath: string, fileNodeId: string): CallSite[];
export declare function extractJavaCallSites(source: string, filePath: string, fileNodeId: string): CallSite[];
export declare function extractRustCallSites(source: string, filePath: string, fileNodeId: string): CallSite[];
/**
 * Build package-name → directory map from workspace package.json files.
 * Scans packages/ for package.json and maps npm name to its relative src path.
 */
export declare function buildWorkspacePackageMap(repoPath: string): Map<string, string>;
export declare function resolveModuleSpecifier(importerPath: string, specifier: string, repoPath: string, knownFiles: Set<string>, workspaceMap: Map<string, string>): string | null;
export declare const scopeResolutionPhase: PipelinePhase<ScopeResolutionOutput>;
export {};
//# sourceMappingURL=scope-resolution.d.ts.map