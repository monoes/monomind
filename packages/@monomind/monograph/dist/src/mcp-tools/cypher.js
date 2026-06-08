import { executeCypherQuery } from '../query/cypher-parser.js';
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
//# sourceMappingURL=cypher.js.map