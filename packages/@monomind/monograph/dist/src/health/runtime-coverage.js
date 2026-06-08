export function classifyRuntimeVerdict(signal) {
    if (signal === undefined)
        return 'CoverageUnavailable';
    if (signal.requestsPerDay === 0)
        return 'LowTraffic';
    if (signal.lastSeenDaysAgo !== undefined && signal.lastSeenDaysAgo > 30)
        return 'LowTraffic';
    if (signal.requestsPerDay !== undefined && signal.requestsPerDay > 10)
        return 'Active';
    return 'Unknown';
}
export function classifyRiskBand(staticVerdict, runtimeVerdict) {
    if (staticVerdict === 'unused') {
        if (runtimeVerdict === 'LowTraffic' || runtimeVerdict === 'CoverageUnavailable')
            return 'Critical';
        if (runtimeVerdict === 'Unknown')
            return 'High';
        if (runtimeVerdict === 'Active')
            return 'Medium';
    }
    return 'Low';
}
export function recommendAction(riskBand, runtimeVerdict) {
    if (riskBand === 'Critical') {
        if (runtimeVerdict === 'LowTraffic')
            return 'Delete';
        return 'Review';
    }
    if (riskBand === 'High')
        return 'Review';
    if (riskBand === 'Medium')
        return 'Monitor';
    return 'Keep';
}
export function classifyRuntimeCoverage(path, staticVerdict, signal) {
    const runtimeVerdict = classifyRuntimeVerdict(signal);
    const riskBand = classifyRiskBand(staticVerdict, runtimeVerdict);
    const recommendedAction = recommendAction(riskBand, runtimeVerdict);
    return { path, staticVerdict, runtimeVerdict, riskBand, recommendedAction };
}
//# sourceMappingURL=runtime-coverage.js.map