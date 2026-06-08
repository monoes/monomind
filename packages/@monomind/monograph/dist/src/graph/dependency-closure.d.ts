import type { MonographDb } from '../storage/db.js';
export interface DepClosureResult {
    nodeId: string;
    name: string;
    filePath: string | null;
    directDeps: string[];
    transitiveDeps: string[];
    depDepth: number;
    unusedTransitiveDeps: string[];
}
export interface DepClosureReport {
    nodes: DepClosureResult[];
    avgDepDepth: number;
    maxDepDepth: number;
    deepDependencyFiles: DepClosureResult[];
}
export declare function computeDependencyClosure(db: MonographDb, maxNodes?: number): DepClosureReport;
//# sourceMappingURL=dependency-closure.d.ts.map