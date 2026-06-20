export type TraceReason = 'no_references' | 'only_re_exported' | 'self_import' | 'has_references';
export interface ReferenceLocation {
    filePath: string;
    line: number;
    col: number;
}
export interface ReExportChain {
    path: string;
    exportName: string;
}
export interface ExportTrace {
    file: string;
    exportName: string;
    isUsed: boolean;
    directReferences: ReferenceLocation[];
    reExportChains: ReExportChain[];
    reason: TraceReason;
}
export interface FileTrace {
    file: string;
    exports: Array<{
        name: string;
        isUsed: boolean;
        line: number;
    }>;
    importsFrom: string[];
    importedBy: string[];
    reExports: Array<{
        name: string;
        fromFile: string;
    }>;
}
export interface DependencyTrace {
    packageName: string;
    directImporters: string[];
    transitiveImporters: string[];
    isUsed: boolean;
}
export interface CloneInstance {
    filePath: string;
    startLine: number;
    endLine: number;
    similarity: number;
}
export interface CloneTrace {
    sourceFile: string;
    sourceLine: number;
    matchingInstances: CloneInstance[];
    groupId?: number;
}
export interface GraphNode {
    id: string;
    filePath?: string;
    name: string;
    isExported: boolean;
    startLine?: number;
}
interface GraphEdge {
    sourceId: string;
    targetId: string;
    relation: string;
}
interface Graph {
    nodes: GraphNode[];
    edges: GraphEdge[];
}
/** Build an O(1) id→node index. Pass to the trace functions when calling multiple times on the same graph. */
export declare function buildNodeIndex(graph: Graph): Map<string, GraphNode>;
export declare function traceExport(graph: Graph, file: string, exportName: string, nodeIndex?: Map<string, GraphNode>): ExportTrace;
export declare function traceFile(graph: Graph, file: string, nodeIndex?: Map<string, GraphNode>): FileTrace;
export declare function traceDependency(importEdges: Array<{
    sourceFile: string;
    targetPackage: string;
}>, packageName: string): DependencyTrace;
export declare function traceClone(cloneGroups: Array<{
    id: number;
    instances: CloneInstance[];
}>, file: string, line: number): CloneTrace;
export {};
//# sourceMappingURL=trace.d.ts.map