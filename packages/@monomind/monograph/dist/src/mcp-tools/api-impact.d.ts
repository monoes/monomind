import type Database from 'better-sqlite3';
import type { MonographNode } from '../types.js';
export interface MonographApiImpactResult {
    route: {
        method: string;
        path: string;
        nodeId: string;
    } | null;
    handler: MonographNode | null;
    callees: Array<{
        depth: number;
        node: MonographNode;
    }>;
    affectedProcesses: Array<{
        id: string;
        name: string;
    }>;
    riskScore: number;
}
export declare function getMonographApiImpact(db: Database.Database, input: {
    routePath: string;
    method?: string;
}): MonographApiImpactResult;
//# sourceMappingURL=api-impact.d.ts.map