export type Confidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
export type FileType = 'code' | 'document' | 'paper' | 'image' | 'unknown';
export interface GraphNode {
    id: string;
    label: string;
    fileType: FileType;
    sourceFile: string;
    sourceLocation?: string;
    community?: number;
    degree?: number;
    [key: string]: unknown;
}
export interface GraphEdge {
    source: string;
    target: string;
    relation: string;
    confidence: Confidence;
    confidenceScore?: number;
    sourceFile?: string;
    sourceLocation?: string;
    weight?: number;
}
export interface ExtractionResult {
    nodes: GraphNode[];
    edges: GraphEdge[];
    hyperedges?: HyperEdge[];
    filesProcessed: number;
    fromCache: number;
    errors: string[];
}
export interface HyperEdge {
    label: string;
    nodes: string[];
    confidence: Confidence;
    confidenceScore?: number;
}
export interface GraphAnalysis {
    godNodes: GodNode[];
    surprises: SurpriseEdge[];
    communities: Record<number, string[]>;
    stats: GraphStats;
}
export interface GodNode {
    id: string;
    label: string;
    degree: number;
    community?: number;
    sourceFile: string;
    neighbors: string[];
}
export interface SurpriseEdge {
    from: string;
    fromCommunity: number;
    fromFile: string;
    to: string;
    toCommunity: number;
    toFile: string;
    relation: string;
    confidence: Confidence;
    score: number;
}
export interface GraphStats {
    nodes: number;
    edges: number;
    communities: number;
    confidence: Record<Confidence, number>;
    fileTypes: Record<string, number>;
    topRelations: Record<string, number>;
    isDirected: boolean;
    graphPath?: string;
}
export interface SerializedGraph {
    version: string;
    builtAt: string;
    projectPath: string;
    nodes: Array<{
        id: string;
    } & Record<string, unknown>>;
    links: Array<{
        source: string;
        target: string;
    } & Record<string, unknown>>;
    directed: boolean;
    multigraph: boolean;
}
export interface BuildOptions {
    codeOnly?: boolean;
    outputDir?: string;
    maxFileSizeBytes?: number;
    excludePatterns?: string[];
    languages?: string[];
}
export interface ClassifiedFile {
    path: string;
    fileType: FileType;
    language?: string;
    sizeBytes: number;
}
export interface GraphQuestion {
    type: 'AMBIGUOUS_EDGE' | 'BRIDGE_NODE' | 'INFERRED_GOD_NODE' | 'ISOLATED_NODE' | 'LOW_COHESION_COMMUNITY';
    question: string;
    nodes: string[];
    priority: 'high' | 'medium' | 'low';
}
export interface GraphDiff {
    addedNodes: string[];
    removedNodes: string[];
    addedEdges: Array<{
        source: string;
        target: string;
        relation: string;
    }>;
    removedEdges: Array<{
        source: string;
        target: string;
        relation: string;
    }>;
    communityChanges: Array<{
        node: string;
        oldCommunity: number;
        newCommunity: number;
    }>;
}
//# sourceMappingURL=types.d.ts.map