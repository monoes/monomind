/**
 * MCP Request Tracker
 * Lightweight counter for tracking MCP tool invocations.
 * Used by system_metrics to report real request counts.
 */
interface RequestCounts {
    total: number;
    success: number;
    errors: number;
    byTool: Record<string, number>;
    startedAt: string;
}
export declare function trackRequest(toolName: string, success: boolean): void;
export declare function getRequestCounts(): RequestCounts;
export declare function resetRequestCounts(): void;
export {};
//# sourceMappingURL=request-tracker.d.ts.map