export function crossReference(duplication, deadCode) {
    const findings = [];
    let clonesInUnusedFiles = 0, clonesWithUnusedExports = 0;
    // Preindex unusedExports and unusedTypes by file path to avoid O(N) Array.find
    // per clone instance. Each lookup becomes an O(1) Map get + a short in-range scan
    // over the candidates for that specific file.
    const exportsByPath = new Map();
    for (const e of deadCode.unusedExports) {
        const bucket = exportsByPath.get(e.path) ?? [];
        bucket.push({ exportName: e.exportName, line: e.line });
        exportsByPath.set(e.path, bucket);
    }
    const typesByPath = new Map();
    for (const t of deadCode.unusedTypes) {
        const bucket = typesByPath.get(t.path) ?? [];
        bucket.push({ typeName: t.typeName, line: t.line });
        typesByPath.set(t.path, bucket);
    }
    for (let gi = 0; gi < duplication.cloneGroups.length; gi++) {
        for (const inst of duplication.cloneGroups[gi].instances) {
            if (deadCode.unusedFiles.has(inst.file)) {
                findings.push({ cloneInstance: inst, deadCodeKind: { type: 'unused-file' }, groupIndex: gi });
                clonesInUnusedFiles++;
                continue;
            }
            const exportsForFile = exportsByPath.get(inst.file);
            const overlap = exportsForFile?.find(e => e.line >= inst.startLine && e.line <= inst.endLine);
            if (overlap) {
                findings.push({ cloneInstance: inst, deadCodeKind: { type: 'unused-export', exportName: overlap.exportName }, groupIndex: gi });
                clonesWithUnusedExports++;
                continue;
            }
            const typesForFile = typesByPath.get(inst.file);
            const typeOverlap = typesForFile?.find(t => t.line >= inst.startLine && t.line <= inst.endLine);
            if (typeOverlap) {
                findings.push({ cloneInstance: inst, deadCodeKind: { type: 'unused-type', typeName: typeOverlap.typeName }, groupIndex: gi });
                clonesWithUnusedExports++;
            }
        }
    }
    return { combinedFindings: findings, clonesInUnusedFiles, clonesWithUnusedExports };
}
export function affectedGroupIndices(result) {
    return new Set(result.combinedFindings.map(f => f.groupIndex));
}
//# sourceMappingURL=cross-reference-findings.js.map