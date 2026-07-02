/**
 * Hive Mind shared types, constants, and format helpers
 */
export declare const MAX_OBJECTIVE_LEN = 2000;
export declare const MAX_TASK_DESC_LEN = 4000;
export declare const MAX_MESSAGE_LEN = 2000;
export declare const MAX_KEY_LEN = 256;
export declare const MAX_VALUE_LEN = 65536;
export declare const MAX_AGENT_ID_LEN = 128;
export interface HiveWorker {
    agentId: string;
    role: string;
    type?: string;
    joinedAt?: string;
}
export interface WorkerGroups {
    [key: string]: HiveWorker[];
}
export declare const TOPOLOGIES: {
    value: string;
    label: string;
    hint: string;
}[];
export declare const CONSENSUS_STRATEGIES: {
    value: string;
    label: string;
    hint: string;
}[];
export declare function groupWorkersByType(workers: HiveWorker[]): WorkerGroups;
export declare function generateHiveMindPrompt(swarmId: string, swarmName: string, objective: string, workers: HiveWorker[], workerGroups: WorkerGroups, flags: Record<string, unknown>): string;
export declare function formatAgentStatus(status: unknown): string;
export declare function formatHiveStatus(status: string): string;
export declare function formatHealth(health: string): string;
export declare function formatPriority(priority: string): string;
//# sourceMappingURL=hive-mind-helpers.d.ts.map