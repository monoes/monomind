import type Database from 'better-sqlite3';

export interface NodeLabelCount {
  label: string;
  count: number;
}

export interface EdgeRelationCount {
  relation: string;
  count: number;
}

export interface SchemaResourceData {
  nodeLabels: NodeLabelCount[];
  edgeRelations: EdgeRelationCount[];
  totalNodes: number;
  totalEdges: number;
}

/**
 * Returns the graph schema: node label distribution, edge relation distribution,
 * and total counts. Useful for understanding what's in the index at a glance.
 */
export function getSchemaResource(db: Database.Database): SchemaResourceData {
  const labelRows = db
    .prepare(
      `SELECT label, COUNT(*) AS count FROM nodes GROUP BY label ORDER BY count DESC`,
    )
    .all() as Array<{ label: string; count: number }>;

  const relationRows = db
    .prepare(
      `SELECT relation, COUNT(*) AS count FROM edges GROUP BY relation ORDER BY count DESC`,
    )
    .all() as Array<{ relation: string; count: number }>;

  const totalNodes = labelRows.reduce((sum, r) => sum + r.count, 0);
  const totalEdges = relationRows.reduce((sum, r) => sum + r.count, 0);

  return {
    nodeLabels: labelRows.map((r) => ({ label: r.label, count: r.count })),
    edgeRelations: relationRows.map((r) => ({ relation: r.relation, count: r.count })),
    totalNodes,
    totalEdges,
  };
}
