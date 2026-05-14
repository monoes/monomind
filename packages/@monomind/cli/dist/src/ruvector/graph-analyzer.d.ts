/**
 * Graph Analyzer Module
 *
 * Provides code dependency graph analysis using ruvector's graph algorithms:
 * - MinCut for code boundary detection (refactoring suggestions)
 * - Louvain for module/community detection
 * - Circular dependency detection
 * - DOT format export for visualization
 *
 * Falls back to built-in implementations when @ruvector/wasm is not available.
 *
 * @module @monoes/cli/ruvector/graph-analyzer
 */
/**
 * Clear all graph caches
 */
export declare function clearGraphCaches(): void;
/**
 * Get cache statistics
 */
export declare function getGraphCacheStats(): {
    graphCacheSize: number;
    analysisCacheSize: number;
};
/**
 * Node in the dependency graph
 */
export interface GraphNode {
    id: string;
    path: string;
    name: string;
    type: 'file' | 'module' | 'package';
    imports: string[];
    exports: string[];
    size: number;
    complexity?: number;
}
/**
 * Edge in the dependency graph
 */
export interface GraphEdge {
    source: string;
    target: string;
    type: 'import' | 'require' | 'dynamic' | 're-export';
    weight: number;
}
/**
 * Dependency graph representation
 */
export interface DependencyGraph {
    nodes: Map<string, GraphNode>;
    edges: GraphEdge[];
    metadata: {
        rootDir: string;
        totalFiles: number;
        totalEdges: number;
        buildTime: number;
    };
}
/**
 * MinCut result representing a natural boundary in the codebase
 */
export interface MinCutBoundary {
    cutValue: number;
    partition1: string[];
    partition2: string[];
    cutEdges: GraphEdge[];
    suggestion: string;
}
/**
 * Community/module detection result
 */
export interface ModuleCommunity {
    id: number;
    members: string[];
    cohesion: number;
    centralNode?: string;
    suggestedName?: string;
}
/**
 * Circular dependency info
 */
export interface CircularDependency {
    cycle: string[];
    severity: 'low' | 'medium' | 'high';
    suggestion: string;
}
/**
 * Analysis result
 */
export interface GraphAnalysisResult {
    graph: DependencyGraph;
    boundaries?: MinCutBoundary[];
    communities?: ModuleCommunity[];
    circularDependencies: CircularDependency[];
    statistics: {
        nodeCount: number;
        edgeCount: number;
        avgDegree: number;
        maxDegree: number;
        density: number;
        componentCount: number;
    };
}
/**
 * Interface for ruvector graph operations
 */
interface IRuVectorGraph {
    mincut(nodes: string[], edges: Array<[string, string, number]>): {
        cutValue: number;
        partition1: string[];
        partition2: string[];
        cutEdges: Array<[string, string]>;
    };
    louvain(nodes: string[], edges: Array<[string, string, number]>): {
        communities: Array<{
            id: number;
            members: string[];
        }>;
        modularity: number;
    };
}
/**
 * Attempt to load ruvector graph algorithms
 */
declare function loadRuVector(): Promise<IRuVectorGraph | null>;
/**
 * Build dependency graph from source directory (with caching)
 */
export declare function buildDependencyGraph(rootDir: string, options?: {
    include?: string[];
    exclude?: string[];
    maxDepth?: number;
    skipCache?: boolean;
}): Promise<DependencyGraph>;
/**
 * Stoer-Wagner MinCut algorithm (fallback when ruvector not available)
 * Finds minimum cut with deterministic result
 */
declare function fallbackMinCut(nodes: string[], edges: Array<[string, string, number]>): {
    cutValue: number;
    partition1: string[];
    partition2: string[];
    cutEdges: Array<[string, string]>;
};
/**
 * Louvain community detection algorithm (fallback when ruvector not available)
 * Greedy modularity optimization
 */
declare function fallbackLouvain(nodes: string[], edges: Array<[string, string, number]>): {
    communities: Array<{
        id: number;
        members: string[];
    }>;
    modularity: number;
};
/**
 * Detect circular dependencies using DFS
 */
export declare function detectCircularDependencies(graph: DependencyGraph): CircularDependency[];
/**
 * Analyze graph boundaries using MinCut algorithm
 */
export declare function analyzeMinCutBoundaries(graph: DependencyGraph, numPartitions?: number): Promise<MinCutBoundary[]>;
/**
 * Analyze module communities using Louvain algorithm
 */
export declare function analyzeModuleCommunities(graph: DependencyGraph): Promise<ModuleCommunity[]>;
/**
 * Full graph analysis (with caching)
 */
export declare function analyzeGraph(rootDir: string, options?: {
    includeBoundaries?: boolean;
    includeModules?: boolean;
    numPartitions?: number;
    skipCache?: boolean;
}): Promise<GraphAnalysisResult>;
/**
 * Export graph to DOT format for visualization
 */
export declare function exportToDot(result: GraphAnalysisResult, options?: {
    includeLabels?: boolean;
    colorByCommunity?: boolean;
    highlightCycles?: boolean;
}): string;
export { loadRuVector, fallbackMinCut, fallbackLouvain, };
//# sourceMappingURL=graph-analyzer.d.ts.map