export function buildAnalysisCountsSnapshot(fileScores) {
    const counts = new Map();
    for (const { filePath, ...rest } of fileScores) {
        counts.set(filePath, rest);
    }
    return { counts };
}
export function countsFor(snapshot, roots) {
    const filtered = new Map();
    for (const [key, value] of snapshot.counts) {
        if (roots.some((root) => key.startsWith(root))) {
            filtered.set(key, value);
        }
    }
    return { counts: filtered };
}
export function serializeSnapshot(snapshot) {
    const result = {};
    for (const [key, value] of snapshot.counts) {
        result[key] = value;
    }
    return result;
}
export function deserializeSnapshot(data) {
    const counts = new Map();
    for (const [key, value] of Object.entries(data)) {
        counts.set(key, value);
    }
    return { counts };
}
//# sourceMappingURL=analysis-counts-snapshot.js.map