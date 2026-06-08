export function computePipelineStats(groups, allFileIds, totalTokens, totalLines, fileLineCount) {
    const filesWithClones = new Set();
    const fileDupLines = new Map();
    let duplicatedTokens = 0;
    let cloneInstances = 0;
    for (const group of groups) {
        for (const inst of group.instances) {
            filesWithClones.add(inst.fileId);
            cloneInstances++;
            let lineSet = fileDupLines.get(inst.fileId);
            if (!lineSet) {
                lineSet = new Set();
                fileDupLines.set(inst.fileId, lineSet);
            }
            const lines = fileLineCount(inst.fileId, inst.offset, group.lcpLength);
            for (let l = 0; l < lines; l++) {
                lineSet.add(inst.offset + l);
            }
        }
        if (group.instances.length > 1) {
            duplicatedTokens += group.lcpLength * (group.instances.length - 1);
        }
    }
    let duplicatedLines = 0;
    for (const lineSet of fileDupLines.values()) {
        duplicatedLines += lineSet.size;
    }
    duplicatedTokens = Math.min(duplicatedTokens, totalTokens);
    const duplicationPct = totalLines > 0 ? (duplicatedLines / totalLines) * 100 : 0;
    return {
        totalFiles: allFileIds.length,
        filesWithClones: filesWithClones.size,
        totalTokens,
        duplicatedTokens,
        totalLines,
        duplicatedLines,
        cloneGroups: groups.length,
        cloneInstances,
        duplicationPct,
    };
}
//# sourceMappingURL=statistics.js.map