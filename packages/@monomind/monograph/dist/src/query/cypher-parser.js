// ── Constants ──────────────────────────────────────────────────────────────────
const MAX_ROWS = 200;
const FORBIDDEN_KEYWORDS = ['CREATE', 'MERGE', 'SET', 'DELETE', 'REMOVE', 'DROP'];
/** Map from Cypher field name to SQLite column name */
const FIELD_MAP = {
    name: 'name',
    filePath: 'file_path',
    startLine: 'start_line',
    endLine: 'end_line',
    label: 'label',
    language: 'language',
    isExported: 'is_exported',
};
// ── Security check ─────────────────────────────────────────────────────────────
function checkForbiddenKeywords(query) {
    // Strip quoted string literals before scanning to avoid false positives on
    // node names like "createServer" (contains CREATE) or "dropdown" (contains DROP).
    const stripped = query.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
    const upper = stripped.toUpperCase();
    for (const kw of FORBIDDEN_KEYWORDS) {
        if (new RegExp(`\\b${kw}\\b`).test(upper)) {
            return `Write operations not supported: ${kw}`;
        }
    }
    return null;
}
// ── Parsing helpers ────────────────────────────────────────────────────────────
/**
 * Parse inline props like {name: "value", key: "val2"} → Record<string, string>
 * Returns null on parse failure.
 */
function parseInlineProps(propsStr) {
    const result = {};
    // Match key: "value" pairs
    const pairRe = /(\w+)\s*:\s*"([^"]*)"/g;
    let match;
    while ((match = pairRe.exec(propsStr)) !== null) {
        result[match[1]] = match[2];
    }
    return result;
}
/**
 * Parse a node pattern like (alias:Label {key: "val"})
 * Returns { alias, label?, props? } or null on failure.
 */
function parseNodePattern(nodeStr) {
    // Remove surrounding parens
    const inner = nodeStr.trim().replace(/^\(|\)$/g, '').trim();
    if (!inner)
        return null;
    // alias:Label {props} or alias:Label or alias {props} or alias
    const mainRe = /^(\w+)(?::(\w+))?(?:\s*(\{[^}]*\}))?$/;
    const m = mainRe.exec(inner);
    if (!m)
        return null;
    const alias = m[1];
    const label = m[2] ?? undefined;
    let props;
    if (m[3]) {
        const parsed = parseInlineProps(m[3]);
        if (parsed && Object.keys(parsed).length > 0) {
            props = parsed;
        }
    }
    return { alias, label, props };
}
/**
 * Parse RETURN clause fields like "a.name, b.filePath"
 * Returns array of { alias, field } or null if any field is invalid.
 */
function parseReturnFields(returnStr) {
    const fields = [];
    const parts = returnStr.split(',').map((s) => s.trim());
    for (const part of parts) {
        const m = /^(\w+)\.(\w+)$/.exec(part);
        if (!m)
            return null;
        const alias = m[1];
        const field = m[2];
        if (!FIELD_MAP[field]) {
            return null; // Reject unknown fields
        }
        fields.push({ alias, field });
    }
    return fields.length > 0 ? fields : null;
}
/**
 * Parse WHERE clause like "n.name = \"buildAsync\""
 * Returns { alias, field, value } or null.
 */
function parseWhereClause(whereStr) {
    const m = /^(\w+)\.(\w+)\s*=\s*"([^"]*)"$/.exec(whereStr.trim());
    if (!m)
        return null;
    const alias = m[1];
    const field = m[2];
    const value = m[3];
    if (!FIELD_MAP[field])
        return null;
    return { alias, field, value };
}
// ── Query parser ───────────────────────────────────────────────────────────────
/**
 * Parse a Cypher-style MATCH query into a structured CypherQuery.
 * Returns null with an error message on failure.
 */
export function parseCypherQuery(query) {
    // Security: block write operations
    const forbidden = checkForbiddenKeywords(query);
    if (forbidden)
        return { parsed: null, error: forbidden };
    const trimmed = query.trim();
    // Must start with MATCH
    if (!/^MATCH\s+/i.test(trimmed)) {
        return { parsed: null, error: 'Parse error: query must start with MATCH' };
    }
    // Extract RETURN clause (required)
    const returnMatch = /\bRETURN\s+(.+)$/i.exec(trimmed);
    if (!returnMatch) {
        return { parsed: null, error: 'Parse error: RETURN clause is required' };
    }
    const returnStr = returnMatch[1].trim();
    const returnFields = parseReturnFields(returnStr);
    if (!returnFields) {
        return {
            parsed: null,
            error: `Parse error: invalid or unknown RETURN fields. Allowed: ${Object.keys(FIELD_MAP).join(', ')}`,
        };
    }
    // Extract WHERE clause (optional), must appear before RETURN
    const beforeReturn = trimmed.slice(0, returnMatch.index).trim();
    let whereClause;
    let matchBody = beforeReturn;
    const whereMatch = /\bWHERE\s+(.+?)(?:\s+RETURN\s+|$)/i.exec(trimmed);
    if (whereMatch) {
        const wherePart = whereMatch[1].trim();
        const parsed = parseWhereClause(wherePart);
        if (!parsed) {
            return { parsed: null, error: `Parse error: invalid WHERE clause: ${wherePart}` };
        }
        whereClause = parsed;
        // Remove WHERE from matchBody
        matchBody = beforeReturn.replace(/\s+WHERE\s+.+$/i, '').trim();
    }
    // Remove MATCH keyword from matchBody
    matchBody = matchBody.replace(/^MATCH\s+/i, '').trim();
    // Determine if relationship or node pattern
    // Relationship pattern: (nodeA)-[:REL]->(nodeB)
    const relRe = /^(\([^)]+\))\s*-\[:([A-Z_]+)\]->\s*(\([^)]+\))$/;
    const relMatch = relRe.exec(matchBody);
    if (relMatch) {
        // Relationship pattern
        const nodeAStr = relMatch[1];
        const relation = relMatch[2];
        const nodeBStr = relMatch[3];
        const nodeA = parseNodePattern(nodeAStr);
        const nodeB = parseNodePattern(nodeBStr);
        if (!nodeA)
            return { parsed: null, error: `Parse error: invalid node pattern: ${nodeAStr}` };
        if (!nodeB)
            return { parsed: null, error: `Parse error: invalid node pattern: ${nodeBStr}` };
        return {
            parsed: {
                type: 'relationship',
                nodeA,
                nodeB,
                relation,
                whereClause,
                returnFields,
            },
        };
    }
    // Node-only pattern: (n:Label {props}) or (n:Label) or (n)
    const nodeOnlyRe = /^(\([^)]+\))$/;
    const nodeOnlyMatch = nodeOnlyRe.exec(matchBody);
    if (nodeOnlyMatch) {
        const nodeA = parseNodePattern(nodeOnlyMatch[1]);
        if (!nodeA)
            return { parsed: null, error: `Parse error: invalid node pattern: ${nodeOnlyMatch[1]}` };
        return {
            parsed: {
                type: 'node',
                nodeA,
                whereClause,
                returnFields,
            },
        };
    }
    return { parsed: null, error: `Parse error: unrecognized pattern: ${matchBody}` };
}
// ── SQL generation ─────────────────────────────────────────────────────────────
/**
 * Build SELECT clause from return fields, mapping alias.field → SQL alias.
 */
function buildSelectClause(returnFields) {
    return returnFields
        .map(({ alias, field }) => {
        const col = FIELD_MAP[field];
        return `${alias}.${col} AS "${alias}_${field}"`;
    })
        .join(', ');
}
/**
 * Build WHERE conditions for node inline props and WHERE clause.
 */
function buildNodeConditions(nodeAlias, label, props, whereClause) {
    const conditions = [];
    const params = [];
    if (label) {
        conditions.push(`${nodeAlias}.label = ?`);
        params.push(label);
    }
    if (props) {
        for (const [field, value] of Object.entries(props)) {
            const col = FIELD_MAP[field];
            if (col) {
                conditions.push(`${nodeAlias}.${col} = ?`);
                params.push(value);
            }
        }
    }
    if (whereClause && whereClause.alias === nodeAlias) {
        const col = FIELD_MAP[whereClause.field];
        if (col) {
            conditions.push(`${nodeAlias}.${col} = ?`);
            params.push(whereClause.value);
        }
    }
    return { conditions, params };
}
/**
 * Translate a parsed CypherQuery to a SQL string and bound parameters.
 * Returns parameterized SQL — never interpolates user values into the query string.
 */
export function cypherToSql(parsed) {
    const select = buildSelectClause(parsed.returnFields);
    const allParams = [];
    if (parsed.type === 'relationship' && parsed.nodeB && parsed.relation) {
        const { nodeA, nodeB, relation, whereClause } = parsed;
        const aAlias = nodeA.alias;
        const bAlias = nodeB.alias;
        const aResult = buildNodeConditions(aAlias, nodeA.label, nodeA.props, whereClause);
        const bResult = buildNodeConditions(bAlias, nodeB.label, nodeB.props, whereClause);
        const conditions = [...aResult.conditions, ...bResult.conditions];
        allParams.push(...aResult.params, ...bResult.params);
        // relation goes through the relation-type allowlist check upstream; still parameterize it
        allParams.unshift(relation); // prepend — used in JOIN before WHERE params
        const whereStr = conditions.length > 0 ? `WHERE ${conditions.join('\n  AND ')}` : '';
        const sql = [
            `SELECT ${select}`,
            `FROM nodes ${aAlias}`,
            `JOIN edges e ON ${aAlias}.id = e.source_id AND e.relation = ?`,
            `JOIN nodes ${bAlias} ON ${bAlias}.id = e.target_id`,
            whereStr,
            `LIMIT ${MAX_ROWS}`,
        ]
            .filter(Boolean)
            .join('\n');
        return { sql, params: allParams };
    }
    // Node-only
    const { nodeA, whereClause } = parsed;
    const alias = nodeA.alias;
    const { conditions, params } = buildNodeConditions(alias, nodeA.label, nodeA.props, whereClause);
    allParams.push(...params);
    const whereStr = conditions.length > 0 ? `WHERE ${conditions.join('\n  AND ')}` : '';
    const sql = [`SELECT ${select}`, `FROM nodes ${alias}`, whereStr, `LIMIT ${MAX_ROWS}`]
        .filter(Boolean)
        .join('\n');
    return { sql, params: allParams };
}
// ── Executor ───────────────────────────────────────────────────────────────────
/**
 * Parse and execute a Cypher-style query against the Monograph SQLite database.
 * Never throws — all errors are returned in the CypherResult.error field.
 */
export function executeCypherQuery(db, query) {
    const start = Date.now();
    try {
        const { parsed, error } = parseCypherQuery(query);
        if (!parsed) {
            return { rows: [], queryTime: 0, error };
        }
        const { sql, params } = cypherToSql(parsed);
        const rows = db.prepare(sql).all(...params);
        return { rows, queryTime: Date.now() - start };
    }
    catch (err) {
        return {
            rows: [],
            queryTime: Date.now() - start,
            error: `Execution error: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}
//# sourceMappingURL=cypher-parser.js.map