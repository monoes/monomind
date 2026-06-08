import type Database from 'better-sqlite3';
export interface ProcessStep {
    name: string;
    label: string;
    filePath: string | null;
    startLine: number | null;
}
export interface ProcessEntry {
    id: string;
    name: string;
    filePath: string | null;
    stepCount: number;
    steps: ProcessStep[];
}
export interface ProcessesResourceData {
    processes: ProcessEntry[];
}
/**
 * Returns all Process nodes with their steps (via STEP_IN_PROCESS edges).
 * Process nodes are defined by label='Process' in the monograph schema.
 * Steps are nodes connected via outgoing STEP_IN_PROCESS edges (limit 50 per process).
 */
export declare function getProcessesResource(db: Database.Database): ProcessesResourceData;
//# sourceMappingURL=processes-resource.d.ts.map