import type { BuildOptions, GraphAnalysis, SerializedGraph, GraphQuestion } from './types.js';
/**
 * Main entry point for building a knowledge graph from a codebase.
 *
 * Orchestrates file collection, per-file extraction (with caching),
 * graph construction via graphology, community detection, and serialisation.
 *
 * @param projectPath - Absolute path to the root of the codebase to analyse.
 * @param options     - Optional build configuration.
 * @returns           - Serialized graph + analysis summary.
 */
export interface BuildResult {
    graph: SerializedGraph;
    analysis: GraphAnalysis;
    questions: GraphQuestion[];
    corpusWarnings: string[];
    filesProcessed: number;
    fromCache: number;
    graphPath: string;
    reportPath: string;
}
export declare function buildGraph(projectPath: string, options?: BuildOptions): Promise<BuildResult>;
//# sourceMappingURL=pipeline.d.ts.map