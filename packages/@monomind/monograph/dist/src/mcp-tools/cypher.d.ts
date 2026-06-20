import type Database from 'better-sqlite3';
import { formatCypherResult } from '../query/cypher-parser.js';
import type { CypherResult } from '../query/cypher-parser.js';
export type { CypherResult };
export { formatCypherResult };
/**
 * Execute a restricted read-only Cypher-style query against the Monograph graph.
 *
 * @param db - Open better-sqlite3 database handle
 * @param query - Cypher MATCH query string
 * @returns CypherResult with rows, queryTime, and optional error
 */
export declare function getMonographCypher(db: Database.Database, query: string): CypherResult;
/**
 * Execute a Cypher-style query and return structured text for LLM consumption.
 * Rows with filePath + startLine fields are rendered as "file:line" navigation hints.
 *
 * @param db - Open better-sqlite3 database handle
 * @param query - Cypher MATCH query string
 * @returns Formatted string suitable for direct injection into LLM context
 */
export declare function getMonographCypherText(db: Database.Database, query: string): string;
//# sourceMappingURL=cypher.d.ts.map