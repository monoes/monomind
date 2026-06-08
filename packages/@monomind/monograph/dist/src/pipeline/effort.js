const EFFORT_PROFILES = {
    low: {
        runChurn: false,
        runOwnership: false,
        runHotspots: false,
        runFileScores: true,
        runSuffixArray: false,
        runCrossReference: false,
        maxFilesForExpensiveAnalysis: 100,
    },
    medium: {
        runChurn: true,
        runOwnership: false,
        runHotspots: true,
        runFileScores: true,
        runSuffixArray: false,
        runCrossReference: true,
        maxFilesForExpensiveAnalysis: 500,
    },
    high: {
        runChurn: true,
        runOwnership: true,
        runHotspots: true,
        runFileScores: true,
        runSuffixArray: true,
        runCrossReference: true,
        maxFilesForExpensiveAnalysis: Infinity,
    },
};
export function getEffortProfile(effort = 'medium') {
    return EFFORT_PROFILES[effort];
}
export function parseEffort(s) {
    if (s === 'low' || s === 'medium' || s === 'high')
        return s;
    return 'medium';
}
//# sourceMappingURL=effort.js.map