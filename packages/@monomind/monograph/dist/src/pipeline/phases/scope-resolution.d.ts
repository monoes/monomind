import type { PipelinePhase } from '../types.js';
export interface ScopeResolutionOutput {
    resolvedEdges: number;
    skippedDynamic: number;
    ambiguous: number;
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
export declare const scopeResolutionPhase: PipelinePhase<ScopeResolutionOutput>;
export {};
//# sourceMappingURL=scope-resolution.d.ts.map