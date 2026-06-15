/**
 * MCP Request Tracker
 * Lightweight counter for tracking MCP tool invocations.
 * Used by system_metrics to report real request counts.
 */
const MAX_TRACKED_TOOLS = 500;
const MAX_TOOL_NAME_LEN = 256;
// Keys that would corrupt Object.prototype or its constructor if used as plain
// object property keys without Object.hasOwn() protection.
const FORBIDDEN_TOOL_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
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
    // Guard against prototype pollution via toolName.
    // The previous `toolName in counts.byTool` check traversed the prototype
    // chain, so "__proto__" was always truthy and could corrupt Object.prototype.
    // Use Object.hasOwn() instead, and reject forbidden key names outright.
    if (typeof toolName !== 'string' ||
        toolName.length === 0 ||
        toolName.length > MAX_TOOL_NAME_LEN ||
        FORBIDDEN_TOOL_NAMES.has(toolName)) {
        return; // Drop invalid tool names silently
    }
    if (Object.keys(counts.byTool).length < MAX_TRACKED_TOOLS || Object.hasOwn(counts.byTool, toolName)) {
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