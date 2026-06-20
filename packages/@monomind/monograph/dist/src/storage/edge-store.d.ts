import type Database from 'better-sqlite3';
import type { MonographEdge } from '../types.js';
export declare function insertEdge(db: Database.Database, edge: MonographEdge): void;
export declare function insertEdges(db: Database.Database, edges: MonographEdge[]): void;
/** Batch-fetch edges for multiple source IDs using a single SQL IN query. Batches at 50 IDs. */
export declare function getEdgesForSources(db: Database.Database, sourceIds: string[]): MonographEdge[];
export declare function getEdgesForSource(db: Database.Database, sourceId: string): MonographEdge[];
export declare function getEdgesForTarget(db: Database.Database, targetId: string): MonographEdge[];
export declare function deleteEdgesForFile(db: Database.Database, filePath: string): void;
export declare function countEdges(db: Database.Database): number;
//# sourceMappingURL=edge-store.d.ts.map