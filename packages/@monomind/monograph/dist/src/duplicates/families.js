export const MODULE_EXTRACTION_THRESHOLD = 50;
function fileSetKey(files) {
    return [...files].sort().join('\0');
}
function dirOf(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.slice(0, idx) : '';
}
function generateSuggestions(files, groups, totalDuplicatedLines) {
    if (totalDuplicatedLines < MODULE_EXTRACTION_THRESHOLD) {
        return groups.map((g) => ({
            kind: 'ExtractFunction',
            description: `Extract shared function (${g.duplicatedLines} lines) from ${g.instances.map((i) => i.filePath.split('/').pop() ?? i.filePath).join(', ')}`,
            estimatedLines: g.duplicatedLines,
            files,
        }));
    }
    const dirs = [...new Set(files.map(dirOf))];
    if (dirs.length > 1 && files.length >= 3) {
        return [
            {
                kind: 'MergeDirectories',
                description: `Consider merging ${dirs.length} directories with ${totalDuplicatedLines} shared lines`,
                estimatedLines: totalDuplicatedLines,
                files,
            },
        ];
    }
    return [
        {
            kind: 'ExtractModule',
            description: `Extract ${totalDuplicatedLines} duplicated lines into a shared module`,
            estimatedLines: totalDuplicatedLines,
            files,
        },
    ];
}
export function groupRawGroupsIntoFamilies(groups) {
    const familyMap = new Map();
    for (const group of groups) {
        const files = group.instances.map((i) => i.filePath);
        const key = fileSetKey(files);
        if (!familyMap.has(key)) {
            familyMap.set(key, { files: new Set(files), groups: [] });
        }
        familyMap.get(key).groups.push(group);
    }
    const families = [];
    for (const { files, groups: fg } of familyMap.values()) {
        const fileList = [...files].sort();
        const totalDuplicatedLines = fg.reduce((s, g) => s + g.duplicatedLines, 0);
        families.push({
            files: fileList,
            groupCount: fg.length,
            totalDuplicatedLines,
            suggestions: generateSuggestions(fileList, fg, totalDuplicatedLines),
        });
    }
    families.sort((a, b) => b.totalDuplicatedLines - a.totalDuplicatedLines);
    return families;
}
//# sourceMappingURL=families.js.map