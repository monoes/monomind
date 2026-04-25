import Graph from 'graphology';
/**
 * Serialize a graphology graph to disk as a JSON file.
 * Creates the output directory if it does not exist.
 * Returns the absolute path to the written file.
 */
export declare function saveGraph(graph: Graph, outputDir: string, projectPath: string): string;
/**
 * Deserialize a graph from a previously saved JSON file.
 * Silently skips edges whose endpoints are missing from the node list.
 */
export declare function loadGraph(graphPath: string): Graph;
/**
 * Return true when a graph.json already exists in the given output directory.
 */
export declare function graphExists(outputDir: string): boolean;
/**
 * Return the canonical path to graph.json inside an output directory.
 */
export declare function getGraphPath(outputDir: string): string;
//# sourceMappingURL=export.d.ts.map