export interface DfsNode {
    id: string;
    depth: number;
}
export interface DfsOptions {
    maxDepth?: number;
}
export declare function dfsTraversal(startId: string, adjacency: Map<string, string[]>, visitor: (node: DfsNode) => void, options?: DfsOptions): void;
//# sourceMappingURL=dfs.d.ts.map