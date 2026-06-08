import type Database from 'better-sqlite3';
import { queryGraphData as queryGraph } from '../web/api.js';
import type { GraphData } from '../web/api.js';

export type { GraphData };

/**
 * Returns the full graph export: up to 2000 nodes, edges between those nodes,
 * and the community membership map. Delegates to queryGraph from web/api.ts
 * to stay consistent with the HTTP API shape.
 */
export function getGraphResource(db: Database.Database): GraphData {
  return queryGraph(db);
}
