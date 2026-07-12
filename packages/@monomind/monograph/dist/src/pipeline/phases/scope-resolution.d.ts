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
/** Invalidate the cached workspace package map for a repo — call at the start
 * of each build so long-lived processes (watch mode) pick up package.json
 * additions/removals instead of serving a stale map from a prior build. */
export declare function clearWorkspacePackageMapCache(repoPath: string): void;
/**
 * Build package-name → directory map from workspace package.json files.
 * Scans packages/ for package.json and maps npm name to its relative src path.
 * Cached per repoPath — multiple pipeline phases (cross-file, scope-resolution,
 * the latter's own re-export loop) call this per-file/per-edge within the same
 * build, and the workspace's package.json set doesn't change mid-build.
 */
export declare function buildWorkspacePackageMap(repoPath: string): Map<string, string>;
export declare function resolveModuleSpecifier(importerPath: string, specifier: string, repoPath: string, knownFiles: Set<string>, workspaceMap: Map<string, string>): string | null;
export declare const scopeResolutionPhase: PipelinePhase<ScopeResolutionOutput>;
export {};
//# sourceMappingURL=scope-resolution.d.ts.map