import type Database from 'better-sqlite3';
import type { MonographNode } from '../types.js';
export interface MonographRenameResult {
    symbol: MonographNode | null;
    referencingFiles: string[];
    changes: Array<{
        file: string;
        line: number;
        before: string;
        after: string;
    }>;
    error?: string;
}
export declare function getMonographRename(db: Database.Database, input: {
    oldName: string;
    newName: string;
    filePath?: string;
    dryRun?: boolean;
}): MonographRenameResult;
//# sourceMappingURL=rename.d.ts.map