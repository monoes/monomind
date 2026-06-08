import type Database from 'better-sqlite3';
import type { MonographNode } from '../types.js';
export interface MonographContextResult {
    node: MonographNode | null;
    callers: MonographNode[];
    callees: MonographNode[];
    imports: MonographNode[];
    importedBy: MonographNode[];
    community: {
        id: number;
        label?: string;
    } | null;
    inProcesses: Array<{
        id: string;
        name: string;
    }>;
}
export declare function getMonographContext(db: Database.Database, input: {
    name: string;
    filePath?: string;
}): MonographContextResult;
//# sourceMappingURL=context.d.ts.map