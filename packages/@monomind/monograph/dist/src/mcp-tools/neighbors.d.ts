import type Database from 'better-sqlite3';
import type { MonographNode } from '../types.js';
export interface NeighborEntry {
    node: MonographNode;
    relation: string;
    confidence: string;
    confidenceScore: number;
    direction: 'outbound' | 'inbound';
}
export interface MonographNeighborsResult {
    node: MonographNode | null;
    neighbors: NeighborEntry[];
}
export declare function getMonographNeighbors(db: Database.Database, input: {
    name: string;
    relationFilter?: string;
    includeInbound?: boolean;
}): MonographNeighborsResult;
//# sourceMappingURL=neighbors.d.ts.map