import type Database from 'better-sqlite3';
import type { MonographNode } from '../types.js';
export interface GraphQueryInput {
    query: string;
    mode?: 'bfs' | 'dfs';
    /** Direction of edge traversal. 'both' includes incoming edges (callers) and outgoing (callees). Default: 'out' */
    direction?: 'out' | 'in' | 'both';
    tokenBudget?: number;
    depth?: number;
}
export interface GraphQueryResult {
    nodes: MonographNode[];
    mode: 'bfs' | 'dfs';
    truncated: boolean;
    tokenEstimate: number;
}
export declare function queryGraph(db: Database.Database, input: GraphQueryInput): GraphQueryResult;
//# sourceMappingURL=graph-query.d.ts.map