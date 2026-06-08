/**
 * Evidence weight constants for scope-based resolution.
 */
export const EvidenceWeights = {
    local: 0.55,
    import: 0.45,
    reexport: 0.4,
    namespace: 0.4,
    wildcard: 0.3,
    scopeChainPerDepth: -0.02,
    typeBindingByMroDepth: [0.5, 0.42, 0.36, 0.32, 0.3],
    ownerMatch: 0.2,
    kindMatch: 0.0,
    arityMatchCompatible: 0.1,
    arityMatchUnknown: 0.0,
    arityMatchIncompatible: -0.15,
    globalQualified: 0.35,
    globalName: 0.1,
    dynamicImportUnresolved: 0.02,
    unlinkedImportMultiplier: 0.5,
};
export function typeBindingWeightAtDepth(mroDepth) {
    const table = EvidenceWeights.typeBindingByMroDepth;
    if (mroDepth < 0)
        return table[0];
    if (mroDepth >= table.length)
        return table[table.length - 1];
    return table[mroDepth];
}
export function composeWeights(...weights) {
    const sum = weights.reduce((s, w) => s + w, 0);
    return Math.min(1.0, Math.max(0.0, sum));
}
//# sourceMappingURL=evidence-weights.js.map