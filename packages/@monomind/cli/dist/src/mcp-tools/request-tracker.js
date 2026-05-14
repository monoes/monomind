/**
 * MCP Request Tracker
 * Lightweight counter for tracking MCP tool invocations.
 * Used by system_metrics to report real request counts.
 */
const MAX_TRACKED_TOOLS = 500;
let counts = {
    total: 0,
    success: 0,
    errors: 0,
    byTool: {},
    startedAt: new Date().toISOString(),
};
export function trackRequest(toolName, success) {
    counts.total++;
    if (success)
        counts.success++;
    else
        counts.errors++;
    if (Object.keys(counts.byTool).length < MAX_TRACKED_TOOLS || toolName in counts.byTool) {
        counts.byTool[toolName] = (counts.byTool[toolName] || 0) + 1;
    }
}
export function getRequestCounts() {
    return { ...counts };
}
export function resetRequestCounts() {
    counts = { total: 0, success: 0, errors: 0, byTool: {}, startedAt: new Date().toISOString() };
}
//# sourceMappingURL=request-tracker.js.map