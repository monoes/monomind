/**
 * Evidence weight constants for scope-based resolution.
 */
export declare const EvidenceWeights: {
    readonly local: 0.55;
    readonly import: 0.45;
    readonly reexport: 0.4;
    readonly namespace: 0.4;
    readonly wildcard: 0.3;
    readonly scopeChainPerDepth: -0.02;
    readonly typeBindingByMroDepth: readonly [0.5, 0.42, 0.36, 0.32, 0.3];
    readonly ownerMatch: 0.2;
    readonly kindMatch: 0;
    readonly arityMatchCompatible: 0.1;
    readonly arityMatchUnknown: 0;
    readonly arityMatchIncompatible: -0.15;
    readonly globalQualified: 0.35;
    readonly globalName: 0.1;
    readonly dynamicImportUnresolved: 0.02;
    readonly unlinkedImportMultiplier: 0.5;
};
export declare function typeBindingWeightAtDepth(mroDepth: number): number;
export declare function composeWeights(...weights: number[]): number;
//# sourceMappingURL=evidence-weights.d.ts.map