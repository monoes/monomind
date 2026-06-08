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
export declare function getSchemaResource(db: Database.Database): SchemaResourceData;
//# sourceMappingURL=schema-resource.d.ts.map