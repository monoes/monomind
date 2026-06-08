import type Database from 'better-sqlite3';
import type { MonographNode } from '../types.js';
export interface ExplainResult {
    node: MonographNode | null;
    explanation: string | null;
    connectionCount: number;
}
export declare function explainNode(db: Database.Database, name: string): ExplainResult;
//# sourceMappingURL=explain.d.ts.map