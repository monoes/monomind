import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import Graph from 'graphology';
/**
 * Serialize a graphology graph to disk as a JSON file.
 * Creates the output directory if it does not exist.
 * Returns the absolute path to the written file.
 */
export function saveGraph(graph, outputDir, projectPath) {
    mkdirSync(outputDir, { recursive: true });
    const graphPath = join(outputDir, 'graph.json');
    const nodes = [];
    graph.forEachNode((id, attrs) => nodes.push({ id, ...attrs }));
    const links = [];
    graph.forEachEdge((_, attrs, source, target) => links.push({ source, target, ...attrs }));
    const serialized = {
        version: '1.0.0',
        builtAt: new Date().toISOString(),
        projectPath,
        nodes,
        links,
        directed: graph.type === 'directed',
        multigraph: graph.multi,
    };
    writeFileSync(graphPath, JSON.stringify(serialized, null, 2), 'utf-8');
    return graphPath;
}
/**
 * Deserialize a graph from a previously saved JSON file.
 * Silently skips edges whose endpoints are missing from the node list.
 */
export function loadGraph(graphPath) {
    const raw = readFileSync(graphPath, 'utf-8');
    const data = JSON.parse(raw);
    const graph = new Graph({
        type: data.directed ? 'directed' : 'undirected',
        multi: false,
    });
    for (const node of data.nodes) {
        const { id, ...attrs } = node;
        graph.addNode(id, attrs);
    }
    for (const link of data.links) {
        const { source, target, ...attrs } = link;
        if (!graph.hasNode(source) || !graph.hasNode(target))
            continue;
        try {
            graph.addEdge(source, target, attrs);
        }
        catch {
            // Duplicate edge — ignore
        }
    }
    return graph;
}
/**
 * Return true when a graph.json already exists in the given output directory.
 */
export function graphExists(outputDir) {
    return existsSync(join(outputDir, 'graph.json'));
}
/**
 * Return the canonical path to graph.json inside an output directory.
 */
export function getGraphPath(outputDir) {
    return join(outputDir, 'graph.json');
}
//# sourceMappingURL=export.js.map