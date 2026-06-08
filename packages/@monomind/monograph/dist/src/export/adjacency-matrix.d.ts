import type { MonographNode, MonographEdge } from '../types.js';
import type { MonographDb } from '../storage/db.js';
export interface AdjacencyMatrix {
    /** Ordered node ids (row/column headers). */
    nodeIds: string[];
    /** Ordered node names, parallel to nodeIds. */
    nodeNames: string[];
    /** n×n matrix where matrix[i][j] = number of edges from nodeIds[i] to nodeIds[j]. */
    matrix: number[][];
}
/**
 * Build an adjacency matrix from a set of nodes and edges.
 *
 * Multi-edges (same source→target pair) are counted, so the matrix
 * contains edge-counts rather than simple 0/1 booleans.
 *
 * @param nodes - The node list (defines row/column order).
 * @param edges - The edge list.
 * @returns An AdjacencyMatrix with nodeIds, nodeNames, and the n×n matrix.
 */
export declare function buildAdjacencyMatrix(nodes: MonographNode[], edges: MonographEdge[]): AdjacencyMatrix;
/**
 * Build an adjacency matrix directly from a MonographDb.
 * Optionally restrict to a subset of node ids.
 */
export declare function buildAdjacencyMatrixFromDb(db: MonographDb, nodeIds?: string[]): AdjacencyMatrix;
/**
 * Serialise an AdjacencyMatrix to a CSV string.
 * The first row and first column are node names (headers).
 */
export declare function adjacencyMatrixToCsv(am: AdjacencyMatrix): string;
//# sourceMappingURL=adjacency-matrix.d.ts.map