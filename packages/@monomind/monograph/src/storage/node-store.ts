import type Database from 'better-sqlite3';
import type { MonographNode } from '../types.js';
import { toNormLabel, MonographError } from '../types.js';

export function insertNode(db: Database.Database, node: MonographNode): void {
  db.prepare(`
    INSERT OR REPLACE INTO nodes
      (id, label, name, norm_label, file_path, start_line, end_line,
       community_id, is_exported, language, properties)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    node.id,
    node.label,
    node.name,
    node.normLabel ?? toNormLabel(node.name),
    node.filePath ?? null,
    node.startLine ?? null,
    node.endLine ?? null,
    node.communityId ?? null,
    node.isExported ? 1 : 0,
    node.language ?? null,
    node.properties ? JSON.stringify(node.properties) : null,
  );
}

export function insertNodes(db: Database.Database, nodes: MonographNode[]): void {
  const insertMany = db.transaction((rows: MonographNode[]) => {
    for (const n of rows) {
      insertNode(db, n);
    }
  });
  insertMany(nodes);
}

export function getNode(db: Database.Database, id: string): MonographNode | undefined {
  const row = db
    .prepare('SELECT * FROM nodes WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToNode(row) : undefined;
}

export function getNodesForFile(db: Database.Database, filePath: string): MonographNode[] {
  const rows = db
    .prepare('SELECT * FROM nodes WHERE file_path = ?')
    .all(filePath) as Record<string, unknown>[];
  return rows.map(rowToNode);
}

export function deleteNodesForFile(db: Database.Database, filePath: string): void {
  db.prepare('DELETE FROM nodes WHERE file_path = ?').run(filePath);
}

export function countNodes(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) as n FROM nodes').get() as { n: number };
  return row.n;
}

// ── Property registry ─────────────────────────────────────────────────────────

export interface PropertyDef {
  ident: string;
  type: string;
  cardinality: string;
  viewContext: string;
  closedValues: string[] | null;
  description: string | null;
  queryable: boolean;
}

function rowToPropDef(row: Record<string, unknown>): PropertyDef {
  return {
    ident: row.ident as string,
    type: row.type as string,
    cardinality: row.cardinality as string,
    viewContext: row.view_context as string,
    closedValues: row.closed_values ? JSON.parse(row.closed_values as string) : null,
    description: (row.description as string | null) ?? null,
    queryable: (row.queryable as number) === 1,
  };
}

/** List all registered property definitions */
export function listProperties(db: Database.Database): PropertyDef[] {
  const rows = db.prepare('SELECT * FROM node_properties ORDER BY ident').all() as Record<string, unknown>[];
  return rows.map(rowToPropDef);
}

/** Get a single property definition */
export function getProperty(db: Database.Database, ident: string): PropertyDef | null {
  const row = db.prepare('SELECT * FROM node_properties WHERE ident = ?').get(ident) as Record<string, unknown> | undefined;
  return row ? rowToPropDef(row) : null;
}

/** Register or update a custom property */
export function upsertProperty(db: Database.Database, def: PropertyDef): void {
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
  `).run(
    def.ident,
    def.type,
    def.cardinality,
    def.viewContext,
    def.closedValues != null ? JSON.stringify(def.closedValues) : null,
    def.description ?? null,
    def.queryable ? 1 : 0,
  );
}

/**
 * Query nodes by a typed property value extracted from their JSON properties column.
 * For queryable properties only.
 * @param ident - property ident (e.g. 'layer', 'tags', 'ua_type')
 * @param value - value to match (exact for closed/text, numeric comparison for number)
 * @param comparator - '=' | 'LIKE' | '>' | '<' (default '=')
 */
export function queryByProperty(
  db: Database.Database,
  ident: string,
  value: string | number | boolean,
  comparator: '=' | 'LIKE' | '>' | '<' = '=',
  limit = 100,
): Array<{ id: string; name: string; label: string; filePath: string | null; propertyValue: unknown }> {
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
  `).all(value, limit) as Array<Record<string, unknown>>;

  return rows.map(r => ({
    id: r.id as string,
    name: r.name as string,
    label: r.label as string,
    filePath: (r.file_path as string | null) ?? null,
    propertyValue: r.property_value,
  }));
}

function rowToNode(row: Record<string, unknown>): MonographNode {
  return {
    id: row.id as string,
    label: row.label as MonographNode['label'],
    name: row.name as string,
    normLabel: row.norm_label as string,
    filePath: row.file_path as string | undefined,
    startLine: row.start_line as number | undefined,
    endLine: row.end_line as number | undefined,
    communityId: row.community_id as number | undefined,
    isExported: (row.is_exported as number) === 1,
    language: row.language as string | undefined,
    properties: row.properties ? JSON.parse(row.properties as string) : undefined,
  };
}
