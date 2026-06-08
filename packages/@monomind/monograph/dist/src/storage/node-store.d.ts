import type Database from 'better-sqlite3';
import type { MonographNode } from '../types.js';
export declare function insertNode(db: Database.Database, node: MonographNode): void;
export declare function insertNodes(db: Database.Database, nodes: MonographNode[]): void;
export declare function getNode(db: Database.Database, id: string): MonographNode | undefined;
export declare function getNodesForFile(db: Database.Database, filePath: string): MonographNode[];
export declare function deleteNodesForFile(db: Database.Database, filePath: string): void;
export declare function countNodes(db: Database.Database): number;
export interface PropertyDef {
    ident: string;
    type: string;
    cardinality: string;
    viewContext: string;
    closedValues: string[] | null;
    description: string | null;
    queryable: boolean;
}
/** List all registered property definitions */
export declare function listProperties(db: Database.Database): PropertyDef[];
/** Get a single property definition */
export declare function getProperty(db: Database.Database, ident: string): PropertyDef | null;
/** Register or update a custom property */
export declare function upsertProperty(db: Database.Database, def: PropertyDef): void;
/**
 * Query nodes by a typed property value extracted from their JSON properties column.
 * For queryable properties only.
 * @param ident - property ident (e.g. 'layer', 'tags', 'ua_type')
 * @param value - value to match (exact for closed/text, numeric comparison for number)
 * @param comparator - '=' | 'LIKE' | '>' | '<' (default '=')
 */
export declare function queryByProperty(db: Database.Database, ident: string, value: string | number | boolean, comparator?: '=' | 'LIKE' | '>' | '<', limit?: number): Array<{
    id: string;
    name: string;
    label: string;
    filePath: string | null;
    propertyValue: unknown;
}>;
//# sourceMappingURL=node-store.d.ts.map