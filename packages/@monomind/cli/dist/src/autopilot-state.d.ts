/**
 * Autopilot Shared State Module
 *
 * Centralizes state management, validation, and task discovery
 * for both CLI command and MCP tools. Eliminates code duplication.
 *
 * ADR-072: Autopilot Integration
 * Security: Addresses prototype pollution, NaN bypass, input validation
 */
export declare const STATE_DIR = ".monomind/data";
export declare const STATE_FILE = ".monomind/data/autopilot-state.json";
export declare const LOG_FILE = ".monomind/data/autopilot-log.json";
/** Allowlist for valid task sources */
export declare const VALID_TASK_SOURCES: Set<string>;
/** Terminal task statuses */
export declare const TERMINAL_STATUSES: Set<string>;
export interface AutopilotState {
    sessionId: string;
    enabled: boolean;
    startTime: number;
    iterations: number;
    maxIterations: number;
    timeoutMinutes: number;
    taskSources: string[];
    lastCheck: number | null;
    history: Array<{
        ts: number;
        iteration: number;
        completed: number;
        total: number;
    }>;
}
export interface AutopilotLogEntry {
    ts: number;
    event: string;
    [key: string]: unknown;
}
export interface TaskInfo {
    id: string;
    subject: string;
    status: string;
    source: string;
}
export interface TaskProgress {
    completed: number;
    total: number;
    percent: number;
    incomplete: TaskInfo[];
}
/**
 * Safe JSON.parse that prevents prototype pollution.
 */
export declare function safeJsonParse<T>(raw: string): T;
/**
 * Validate and coerce a numeric parameter. Returns the default if
 * the input is NaN, undefined, or outside the allowed range.
 */
export declare function validateNumber(value: unknown, min: number, max: number, defaultValue: number): number;
/**
 * Validate task sources against the allowlist.
 * Returns only valid sources; falls back to defaults if none are valid.
 */
export declare function validateTaskSources(sources: unknown): string[];
export declare function getDefaultState(): AutopilotState;
export declare function loadState(): AutopilotState;
export declare function saveState(state: AutopilotState): void;
export declare function appendLog(entry: AutopilotLogEntry): void;
export declare function loadLog(): AutopilotLogEntry[];
export declare function discoverTasks(sources: string[]): TaskInfo[];
export declare function isTerminal(status: string): boolean;
export declare function getProgress(tasks: TaskInfo[]): TaskProgress;
export declare function calculateReward(iterations: number, durationMs: number): number;
export declare function tryLoadLearning(): Promise<{
    initialize: () => Promise<boolean>;
    [key: string]: unknown;
} | null>;
//# sourceMappingURL=autopilot-state.d.ts.map