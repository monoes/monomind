import { queryGraphData as queryGraph } from '../web/api.js';
/**
 * Returns the full graph export: up to 2000 nodes, edges between those nodes,
 * and the community membership map. Delegates to queryGraph from web/api.ts
 * to stay consistent with the HTTP API shape.
 */
export function getGraphResource(db) {
    return queryGraph(db);
}
//# sourceMappingURL=graph-resource.js.map