export function groupFilesByOwner(files, resolveOwner) {
    const result = new Map();
    for (const { filePath } of files) {
        const owner = resolveOwner(filePath);
        const list = result.get(owner);
        if (list != null) {
            list.push(filePath);
        }
        else {
            result.set(owner, [filePath]);
        }
    }
    return result;
}
export function computeGroupScore(files, scoreMap) {
    const known = files.filter(f => scoreMap.has(f));
    if (known.length === 0)
        return 100;
    const sum = known.reduce((acc, f) => acc + scoreMap.get(f), 0);
    return sum / known.length;
}
function gradeFromScore(score) {
    if (score >= 90)
        return 'A';
    if (score >= 75)
        return 'B';
    if (score >= 60)
        return 'C';
    if (score >= 40)
        return 'D';
    return 'F';
}
export function buildHealthGrouping(files, resolveOwner, scoreMap, lineCountMap) {
    const grouped = groupFilesByOwner(files.map(f => ({ filePath: f })), resolveOwner);
    const groups = [];
    for (const [owner, ownerFiles] of grouped.entries()) {
        const score = computeGroupScore(ownerFiles, scoreMap);
        const totalLines = ownerFiles.reduce((sum, f) => sum + (lineCountMap.get(f) ?? 0), 0);
        groups.push({
            name: owner,
            files: ownerFiles,
            fileCount: ownerFiles.length,
            score,
            grade: gradeFromScore(score),
            totalLines,
            unusedExports: 0,
            circularDeps: 0,
        });
    }
    groups.sort((a, b) => b.score - a.score);
    const totalFiles = files.length;
    const averageScore = groups.length > 0
        ? groups.reduce((sum, g) => sum + g.score * g.fileCount, 0) / Math.max(totalFiles, 1)
        : 100;
    return { groups, totalFiles, averageScore };
}
//# sourceMappingURL=health-grouping.js.map