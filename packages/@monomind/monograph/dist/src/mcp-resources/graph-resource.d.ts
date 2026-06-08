import type Database from 'better-sqlite3';
import type { GraphData } from '../web/api.js';
export type { GraphData };
/**
 * Returns the full graph export: up to 2000 nodes, edges between those nodes,
 * and the community membership map. Delegates to queryGraph from web/api.ts
 * to stay consistent with the HTTP API shape.
 */
export declare function getGraphResource(db: Database.Database): GraphData;
//# sourceMappingURL=graph-resource.d.ts.map