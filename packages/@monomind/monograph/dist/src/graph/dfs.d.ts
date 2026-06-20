export interface DfsNode {
    id: string;
    depth: number;
}
export interface DfsOptions {
    maxDepth?: number;
}
export interface DfsResult {
    visited: DfsNode[];
    maxDepth: number;
    nodeCount: number;
}
export declare function dfsTraversal(startId: string, adjacency: Map<string, string[]>, visitor: (node: DfsNode) => void, options?: DfsOptions): void;
/** Collect all reachable nodes from startId via DFS, returning structured result. */
export declare function dfsCollect(startId: string, adjacency: Map<string, string[]>, options?: DfsOptions): DfsResult;
/** BFS level-order traversal — useful when shortest-path distance matters more than DFS order. */
export declare function bfsTraversal(startId: string, adjacency: Map<string, string[]>, visitor: (node: DfsNode) => void, options?: DfsOptions): void;
/**
 * Format a DfsResult as structured text for LLM consumption.
 * Groups nodes by depth level for easy reading.
 */
export declare function formatDfsResult(result: DfsResult, startId: string): string;
//# sourceMappingURL=dfs.d.ts.map