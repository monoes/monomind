import type Database from 'better-sqlite3';
export interface CypherQuery {
    type: 'node' | 'relationship';
    nodeA: {
        alias: string;
        label?: string;
        props?: Record<string, string>;
    };
    nodeB?: {
        alias: string;
        label?: string;
        props?: Record<string, string>;
    };
    relation?: string;
    whereClause?: {
        alias: string;
        field: string;
        value: string;
    };
    returnFields: Array<{
        alias: string;
        field: string;
    }>;
}
export interface CypherResult {
    rows: Record<string, string | number | null>[];
    queryTime: number;
    error?: string;
}
/**
 * Parse a Cypher-style MATCH query into a structured CypherQuery.
 * Returns null with an error message on failure.
 */
export declare function parseCypherQuery(query: string): {
    parsed: CypherQuery | null;
    error?: string;
};
/**
 * Translate a parsed CypherQuery to a SQL string and bound parameters.
 * Returns parameterized SQL — never interpolates user values into the query string.
 */
export declare function cypherToSql(parsed: CypherQuery): {
    sql: string;
    params: unknown[];
};
/**
 * Parse and execute a Cypher-style query against the Monograph SQLite database.
 * Never throws — all errors are returned in the CypherResult.error field.
 */
export declare function executeCypherQuery(db: Database.Database, query: string): CypherResult;
/**
 * Format a CypherResult as structured text for LLM consumption.
 *
 * Rows that contain *_filePath and *_startLine fields are rendered with
 * "file:line" navigation hints so LLMs can jump directly to the symbol.
 * Plain key=value pairs are rendered for all other fields.
 *
 * @example
 * ```
 * monograph_cypher result (3 rows, 2ms)
 *
 * Row 1:
 *   n.name = buildAsync
 *   n.filePath = src/server.ts:42
 *
 * Row 2:
 *   ...
 * ```
 */
export declare function formatCypherResult(result: CypherResult): string;
//# sourceMappingURL=cypher-parser.d.ts.map