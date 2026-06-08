export function makeEvidence(kind, weight, note) {
    return { kind, weight: Math.max(0, Math.min(1, weight)), note };
}
export function mergeEvidence(existing, entry) {
    return [...(existing ?? []), entry];
}
//# sourceMappingURL=evidence.js.map