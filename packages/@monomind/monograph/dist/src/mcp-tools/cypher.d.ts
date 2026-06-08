import type Database from 'better-sqlite3';
import type { CypherResult } from '../query/cypher-parser.js';
export type { CypherResult };
/**
 * Execute a restricted read-only Cypher-style query against the Monograph graph.
 *
 * @param db - Open better-sqlite3 database handle
 * @param query - Cypher MATCH query string
 * @returns CypherResult with rows, queryTime, and optional error
 */
export declare function getMonographCypher(db: Database.Database, query: string): CypherResult;
//# sourceMappingURL=cypher.d.ts.map