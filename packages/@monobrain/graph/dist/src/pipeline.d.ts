import type { BuildOptions, GraphAnalysis, SerializedGraph } from './types.js';
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
export declare function buildGraph(projectPath: string, options?: BuildOptions): Promise<{
    graph: SerializedGraph;
    analysis: GraphAnalysis;
}>;
//# sourceMappingURL=pipeline.d.ts.map