// Typed parameter schemas for all MCP tool endpoints.
export function isValidEmailMode(v) {
    return v === 'full' || v === 'domain' || v === 'name';
}
export function isValidAuditGate(v) {
    return v === 'new-only' || v === 'all';
}
export function isValidFixMode(mode) {
    return mode === 'preview' || mode === 'apply';
}
//# sourceMappingURL=params.js.map