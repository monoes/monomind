import type { MonographDb } from './storage/db.js';
export type AuditVerdict = 'Pass' | 'Warn' | 'Fail';
export type AuditGate = 'new-only' | 'all';
export interface AuditAttribution {
    domain: string;
    newCount: number;
    inheritedCount: number;
}
export interface AuditSummary {
    verdict: AuditVerdict;
    changedFiles: number;
    deadCodeIssues: number;
    complexityFindings: number;
    maxCyclomatic: number;
    duplicationCloneGroups: number;
    cycleCount: number;
    attributions: AuditAttribution[];
    gate: AuditGate;
}
export declare function runAudit(db: MonographDb, repoPath: string, options?: {
    changedSince?: string;
    gate?: AuditGate;
}): AuditSummary;
//# sourceMappingURL=audit.d.ts.map