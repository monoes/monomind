export const ModuleNodeFlags = {
    ENTRY_POINT: 1,
    REACHABLE: 2,
    RUNTIME_REACHABLE: 4,
    TEST_REACHABLE: 8,
    CJS_EXPORTS: 16,
};
export function isEntryPoint(node) {
    return (node.flags & ModuleNodeFlags.ENTRY_POINT) !== 0;
}
export function isReachable(node) {
    return (node.flags & ModuleNodeFlags.REACHABLE) !== 0;
}
export function isRuntimeReachable(node) {
    return (node.flags & ModuleNodeFlags.RUNTIME_REACHABLE) !== 0;
}
export function isTestReachable(node) {
    return (node.flags & ModuleNodeFlags.TEST_REACHABLE) !== 0;
}
export function hasCjsExports(node) {
    return (node.flags & ModuleNodeFlags.CJS_EXPORTS) !== 0;
}
export function setFlag(node, flag) {
    node.flags |= flag;
}
export function clearFlag(node, flag) {
    node.flags &= ~flag;
}
//# sourceMappingURL=node-types.js.map