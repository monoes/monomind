import { executeCypherQuery, formatCypherResult } from '../query/cypher-parser.js';
export { formatCypherResult };
/**
 * Execute a restricted read-only Cypher-style query against the Monograph graph.
 *
 * @param db - Open better-sqlite3 database handle
 * @param query - Cypher MATCH query string
 * @returns CypherResult with rows, queryTime, and optional error
 */
export function getMonographCypher(db, query) {
    return executeCypherQuery(db, query);
}
/**
 * Execute a Cypher-style query and return structured text for LLM consumption.
 * Rows with filePath + startLine fields are rendered as "file:line" navigation hints.
 *
 * @param db - Open better-sqlite3 database handle
 * @param query - Cypher MATCH query string
 * @returns Formatted string suitable for direct injection into LLM context
 */
export function getMonographCypherText(db, query) {
    return formatCypherResult(executeCypherQuery(db, query));
}
//# sourceMappingURL=cypher.js.map