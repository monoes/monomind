import { toNormLabel, MonographError } from '../types.js';
export function insertNode(db, node) {
    db.prepare(`
    INSERT OR REPLACE INTO nodes
      (id, label, name, norm_label, file_path, start_line, end_line,
       community_id, is_exported, language, properties)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(node.id, node.label, node.name, node.normLabel ?? toNormLabel(node.name), node.filePath ?? null, node.startLine ?? null, node.endLine ?? null, node.communityId ?? null, node.isExported ? 1 : 0, node.language ?? null, node.properties ? JSON.stringify(node.properties) : null);
}
export function insertNodes(db, nodes) {
    const insertMany = db.transaction((rows) => {
        for (const n of rows) {
            insertNode(db, n);
        }
    });
    insertMany(nodes);
}
export function getNode(db, id) {
    const row = db
        .prepare('SELECT * FROM nodes WHERE id = ?')
        .get(id);
    return row ? rowToNode(row) : undefined;
}
export function getNodesForFile(db, filePath) {
    const rows = db
        .prepare('SELECT * FROM nodes WHERE file_path = ?')
        .all(filePath);
    return rows.map(rowToNode);
}
export function deleteNodesForFile(db, filePath) {
    db.prepare('DELETE FROM nodes WHERE file_path = ?').run(filePath);
}
export function countNodes(db) {
    const row = db.prepare('SELECT COUNT(*) as n FROM nodes').get();
    return row.n;
}
function rowToPropDef(row) {
    return {
        ident: row.ident,
        type: row.type,
        cardinality: row.cardinality,
        viewContext: row.view_context,
        closedValues: row.closed_values ? JSON.parse(row.closed_values) : null,
        description: row.description ?? null,
        queryable: row.queryable === 1,
    };
}
/** List all registered property definitions */
export function listProperties(db) {
    const rows = db.prepare('SELECT * FROM node_properties ORDER BY ident').all();
    return rows.map(rowToPropDef);
}
/** Get a single property definition */
export function getProperty(db, ident) {
    const row = db.prepare('SELECT * FROM node_properties WHERE ident = ?').get(ident);
    return row ? rowToPropDef(row) : null;
}
/** Register or update a custom property */
export function upsertProperty(db, def) {
    db.prepare(`
    INSERT INTO node_properties (ident, type, cardinality, view_context, closed_values, description, queryable)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ident) DO UPDATE SET
      type = excluded.type,
      cardinality = excluded.cardinality,
      view_context = excluded.view_context,
      closed_values = excluded.closed_values,
      description = excluded.description,
      queryable = excluded.queryable
  `).run(def.ident, def.type, def.cardinality, def.viewContext, def.closedValues != null ? JSON.stringify(def.closedValues) : null, def.description ?? null, def.queryable ? 1 : 0);
}
/**
 * Query nodes by a typed property value extracted from their JSON properties column.
 * For queryable properties only.
 * @param ident - property ident (e.g. 'layer', 'tags', 'ua_type')
 * @param value - value to match (exact for closed/text, numeric comparison for number)
 * @param comparator - '=' | 'LIKE' | '>' | '<' (default '=')
 */
export function queryByProperty(db, ident, value, comparator = '=', limit = 100) {
    const propDef = getProperty(db, ident);
    if (!propDef) {
        throw new MonographError(`Unknown property: '${ident}'. Register it first with upsertProperty.`);
    }
    if (!propDef.queryable) {
        throw new MonographError(`Property '${ident}' is not queryable (view_context may be 'never' or queryable=false).`);
    }
    const extractExpr = `json_extract(properties, '$.${ident}')`;
    const rows = db.prepare(`
    SELECT id, name, label, file_path, ${extractExpr} AS property_value
    FROM nodes
    WHERE properties IS NOT NULL
      AND ${extractExpr} ${comparator} ?
    LIMIT ?
  `).all(value, limit);
    return rows.map(r => ({
        id: r.id,
        name: r.name,
        label: r.label,
        filePath: r.file_path ?? null,
        propertyValue: r.property_value,
    }));
}
function rowToNode(row) {
    return {
        id: row.id,
        label: row.label,
        name: row.name,
        normLabel: row.norm_label,
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        communityId: row.community_id,
        isExported: row.is_exported === 1,
        language: row.language,
        properties: row.properties ? JSON.parse(row.properties) : undefined,
    };
}
//# sourceMappingURL=node-store.js.map