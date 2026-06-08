export function computeEffortFromLines(lines) {
    if (lines < 50)
        return 'Low';
    if (lines < 200)
        return 'Medium';
    if (lines < 500)
        return 'High';
    return 'VeryHigh';
}
export function computeConfidenceFromFactors(factorCount) {
    if (factorCount === 1)
        return 'Low';
    if (factorCount <= 3)
        return 'Medium';
    return 'High';
}
//# sourceMappingURL=target-types.js.map