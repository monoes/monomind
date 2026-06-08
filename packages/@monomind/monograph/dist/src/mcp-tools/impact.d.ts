import type Database from 'better-sqlite3';
import type { MonographNode } from '../types.js';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export declare function computeRiskLevel(riskScore: number): RiskLevel;
export interface ImpactOptions {
    minConfidenceScore?: number;
    relationTypes?: string[];
    maxDepth?: number;
}
export interface MonographImpactResult {
    node: MonographNode | null;
    directCallers: MonographNode[];
    transitiveCallers: Array<{
        depth: number;
        nodes: MonographNode[];
    }>;
    affectedFiles: string[];
    riskScore: number;
    riskLevel: RiskLevel;
}
export declare function getMonographImpact(db: Database.Database, input: {
    name: string;
    filePath?: string;
    depth?: number;
}): MonographImpactResult;
export declare function monographImpact(db: Database.Database, nodeId: string, options?: ImpactOptions): Promise<MonographImpactResult>;
//# sourceMappingURL=impact.d.ts.map