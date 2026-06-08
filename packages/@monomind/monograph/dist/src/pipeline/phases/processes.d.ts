import type { PipelinePhase } from '../types.js';
export interface ProcessDef {
    id: string;
    name: string;
    filePath: string;
    entryNodeId: string;
    stepCount: number;
}
export interface ProcessesOutput {
    processResult: {
        processes: ProcessDef[];
        memberships: Map<string, string>;
        stats: {
            totalProcesses: number;
            totalSteps: number;
        };
    };
}
export declare const processesPhase: PipelinePhase<ProcessesOutput>;
//# sourceMappingURL=processes.d.ts.map