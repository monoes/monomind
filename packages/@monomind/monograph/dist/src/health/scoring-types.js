export function computeComplexityDensity(totalCyclomatic, lineCount) {
    return totalCyclomatic / Math.max(lineCount, 1);
}
export function computeDeadCodeRatio(unusedExports, totalExports) {
    return Math.min(unusedExports / Math.max(totalExports, 1), 1.0);
}
export function computeMaintainabilityIndex(halsteadVolume, cyclomaticComplexity, lineCount) {
    const v = Math.max(halsteadVolume, 1);
    const loc = Math.max(lineCount, 1);
    const mi = 171 - 5.2 * Math.log(v) - 0.23 * cyclomaticComplexity - 16.2 * Math.log(loc);
    return Math.min(Math.max(mi, 0), 100);
}
//# sourceMappingURL=scoring-types.js.map