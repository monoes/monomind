import type { WorkflowDef, RunRecord } from './types.js';
export declare class WorkflowStoreError extends Error {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
export declare function readWorkflow(filePath: string): Promise<WorkflowDef>;
export declare function writeRunRecord(record: RunRecord): Promise<void>;
export declare function listRuns(workflowId?: string): Promise<RunRecord[]>;
export declare function saveSession(session: {
    id: string;
    platform: string;
    username: string;
    cookies: string;
    userAgent?: string;
}): Promise<void>;
export declare function listSessions(): Promise<Array<{
    id: string;
    platform: string;
    username: string;
    lastUsedAt: number;
}>>;
export declare function deleteSession(id: string): Promise<void>;
export declare function getSessionCookies(platform: string, username: string): Promise<string | null>;
//# sourceMappingURL=store.d.ts.map