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
//# sourceMappingURL=cypher-parser.d.ts.map