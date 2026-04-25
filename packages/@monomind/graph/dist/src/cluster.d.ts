import type Graph from 'graphology';
export declare function detectCommunities(graph: Graph): Promise<Record<number, string[]>>;
export declare function cohesionScore(graph: Graph, communityNodes: string[]): number;
export declare function splitOversizedCommunities(graph: Graph, communities: Record<number, string[]>, threshold?: number): Record<number, string[]>;
//# sourceMappingURL=cluster.d.ts.map