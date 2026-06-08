export const OUTPUT_DIRS = ["dist", "build", "out", "esm", "cjs", ".next", ".nuxt", ".output"];
export function isTestEntryPoint(filePath) {
    return (filePath.includes("/__tests__/") ||
        filePath.includes(".test.") ||
        filePath.includes(".spec.") ||
        filePath.includes("/test/") ||
        filePath.includes("/tests/"));
}
export function categorizeEntryPoints(entryPoints) {
    const result = { all: [], runtime: [], test: [] };
    for (const ep of entryPoints) {
        result.all.push(ep);
        if (isTestEntryPoint(ep)) {
            result.test.push(ep);
        }
        else {
            result.runtime.push(ep);
        }
    }
    return result;
}
export function formatSkippedEntryWarning(filePath, reason) {
    return `Skipped entry point ${filePath}: ${reason}`;
}
export function deduplicateEntryPoints(entries) {
    return [...new Set(entries)];
}
//# sourceMappingURL=entry-points.js.map