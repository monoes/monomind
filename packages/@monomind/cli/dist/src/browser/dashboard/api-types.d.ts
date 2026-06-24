/**
 * Typed API response schemas for the monobrowse dashboard.
 *
 * These interfaces are the canonical contract between server.ts and
 * dashboard clients (ui.html + any external consumers).  Changing a
 * field name here will surface breakage at compile time rather than
 * at runtime — preventing the field-name regression class documented
 * in the sprint review (e.g. `msg` vs `message`, `tokensIn` vs
 * `tokens_in`).
 *
 * @module @monomind/cli/browser/dashboard/api-types
 */
export interface OrgStatusResponse {
    name: string;
    status: 'ready' | 'running' | 'stopped';
    currentRun?: RunRecord;
}
export interface RunRecord {
    /** Stable run identifier (UUID or monotonic ID). */
    id: string;
    workflowId: string;
    startedAt: number;
    itemsProcessed: number;
    status: string;
}
export interface SessionListResponse {
    sessions: SessionEntry[];
    total: number;
}
export interface SessionEntry {
    sessionId: string;
    name: string;
    createdAt: string;
}
export interface BudgetResponse {
    /** Input tokens consumed in this session/run. */
    tokensIn: number;
    /** Output tokens generated in this session/run. */
    tokensOut: number;
    /** Total monetary cost in `currency` units. */
    totalCost: number;
    currency: 'USD';
}
export interface ApiError {
    /** Human-readable error message. */
    error: string;
    /** Optional machine-readable error code for programmatic handling. */
    code?: string;
}
//# sourceMappingURL=api-types.d.ts.map