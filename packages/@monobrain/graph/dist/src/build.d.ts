import Graph from 'graphology';
import type { ExtractionResult } from './types.js';
/**
 * Build a graphology Graph from extracted nodes and edges.
 * Deduplicates nodes by id, merges parallel edges with higher weight.
 */
export declare function buildGraph(extraction: ExtractionResult): Graph;
//# sourceMappingURL=build.d.ts.map